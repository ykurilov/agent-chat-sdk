import { randomUUID } from "node:crypto";
import { ChatNotFoundError, SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { AgentFlow } from "../format/flow-format";
import type { FlowRun, Transition } from "../engine/flow-run";
import { FLOW_STATE_KEY } from "../engine/flow-run";
import { noteAgentAnswer, withoutUndeliveredTouch } from "../engine/run-updates";
import { nextDayStartAfter } from "../engine/flow-days";
import type { FirstWakeContext, FlowFirstReason } from "../engine/nudges";
import { dueReasons, FLOW_FIRST_EXIT, nextWake, type FlowDue } from "../engine/timers";
import type { FlowChatRecord, FlowStore } from "../store/flow-store";
import type { FirstMessageRules, FlowPort, FlowTimers, FlowTimerSettings } from "./flow-types";
import { advance, chainLimitMessage, chatRun, exactFirstText, storedRun, type ChatFlowRun } from "./flow-events";
import { chatWriteBlock } from "./first-message-rules";
import { firstReasonsNotice } from "./first-reasons-notice";
import { FLOW_DELIVERY_EXIT, type FlowDelivery } from "./flow-delivery";
import { testChatOffset } from "./test-clock";

export const DEFAULT_TIMER_TICK_MS = 15_000;
export const DEFAULT_TIMER_LEASE_MS = 60_000;
/** Сколько наступивших таймеров копия берёт за один обход. */
const TIMER_BATCH = 50;
/** Сколько из них идут одновременно: каждый — ход модели. */
const TIMER_PARALLEL = 5;
const DAY_MS = 86_400_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isoOf = (at: number) => new Date(at).toISOString();

/** Ключ ожидающего перехода и доставки: одно срабатывание условия в одном заходе в состояние. */
const timerKey = (chatId: string, exitId: string, run: FlowRun) => `flow:${chatId}:${exitId}:${run.enteredAt}`;

/**
 * Что в истории меняет сроки. `unanswered` — человек писал после последнего доставленного ответа агента и ответа не
 * получил (ночь, рамка дня, пауза). Ответ места ещё идёт (пересчёт сроков из `afterTurn`) — история его не показывает,
 * но он отвечает на всё до него. `undelivered` — ответы с пометкой «не доставлено».
 */
async function historyFacts(port: FlowPort, ownerId: string, chatId: string, answerId: string | undefined): Promise<{ unanswered: number; undelivered: Set<string> }> {
  const { messages } = await port.peekHistory(ownerId, chatId);
  const undelivered = new Set(messages.flatMap((message) => (message.role === "assistant" && message.metadata?.undelivered === true ? [message.id] : [])));
  if (answerId !== undefined && !messages.some((message) => message.id === answerId)) return { unanswered: 0, undelivered };
  let unanswered = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant" && !undelivered.has(message.id)) break;
    if (message.role === "user" && !message.parts.some((part) => part.type === "data-agent-notice")) unanswered += 1;
  }
  return { unanswered, undelivered };
}

/**
 * Тик по наступившим срокам: аренда, затем один ход «пишет первым» на все причины срока (переход ноды по таймеру,
 * утреннее, накопленное, касание) через `deliverNotices` (вид `app`) или готовый текст. По plan.md, «Пишет первым».
 */
