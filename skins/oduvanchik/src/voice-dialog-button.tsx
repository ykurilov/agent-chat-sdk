import { Button, Tooltip } from "@tandem/ui";
import type { VoiceDialogView } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { AudioLines } from "./icons";

/**
 * Кнопка голосового режима в нижнем ряду поля ввода, рядом с микрофоном диктовки. Отличается значком (волна, не микрофон)
 * и подписью. Пока режим включён, подпись называет состояние словами и «Выйти»; нажатие в любом состоянии переключает режим.
 * Не меньше 44 пунктов: такую кнопку нажимают на ходу, одной рукой.
 */
export function OduvanchikVoiceDialogButton({ dialog }: { dialog: VoiceDialogView }) {
  const words = useChatLabels().voiceDialog;
  const active = dialog.state !== "off";
  const label = active ? `${words.states[dialog.state]}. ${words.exit}` : words.start;
  return (
    <Tooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-pressed={active}
        onClick={dialog.onToggle}
        style={{ minWidth: 44, minHeight: 44 }}
        className={active ? "text-[var(--action)] hover:text-[var(--action)]" : ""}
      >
        <AudioLines />
      </Button>
    </Tooltip>
  );
}
