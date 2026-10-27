import { Tooltip } from "./primitives/tooltip";
import { Button } from "@tandem/ui";
import type { VoiceInputView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Loader2, Mic, Square } from "./icons";

/**
 * Кнопка микрофона в нижнем ряду поля ввода, слева от «Отправить», как остальные значки ряда (скрепка, мозг):
 * покой, подключение, запись (нажата, цвета действия, пульсирует), причёсывание текста (крутится, не нажимается).
 */
export function OduvanchikVoiceButton({ voice }: { voice: VoiceInputView }) {
  const labels = useChatLabels();
  const label = voice.polishing
    ? labels.voicePolishing
    : voice.state === "idle"
      ? labels.voiceStart
      : voice.state === "connecting"
        ? labels.voiceConnecting
        : labels.voiceStop;
  const recording = voice.state === "listening" || voice.state === "stopping";
  return (
    <>
      {/* Подпись кнопки экранный диктор при смене не зачитывает: чистку объявляем отдельным живым сообщением. */}
      <span className="sr-only" aria-live="polite">
        {voice.polishing ? labels.voicePolishing : ""}
      </span>
      <Tooltip label={label}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={recording}
          aria-busy={voice.polishing ? true : undefined}
          disabled={voice.state === "stopping"}
          onClick={voice.onToggle}
          className={`${recording ? "text-[var(--action)] hover:text-[var(--action)]" : ""}${voice.state === "listening" ? " animate-pulse" : ""}`}
        >
          {voice.state === "connecting" || voice.polishing ? <Loader2 className="animate-spin" /> : recording ? <Square className="size-3.5 fill-current" /> : <Mic />}
        </Button>
      </Tooltip>
    </>
  );
}