export function createFlowTimers(input: {
  store: FlowStore;
  settings: FlowTimerSettings;
  firstMessages: FirstMessageRules | null;
  /** Служба чата этого разговора. */
  port: (chat: { ownerId: string; chatId: string }) => FlowPort | Promise<FlowPort>;
  logError: (message: string) => void;
  now: () => Date;
  /** Сценарий версии, за которой закреплён чат. */
  flowOf: (record: FlowChatRecord) => Promise<AgentFlow | null>;
  /** Пояс человека: известный пояс чата, иначе приложения, иначе сервера (→ В10). */
  timeZoneOf: (chatId: string, stored: string) => string;
  cardValues: (ownerId: string) => Promise<Record<string, unknown>>;
  /** Наступил «срок вышел» (этап 4): конец разговора и прощание. Нет — срок снимается. */
  onDeadline?: (input: { record: FlowChatRecord; flow: AgentFlow; run: ChatFlowRun; at: number; timeZone: string }) => Promise<void>;
  /** «Не завершил»: тишина человека дольше `giveUpAfter` — конец без сообщения. */
  onGiveUp?: (input: { record: FlowChatRecord; flow: AgentFlow; run: ChatFlowRun; at: number }) => Promise<void>;
  /** Доставка ответа в каналы приложения и счётчик дня. Нет — каналы SDK, счётчик сразу. */
  delivery?: () => FlowDelivery;
}): FlowTimers {
  const { store, firstMessages, port, logError } = input;
  const tickMs = input.settings.tickMs ?? DEFAULT_TIMER_TICK_MS;
  const leaseMs = input.settings.leaseMs ?? DEFAULT_TIMER_LEASE_MS;
  /** Эта копия сервера в арендах. */
  const owner = `flow-timers:${randomUUID()}`;
  let interval: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;

  // Сроки считаются по часам чата, а в хранилище лежат по часам сервера: у тестового чата часы сдвинуты на `offset`.
  const dueInput = (due: FlowDue, branchHead: string | null, offset: number) => ({ at: isoOf(due.at - offset), exitId: due.exitId, branchHead });

  /**
   * Место для сроков «пишет первым»: недоставленное касание не засчитано (FR-309), пауза сотрудника, сообщения человека
   * без ответа. `failedAt` — когда узнали об отказе (часы чата): следующий срок не раньше. `undelivered` — ответ
   * незасчитанного касания: следующий ход «пишет первым» откатит счёт и в месте чата.
   */
  async function placeOf<R extends FlowRun & { answerId?: string }>(
    record: FlowChatRecord,
    chatPort: FlowPort,
    run: R,
    failedAt?: number,
  ): Promise<{ run: R; context: FirstWakeContext; undelivered: string | null }> {
    const pausedUntil = record.pausedUntil === null ? null : Date.parse(record.pausedUntil);
    const facts = await historyFacts(chatPort, record.ownerId, record.chatId, run.answerId);
    const reverted = withoutUndeliveredTouch(run, facts.undelivered);
    if (reverted.undeliveredAt === null) return { run, context: { pausedUntil, unanswered: facts.unanswered }, undelivered: null };
    const undeliveredAt = Math.max(reverted.undeliveredAt, failedAt ?? 0);
    return { run: reverted.run as R, context: { pausedUntil, unanswered: facts.unanswered, undeliveredAt }, undelivered: run.touch!.answerId };
  }

  /** Пересчёты одного чата идут по очереди: поздний с устаревшим чтением не затрёт свежий. */
  const queues = new Map<string, Promise<void>>();
  function oneAtATime(chatId: string, work: () => Promise<void>): Promise<void> {
    const result = (queues.get(chatId) ?? Promise.resolve()).then(work);
    const tail = result.catch(() => {});
    queues.set(chatId, tail);
    void tail.then(() => {
      if (queues.get(chatId) === tail) queues.delete(chatId);
    });
    return result;
  }

  function reschedule(request: { ownerId: string; chatId: string; run: FlowRun; branchHead: string | null; failedAt?: number }): Promise<void> {
    return oneAtATime(request.chatId, () => rescheduleNow(request));
  }

  /** Касание не дошло: сроки — по месту из состояния чата, не раньше отказа (часы сервера). */
  async function recountAfterFailure(ownerId: string, chatId: string, failedAt: number): Promise<void> {
    const { values } = await (await port({ ownerId, chatId })).getChatState(ownerId, chatId);
    const run = storedRun(values[FLOW_STATE_KEY]);
    if (run) await reschedule({ ownerId, chatId, run, branchHead: run.answerId ?? null, failedAt });
  }

  async function rescheduleNow({ ownerId, chatId, run, branchHead, failedAt }: { ownerId: string; chatId: string; run: FlowRun; branchHead: string | null; failedAt?: number }): Promise<void> {
    const record = await store.getChat(chatId);
    if (!record) return;
    // После конца разговора сроков нет.
    if (record.endedAt !== null) return store.setDue(chatId, null);
    // Ждёт повтор доставки: его срок остаётся, следующий считается после него.
    if (record.delivery) return store.setDue(chatId, { at: record.delivery.retryAt, exitId: FLOW_DELIVERY_EXIT, branchHead });
    const flow = await input.flowOf(record);
    const offset = run.timeOffset ?? 0;
    const place = flow ? await placeOf(record, await port({ ownerId, chatId }), { ...run, answerId: branchHead ?? undefined }, failedAt === undefined ? undefined : failedAt + offset) : null;
    const due = flow && place ? nextWake(flow, place.run, input.now().getTime() + offset, input.timeZoneOf(chatId, record.timeZone), place.context) : null;
    // Пока считали, ход по таймеру мог отдать ответ в доставку приложения: её срок не затирается (условие — в записи).
    await store.setDue(chatId, due ? dueInput(due, branchHead, offset) : null, { unlessDelivery: true });
  }

  /** Переход по таймеру без сообщения агента: применится в начале следующего хода человека. */
  async function keepForNextTurn(chatId: string, run: FlowRun & { answerId?: string }, transition: Transition, due: { at: string; exitId: string } | null = null): Promise<void> {
    await store.addPending(chatId, { kind: "transition", key: timerKey(chatId, transition.exitId, run), transition, branchHead: run.answerId ?? null });
    await store.setDue(chatId, due && { ...due, branchHead: run.answerId ?? null });
  }

  /** Место ветки сменилось с начала тика: новый ответ или новое сообщение человека. */
  async function placeMoved(chatPort: FlowPort, record: FlowChatRecord, flow: AgentFlow, run: ChatFlowRun, at: number, timeZone: string): Promise<boolean> {
    const { ownerId, chatId } = record;
    const { values } = await chatPort.getChatState(ownerId, chatId);
    const fresh = chatRun(flow, values, await store.getChat(chatId), at, timeZone);
    return fresh.answerId !== run.answerId || fresh.humanMessages !== run.humanMessages;
  }

  /** Лимит расходов исчерпан: проверка до записи, иначе служба запишет служебное сообщение без хода. */
  async function overSpendingLimit(chatPort: FlowPort, ownerId: string, chatId: string): Promise<boolean> {
    try {
      await chatPort.assertWithinLimit(ownerId, chatId);
      return false;
    } catch (error) {
      if (error instanceof SpendingLimitReachedError) return true;
      throw error;
    }
  }

  async function fire(leased: FlowChatRecord, serverAt: number): Promise<void> {
    let record = leased;
    const { chatId, ownerId } = record;
    const flow = await input.flowOf(record);
    if (!flow) {
      logError(`[сценарий] чат=${chatId}: версии ${record.flowId}@${record.versionId} нет в хранилище, таймер снят`);
      await store.setDue(chatId, null);
      return;
    }
    if (record.delivery && input.delivery) {
      // Пока ждёт повтор доставки, новых ходов нет: срок — его, даже если запись затёрли.
      if (Date.parse(record.delivery.retryAt) > serverAt) {
        await store.setDue(chatId, { at: record.delivery.retryAt, exitId: FLOW_DELIVERY_EXIT, branchHead: record.dueBranchHead });
        return;
      }
      // Повтор доставки — тот же текст без хода; пока он ждёт, другие сроки ждут его.
      const outcome = await input.delivery().retry(record, serverAt);
      const after = await store.getChat(chatId);
      if (!after || after.endedAt !== null || after.delivery) return;
      // Повторы кончились: касание не засчитано, следующий срок — от отказа, а не новым ходом в этом же тике.
      if (outcome === "failed" || outcome === "window_closed") return recountAfterFailure(ownerId, chatId, serverAt);
      record = after;
    }
    let chatPort: FlowPort;
    let values: Record<string, unknown>;
    let offset: number;
    try {
      chatPort = await port({ ownerId, chatId });
      ({ values } = await chatPort.getChatState(ownerId, chatId));
      // Сдвиг тестового чата — из данных чата: перемотка пишет туда, а место в состоянии обновит только ход.
      offset = testChatOffset(await chatPort.getChatData(ownerId, chatId)) ?? 0;
    } catch (error) {
      if (!(error instanceof ChatNotFoundError)) throw error;
      await store.deleteChat(chatId);
      return;
    }
    const at = serverAt + offset;
    const timeZone = input.timeZoneOf(chatId, record.timeZone);
    // Перенесённый чат до первого хода — с места из записи переноса.
    const { run, context, undelivered } = await placeOf(record, chatPort, chatRun(flow, values, record, at, timeZone));
    // Срок считается заново по месту ветки: строка могла отстать (смена ветки, перенос правилами «писать первым»).
    const wake = nextWake(flow, run, at, timeZone, context);
    if (!wake || wake.at > at) {
      await store.setDue(chatId, wake ? dueInput(wake, run.answerId ?? null, offset) : null);
      return;
    }
    const due = dueReasons(flow, run, at, timeZone, context);
    if (due.deadline) {
      // Срок закрывает разговор без хода модели; прощание — отдельным ходом по правилам «писать первым».
      await store.setDue(chatId, null);
      await input.onDeadline?.({ record, flow, run, at: wake.at, timeZone });
      return;
    }
    if (due.giveUp) {
      await store.setDue(chatId, null);
      await input.onGiveUp?.({ record, flow, run, at });
      return;
    }
    const transitions: Transition[] = [];
    const next = due.exitId
      ? advance(flow, run, { type: "timer", exitId: due.exitId, timeZone }, {
          now: at,
          card: await input.cardValues(ownerId),
          out: transitions,
          onChainLimit: (stopped) => logError(chainLimitMessage(chatId, stopped)),
        })
      : run;
    const moved = transitions.length > 0;
    const reasons: FlowFirstReason[] = [...(moved ? [{ kind: "transition" as const, stateId: next.state }] : []), ...due.reasons];
    if (reasons.length === 0) {
      // Срок наступил, а писать не о чем (предел переходов подряд): тот же срок крутился бы каждый тик.
      await store.setDue(chatId, null);
      return;
    }
    const wakeExit = moved ? due.exitId! : FLOW_FIRST_EXIT;

    // Правила «писать первым»: окно канала, пауза, закрытый день, затем ночь и потолок сценария и приложения.
    const chat = { dayClosedOn: record.dayClosedOn, pausedUntil: record.pausedUntil, windowClosed: record.windowClosed };
    const block = firstMessages ? null : chatWriteBlock(chat, at, timeZone, flow.schedule);
    const allowed = firstMessages
      ? await firstMessages.check({ ownerId, chatId, at, timeZone, chat, ...(flow.schedule && { schedule: flow.schedule }) })
      : block
        ? { allowed: false as const, retryAt: block.retryAt }
        : { allowed: true as const };
    if (!allowed.allowed) {
      if (allowed.retryAt !== null) await store.setDue(chatId, { at: isoOf(allowed.retryAt - offset), exitId: wakeExit, branchHead: run.answerId ?? null });
      else if (moved) await keepForNextTurn(chatId, run, transitions[0]!);
      else await store.setDue(chatId, null);
      return;
    }

    // Пока шли проверки, человек мог ответить: место устарело, точный текст ушёл бы мимо разговора. Срок пересчитает его ход.
    if (await placeMoved(chatPort, record, flow, run, at, timeZone)) {
      await store.releaseLease(chatId, owner);
      return;
    }
    if (await overSpendingLimit(chatPort, ownerId, chatId)) {
      // Как ход человека при исчерпанном лимите: агент молчит до начала следующего дня; переход применит следующий ход.
      const retryAt = flow.schedule ? nextDayStartAfter(at, timeZone, flow.schedule) : at + DAY_MS;
      const retry = { at: isoOf(retryAt - offset), exitId: FLOW_FIRST_EXIT };
      if (moved) await keepForNextTurn(chatId, run, transitions[0]!, retry);
      else await store.setDue(chatId, { ...retry, branchHead: run.answerId ?? null });
      return;
    }
    const reasonsNotice = firstReasonsNotice(flow, reasons, moved ? due.exitId : null);
    // Прошлое касание не дошло: ход откатит его счёт и в месте чата.
    const notice = undelivered ? { ...reasonsNotice, data: { ...(reasonsNotice.data as object), undelivered } } : reasonsNotice;
    const reply = moved ? exactFirstText(flow, next.state) : null;
    const delivery = input.delivery?.();
    const result = await chatPort.deliverNotices({
      ownerId,
      chatId,
      notices: [notice],
      wakeAgent: true,
      deliveryKey: moved ? timerKey(chatId, due.exitId!, run) : `flow:${chatId}:${FLOW_FIRST_EXIT}:${wake.at}`,
      usageSource: "first_message",
      ...(delivery?.own() && { awaitAnswer: true }),
      ...(reply && { reply: { text: reply } }),
    });
    if (result.status === "busy") {
      // Чат занят ходом: срок остаётся, повтор следующим тиком.
      await store.releaseLease(chatId, owner);
      return;
    }
    if (result.status === "chat_gone") {
      await store.deleteChat(chatId);
      return;
    }
    if (!result.turnStarted) {
      // Ход не начался (предел ходов сервера подряд): агент не пишет, место меняется к следующему ходу.
      if (moved) await keepForNextTurn(chatId, run, transitions[0]!);
      else await store.setDue(chatId, null);
      return;
    }
    // Следующий срок — по месту после ответа агента; `afterTurn` пересчитает его ещё раз уже с ответом в ветке.
    const nudgeStep = (notice.data as { nudgeStep?: number }).nudgeStep;
    const answered = { ...noteAgentAnswer(next, at), ...(nudgeStep !== undefined && { nudgeStep }) };
    const following = nextWake(flow, answered, at, timeZone, { pausedUntil: context.pausedUntil ?? null });
    await store.setDue(chatId, following ? dueInput(following, result.messageId ?? null, offset) : null, { unlessDelivery: true });
    if (!delivery) {
      await firstMessages?.record({ ownerId, at, timeZone });
      return;
    }
    const outcome = await delivery.afterFirstTurn({ ownerId, chatId, answer: result.answer, reasons, at, timeZone });
    if (outcome === "failed" || outcome === "window_closed") await recountAfterFailure(ownerId, chatId, serverAt);
  }

  /** Продлить аренду; `false` — запись уже не наша (аренда кончилась и её взяла другая копия, или срок переписан). */
  const renew = (chatId: string) => store.renewLease({ chatId, owner, now: input.now().toISOString(), leaseMs });

  /** Один таймер под живой арендой: продлевается перед ходом и, пока ход идёт, каждую треть аренды. */
  async function fireLeased(record: FlowChatRecord, serverAt: number): Promise<void> {
    try {
      if (!(await renew(record.chatId))) return;
      const heartbeat = setInterval(() => {
        renew(record.chatId).catch((error) => logError(`[сценарий] чат=${record.chatId} аренда не продлена: ${errorText(error)}`));
      }, leaseMs / 3);
      heartbeat.unref?.();
      try {
        await fire(record, serverAt);
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      // Аренда остаётся: повтор после её конца, не каждый тик.
      logError(`[сценарий] чат=${record.chatId} таймер не сработал: ${errorText(error)}`);
    }
  }

  async function tickOnce(): Promise<void> {
    const at = input.now();
    const records = await store.leaseDue({ now: at.toISOString(), owner, leaseMs, limit: TIMER_BATCH });
    // Несколько ходов одновременно: пачка не растягивается на много аренд. Ждущие своей очереди продлеваются перед ходом.
    let next = 0;
    const worker = async () => {
      while (next < records.length) await fireLeased(records[next++]!, at.getTime());
    };
    await Promise.all(Array.from({ length: Math.min(TIMER_PARALLEL, records.length) }, worker));
  }

  function tick(): Promise<void> {
    running ??= tickOnce().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    start() {
      if (interval) return;
      interval = setInterval(() => {
        tick().catch((error) => logError(`[сценарий] обход таймеров упал: ${errorText(error)}`));
      }, tickMs);
      interval.unref?.();
    },
    async stop() {
      if (interval) clearInterval(interval);
      interval = undefined;
      await running?.catch(() => {});
    },
    tick,
    reschedule,
  };
}
