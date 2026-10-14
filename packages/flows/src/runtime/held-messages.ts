import type { FlowRun } from "../engine/flow-run";
import { FLOW_FIRST_EXIT } from "../engine/timers";
import type { FlowChatRecord, FlowStore } from "../store/flow-store";
import type { FlowPort } from "./flow-types";

// Сообщения человека после жёсткой рамки дня записываются без хода, ответ на них — в начале следующего дня. В месте
// чата их нет (`lastHumanAt` двигает только ход), у сообщений истории нет времени. Поэтому время последнего такого
// сообщения лежит в данных чата (`Chat.data`): их можно писать вне хода, и их видят все копии сервера.

/** Ключ данных чата (`Chat.data`) со временем последнего сообщения человека, отложенного до утра (часы чата, мс). */
export const FLOW_HELD_HUMAN_KEY = "flowHeldHuman";

/** Время последнего отложенного сообщения человека из данных чата, мс; нет — `null`. */
export function heldHumanAt(data: Record<string, unknown> | undefined): number | null {
  const mark = data?.[FLOW_HELD_HUMAN_KEY];
  const at = mark && typeof mark === "object" ? (mark as { at?: unknown }).at : undefined;
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/**
 * Место чата для сроков с отложенным сообщением человека: оно — его слова, как сообщение с ходом. От него считаются
 * тишина человека («не завершил», переход «человек молчит») и правило «писал меньше 3 ч назад» (утреннее, касания утром).
 */
export function withHeldHuman<R extends FlowRun>(run: R, data: Record<string, unknown> | undefined): R {
  const held = heldHumanAt(data);
  return held === null || (run.lastHumanAt !== null && run.lastHumanAt >= held) ? run : { ...run, lastHumanAt: held };
}

/**
 * Сообщение человека отложено до утра: запомнить его время (часы чата) и поставить срок чата не позже `morningAt` (часы
 * сервера) — в этот срок обход таймеров увидит сообщения без ответа в истории и ответит на них. Срок раньше не трогается:
 * обход всё равно считает ближайший заново.
 */
export async function noteHeldUntilMorning(input: {
  store: FlowStore;
  port: FlowPort;
  record: FlowChatRecord;
  at: number;
  morningAt: number;
  logError: (message: string) => void;
}): Promise<void> {
  const { store, port, record, at, morningAt } = input;
  try {
    await port.updateChatData(record.ownerId, record.chatId, { [FLOW_HELD_HUMAN_KEY]: { at } });
  } catch (error) {
    // Хранилище без данных чата: ответ утром всё равно придёт, утреннее касание лишь не узнает о позднем сообщении.
    input.logError(`[сценарий] чат=${record.chatId}: время отложенного сообщения не записано — ${error instanceof Error ? error.message : String(error)}`);
  }
  if (record.dueAt !== null && Date.parse(record.dueAt) <= morningAt) return;
  await store.setDue(record.chatId, { at: new Date(morningAt).toISOString(), exitId: FLOW_FIRST_EXIT, branchHead: record.dueBranchHead }, { unlessDelivery: true });
}
