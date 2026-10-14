import { answerText, ChatNotFoundError, deliverableParts, type StoredMessage } from "@ykurilov/agent-chat-core";
import type { FlowFirstReason } from "../engine/nudges";
import type { FlowChatRecord } from "../store/flow-store";
import type { FirstMessageRules, FlowAttachment, FlowDeliveryOutcome, FlowDeliveryReport, FlowOutgoing, FlowPort } from "./flow-types";
import { runOutsideTurn, type FlowRuntime } from "./flow-events";
import type { FlowFinisher } from "./flow-finish";

// Этап 7 сценариев: доставка ответа, написанного первым, в каналы приложения и разбор исходов. По plan.md, «Доставка в
// каналы приложения». Исход последний побеждает; «заблокировал» закрывает разговор один раз.

/** Срок записи о повторе доставки в таблице сроков. */
export const FLOW_DELIVERY_EXIT = "@delivery";

/** Паузы перед повторами: после 1-й попытки — 1 мин, после 2-й — 5 мин, после 3-й — 30 мин; дальше — не доставлено. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isoOf = (at: number) => new Date(at).toISOString();
/** Есть что доставить: текст или другие части (карточка ролика, картинка, файл). */
const hasContent = (answer: { text: string; parts: StoredMessage["parts"] }) => answer.text.trim() !== "" || answer.parts.some((part) => part.type !== "text");

/** Ход «пишет первым» закончен: что ушло и когда. */
export interface FirstTurnAnswer {
  ownerId: string;
  chatId: string;
  /** Готовый ответ хода (`awaitAnswer`); нет — каналы SDK. */
  answer: { messageId: string; text: string; status: string; parts: StoredMessage["parts"] } | undefined;
  reasons: FlowFirstReason[];
  /** Момент хода по часам чата и пояс человека: счётчик дня. */
  at: number;
  timeZone: string;
}

export interface FlowDelivery {
  /** У приложения своя доставка (`attach({ deliver })`). Нет — доставляют каналы SDK, как в 0.48. */
  own(): boolean;
  /** Отдать ответ в `deliver` и разобрать исход. */
  send(message: FlowOutgoing): Promise<FlowDeliveryOutcome>;
  /** Исход из каналов SDK (`reportDelivery`). */
  report(input: FlowDeliveryReport): Promise<void>;
  /** Ход «пишет первым» закончен: своя доставка — первая попытка; каналы SDK — в счётчик дня сразу (как в 0.48). Итог попытки; нечего отдавать — `null`. */
  afterFirstTurn(turn: FirstTurnAnswer): Promise<FlowDeliveryOutcome["status"] | null>;
  /** Наступил срок повтора (`record.delivery`): тот же текст, тот же `messageId`, без нового хода. Итог попытки; повторять нечего — `null`. */
  retry(record: FlowChatRecord, serverAt: number): Promise<FlowDeliveryOutcome["status"] | null>;
}

