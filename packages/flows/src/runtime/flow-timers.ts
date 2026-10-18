import { randomUUID } from "node:crypto";
import { ChatNotFoundError, SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { AgentFlow } from "../format/flow-format";
import type { FlowRun, Transition } from "../engine/flow-run";
import { FLOW_STATE_KEY } from "../engine/flow-run";
import { noteAgentAnswer, withNudgeStep, withoutUndeliveredTouch } from "../engine/run-updates";
import { deadlineAt, nextDayStartAfter } from "../engine/flow-days";
import { stateById } from "../engine/flow-graph";
import type { FirstWakeContext, FlowFirstReason } from "../engine/nudges";
import { dayStartHoldUntil } from "../engine/nudges";
import { deferredWake, dueReasons, endingWake, FLOW_FIRST_EXIT, nextFirstMessageAfter, nextWake, type FlowDue } from "../engine/timers";
import type { FlowChatRecord, FlowStore } from "../store/flow-store";
import type { FirstMessageRules, FlowPort, FlowTestClockReason, FlowTimers, FlowTimerSettings } from "./flow-types";
import { advance, chainLimitMessage, chatRun, exactFirstText, storedRun, withPending, type ChatFlowRun } from "./flow-events";
import { chatWriteBlock } from "./first-message-rules";
import { FIRST_MESSAGE_RETRY_MS } from "./first-message-retry";
import { firstReasonsNotice } from "./first-reasons-notice";
import { FLOW_DELIVERY_EXIT, type FlowDelivery } from "./flow-delivery";
import { testChatOffset } from "./test-clock";
import { withHeldHuman } from "./held-messages";

export const DEFAULT_TIMER_TICK_MS = 15_000;
export const DEFAULT_TIMER_LEASE_MS = 60_000;
/** Сколько наступивших таймеров копия берёт за один обход. */
const TIMER_BATCH = 50;
/** Сколько из них идут одновременно: каждый — ход модели. */
const TIMER_PARALLEL = 5;
const DAY_MS = 86_400_000;
/** Мягкий потолок ходов сервера подряд без сообщения человека у сценария (страховка от петли переходов по таймерам). */
export const DEFAULT_FLOW_SERVER_TURNS_IN_ROW = 50;

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
  /** Переход по таймеру применён в срок без хода: запись чата, `onTransition`, конечная нода. */
  onAppliedTransitions?: (input: { record: FlowChatRecord; flow: AgentFlow; run: ChatFlowRun; transitions: Transition[] }) => Promise<void>;
  /** Доставка ответа в каналы приложения и счётчик дня. Нет — каналы SDK, счётчик сразу. */
  delivery?: () => FlowDelivery;
}): FlowTimers {
  const { store, firstMessages, port, logError } = input;
  const tickMs = input.settings.tickMs ?? DEFAULT_TIMER_TICK_MS;
  const leaseMs = input.settings.leaseMs ?? DEFAULT_TIMER_LEASE_MS;
  const maxServerTurns = input.settings.maxServerTurnsInRow ?? DEFAULT_FLOW_SERVER_TURNS_IN_ROW;
  /** Эта копия сервера в арендах. */
  const owner = `flow-timers:${randomUUID()}`;
  let interval: ReturnType<typeof setInterval> | undefined;
  let running: Promise<void> | null = null;
  /** Слушатели срабатываний по чатам: перемотка тестового чата узнаёт, что именно сработало. */
  const watchers = new Map<string, Set<(fired: FlowTestClockReason) => void>>();
  const fired = (chatId: string, reason: FlowTestClockReason) => {
    for (const onFired of watchers.get(chatId) ?? []) onFired(reason);
  };

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
    const context = { pausedUntil, unanswered: facts.unanswered };
    // Сообщение, отложенное до утра, — слова человека: в месте чата их нет, ход их не записал.
    const spoken = withHeldHuman(run, await chatPort.getChatData(record.ownerId, record.chatId));
    const reverted = withoutUndeliveredTouch(spoken, facts.undelivered);
    if (reverted.undeliveredAt === null) return { run: spoken, context, undelivered: null };
    const undeliveredAt = Math.max(reverted.undeliveredAt, failedAt ?? 0);
    return { run: reverted.run as R, context: { ...context, undeliveredAt }, undelivered: run.touch!.answerId };
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
    const at = input.now().getTime() + offset;
    const timeZone = input.timeZoneOf(chatId, record.timeZone);
    const branch = flow ? await withApplied(record, flow, { ...run, answerId: branchHead ?? undefined }, at, timeZone) : null;
    const place = flow && branch ? await placeOf(record, await port({ ownerId, chatId }), branch, failedAt === undefined ? undefined : failedAt + offset) : null;
    const due = flow && place ? nextWake(flow, place.run, at, timeZone, place.context) : null;
    // Пока считали, ход по таймеру мог отдать ответ в доставку приложения: её срок не затирается (условие — в записи).
    await store.setDue(chatId, due ? dueInput(due, branchHead, offset) : null, { unlessDelivery: true });
  }

  /** Переходы, применённые в срок без хода, — уже место чата: таймеры идут от новой ноды. */
  async function withApplied<R extends ChatFlowRun>(record: FlowChatRecord, flow: AgentFlow, run: R, at: number, timeZone: string): Promise<R> {
    const applied = record.pending.filter((change) => change.kind === "transition" && change.appliedAt !== undefined);
    if (applied.length === 0) return run;
    return withPending(flow, run, applied, { now: at, timeZone, card: await input.cardValues(record.ownerId), out: [], onChainLimit: () => {} }) as R;
  }

  /**
   * Переход по таймеру без сообщения агента: в состояние чата его перенесёт следующий ход. `applied` — переход наступил
   * в срок уже сейчас: запись чата и `onTransition`, следующие сроки — от новой ноды.
   */
  async function keepForNextTurn(
    chatId: string,
    run: FlowRun & { answerId?: string },
    transition: Transition,
    due: { at: string; exitId: string } | null = null,
    applied: { record: FlowChatRecord; flow: AgentFlow; run: ChatFlowRun; transitions: Transition[]; at: number } | null = null,
  ): Promise<void> {
    // Применён в срок — вся цепочка: ход отличит сообщённые переходы от тех, что дотянет сам.
    const key = timerKey(chatId, transition.exitId, run);
    for (const [index, item] of (applied ? applied.transitions : [transition]).entries()) {
      await store.addPending(chatId, {
        kind: "transition",
        key: index === 0 ? key : `${key}:${index}`,
        transition: item,
        branchHead: run.answerId ?? null,
        ...(applied && { appliedAt: new Date(applied.at).toISOString() }),
      });
    }
    if (applied) await input.onAppliedTransitions?.(applied);
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
    const { run, context, undelivered } = await placeOf(record, chatPort, await withApplied(record, flow, chatRun(flow, values, record, at, timeZone), at, timeZone));
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
      // Момент самого срока: ближайшим сроком могло быть отложенное касание до него.
      const endAt = flow.schedule ? (deadlineAt(run, timeZone, flow.schedule) ?? wake.at) : wake.at;
      await input.onDeadline?.({ record, flow, run, at: endAt, timeZone });
      const deadlineState = flow.schedule?.deadlineState;
      fired(chatId, { kind: "deadline", stateId: deadlineState && stateById(flow, deadlineState) ? deadlineState : run.state });
      return;
    }
    if (due.giveUp) {
      await store.setDue(chatId, null);
      await input.onGiveUp?.({ record, flow, run, at });
      fired(chatId, { kind: "give_up", stateId: run.state });
      return;
    }
    const transitions: Transition[] = [];
    const next = due.exitId
      ? advance(flow, run, { type: "timer", exitId: due.exitId, timeZone }, {
          now: at,
          timeZone,
          card: await input.cardValues(ownerId),
          out: transitions,
          onChainLimit: (stopped) => logError(chainLimitMessage(chatId, stopped)),
        })
      : run;
    const moved = transitions.length > 0;
    const reasons: FlowFirstReason[] = [...(moved ? [{ kind: "transition" as const, stateId: next.state }] : []), ...due.reasons];
    /**
     * Касание не сейчас: повтор в `retryAt` (`null` — до сообщения человека), но выход ноды, «срок вышел» и «не завершил»
     * остаются в силе. Переход по таймеру ждёт следующего хода; повтор касания придёт с ним же.
     */
    // Сообщения по таймеру не будет (повтора нет — до сообщения человека): переход наступает в свой срок без хода
    // (`applyNow`). Отложенное сообщение (ночь, потолок, лимит, повтор хода) придёт вместе с переходом, как раньше.
    const keep = async (wakeAt: FlowDue | null, applyNow: boolean) => {
      const deferred = wakeAt && dueInput(wakeAt, run.answerId ?? null, offset);
      if (moved) await keepForNextTurn(chatId, run, transitions[0]!, deferred, applyNow ? { record, flow, run: next, transitions, at } : null);
      else await store.setDue(chatId, deferred);
    };
    const defer = (retryAt: number | null) =>
      keep(deferredWake(flow, next, at, timeZone, context, { at: retryAt, exitId: moved && retryAt !== null ? due.exitId! : FLOW_FIRST_EXIT }), retryAt === null);
    if (reasons.length === 0) {
      // Срок наступил, а писать не о чем (предел переходов подряд): срок — ближайший настоящий (касание, конец), нет — снят.
      await defer(nextFirstMessageAfter(flow, next, at, timeZone, context));
      return;
    }
    const serverTurns = run.serverTurns ?? 0;
    if (maxServerTurns !== false && serverTurns >= maxServerTurns) {
      // Мягкий потолок против петли: касания и переходы по таймерам ждут сообщения человека, конец разговора — в свой срок.
      logError(`[сценарий] чат=${chatId}: ${serverTurns} ходов сервера подряд без ответа человека — касания и переходы по таймерам ждут его сообщения`);
      await keep(endingWake(flow, next, at, timeZone, context), true);
      return;
    }
    // Человек писал до начала дня и недавно: касание без дела ждёт, как утреннее (переход ноды и ответ на ночные — нет).
    const hold = dayStartHoldUntil(flow, run, at, timeZone, reasons);
    if (hold !== null) {
      await defer(hold);
      return;
    }

    // Правила «писать первым»: окно канала, пауза, закрытый день, затем ночь и потолок сценария и приложения.
    const chat = { dayClosedOn: record.dayClosedOn, pausedUntil: record.pausedUntil, windowClosed: record.windowClosed };
    const block = firstMessages ? null : chatWriteBlock(chat, at, timeZone, flow.schedule);
    const allowed = firstMessages
      ? await firstMessages.check({ ownerId, chatId, at, timeZone, chat, ...(flow.schedule && { schedule: flow.schedule }) })
      : block
        ? { allowed: false as const, retryAt: block.retryAt }
        : { allowed: true as const };
    if (!allowed.allowed) {
      await defer(allowed.retryAt);
      return;
    }

    // Пока шли проверки, человек мог ответить: место устарело, точный текст ушёл бы мимо разговора. Срок пересчитает его ход.
    if (await placeMoved(chatPort, record, flow, run, at, timeZone)) {
      await store.releaseLease(chatId, owner);
      return;
    }
    if (await overSpendingLimit(chatPort, ownerId, chatId)) {
      // Как ход человека при исчерпанном лимите: агент молчит до начала следующего дня; переход применит следующий ход.
      await defer(flow.schedule ? nextDayStartAfter(at, timeZone, flow.schedule) : at + DAY_MS);
      return;
    }
    const reasonsNotice = firstReasonsNotice(flow, reasons, moved ? due.exitId : null, due.ownNudge);
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
      // Ходы сценария идут по его расписанию и правилам «писать первым»: потолок ядра против петли их не режет.
      maxServerTurnsInRow: false,
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
      // Ход не начался (ворота приложения, лимит, закрытый чат): касание позже, место меняется к следующему ходу.
      await defer(at + FIRST_MESSAGE_RETRY_MS);
      return;
    }
    // Следующий срок — по месту после ответа агента; `afterTurn` пересчитает его ещё раз уже с ответом в ветке.
    const { nudgeStep, nudgeStepOwn } = notice.data as { nudgeStep?: number; nudgeStepOwn?: boolean };
    const answered = nudgeStep === undefined ? noteAgentAnswer(next, at) : withNudgeStep(noteAgentAnswer(next, at), nudgeStep, nudgeStepOwn === true);
    const following = nextWake(flow, answered, at, timeZone, { pausedUntil: context.pausedUntil ?? null });
    await store.setDue(chatId, following ? dueInput(following, result.messageId ?? null, offset) : null, { unlessDelivery: true });
    fired(chatId, { kind: reasons[0]!.kind, stateId: next.state, ...(moved && { exitId: due.exitId! }), reasons });
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
    watch(chatId, onFired) {
      const listeners = watchers.get(chatId) ?? new Set();
      watchers.set(chatId, listeners.add(onFired));
      return () => {
        listeners.delete(onFired);
        if (listeners.size === 0) watchers.delete(chatId);
      };
    },
  };
}
