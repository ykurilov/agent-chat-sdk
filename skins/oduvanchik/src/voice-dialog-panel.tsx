import { Button } from "@tandem/ui";
import type { VoiceDialogState, VoiceDialogView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { AudioLines, Hand, Loader2, Mic, TriangleAlert, X } from "./icons";
import type { ReactNode } from "react";
import { OduvanchikVoiceMenu } from "./voice-menu";

const clamp01 = (value: number | undefined) => Math.min(1, Math.max(0, value ?? 0));

/** Значок состояния; пока слушаем, вокруг микрофона кольцо растёт с громкостью голоса. */
function stateIcon(state: VoiceDialogState): ReactNode {
  switch (state) {
    case "connecting":
    case "thinking":
      return <Loader2 className="animate-spin motion-reduce:animate-none" />;
    case "speaking":
      return <AudioLines className="motion-safe:animate-pulse" />;
    case "interrupted":
      return <Hand />;
    case "error":
      return <TriangleAlert className="text-[var(--destructive-text)]" />;
    default:
      return <Mic />;
  }
}

function LevelIndicator({ state, level }: { state: VoiceDialogState; level: number | undefined }) {
  const shown = state === "listening" ? clamp01(level) : 0;
  return (
    <div aria-hidden="true" className="relative flex size-11 shrink-0 items-center justify-center text-[var(--action)] [&_svg]:size-5">
      <span
        data-level={shown}
        className="absolute inset-0 rounded-full bg-[var(--action)] opacity-20 transition-transform duration-75 motion-reduce:transition-none"
        style={{ transform: `scale(${0.6 + shown * 0.4})` }}
      />
      <span className="relative">{stateIcon(state)}</span>
    </div>
  );
}

/**
 * Панель режима на месте поля ввода, пока режим включён: индикатор, состояние словами, меню голосов, выход, надпись ошибки.
 * Выключенный режим с причиной (простой, уход страницы в фон) рисует только эту причину. Компактная: на телефоне
 * не выше нижней трети экрана, кнопки не меньше 44 пунктов.
 */
export function OduvanchikVoiceDialogPanel({ dialog }: { dialog: VoiceDialogView }) {
  const words = useChatLabels().voiceDialog;
  const errorText = dialog.error && words.errors[dialog.error];
  // Строки под рядом «значок · состояние · выход» занимают всю ширину: длинная надпись не сжимает состояние в узкий столбец.
  const errorAlert = errorText && (
    <p role="alert" className="order-3 basis-full text-sm text-[var(--destructive-text)]">
      {errorText}
    </p>
  );
  if (dialog.state === "off") return errorAlert ? <div className="flex px-2">{errorAlert}</div> : null;
  const textOnly = !dialog.speechAvailable && dialog.error === undefined;
  return (
    <div
      data-state={dialog.state}
      className="flex max-h-[33dvh] min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border)] bg-[var(--surface-raised)] p-2"
    >
      <LevelIndicator state={dialog.state} level={dialog.level} />
      <p role="status" className="min-w-0 flex-1 basis-24 font-semibold text-[var(--foreground)]">
        {words.states[dialog.state]}
      </p>
      <OduvanchikVoiceMenu dialog={dialog} />
      <Button variant="secondary" onClick={dialog.onToggle} style={{ minWidth: 44, minHeight: 44 }} className="order-2 gap-2">
        <X aria-hidden="true" />
        {words.exit}
      </Button>
      {errorAlert}
      {textOnly && <p className="order-3 basis-full text-sm text-[var(--foreground-muted)]">{words.errors.speech_unavailable}</p>}
    </div>
  );
}
