import { useState } from "react";
import { messageText } from "./chat-types";
import { voiceAnswerIds } from "./voice-turn";
import { withoutMarkdown } from "./without-markdown";
import type { AgentChatMessage } from "./chat-types";
import { useChatLabels } from "./labels";
import type { ResolvedChatLabels } from "./labels";

/*
 * Что прочитает экранный диктор, когда ответ закончился во вкладке. Сама лента для дикторов
 * молчит (`aria-live="off"`): иначе окно ленты зачитывало бы каждое сообщение, которое оно
 * дорисовывает при прокрутке.
 */

/**
 * Текст для диктора: пустой при открытии чата, итог ответа — когда ответ перешёл из «идёт» в
 * итоговое состояние. Когда начинается новый ответ, текст обнуляется: так одинаковые итоги
 * подряд («Остановлено» дважды) озвучиваются оба раза. `resetKey` (id чата) тоже обнуляет текст.
 */
export function useFeedAnnouncement(messages: AgentChatMessage[], busy: boolean, resetKey?: string): string {
  const labels = useChatLabels();
  // Прошлые `busy` и `resetKey` хранятся в состоянии и сравниваются прямо при рендере: итог появляется
  // в том же кадре, в котором ответ закончился, а не в следующем после эффекта.
  const [seen, setSeen] = useState({ busy, resetKey, announcement: "" });
  let current = seen;
  if (seen.resetKey !== resetKey) {
    // Чат сменился: итог прежнего чата и его «идёт ответ» к новому чату не относятся.
    current = { busy, resetKey, announcement: "" };
  } else if (seen.busy !== busy) {
    // Начался новый ответ: текст прошлого убираем, иначе такой же итог (например «Остановлено») не прозвучит снова.
    current = { busy, resetKey, announcement: busy ? "" : announcementFor(messages, labels) };
  }
  if (current !== seen) setSeen(current);
  return current.announcement;
}

function announcementFor(messages: AgentChatMessage[], labels: ResolvedChatLabels): string {
  const answer = messages.findLast((message) => message.role === "assistant");
  if (!answer) return "";
  const status = answer.metadata?.status ?? "complete";
  if (status === "error") return labels.errors[answer.metadata?.error?.kind ?? "other"];
  if (status === "stopped") return labels.answerStopped;
  if (status === "interrupted") return labels.answerInterrupted;
  if (status === "awaiting_approval") return widgetQuestionOf(answer, labels) ?? labels.approvalAnnouncement;
  const text = messageText(answer, { voiceAnswer: voiceAnswerIds(messages).has(answer.id) });
  const spoken = withoutMarkdown(text);
  return spoken.trim().length === 0 ? labels.answerEmpty : spoken;
}

/** Ход остановился на вопросе агента (ждущий виджет): диктор слышит «Агент задал вопрос» и сам вопрос (FR-021). */
function widgetQuestionOf(answer: AgentChatMessage, labels: ResolvedChatLabels): string | null {
  const waiting = answer.parts.find((part) => {
    const tool = part as { type: string; state?: string; approval?: unknown };
    return (tool.type.startsWith("tool-") || tool.type === "dynamic-tool") && tool.state === "input-available" && tool.approval === undefined;
  });
  if (!waiting) return null;
  const input = (waiting as { input?: { question?: unknown; title?: unknown } }).input;
  const question = typeof input?.question === "string" ? input.question : typeof input?.title === "string" ? input.title : "";
  return question.trim().length > 0 ? `${labels.widgets.asked}: ${question}` : labels.widgets.asked;
}
