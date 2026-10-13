import { useEffect, useRef } from "react";
import type { AgentChatMessage, AnswerStatus } from "./chat-types";
import { isCorrection } from "./steering/corrections";

/** Ход закончен на экране: ответ получил итог. */
export interface TurnFinishedEvent {
  chatId: string;
  /** Id ответа агента — тот же, что в истории на сервере. */
  messageId: string;
  status: Exclude<AnswerStatus, "streaming">;
}

/**
 * Зовёт `onTurnFinished` один раз на ход: чат был занят ответом, освободился, и у последнего ответа есть итог
 * (законченный, остановленный, с ошибкой, прерванный, ждущий человека). Открытие чата с готовой историей хода не даёт.
 * Ответ, законченный ради поправки, — свой ход и на сервере: он получает событие первым, перед ответом на поправку.
 */
export function useTurnFinishedReport(
  chatId: string,
  busy: boolean,
  messages: readonly AgentChatMessage[],
  onTurnFinished: ((turn: TurnFinishedEvent) => void) | undefined,
): void {
  const report = useRef(onTurnFinished);
  report.current = onTurnFinished;
  const turnRunning = useRef(false);
  const latest = useRef(messages);
  latest.current = messages;
  /** Ответы с итогом на начало хода: их ход уже прошёл, второй раз о них не сообщается. */
  const finishedBefore = useRef<ReadonlySet<string>>(new Set());
  const last = messages.at(-1);
  const answerId = last?.role === "assistant" ? last.id : undefined;
  const answerStatus = last?.role === "assistant" ? last.metadata?.status : undefined;

  useEffect(() => {
    if (busy) {
      if (!turnRunning.current) finishedBefore.current = finishedAnswerIds(latest.current);
      turnRunning.current = true;
      return;
    }
    if (!turnRunning.current) return;
    const reportSteered = () => {
      for (const steered of steeredAnswersBefore(latest.current)) {
        if (!finishedBefore.current.has(steered.id)) report.current?.({ chatId, messageId: steered.id, status: steered.status });
      }
    };
    // Ответа на последнее сообщение человека нет: обычный ход не начался (отказ сервера), событий нет; продолжение
    // по поправке не стартовало (лимит, чужие ходы, чат закрыт) — события получают ответы цепочки до неё.
    if (answerId === undefined) {
      turnRunning.current = false;
      reportSteered();
      return;
    }
    // Связь оборвалась без итога: ход закончится, когда чат снова получит ответ с итогом.
    if (answerStatus === undefined || answerStatus === "streaming") return;
    turnRunning.current = false;
    reportSteered();
    report.current?.({ chatId, messageId: answerId, status: answerStatus });
  }, [answerId, answerStatus, busy, chatId]);
}

type FinalStatus = TurnFinishedEvent["status"];

function finalStatusOf(message: AgentChatMessage): FinalStatus | undefined {
  const status = message.metadata?.status;
  return status === undefined || status === "streaming" ? undefined : status;
}

function finishedAnswerIds(messages: readonly AgentChatMessage[]): ReadonlySet<string> {
  return new Set(messages.flatMap((message) => (message.role === "assistant" && finalStatusOf(message) ? [message.id] : [])));
}

/**
 * Ответы, законченные ради поправок, в конце ленты: цепочка «ответ, поправки, ответ…» перед последним ответом или
 * перед поправками, которые остались без ответа. По порядку.
 */
function steeredAnswersBefore(messages: readonly AgentChatMessage[]): Array<{ id: string; status: FinalStatus }> {
  const steered: Array<{ id: string; status: FinalStatus }> = [];
  let index = messages.at(-1)?.role === "assistant" ? messages.length - 2 : messages.length - 1;
  for (;;) {
    if (index < 0 || !isCorrection(messages[index]!)) break;
    while (index >= 0 && isCorrection(messages[index]!)) index--;
    const answer = messages[index];
    const status = answer && answer.role === "assistant" ? finalStatusOf(answer) : undefined;
    if (!answer || !status) break;
    steered.unshift({ id: answer.id, status });
    index--;
  }
  return steered;
}
