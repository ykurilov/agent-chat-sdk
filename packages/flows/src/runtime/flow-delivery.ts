import { randomUUID } from "node:crypto";
import { answerText, ChatNotFoundError, deliverableParts, isHumanMessage, type AgentChatMessage, type StoredMessage } from "@ykurilov/agent-chat-core";
import type { FlowFirstReason } from "../engine/nudges";
import { FLOW_DELIVERY_EXIT, type FlowChatRecord, type FlowPendingDelivery } from "../store/flow-store";
import { sameDelivery } from "../store/flow-store-shared";
import type {
  FirstMessageRules,
  FlowAttachment,
  FlowDeliveryOutcome,
  FlowDeliveryReport,
  FlowOutgoing,
  FlowPort,
  FlowResumeDeliveryInput,
  FlowResumeDeliveryResult,
} from "./flow-types";
import { runOutsideTurn, type FlowRuntime } from "./flow-events";
import type { FlowFinisher } from "./flow-finish";
import { holdLease } from "./flow-lease";

// Этап 7 сценариев: доставка ответа, написанного первым, в каналы приложения и разбор исходов. По plan.md, «Доставка в
// каналы приложения». Исход последний побеждает; «заблокировал» закрывает разговор один раз.

export { FLOW_DELIVERY_EXIT } from "../store/flow-store";

/** Паузы перед повторами: после 1-й попытки — 1 мин, после 2-й — 5 мин, после 3-й — 30 мин; дальше — не доставлено. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;
/** Пауза попытки: копия упала посреди отправки — та же попытка повторится через столько. */
const pauseOf = (attempt: number) => RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]!;

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
  /** Конец разговора, при котором шёл ход: `null` — живой разговор, у прощания — конец по сроку. Сменился — не отправлять. */
  endedAt: string | null;
}

/** Последняя проверка перед отправкой: что отправить, или ответ снят (`stale`), или запись ведёт другой писатель. */
type Ready = { message: FlowOutgoing } | { stale: true; answerId?: string } | { replaced: true };

export interface FlowDelivery {
  /** У приложения своя доставка (`attach({ deliver })`). Нет — доставляют каналы SDK, как в 0.48. */
  own(): boolean;
  /** Исход из каналов SDK (`reportDelivery`). */
  report(input: FlowDeliveryReport): Promise<void>;
  /** Ход «пишет первым» закончен: своя доставка — первая попытка; каналы SDK — в счётчик дня сразу (как в 0.48). */
  afterFirstTurn(turn: FirstTurnAnswer): Promise<void>;
  /**
   * Наступил срок повтора (`record.delivery`): тот же текст, тот же `messageId`, без нового хода. `from` — аренда
   * срабатывания таймера: отправка берёт её себе.
   */
  retry(record: FlowChatRecord, serverAt: number, from: string): Promise<void>;
  /** Канал починили (`resumeDelivery`): отправка, ждавшая починки, уходит таймеру. */
  resume(input: FlowResumeDeliveryInput): Promise<FlowResumeDeliveryResult>;
}

