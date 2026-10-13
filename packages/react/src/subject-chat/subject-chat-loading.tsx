import { useRef } from "react";
import type { ChatSkin } from "../skin-contract";

const nothing = () => {};

/**
 * Чат объекта ещё ищется: тот же вид, что у обычного чата, пока грузится история, — пустая лента и поле ввода без
 * отправки. Экран не прыгает, когда чат найден.
 */
export function SubjectChatLoading({ skin }: { skin: ChatSkin }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <skin.Layout
      feed={null}
      scrollRef={scrollRef}
      announcement=""
      composer={<skin.Composer value="" onValueChange={nothing} onSubmit={nothing} canSubmit={false} busy={false} onStop={nothing} />}
    />
  );
}
