import { Button } from "@tandem/ui";
import { TOUCH_TARGET } from "./widget-frame";

/** Подсказки ответа под последним ответом: кнопки в строку с переносом; нажатие — обычная отправка текста (FR-015). */
export function TandemSuggestedReplies({ replies, onPick, disabled }: { replies: string[]; onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {replies.map((reply) => (
        <Button
          key={reply}
          size="sm"
          variant="secondary"
          style={TOUCH_TARGET}
          className="h-auto max-w-full whitespace-normal break-words text-left"
          disabled={disabled}
          onClick={() => onPick(reply)}
        >
          {reply}
        </Button>
      ))}
    </div>
  );
}
