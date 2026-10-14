import type { ToolSet } from "ai";
import type { ClientFact, FlowStore } from "../store/flow-store";
import { clientCardBlock } from "../prompt/client-card-block";
import type { CardToolsTurn, ClientCardStore, ClientCardTools, ClientFactStore } from "./flow-types";
import { FACT_PREFIX, clientFactStore, factEntry, isFactEntry } from "./client-facts";
import { CLIENT_CARD_TOOL, FLOW_NOTE_TOOL, noteTools } from "./note-tools";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Карточка у приложения: читается, пишется и стирается там. Остальное (таймеры, попытки задач) — в хранилище модуля. */
const withAppCard = (store: FlowStore, adapter: ClientCardStore, facts: ClientFactStore): FlowStore => ({
  ...store,
  readCard: (ownerId) => adapter.read(ownerId),
  writeCardField: ({ at, ...input }) => adapter.write({ ...input, at: new Date(at) }),
  forgetCard: (ownerId, fieldId) => forgetEverything(store, facts, ownerId, fieldId, () => adapter.forget(ownerId, fieldId)),
});

/**
 * «Забудь всё» стирает и свободные факты, и счётчики попыток попутных задач человека; не стёрлась карточка — остальное
 * остаётся. Факты стираются всегда, даже если `clientFacts` потом выключили: записанное нельзя оставить без «забудь».
 */
async function forgetEverything(store: FlowStore, facts: ClientFactStore, ownerId: string, fieldId: string | "all", forgetCard: () => Promise<void>): Promise<void> {
  await forgetCard();
  if (fieldId !== "all") return;
  await facts.forget(ownerId, "all");
  await store.forgetSideTasks(ownerId);
}

/** Что сказать агенту, когда хранилище приложения не ответило: он не должен считать запись сделанной. */
function failureText(tool: string, input: unknown): string {
  if (tool === FLOW_NOTE_TOOL) return "Не записано: хранилище недоступно, ничего не сохранено. Не говори человеку, что запомнил; продолжай разговор.";
  if ((input as { action?: string } | undefined)?.action === "forget") {
    return "Не стёр: хранилище недоступно, ничего не удалено. Скажи человеку, что не получилось и надо повторить позже.";
  }
  return "Не удалось прочитать, что известно о человеке: хранилище недоступно. Скажи об этом один раз, ничего не придумывай.";
}

/** Сбой хранилища приложения в инструменте карточки — ответ агенту и строка в журнал, а не обрыв хода. */
function guarded(tools: ToolSet, logError: (message: string) => void): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, original]) => {
      const execute = original.execute;
      if (!execute || (name !== FLOW_NOTE_TOOL && name !== CLIENT_CARD_TOOL)) return [name, original];
      return [
        name,
        {
          ...original,
          execute: async (input: unknown, options: never) => {
            try {
              return await (execute as (input: unknown, options: never) => unknown)(input, options);
            } catch (error) {
              logError(`[сценарий] карточка клиента: «${name}» не отработал: ${errorText(error)}`);
              return failureText(name, input);
            }
          },
        } as typeof original,
      ];
    }),
  );
}

/**
 * Карточка клиента: чтение, запись агентом, «стереть поле» и «стереть всё». Есть `adapter` — всё лежит в хранилище
 * приложения (читается, пишется и стирается там, таблица модуля не нужна). Нет — таблица модуля, как в 0.48.
 */
export function createClientCard(
  store: FlowStore,
  now: () => Date,
  adapter?: ClientCardStore,
  logError: (message: string) => void = () => {},
  options: { facts?: boolean } = {},
): ClientCardTools {
  const facts = clientFactStore(store, adapter);
  const cardStore: FlowStore = adapter
    ? withAppCard(store, adapter, facts)
    : { ...store, forgetCard: (ownerId, fieldId) => forgetEverything(store, facts, ownerId, fieldId, () => store.forgetCard(ownerId, fieldId)) };
  // Факты на чтении: записи `fact:<id>` в таблице модуля и свои факты приложения одинаково отдаются записями карточки.
  const readAll = async (ownerId: string) => {
    const fields = (await cardStore.readCard(ownerId)).filter((entry) => !isFactEntry(entry.fieldId));
    return [...fields, ...(await facts.read(ownerId)).map(factEntry)];
  };
  return {
    tools: (turn: CardToolsTurn) => {
      const tools = noteTools({ store: cardStore, now, turn, ...(options.facts && { facts }) });
      return adapter ? guarded(tools, logError) : tools;
    },
    async block({ ownerId, flow, run }) {
      let card;
      let known: ClientFact[] = [];
      try {
        card = (await cardStore.readCard(ownerId)).filter((entry) => !isFactEntry(entry.fieldId));
        if (options.facts) known = await facts.read(ownerId);
      } catch (error) {
        if (!adapter) throw error;
        // Хранилище приложения не ответило: ход идёт без блока, а не падает.
        logError(`[сценарий] карточка клиента не прочитана: ${errorText(error)}`);
        return "";
      }
      return clientCardBlock({ flow, run, card, facts: known, now: now().getTime() + (run.timeOffset ?? 0) });
    },
    read: readAll,
    forget: (ownerId, fieldId) => (fieldId.startsWith(FACT_PREFIX) ? facts.forget(ownerId, fieldId.slice(FACT_PREFIX.length)) : cardStore.forgetCard(ownerId, fieldId)),
  };
}
