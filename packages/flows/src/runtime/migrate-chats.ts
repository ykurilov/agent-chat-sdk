import type { AgentFlow } from "../format/flow-format";
import { stateById } from "../engine/flow-graph";
import type { StateMap } from "../engine/migrate-run";
import type { ChatsInState, FlowChatRecord, FlowChatSummary, FlowStore, SaveFlowVersionResult } from "../store/flow-store";
import { byVersionAndState } from "../store/flow-store-shared";
import type { ChatMigrator, FlowChatCandidate, FlowChatSelection, LoadedFlow } from "./flow-types";
import { testChatOffset } from "./test-clock";

/** Сколько чатов хранилище переводит за одно обращение. */
const MIGRATE_BATCH = 100;

export interface ChatMigratorDeps {
  store: FlowStore;
  now: () => Date;
  /** Разобрать и проверить сценарий приложения; с ошибками — `null`. */
  checkedFlow(loaded: LoadedFlow): AgentFlow | null;
  /** Сохранить уже проверенный сценарий версии. */
  saveVersion(loaded: LoadedFlow, flow: AgentFlow): Promise<SaveFlowVersionResult>;
  /** Пересчитать таймер переведённого чата по новой версии. Запись чата к этому времени уже на новой версии. */
  rescheduleMigrated(input: { record: FlowChatRecord; flow: AgentFlow; map: StateMap }): Promise<void>;
  /** Данные чата (`Chat.data`) для отбора; чата нет в службе — `{}`. */
  chatData(chat: { ownerId: string; chatId: string }): Promise<Record<string, unknown>>;
}

const chunks = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** Перевод чатов на новую версию пачками: версия меняется сразу, состояние — в начале следующего хода чата. */
export function createChatMigrator(deps: ChatMigratorDeps): ChatMigrator {
  const { store } = deps;

  /** Сценарий новой версии: из запроса (сохраняется после всех проверок) или из хранилища. */
  async function newVersion(flowId: string, versionId: string, raw: unknown): Promise<{ flow: AgentFlow; save?: () => Promise<void> }> {
    if (raw !== undefined) {
      const loaded = { flowId, versionId, flow: raw };
      const flow = deps.checkedFlow(loaded);
      if (!flow) throw new Error(`Сценарий ${flowId}@${versionId} не разобран или с ошибками: чаты не переведены.`);
      return {
        flow,
        save: async () => {
          if ((await deps.saveVersion(loaded, flow)) === "conflict") {
            throw new Error(`Под номером ${versionId} уже сохранён другой сценарий «${flowId}»: возьмите новый номер версии.`);
          }
        },
      };
    }
    const found = await store.getVersion(flowId, versionId);
    if (!found) throw new Error(`Версии ${versionId} сценария «${flowId}» нет в хранилище: передайте её сценарий в поле flow.`);
    return { flow: found.flow };
  }

  /** Чаты сценария после отбора: закончившиеся и тестовые — только по просьбе, потом свой отбор приложения. */
  async function selectedChats(flowId: string, exceptVersionId: string | undefined, selection: FlowChatSelection): Promise<FlowChatCandidate[]> {
    const rows = await store.listFlowChats({ flowId, ...(exceptVersionId !== undefined && { exceptVersionId }), ...(selection.chatIds && { chatIds: selection.chatIds }) });
    const needsData = selection.filter !== undefined || selection.includeTestChats !== true;
    const candidate = async ({ endedAt, ...row }: FlowChatSummary): Promise<FlowChatCandidate | null> => {
      const data = needsData ? await deps.chatData(row) : {};
      const test = testChatOffset(data) !== null;
      if (test && selection.includeTestChats !== true) return null;
      const chat: FlowChatCandidate = { ...row, ended: endedAt !== null, test, data };
      return !selection.filter || (await selection.filter(chat)) ? chat : null;
    };
    const selected: FlowChatCandidate[] = [];
    for (const part of chunks(rows.filter((row) => row.endedAt === null || selection.includeEnded === true), MIGRATE_BATCH)) {
      for (const chat of await Promise.all(part.map(candidate))) if (chat) selected.push(chat);
    }
    return selected;
  }

  function countByState(chats: FlowChatCandidate[]): ChatsInState[] {
    const counts = new Map<string, ChatsInState>();
    for (const chat of chats) {
      const key = JSON.stringify([chat.versionId, chat.stateId]);
      const entry = counts.get(key) ?? { versionId: chat.versionId, stateId: chat.stateId, chats: 0 };
      entry.chats += 1;
      counts.set(key, entry);
    }
    return [...counts.values()].sort(byVersionAndState);
  }

  return {
    async chatsByState(flowId, options = {}) {
      return countByState(await selectedChats(flowId, options.exceptVersionId, options));
    },

    async migrateChats(input) {
      const { flowId, toVersionId, map, flow: raw } = input;
      const { flow: next, save } = await newVersion(flowId, toVersionId, raw);

      // Перевод нужен только удалённым состояниям: у тех, что в новой версии есть, чат остаётся на месте.
      const removedMap: StateMap = Object.fromEntries(Object.entries(map).filter(([stateId]) => !stateById(next, stateId)));
      for (const [from, to] of Object.entries(removedMap)) {
        if (!stateById(next, to)) throw new Error(`Куда перевести чаты из «${from}»: состояния «${to}» нет в версии ${toVersionId}.`);
      }
      // Отбор — один раз, до перевода: переводятся ровно те чаты, что посчитал бы `chatsByState` с тем же отбором.
      const chats = await selectedChats(flowId, toVersionId, input);
      const lost = [...new Set(chats.filter((chat) => !stateById(next, chat.stateId) && removedMap[chat.stateId] === undefined).map((chat) => chat.stateId))];
      if (lost.length > 0) {
        throw new Error(`В версии ${toVersionId} нет состояний ${lost.map((id) => `«${id}»`).join(", ")}, а в них есть чаты: выберите, куда их перевести.`);
      }

      await save?.();
      const at = deps.now().toISOString();
      let moved = 0;
      for (const part of chunks(chats.map((chat) => chat.chatId), MIGRATE_BATCH)) {
        const batch = await store.migrateBatch({ flowId, toVersionId, map: removedMap, chatIds: part, limit: part.length, at });
        moved += batch.moved.length;
        for (const chatId of batch.moved) {
          const record = await store.getChat(chatId);
          if (record) await deps.rescheduleMigrated({ record, flow: next, map: removedMap });
        }
      }
      return { moved };
    },
  };
}
