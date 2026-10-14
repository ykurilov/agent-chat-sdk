import { randomUUID } from "node:crypto";
import { ChatNotFoundError } from "@ykurilov/agent-chat-core";
import type { Transition } from "../engine/flow-run";
import type { PendingFlowChange } from "../store/flow-store";
import type { FlowPort, FlowSignalInput } from "./flow-types";
import { advance, exactFirstText, personTimeZone, runOutsideTurn, type FlowRuntime } from "./flow-events";
import { FLOW_EVENT_NOTICE } from "./prepare-turn";
import { chatTime } from "./test-clock";

/**
 * Событие приложения с «будить»: служебное сообщение `app` (`flow_event`), агент отвечает сразу. Переход применит
 * `prepareTurn` этого хода; у нового состояния точный первый текст — готовый ответ без модели. Срочный сигнал проходит
 * мимо правил «писать первым» и в счётчик не идёт. Чат занят — событие ждёт начала следующего хода.
 */
export async function sendFlowSignal(input: { runtime: FlowRuntime; port: FlowPort; signal: FlowSignalInput }): Promise<void> {
  const { runtime, port, signal } = input;
  const { ownerId, chatId, name } = signal;
  const at = runtime.now();
  const key = `signal:${randomUUID()}`;
  const pending: PendingFlowChange = { kind: "event", key, name, ...(signal.data !== undefined && { data: signal.data }), at: new Date(at).toISOString() };

  const pinned = await runtime.chatFlow(ownerId, chatId);
  if (!pinned) {
    runtime.logError(`[сценарий] чат=${chatId}: сигнал «${name}» пропущен — чат не идёт по сценарию`);
    return;
  }
  let values: Record<string, unknown>;
  try {
    ({ values } = await port.getChatState(ownerId, chatId));
  } catch (error) {
    if (error instanceof ChatNotFoundError) return;
    throw error;
  }
  const transitions: Transition[] = [];
  const run = await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, at);
  const next = advance(pinned.flow, run, { type: "event", event: "app", name }, {
    now: chatTime(run, at),
    timeZone: await personTimeZone(runtime, { ownerId, chatId }),
    card: await runtime.cardValues(ownerId),
    out: transitions,
    onChainLimit: () => {},
  });
  const reply = transitions.length > 0 ? exactFirstText(pinned.flow, next.state) : null;
  const result = await port.deliverNotices({
    ownerId,
    chatId,
    notices: [{ kind: "app", name: FLOW_EVENT_NOTICE, title: `Событие приложения «${name}»`, data: { name, ...(signal.data !== undefined && { data: signal.data }) } }],
    wakeAgent: true,
    deliveryKey: `flow:${chatId}:${key}`,
    ...(reply && { reply: { text: reply } }),
  });
  // Ход не начался — событие применит начало следующего хода.
  if (result.status === "busy" || (result.status === "delivered" && !result.turnStarted)) await runtime.store.addPending(chatId, pending);
}
