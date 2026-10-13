import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AgentChatMessage } from "../chat-types";
import { fetchWithDeadline } from "../liveness/request-deadline";
import { serverRefusalOf } from "../server-refusal";
import type { ServerRefusal } from "../server-refusal";
import type { SpendingInfo } from "../spending-status";
import { withWidgetAnswer } from "./widget-messages";

/**
 * Почему ответ на виджет не принят: виджет снова активен, причина — словами у виджета. `refused` — приложение не пустило
 * ход, `answer_refused` — приложение отказало в самом ответе (`checkAnswer`); слова — в `text`.
 * `check_timeout` — проверка ответа не уложилась в срок: виджет открыт, текст — подпись `widgets.answerCheckTimeout`.
 */
export type WidgetFailureKind = "connection" | "spending_limit" | "busy" | "too_many_turns" | "already_answered" | "rejected" | "refused" | "answer_refused" | "check_timeout";

type ResumeOutcome = "streaming" | "nothing" | "failed";

export interface WidgetAnswerDeps {
  chatUrl: string;
  request: (input: string, init?: RequestInit) => Promise<Response>;
  requestTimeoutMs: () => number;
  /** Поля страницы, которые несёт каждый запрос хода (вкладка, место на экране, пояс). */
  pageFields: () => Record<string, unknown>;
  /** Жизнь чата: смена чата обрывает ожидание. */
  chatSignal: () => AbortSignal;
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>;
  setResuming: (resuming: boolean) => void;
  resumeWithProbe: (signal: AbortSignal) => Promise<ResumeOutcome>;
  /** Перечитывает историю; сорвавшееся чтение повторяется серией попыток. */
  rereadHistory: (signal: AbortSignal) => Promise<void>;
  /** Новые события ответа с вызовом `toolCallId` придут живыми с перечитанной историей (`AppEventReport.expectLive`). */
  expectLiveEventsOf: (toolCallId: string) => void;
  startSeries: () => void;
  /** Приложение отказало ходу: сообщает странице (`onTurnRefused`). */
  announceAppRefusal: (refusal: ServerRefusal | null) => void;
  /** Отказ 429: лимит расходов (поле ввода блокируется, как при отказе на отправку) или место хода. */
  spendingRefusalOf: (response: Response) => Promise<SpendingInfo | null>;
  showSpendingExhausted: (info: SpendingInfo) => void;
  errorKindOf: (response: Response) => Promise<string | undefined>;
}

export interface WidgetAnswerState {
  /** Ответ человека на виджет. `true` — сервер принял; `onAccepted` зовётся сразу, как принял, до продолжения хода. */
  answerWidget: (toolCallId: string, answer: unknown, onAccepted?: () => void) => Promise<boolean>;
  /** Виджет, ответ на который сейчас идёт на сервер. */
  widgetPendingId: string | null;
  widgetFailure: { id: string; kind: WidgetFailureKind; text?: string } | null;
  /** Ответ на виджет в пути или его продолжение ещё подключается: ход, который начнёт сервер, — свой. */
  answeringWidget: () => boolean;
}

/**
 * Ответ на виджет (contracts/core-and-http.md, «Маршрут ответа»): `POST {api}/:chatId/widgets/:toolCallId`, тело
 * `{ answer }`. Принятый ответ продолжает ход так же, как решение по подтверждению: лента подключается к продолжению,
 * и оно дописывает то же сообщение.
 */
