import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Menu, MenuContent, MenuItem, MenuTrigger } from "@tandem/ui";
import type { ChatListSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { TandemSkinLabels } from "./tandem-labels";

type ChatListProps = ComponentProps<ChatListSkin["ChatList"]>;

/** Список чатов: «Новый чат», строки с меню «Переименовать / Удалить», окно подтверждения удаления. */
export function TandemChatList({
  status,
  items,
  onSelect,
  onCreate,
  creating,
  onRename,
  onRequestDelete,
  deleteRequest,
  error,
  onRetry,
}: ChatListProps) {
  const labels = useChatLabels();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Чат, чья кнопка получит фокус, когда поле переименования уйдёт (после Enter и Escape). */
  const focusRowOf = useRef<string | null>(null);
  useEffect(() => {
    if (renamingId !== null || focusRowOf.current === null) return;
    const chatId = focusRowOf.current;
    focusRowOf.current = null;
    // Не сразу: Enter ещё дожимается на поле, и кнопка, получившая фокус посреди нажатия, приняла бы его за своё.
    const timer = setTimeout(() => {
      const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-chat-id]") ?? [])].find((element) => element.dataset.chatId === chatId);
      row?.querySelector<HTMLElement>("button")?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [renamingId]);

  return (
    <TandemSkinLabels>
      <nav aria-label={labels.chatListHeading} className="flex flex-col gap-2">
        <Button variant="secondary" size="md" onClick={onCreate} disabled={creating} className="w-full justify-start gap-2">
          <Plus aria-hidden="true" />
          {labels.chatListNewChat}
        </Button>
        {status === "loading" && <p className="px-2 py-1 text-sm text-[var(--foreground-muted)]">{labels.chatListLoading}</p>}
        {error && (
          <p role="alert" className="px-2 text-sm text-[var(--destructive-text)]">
            {error}
          </p>
        )}
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="self-start">
            {labels.retry}
          </Button>
        )}
        <ul ref={listRef} className="flex flex-col gap-0.5">
          {items.map((item) => (
            <li key={item.id} data-chat-id={item.id} className="group relative">
              {renamingId === item.id ? (
                <RenameField
                  title={item.title ?? ""}
                  onDone={(title, keepFocus) => {
                    setRenamingId(null);
                    if (keepFocus) focusRowOf.current = item.id;
                    if (title !== undefined) onRename(item.id, title);
                  }}
                />
              ) : (
                <div
                  className={cn(
                    "flex items-center rounded-[var(--radius-control)] transition-colors duration-[var(--motion-fast)]",
                    item.active ? "bg-[var(--surface-hover)]" : "hover:bg-[var(--surface-hover)]",
                  )}
                >
                  <button
                    type="button"
                    aria-current={item.active ? "true" : undefined}
                    onClick={() => onSelect(item.id)}
                    className={cn(
                      "tandem-focus min-h-11 min-w-0 flex-1 truncate rounded-[var(--radius-control)] px-3 py-2 text-left text-sm",
                      item.active ? "font-medium text-[var(--foreground)]" : "text-[var(--foreground-muted)]",
                    )}
                  >
                    {item.title ?? labels.chatListUntitled}
                  </button>
                  {item.origin && (
                    <Badge variant="neutral" data-chat-origin={item.origin} className="shrink-0 py-0.5 text-[11px] font-normal">
                      {labels.chatListOrigin[item.origin]}
                    </Badge>
                  )}
                  {item.closed && (
                    <Badge variant="neutral" data-chat-closed={item.closed.code} title={item.closed.message} className="shrink-0 py-0.5 text-[11px] font-normal">
                      {labels.chatListClosed}
                    </Badge>
                  )}
                  <Menu>
                    <MenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={labels.chatListRowMenu(item.title ?? labels.chatListUntitled)} className="shrink-0">
                        <MoreHorizontal />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
                      <MenuItem onSelect={() => setRenamingId(item.id)}>{labels.chatListRename}</MenuItem>
                      <MenuItem destructive onSelect={() => onRequestDelete(item.id)}>
                        {labels.chatListDelete}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
              )}
            </li>
          ))}
        </ul>
        <Dialog open={deleteRequest !== undefined} onOpenChange={(open) => !open && deleteRequest?.onCancel()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{labels.chatListDeleteTitle}</DialogTitle>
              <DialogDescription>{labels.chatListDeleteBody(deleteRequest?.title ?? "")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={deleteRequest?.onCancel}>
                {labels.chatListDeleteCancel}
              </Button>
              <Button variant="destructive" loading={deleteRequest?.pending} onClick={deleteRequest?.onConfirm}>
                {labels.chatListDeleteConfirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </nav>
    </TandemSkinLabels>
  );
}

/**
 * Поле на месте названия: Enter и уход из поля сохраняют, Escape отменяет. Пустое и прежнее название не уходит.
 * `onDone(название, вернуть фокус на строку)`: без названия — правку отменили.
 */
function RenameField({ title, onDone }: { title: string; onDone: (title: string | undefined, keepFocus: boolean) => void }) {
  const labels = useChatLabels();
  const finished = useRef(false);
  const finish = (value: string | undefined, keepFocus: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const changed = value !== undefined && value.trim() !== "" && value.trim() !== title.trim();
    onDone(changed ? value : undefined, keepFocus);
  };
  return (
    <Input
      autoFocus
      aria-label={labels.chatListRenameField}
      defaultValue={title}
      maxLength={100}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => finish(event.currentTarget.value, false)}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value, true);
        if (event.key === "Escape") {
          // Escape закрывает только поле: выезжающая панель телефона остаётся открытой.
          event.stopPropagation();
          finish(undefined, true);
        }
      }}
    />
  );
}