export function createFlowDelivery(input: {
  runtime: FlowRuntime;
  deliver: () => FlowAttachment["deliver"];
  /** Аренда отправки: как у таймеров, продлевается каждую треть. */
  leaseMs: number;
  port?: (chat: { ownerId: string; chatId: string }) => Promise<FlowPort>;
  finish?: () => FlowFinisher;
  firstMessages?: () => FirstMessageRules | null;
  timeZoneOf?: (ownerId: string, chatId: string) => Promise<string>;
  /**
   * Сроки чата пересчитать по месту из состояния: отправка закончилась, касание не засчитано (`failedAt` — когда узнали
   * об отказе, следующий срок не раньше), в том числе по исходу каналов SDK (`failed`, `window_closed`).
   */
  recount?: (chat: { ownerId: string; chatId: string; failedAt?: number }) => Promise<void>;
}): FlowDelivery {
  const { runtime } = input;
  const store = runtime.store;
  const portOf = (chat: { ownerId: string; chatId: string }) => {
    if (!input.port) throw new Error("Доставка сценария собрана без службы чата");
    return input.port(chat);
  };
  /** Итог уже записан: сбой пересчёта — в журнал (срок доставки в записи остаётся, таймер пересчитает по нему). */
  async function recount(chat: { ownerId: string; chatId: string; failedAt?: number }): Promise<void> {
    try {
      await input.recount?.(chat);
    } catch (error) {
      runtime.logError(`[сценарий] чат=${chat.chatId} сроки после доставки не пересчитаны: ${errorText(error)}`);
    }
  }

  /** Версия записи доставки: своя у каждой отправки и каждой замены. Разные копии и попытки одной копии не совпадают. */
  const writer = `flow-delivery:${randomUUID()}`;
  let written = 0;
  const nextToken = () => `${writer}:d${++written}`;

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
    const pinned = await runtime.chatFlow(ownerId, chatId);
    if (!pinned || !input.finish) {
      await store.endChat(chatId, { reason: "blocked", at: isoOf(runtime.now()) });
      return;
    }
    const { values } = await (await portOf({ ownerId, chatId })).getChatState(ownerId, chatId);
    const at = runtime.now();
    await input.finish().end({ ownerId, chatId, pinned, run: await runOutsideTurn(runtime, { ownerId, chatId }, pinned.flow, values, at), reason: "blocked", at });
  }

  /**
   * Ответ устарел: его нет в видимой ветке (удалён, ветку сменили) или — после починки канала — человек уже написал
   * после него. Тогда `answer` — ответ в ветке (если есть).
   */
  async function staleness(record: FlowChatRecord, pending: FlowPendingDelivery): Promise<{ stale: boolean; answer?: AgentChatMessage }> {
    let messages: readonly AgentChatMessage[];
    try {
      ({ messages } = await (await portOf(record)).peekHistory(record.ownerId, record.chatId));
    } catch (error) {
      if (error instanceof ChatNotFoundError) return { stale: true };
      throw error;
    }
    const index = messages.findIndex((message) => message.id === pending.messageId);
    if (index < 0) return { stale: true };
    const answer = messages[index]!;
    const repaired = pending.resumedAt !== undefined;
    return { stale: repaired && messages.slice(index + 1).some(isHumanMessage), answer };
  }

  /** Снять устаревшую отправку без отправки и без засчитывания; ответ в ветке — недоставлен. `false` — запись уже другая. */
  async function drop(record: FlowChatRecord, pending: FlowPendingDelivery, answerId: string | undefined, freeAt?: string): Promise<boolean> {
    const { ownerId, chatId } = record;
    if (!(await store.swapDelivery(chatId, { expected: pending, next: null, ...(freeAt && { freeAt }) }))) return false;
    if (answerId) await markUndelivered(ownerId, chatId, answerId);
    await recount({ ownerId, chatId, ...(answerId && { failedAt: runtime.now() }) });
    return true;
  }

  /**
   * Итог одной попытки — условной заменой её резерва: запись сменилась (резерв перехватила другая копия, `flow.end`) —
   * ничего не пишется и не засчитывается. Итог учитывает, что повторы кончились.
   */
  async function settle(
    reservation: FlowPendingDelivery,
    message: FlowOutgoing,
    outcome: FlowDeliveryOutcome,
    job: { counted: { at: number; timeZone: string }; branchHead: string | null },
  ): Promise<void> {
    const { ownerId, chatId, messageId } = message;
    const swap = (next: FlowPendingDelivery | null, due?: { at: string } | null) =>
      store.swapDelivery(chatId, {
        expected: reservation,
        next,
        ...(due !== undefined && { due: due && { at: due.at, exitId: FLOW_DELIVERY_EXIT, branchHead: job.branchHead } }),
      });
    switch (outcome.status) {
      case "delivered":
        if (!(await swap(null))) return;
        await input.firstMessages?.()?.record({ ownerId, ...job.counted });
        await recount({ ownerId, chatId });
        return;
      case "retry": {
        if (message.attempt > RETRY_DELAYS_MS.length) return settle(reservation, message, { status: "failed" }, job);
        const retryAt = isoOf(runtime.now() + (outcome.afterMs ?? RETRY_DELAYS_MS[message.attempt - 1]!));
        const { resumedAt } = reservation;
        await swap({ messageId, attempt: message.attempt + 1, retryAt, reasons: reservation.reasons, token: nextToken(), ...(resumedAt && { resumedAt }) }, { at: retryAt });
        return;
      }
      case "await_repair": {
        // Попытка не потрачена; срока нет — повтор только после `resumeDelivery`.
        const { resumedAt: _resumedAt, ...rest } = reservation;
        await swap({ ...rest, token: nextToken(), pausedAt: isoOf(runtime.now()) }, null);
        return;
      }
      case "failed":
      case "window_closed":
        if (!(await swap(null))) return;
        await markUndelivered(ownerId, chatId, messageId);
        if (outcome.status === "window_closed") await store.setWindowClosed(chatId, true);
        // Касание не засчитано: следующий срок — от отказа.
        await recount({ ownerId, chatId, failedAt: runtime.now() });
        return;
      case "blocked":
        if (!(await swap(null))) return;
        await markUndelivered(ownerId, chatId, messageId);
        await blocked(ownerId, chatId);
        return;
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

  /**
   * Последняя проверка, уже под резервом и сразу перед внешним вызовом: запись — всё ещё эта попытка, разговор не
   * закончили после хода (`flow.end`), ответ не устарел (`ready`). Человек, написавший после этой проверки, может
   * разминуться с отправкой: общей транзакции с историей чата и каналом нет.
   */
  async function lastCheck(chatId: string, reservation: FlowPendingDelivery, endedAt: string | null | undefined, ready: (record: FlowChatRecord) => Promise<Ready>): Promise<Ready> {
    const record = await store.getChat(chatId);
    if (!record || !sameDelivery(record.delivery, reservation)) return { replaced: true };
    if (endedAt !== undefined && record.endedAt !== endedAt) return { stale: true, answerId: reservation.messageId };
    return ready(record);
  }

  /**
   * Одна попытка своей доставки — первая отправка, прощание и повтор идут здесь. До внешнего вызова — резерв: запись
   * с новой версией, срок повтора на случай падения копии и аренда чата на эту попытку (`from` — аренда срабатывания,
   * которая передаётся ей). Пока `deliver` идёт, аренда продлевается: другая копия ту же попытку не начнёт. Аренда
   * чужая, а запись прежняя — попытка встаёт в очередь таймера. Запись другая — её ведёт другой писатель. Что отправить,
   * решает последняя проверка под резервом (`lastCheck`); `endedAt` — конец, при котором написан ответ (`undefined` — не
   * сверять: повтор ведёт уже записанная доставка, `flow.end` её снимает).
   */
  async function dispatch(job: {
    record: FlowChatRecord;
    expected: FlowPendingDelivery | null;
    attempt: { messageId: string; attempt: number; reasons: string[] };
    endedAt?: string | null;
    ready: (record: FlowChatRecord) => Promise<Ready>;
    counted: { at: number; timeZone: string };
    from?: string;
  }): Promise<void> {
    const { record, expected, attempt } = job;
    const { ownerId, chatId } = record;
    const branchHead = record.dueBranchHead;
    const now = runtime.now();
    const reservation: FlowPendingDelivery = {
      messageId: attempt.messageId,
      attempt: attempt.attempt,
      retryAt: isoOf(now + pauseOf(attempt.attempt)),
      reasons: attempt.reasons,
      token: nextToken(),
      ...(expected?.resumedAt && { resumedAt: expected.resumedAt }),
    };
    const due = (at: string) => ({ at, exitId: FLOW_DELIVERY_EXIT, branchHead });
    const claim = { owner: reservation.token!, now: isoOf(now), leaseMs: input.leaseMs, ...(job.from && { from: job.from }) };
    // Ответ хода — только пока разговор не закончили после него (`flow.end`): условие в той же записи, что и резерв.
    const sameEnd = job.endedAt !== undefined ? { endedAt: job.endedAt } : {};
    if (!(await store.swapDelivery(chatId, { expected, next: reservation, due: due(reservation.retryAt), claim, ...sameEnd }))) {
      const queued = { ...reservation, retryAt: isoOf(now), token: nextToken() };
      if (await store.swapDelivery(chatId, { expected, next: queued, due: due(queued.retryAt), ...sameEnd })) return;
      if (expected === null) {
        // Ждёт другая отправка этого чата или разговор закончили: ответ недоставлен.
        runtime.logError(`[сценарий] чат=${chatId} ответ ${attempt.messageId} не отправлен: ждёт другая доставка или разговор закончен`);
        await markUndelivered(ownerId, chatId, attempt.messageId);
      }
      return;
    }
    const lease = holdLease({ store, chatId, owner: reservation.token!, leaseMs: input.leaseMs, now: () => new Date(runtime.now()), logError: runtime.logError });
    try {
      let ready: Ready;
      let outcome: FlowDeliveryOutcome | undefined;
      try {
        ready = await lastCheck(chatId, reservation, job.endedAt, job.ready);
        if ("message" in ready) outcome = await send(ready.message);
      } finally {
        await lease.stop();
      }
      if ("message" in ready) await settle(reservation, ready.message, outcome!, { counted: job.counted, branchHead });
      else if ("stale" in ready) await drop(record, reservation, ready.answerId);
    } finally {
      await store.releaseLease(chatId, reservation.token!);
    }
  }

  return {
    own: () => Boolean(input.deliver()),

    async afterFirstTurn({ ownerId, chatId, answer, reasons, at, timeZone, endedAt }) {
      if (!input.deliver()) {
        await input.firstMessages?.()?.record({ ownerId, at, timeZone });
        return;
      }
      // Ход прервался или не дал ни текста, ни карточек — отдавать нечего.
      if (!answer || answer.status !== "complete" || !hasContent(answer)) return;
      const record = await store.getChat(chatId);
      if (!record) return;
      // Разговор закончили, пока шёл ход (`flow.end`): ответ не уходит. Конец во время резерва поймает `lastCheck`.
      if (record.endedAt !== endedAt) {
        await markUndelivered(ownerId, chatId, answer.messageId);
        return;
      }
      const message = { ownerId, chatId, messageId: answer.messageId, text: answer.text, parts: answer.parts, reasons, attempt: 1 };
      const attempt = { messageId: message.messageId, attempt: 1, reasons: reasons.map((reason) => JSON.stringify(reason)) };
      await dispatch({ record, expected: null, attempt, endedAt, ready: async () => ({ message }), counted: { at, timeZone } });
    },

    async retry(record, serverAt, from) {
      const pending = record.delivery;
      if (!pending) return;
      const { ownerId, chatId } = record;
      const timeZone = (await input.timeZoneOf?.(ownerId, chatId)) ?? record.timeZone;
      const reasons = pending.reasons.map((reason) => JSON.parse(reason) as FlowFirstReason);
      // Текст — из ветки, прочитанной уже под резервом: ответ мог устареть за любое ожидание до него.
      const ready = async (current: FlowChatRecord): Promise<Ready> => {
        const { stale, answer } = await staleness(current, current.delivery!);
        if (stale || !answer) return { stale: true, ...(answer && { answerId: answer.id }) };
        const message = { ownerId, chatId, messageId: pending.messageId, text: answerText(answer.parts), parts: deliverableParts(answer.parts), reasons, attempt: pending.attempt };
        return { message };
      };
      const attempt = { messageId: pending.messageId, attempt: pending.attempt, reasons: pending.reasons };
      await dispatch({ record, expected: pending, attempt, ready, counted: { at: serverAt, timeZone }, from });
    },

    async resume({ ownerId, chatId, messageId }) {
      // Запись могла смениться между чтением и заменой: читаем заново, но не бесконечно.
      for (let round = 0; round < 3; round += 1) {
        const record = await store.getChat(chatId);
        const pending = record?.delivery;
        if (!record || record.ownerId !== ownerId || !pending || pending.messageId !== messageId) return "not_found";
        if (pending.pausedAt === undefined) return "pending";
        const at = isoOf(runtime.now());
        const { stale, answer } = await staleness(record, { ...pending, resumedAt: at });
        if (stale) {
          if (await drop(record, pending, answer?.id, at)) return "dropped";
        } else {
          const next: FlowPendingDelivery = { messageId, attempt: pending.attempt, retryAt: at, reasons: pending.reasons, token: nextToken(), resumedAt: at };
          const due = { at, exitId: FLOW_DELIVERY_EXIT, branchHead: record.dueBranchHead };
          if (await store.swapDelivery(chatId, { expected: pending, next, due, freeAt: at })) return "resumed";
        }
        // Не вышло: запись прежняя — у чата живая аренда; другая — разобрать заново.
        if (sameDelivery((await store.getChat(chatId))?.delivery ?? null, pending)) return "busy";
      }
      return "busy";
    },

    async report({ chatId, messageId, outcome }) {
      if ((outcome as FlowDeliveryOutcome).status === "await_repair") {
        throw new TypeError("reportDelivery: исход await_repair — только для своей доставки attach({ deliver }); каналы SDK повторяют сами");
      }
      const record = await store.getChat(chatId);
      if (!record) return;
      const { ownerId } = record;
      // Каналы SDK повторяют сами; доставленное в счётчике с начала хода.
      if (outcome.status === "delivered" || outcome.status === "retry") return;
      await markUndelivered(ownerId, chatId, messageId);
      if (outcome.status === "window_closed") await store.setWindowClosed(chatId, true);
      if (outcome.status === "blocked") {
        await store.setDelivery(chatId, null);
        await blocked(ownerId, chatId);
      } else await recount({ ownerId, chatId, failedAt: runtime.now() });
    },
  };
}