export function useWidgetAnswer(deps: WidgetAnswerDeps): WidgetAnswerState {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const answering = useRef(false);
  const [widgetPendingId, setWidgetPendingId] = useState<string | null>(null);
  const [widgetFailure, setWidgetFailure] = useState<{ id: string; kind: WidgetFailureKind; text?: string } | null>(null);

  const answerWidget = useCallback(async (toolCallId: string, answer: unknown, onAccepted?: () => void): Promise<boolean> => {
    if (answering.current) return false;
    answering.current = true;
    const current = depsRef.current;
    const signal = current.chatSignal();
    const fail = (kind: WidgetFailureKind, text?: string) => {
      if (!signal.aborted) setWidgetFailure({ id: toolCallId, kind, ...(text !== undefined && { text }) });
      return false;
    };
    setWidgetFailure(null);
    setWidgetPendingId(toolCallId);
    try {
      let response: Response;
      try {
        response = await fetchWithDeadline(
          current.request,
          `${current.chatUrl}/widgets/${encodeURIComponent(toolCallId)}`,
          { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer, ...current.pageFields() }) },
          { timeoutMs: current.requestTimeoutMs(), wholeBody: true },
        );
      } catch {
        return fail("connection");
      }
      // Приложение не пустило ход (или человека): его слова у виджета, а не «ответ не отправился».
      const refusedByApp = response.ok ? null : await serverRefusalOf(response);
      if (refusedByApp?.kind) {
        current.announceAppRefusal(refusedByApp);
        return fail("refused", refusedByApp.text);
      }
      // Приложение отказало в самом ответе (`checkAnswer`): виджет открыт, слова — под ним; поле ввода и отказ хода не при чём.
      if (refusedByApp && response.status === 409 && (await current.errorKindOf(response)) === "widget_answer_refused") {
        return fail("answer_refused", refusedByApp.text);
      }
      // «Стоп» во время проверки: штатное действие человека. Виджет открыт, ошибки под ним нет.
      if (response.status === 409 && (await current.errorKindOf(response)) === "widget_answer_cancelled") return false;
      if (response.status === 504 && (await current.errorKindOf(response)) === "widget_check_timeout") return fail("check_timeout");
      if (response.status === 429) {
        const refusal = await current.spendingRefusalOf(response);
        if (refusal && !signal.aborted) current.showSpendingExhausted(refusal);
        if (refusal) return fail("spending_limit");
        return fail((await current.errorKindOf(response)) === "too_many_turns" ? "too_many_turns" : "connection");
      }
      if (response.status === 400) return fail("rejected");
      if (response.status === 409 && (await current.errorKindOf(response)) === "busy") return fail("busy");
      // Вопрос уже не ждёт (ответили в другой вкладке, закрыли сообщением) или чата нет: показываем то, что на сервере.
      if (response.status === 409 || response.status === 404) {
        await current.rereadHistory(signal);
        return fail("already_answered");
      }
      if (!response.ok) return fail("connection");
      const resumed = await resumedOf(response);
      current.setMessages((messages) => withWidgetAnswer(messages, toolCallId, answer, resumed));
      if (!signal.aborted) onAccepted?.();
      // Без продолжения события проверки ответа уже лежат в ответе: перечитать историю, они придут живыми. Канал
      // наблюдения может принести то же событие раньше или позже — учёт ленты считает каждое событие один раз.
      if (!resumed) {
        current.expectLiveEventsOf(toolCallId);
        if (!signal.aborted) await current.rereadHistory(signal);
        return true;
      }
      current.setResuming(true);
      try {
        const outcome = await current.resumeWithProbe(signal);
        if (outcome === "nothing") await current.rereadHistory(signal);
        else if (outcome === "failed" && !signal.aborted) current.startSeries();
      } finally {
        if (!signal.aborted) current.setResuming(false);
      }
      return true;
    } finally {
      answering.current = false;
      if (!signal.aborted) setWidgetPendingId(null);
    }
  }, []);

  const answeringWidget = useCallback(() => answering.current, []);

  return { answerWidget, widgetPendingId, widgetFailure, answeringWidget };
}

/** Тело успеха — как у ответа на подтверждение, `{ resumed }`; без него ход считается продолженным. */
async function resumedOf(response: Response): Promise<boolean> {
  try {
    const body = (await response.json()) as { resumed?: unknown };
    return body.resumed !== false;
  } catch {
    return true;
  }
}
