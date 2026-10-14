import type { ClientFact, FlowStore } from "../store/flow-store";
import type { ClientCardStore, ClientFactStore } from "./flow-types";

/** Факт в таблице карточки модуля — запись с `fieldId` = `fact:<id>`; приложение не должно называть так свои поля. */
export const FACT_PREFIX = "fact:";
export const MAX_FACTS = 30;
export const MAX_FACT_LENGTH = 200;

const normalized = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/** Тот же факт (с точностью до регистра и пробелов) — тот же id: `f` и восемь шестнадцатеричных цифр. */
export function factId(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of normalized(text)) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `f${hash.toString(16).padStart(8, "0")}`;
}

export const sameFact = (left: string, right: string) => normalized(left) === normalized(right);

export const isFactEntry = (fieldId: string) => fieldId.startsWith(FACT_PREFIX);

/** Факты по времени записи, раньше — выше: начало блока для модели не меняется, пока не пишут новое. */
export const byWriteOrder = (left: ClientFact, right: ClientFact) => left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);

/** Факты в таблице модуля: рядом с полями карточки, под префиксом. Своей таблицы и миграции не нужно. */
function moduleFacts(store: FlowStore): ClientFactStore {
  const read = async (ownerId: string): Promise<ClientFact[]> => {
    const entries = await store.readCard(ownerId);
    return entries
      .filter((entry) => isFactEntry(entry.fieldId))
      .map((entry) => ({ id: entry.fieldId.slice(FACT_PREFIX.length), text: String(entry.value), updatedAt: entry.updatedAt, chatId: entry.chatId, flowId: entry.flowId }))
      .sort(byWriteOrder);
  };
  return {
    read,
    add: ({ ownerId, fact, chatId, flowId, at }) => store.writeCardField({ ownerId, fieldId: `${FACT_PREFIX}${fact.id}`, value: fact.text, chatId, flowId, at: at.toISOString() }),
    async forget(ownerId, id) {
      if (id !== "all") return store.forgetCard(ownerId, `${FACT_PREFIX}${id}`);
      for (const fact of await read(ownerId)) await store.forgetCard(ownerId, `${FACT_PREFIX}${fact.id}`);
    },
  };
}

/** Факты человека: у приложения (`clientCard.facts`) или в таблице модуля. */
export function clientFactStore(store: FlowStore, adapter?: ClientCardStore): ClientFactStore {
  const own = adapter?.facts;
  if (!own) return moduleFacts(store);
  return {
    read: async (ownerId) => [...(await own.read(ownerId))].sort(byWriteOrder),
    add: (input) => own.add(input),
    forget: (ownerId, id) => own.forget(ownerId, id),
  };
}

/** Факт как запись карточки: так его видят `readClientCard` и экран («Что агент знает о вас»). */
export const factEntry = (fact: ClientFact) => ({ fieldId: `${FACT_PREFIX}${fact.id}`, value: fact.text, updatedAt: fact.updatedAt, chatId: fact.chatId, flowId: fact.flowId });
