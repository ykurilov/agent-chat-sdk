import type { AgentNotice, PrepareTurn, TurnAction } from "@ykurilov/agent-chat-core";
import { FLOW_STATE_KEY, type FlowTouch, type Transition } from "../engine/flow-run";
import { migrateRun } from "../engine/migrate-run";
import { noteAgentAnswer, noteHumanMessage, withoutUndeliveredTouch } from "../engine/run-updates";
import { advance, chainLimitMessage, currentRun, transitionNotice, type ChatFlowRun, type FlowRuntime } from "./flow-events";
import type { PendingFlowChange } from "../store/flow-store";
import { pageTimeZone } from "./first-message-rules";
import { testChatOffset } from "./test-clock";
import { dayInProgress, deadlineAt, withDayAnchor } from "../engine/flow-days";
import { endedRun, FLOW_DEADLINE_NOTICE, type FlowFinisher } from "./flow-finish";
import type { FlowFirstReason } from "../engine/nudges";

/** Имена служебных сообщений `app`, которые сценарий применяет в начале хода. */
export const FLOW_TIMER_NOTICE = "flow_timer";
export const FLOW_EVENT_NOTICE = "flow_event";

/** Событие движка для ожидающего перехода: таймер проверяется заново по своему сроку, судья — как вердикт. */
export function pendingEvent(transition: Transition, timeZone: string): Parameters<typeof advance>[2] {
  if (transition.decidedBy === "timer") return { type: "timer", exitId: transition.exitId, timeZone };
  return { type: "verdict", exitId: transition.exitId, probability: transition.probability ?? 1, decidedBy: "judge" };
}

/** Ходы, которые отвечают на сообщение человека. */
const HUMAN_ACTIONS: ReadonlySet<TurnAction> = new Set<TurnAction>(["send", "edit", "regenerate", "retry"]);

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const dataOf = (notice: AgentNotice): Record<string, unknown> =>
  notice.data && typeof notice.data === "object" ? (notice.data as Record<string, unknown>) : {};

/** Причины «пишет первым» этого хода: служебные сообщения таймера и прощания. */
const firstReasonsOf = (notices: readonly AgentNotice[]): FlowFirstReason[] =>
  notices.flatMap((notice) => {
    if (notice.kind !== "app" || (notice.name !== FLOW_TIMER_NOTICE && notice.name !== FLOW_DEADLINE_NOTICE)) return [];
    const { reasons } = dataOf(notice);
    return Array.isArray(reasons) ? (reasons as FlowFirstReason[]) : [];
  });

/**
 * `agent.prepareTurn` сценария: в начале хода, до застывших блоков, применяет всё, что случилось вне хода — ожидающие
 * переходы судьи (только на своей ветке), события приложения, перевод версии, наступившие таймеры, — и сообщение
 * человека («назад» после касаний). Модель получает служебное сообщение «Сработало: …» и уже новую карточку.
 */
