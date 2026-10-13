import type { AppEvent, AppEventViews } from "@ykurilov/agent-chat-react";
import { BadgeCheck } from "lucide-react";

/**
 * Плашка «Урок зачтён» в ответе агента: её событие `lesson_passed` добавляет хук итога хода на сервере демо. В чате
 * урока у события есть ключ урока — он в `data-lesson`.
 */
function LessonPassedBadge({ event }: { event: AppEvent }) {
  const lesson = (event.data as { lesson?: unknown } | undefined)?.lesson;
  return (
    <div role="status" data-app-event="lesson_passed" data-lesson={typeof lesson === "string" ? lesson : undefined} className="my-2 inline-flex items-center gap-2 rounded-[var(--radius-nested)] border border-[var(--success-border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--success-text)]">
      <BadgeCheck aria-hidden className="size-4" />
      Урок зачтён
    </div>
  );
}

/** Вид событий приложения демо в ответах: тип события → компонент. */
export const demoAppEvents: AppEventViews = { lesson_passed: LessonPassedBadge };
