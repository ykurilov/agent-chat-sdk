import { useChatLabels, useThinkingStatus } from "@ykurilov/agent-chat-react";

/**
 * Живая надпись, пока модель думает: фраза сменяется каждые 3–4 с, рядом — время ожидания. Экранный диктор слышит
 * только постоянную `reasoningRunning`: фразы и время от него скрыты. Смена фразы плавная только без prefers-reduced-motion.
 */
export function OduvanchikThinkingLabel() {
  const labels = useChatLabels();
  const { phrase, elapsed } = useThinkingStatus();
  return (
    <>
      <span key={phrase} aria-hidden="true" data-thinking-phrase className="motion-safe:animate-[tandem-fade-in_var(--motion-fast)_ease-out]">
        {phrase}
      </span>
      <span aria-hidden="true" className="tabular-nums text-[var(--foreground-subtle)]">
        {elapsed}
      </span>
      <span className="sr-only">{labels.reasoningRunning}</span>
    </>
  );
}
