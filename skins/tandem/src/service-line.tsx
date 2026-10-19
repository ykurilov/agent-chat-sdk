import type { ChatSkin } from "@ykurilov/agent-chat-react";
import type { ComponentProps } from "react";

/** Служебная строка перед ответом агента («Агент написал первым — человек молчал 1 ч 7 мин»): тихий текст между линиями, без пузыря. */
export function TandemServiceLine({ text }: ComponentProps<NonNullable<ChatSkin["ServiceLine"]>>) {
  return (
    <div className="my-3 flex items-center gap-3" data-service-line="">
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
      <p className="max-w-[80%] px-2 text-center text-xs font-medium break-words text-[var(--foreground-muted)]">{text}</p>
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}
