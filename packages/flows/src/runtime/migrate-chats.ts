import type { AgentFlow } from "../format/flow-format";
import { stateById } from "../engine/flow-graph";
import type { StateMap } from "../engine/migrate-run";
import type { FlowChatRecord, FlowStore, SaveFlowVersionResult } from "../store/flow-store";
import type { ChatMigrator, LoadedFlow } from "./flow-types";

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
}

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

  return {
    async chatsByState(flowId, options) {
      const rows = await store.countChatsByState({ flowId });
      return options?.exceptVersionId === undefined ? rows : rows.filter((row) => row.versionId !== options.exceptVersionId);
    },

    async migrateChats({ flowId, toVersionId, map, flow: raw }) {
      const { flow: next, save } = await newVersion(flowId, toVersionId, raw);

      // Перевод нужен только удалённым состояниям: у тех, что в новой версии есть, чат остаётся на месте.
      const removedMap: StateMap = Object.fromEntries(Object.entries(map).filter(([stateId]) => !stateById(next, stateId)));
      for (const [from, to] of Object.entries(removedMap)) {
        if (!stateById(next, to)) throw new Error(`Куда перевести чаты из «${from}»: состояния «${to}» нет в версии ${toVersionId}.`);
      }
      const counts = await store.countChatsByState({ flowId });
      const lost = [...new Set(counts.filter((row) => row.versionId !== toVersionId && row.chats > 0 && !stateById(next, row.stateId) && removedMap[row.stateId] === undefined).map((row) => row.stateId))];
      if (lost.length > 0) {
        throw new Error(`В версии ${toVersionId} нет состояний ${lost.map((id) => `«${id}»`).join(", ")}, а в них есть чаты: выберите, куда их перевести.`);
      }

      await save?.();
      const at = deps.now().toISOString();
      let moved = 0;
      for (;;) {
        const batch = await store.migrateBatch({ flowId, toVersionId, map: removedMap, limit: MIGRATE_BATCH, at });
        if (batch.moved.length === 0) break;
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
