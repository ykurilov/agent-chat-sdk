import type { TextPart } from "ai";
import { AGENT_NOTICE_PART_TYPE } from "./agent-notice";
import type { AgentNotice } from "./agent-notice";

/** Текст служебного сообщения для модели. Тот же и в хвосте запроса, и в истории на следующих ходах: кэш цел. */
export function noticeText(notice: AgentNotice): string {
  const task = `Фоновая задача "${notice.title}"`;
  switch (notice.kind) {
    case "task_done":
      return `${task} закончилась: ${notice.result ?? ""}`;
    case "task_failed":
      return `${task} не удалась: ${notice.error ?? "неизвестная ошибка"}`;
    case "task_canceled":
      return `${task} отменена`;
    case "task_interrupted":
      return `${task} прервана перезапуском сервера`;
    case "task_timed_out":
      return `${task} не уложилась в срок и остановлена`;
    case "task_awaiting_approval":
      return `${task} ждёт, когда пользователь разрешит действие «${notice.approval?.toolName ?? ""}»`;
    case "conversation_started":
      return `Начни разговор: ${notice.title}`;
    case "app":
      return notice.title;
    case "staff":
      return staffNoticeText(notice);
  }
}

/** Служебные сообщения из части сообщения; не та часть или пусто — `[]`. */
export function noticesOfPart(part: { type: string; data?: unknown }): AgentNotice[] {
  if (part.type !== AGENT_NOTICE_PART_TYPE) return [];
  const notices = (part.data as { notices?: unknown } | undefined)?.notices;
  return Array.isArray(notices) ? (notices as AgentNotice[]) : [];
}

/** Часть `data-agent-notice` — одной текстовой частью для модели; другая часть — `undefined`. */
export function noticePartForModel(part: { type: string; data?: unknown }): TextPart | undefined {
  if (part.type !== AGENT_NOTICE_PART_TYPE) return undefined;
  return { type: "text", text: noticesOfPart(part).map(noticeText).join("\n\n") };
}

/** Реплика сотрудника для модели: от чьего имени сказано и что делать дальше. */
function staffNoticeText(notice: AgentNotice): string {
  const who = notice.staffName ? `Живой сотрудник «${notice.staffName}»` : "Живой сотрудник";
  return `${who} ответил человеку вместо тебя: «${notice.title}». Это сказано от вашего имени: продолжай разговор с учётом этого и не противоречь сотруднику.`;
}