export function createFlowDelivery(input: {
  runtime: FlowRuntime;
  deliver: () => FlowAttachment["deliver"];
  port?: (chat: { ownerId: string; chatId: string }) => Promise<FlowPort>;
  finish?: () => FlowFinisher;
  firstMessages?: () => FirstMessageRules | null;
  timeZoneOf?: (ownerId: string, chatId: string) => Promise<string>;
  /** Канал SDK сообщил «не доставлено» (`failed`, `window_closed`): касание не засчитано — сроки чата пересчитать. */
  onUndelivered?: (chat: { ownerId: string; chatId: string; at: number }) => Promise<void>;
}): FlowDelivery {
  const { runtime } = input;
  const store = runtime.store;
  const portOf = (chat: { ownerId: string; chatId: string }) => {
    if (!input.port) throw new Error("Доставка сценария собрана без службы чата");
    return input.port(chat);
  };

  /** Пометить ответ недоставленным: модель его больше не видит. Чат удалён или ответа нет — нечего помечать. */
  async function markUndelivered(ownerId: string, chatId: string, messageId: string): Promise<void> {
    try {
      await (await portOf({ ownerId, chatId })).markUndelivered({ ownerId, chatId, messageId });
    } catch (error) {
      if (error instanceof ChatNotFoundError) return;
      runtime.logError(`[сценарий] чат=${chatId} пометка «не доставлено» не записана: ${errorText(error)}`);
    }
  }

  /** «Заблокировал»: конец разговора `blocked` (один раз), сроков нет. */
  async function blocked(ownerId: string, chatId: string): Promise<void> {
    await store.setDelivery(chatId, null);
    const pinned = await runtime.chatFlow(ownerId, chatId);
    if (!pinned || !input.finish) {
      await store.endChat(chatId, { reason: "blocked", at: isoOf(runtime.now()) });
      return;
    }
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    const at = runtime.now();
    await input.finish().end({ ownerId, chatId, pinned, run: await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, at), reason: "blocked", at });
  }

  /** Исход одной попытки своей доставки; итог — с учётом того, что повторы кончились. */
  async function settle(message: FlowOutgoing, outcome: FlowDeliveryOutcome, counted: { at: number; timeZone: string }): Promise<FlowDeliveryOutcome["status"]> {
    const { ownerId, chatId, messageId } = message;
    switch (outcome.status) {
      case "delivered":
        await store.setDelivery(chatId, null);
        await input.firstMessages?.()?.record({ ownerId, ...counted });
        return outcome.status;
      case "retry": {
        if (message.attempt > RETRY_DELAYS_MS.length) return settle(message, { status: "failed" }, counted);
        const delay = outcome.afterMs ?? RETRY_DELAYS_MS[message.attempt - 1]!;
        const retryAt = runtime.now() + delay;
        const reasons = message.reasons.map((reason) => JSON.stringify(reason));
        await store.setDelivery(chatId, { messageId, attempt: message.attempt + 1, retryAt: isoOf(retryAt), reasons });
        const record = await store.getChat(chatId);
        await store.setDue(chatId, { at: isoOf(retryAt), exitId: FLOW_DELIVERY_EXIT, branchHead: record?.dueBranchHead ?? null });
        return outcome.status;
      }
      case "failed":
        await store.setDelivery(chatId, null);
        await markUndelivered(ownerId, chatId, messageId);
        return outcome.status;
      case "window_closed":
        await store.setDelivery(chatId, null);
        await markUndelivered(ownerId, chatId, messageId);
        await store.setWindowClosed(chatId, true);
        return outcome.status;
      case "blocked":
        await markUndelivered(ownerId, chatId, messageId);
        await blocked(ownerId, chatId);
        return outcome.status;
    }
  }

  /** Своя доставка: бросила — как `retry`. */
  async function send(message: FlowOutgoing): Promise<FlowDeliveryOutcome> {
    const deliver = input.deliver();
    if (!deliver) throw new Error("У приложения нет своей доставки (attach({ deliver }))");
    try {
      return await deliver(message);
    } catch (error) {
      runtime.logError(`[сценарий] чат=${message.chatId} доставка упала: ${errorText(error)}`);
      return { status: "retry" };
    }
  }

  async function sendAndSettle(message: FlowOutgoing, counted: { at: number; timeZone: string }): Promise<FlowDeliveryOutcome["status"]> {
    return settle(message, await send(message), counted);
  }

  return {
    own: () => Boolean(input.deliver()),
    send,

    async afterFirstTurn({ ownerId, chatId, answer, reasons, at, timeZone }) {
      if (!input.deliver()) {
        await input.firstMessages?.()?.record({ ownerId, at, timeZone });
        return null;
      }
      // Ход прервался или не дал ни текста, ни карточек — отдавать нечего.
      if (!answer || answer.status !== "complete" || !hasContent(answer)) return null;
      return sendAndSettle({ ownerId, chatId, messageId: answer.messageId, text: answer.text, parts: answer.parts, reasons, attempt: 1 }, { at, timeZone });
    },

    async retry(record, serverAt) {
      const pending = record.delivery;
      if (!pending) return null;
      const { ownerId, chatId } = record;
      const { messages } = await (await portOf({ ownerId, chatId })).peekHistory(ownerId, chatId);
      const answer = messages.find((message) => message.id === pending.messageId);
      if (!answer) {
        // Ответа нет в ветке (удалён, ветку сменили) — повторять нечего.
        await store.setDelivery(chatId, null);
        return null;
      }
      const text = answerText(answer.parts);
      const parts = deliverableParts(answer.parts);
      const reasons = pending.reasons.map((reason) => JSON.parse(reason) as FlowFirstReason);
      const timeZone = (await input.timeZoneOf?.(ownerId, chatId)) ?? record.timeZone;
      return sendAndSettle({ ownerId, chatId, messageId: pending.messageId, text, parts, reasons, attempt: pending.attempt }, { at: serverAt, timeZone });
    },

    async report({ chatId, messageId, outcome }) {
      const record = await store.getChat(chatId);
      if (!record) return;
      const { ownerId } = record;
      // Каналы SDK повторяют сами; доставленное в счётчике с начала хода.
      if (outcome.status === "delivered" || outcome.status === "retry") return;
      await markUndelivered(ownerId, chatId, messageId);
      if (outcome.status === "window_closed") await store.setWindowClosed(chatId, true);
      if (outcome.status === "blocked") await blocked(ownerId, chatId);
      else await input.onUndelivered?.({ ownerId, chatId, at: runtime.now() });
    },
  };
}