export function flowPrepareTurn(runtime: FlowRuntime, appTimeZone: () => string | undefined, finisher?: () => FlowFinisher): PrepareTurn {
  return async (ctx) => {
    // В группах сценарий выключен: чат не закрепляется, состояние не пишется.
    if (ctx.audience === "group") return;
    let pinned = await runtime.chatFlow(ctx.ownerId, ctx.chatId, ctx.chat);
    if (!pinned) return;
    // Тестовый чат идёт по своим часам: сдвиг из данных чата ложится в место.
    const timeOffset = testChatOffset(ctx.chat.data);
    const now = runtime.now() + (timeOffset ?? 0);
    const transitions: Transition[] = [];
    let card: Record<string, unknown> | undefined;
    const step = async (run: ChatFlowRun, event: Parameters<typeof advance>[2]) =>
      advance(pinned!.flow, run, event, {
        now,
        card: (card ??= await runtime.cardValues(ctx.ownerId)),
        out: transitions,
        onChainLimit: (stopped) => runtime.logError(chainLimitMessage(ctx.chatId, stopped)),
      });

    // Пояс человека → В10: со страницы, иначе известный пояс человека; ход без пояса страницы (мессенджер) его не затирает.
    const record = await runtime.store.getChat(ctx.chatId);
    const page = pageTimeZone(ctx.timeZone, appTimeZone(), ctx.pageTimeZone);
    const known = page ?? (runtime.timeZones ? await runtime.timeZones.known(ctx.ownerId, ctx.chatId) : record?.timeZone || null);
    const timeZone = known ?? runtime.defaultTimeZone ?? ctx.timeZone;

    let run = currentRun(pinned.flow, ctx.state, now);
    const previousAnswer = run.answerId;
    const pending: PendingFlowChange[] = await runtime.store.takePending(ctx.chatId);
    // Ход не записал место (сбой, срок, «Стоп») — взятое возвращается в очередь: ключи не дают двойных записей.
    let restored: Promise<unknown> | null = null;
    const restore = () => (restored ??= Promise.all(pending.map((change) => runtime.store.addPending(ctx.chatId, change))));
    const onAbort = () => void restore().catch((error) => runtime.logError(`[сценарий] чат=${ctx.chatId} ожидающее не возвращено: ${errorText(error)}`));
    if (pending.length > 0) ctx.abortSignal.addEventListener("abort", onAbort, { once: true });
    try {
      return await applyTurn();
    } catch (error) {
      await restore();
      throw error;
    } finally {
      ctx.abortSignal.removeEventListener("abort", onAbort);
    }

    async function applyTurn() {
      // Первый день — по поясу человека: пояс узнали или сменили — якорь пересчитан (→ В1, FR-207).
      const schedule = pinned!.flow.schedule;
      if (schedule) run = withDayAnchor(run, timeZone, schedule) as ChatFlowRun;
      if (record?.endedAt) {
        // Разговор закрыли вне хода (таймер, перенос): место догоняет запись.
        run = endedRun(pinned!.flow, run, { endedAt: Date.parse(record.endedAt), endReason: record.endReason ?? "final" });
      } else if (schedule && finisher) {
        // Таймер срока не сработал (сервер стоял): срок закрывает разговор на первом же ходе.
        const deadline = deadlineAt(run, timeZone, schedule);
        if (deadline !== null && deadline <= now) {
          ({ run } = await finisher().deadline({ ownerId: ctx.ownerId, chatId: ctx.chatId, pinned: pinned!, run, at: deadline, timeZone }));
        }
      }
      // После конца переходов нет: ожидающее снимается, сообщение человека только считается.
      const ended = run.endedAt !== undefined;
      for (const change of ended ? [] : pending) {
        if (change.kind === "migrate") {
          // Версия в записи чата уже новая (`migrateBatch`): переводится только место в сценарии.
          const next = await runtime.chatFlow(ctx.ownerId, ctx.chatId);
          if (next) {
            run = { ...migrateRun(run, next.flow, change.map, now), answerId: previousAnswer } as ChatFlowRun;
            pinned = next;
          }
        } else if (change.kind === "transition") {
          // Переход судьи или таймера — только на той ветке, где он решён, и только из того же состояния.
          if (change.branchHead !== previousAnswer || run.state !== change.transition.from) continue;
          run = await step(run, pendingEvent(change.transition, timeZone));
        } else {
          run = await step(run, { type: "event", event: "app", name: change.name });
        }
      }
      // Ход «пишет первым»: счёт до него — на случай, если его ответ не дойдёт (FR-309).
      let touchBase: Omit<FlowTouch, "answerId" | "at"> | null = null;
      for (const notice of ended ? [] : ctx.notices) {
        if (notice.kind !== "app") continue;
        const data = dataOf(notice);
        if (notice.name === FLOW_TIMER_NOTICE) {
          // Прошлое касание не доставлено — не засчитано: счёт как до него.
          if (typeof data.undelivered === "string") run = withoutUndeliveredTouch(run, new Set([data.undelivered])).run as ChatFlowRun;
          // Переход ноды (если есть) и шаг ряда касаний после него.
          if (typeof data.exitId === "string") run = await step(run, { type: "timer", exitId: data.exitId, timeZone });
          touchBase = { lastAgentAt: run.lastAgentAt, nudgeStep: run.nudgeStep ?? 0, agentAnswers: run.agentAnswers };
          if (typeof data.nudgeStep === "number") run = { ...run, nudgeStep: data.nudgeStep };
        } else if (notice.name === FLOW_EVENT_NOTICE && typeof data.name === "string") {
          run = await step(run, { type: "event", event: "app", name: data.name });
        }
      }
      // Ответ на сообщение человека: новое, правка, «Перегенерировать» и «Повторить» — состояние до сообщения, оно
      // учитывается заново. Продолжение прежнего ответа его уже учло.
      if (!ctx.resumed && HUMAN_ACTIONS.has(ctx.action)) {
        // Человек написал — окно канала снова открыто: агент может писать первым.
        if (record?.windowClosed) await runtime.store.setWindowClosed(ctx.chatId, false);
        run = noteHumanMessage(run, now, schedule ? dayInProgress(now, timeZone, schedule) : undefined);
        if (!ended) run = await step(run, { type: "event", event: "message" });
      }
      // Ход по служебному сообщению — ход сервера: счёт подряд для мягкого потолка таймеров; человек его обнулил выше.
      if (ctx.action === "notice" && !ctx.resumed) run = { ...run, serverTurns: (run.serverTurns ?? 0) + 1 };
      // Продолжение после подтверждения или виджета — тот же ответ: агент ещё не ответил заново.
      if (ctx.action !== "approval" && ctx.action !== "widget") run = noteAgentAnswer(run, now);
      // Снимок касания живёт до следующего хода; продолжение того же ответа его сохраняет.
      // Причины «пишет первым» — тоже: для хвоста приложения в этом ответе.
      const { touch: earlierTouch, firstReasons: earlierReasons, ...withoutTouch } = run;
      const continued = ctx.action === "approval" || ctx.action === "widget";
      const touch = touchBase ? { answerId: ctx.messageId, at: now, ...touchBase } : continued ? earlierTouch : undefined;
      const reasons = firstReasonsOf(ctx.notices);
      const firstReasons = reasons.length > 0 ? reasons : continued ? earlierReasons : undefined;
      run = { ...withoutTouch, answerId: ctx.messageId, ...(timeOffset !== null && { timeOffset }), ...(touch && { touch }), ...(firstReasons && { firstReasons }) };

      if (ctx.abortSignal.aborted) {
        await restore();
        return undefined;
      }
      // Пояс узнан — человеку (общий для всех его разговоров) и копия в запись чата для таймеров.
      if (known && runtime.timeZones) await runtime.timeZones.write(ctx.ownerId, ctx.chatId, known);
      else if (record && page && record.timeZone !== page) await runtime.store.updateChat(ctx.chatId, { timeZone: page }, new Date(runtime.now()).toISOString());
      await runtime.afterTransitions({ ownerId: ctx.ownerId, chatId: ctx.chatId, pinned: pinned!, run, transitions });
      return {
        set: { [FLOW_STATE_KEY]: run },
        ...(transitions.length > 0 && { notices: [transitionNotice(pinned!.flow, transitions)] }),
      };
    }
  };
}
