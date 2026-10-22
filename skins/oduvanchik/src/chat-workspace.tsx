import { Button, Dialog, DialogContent, DialogTitle } from "@tandem/ui";
import type { ChatListSkin } from "@ykurilov/agent-chat-react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { Menu } from "./icons";
import type { ComponentProps } from "react";
import { useScreenQuery } from "./screen-width";
import { OduvanchikSkinLabels } from "./tandem-labels";

/** С этой ширины список стоит рядом с чатом; уже — прячется в выезжающую панель. */
const wideScreenQuery = "(min-width: 48rem)";

/**
 * Каркас списка чатов. Широкий экран: список слева, чат справа. Узкий: над чатом полоса с кнопкой «Чаты»
 * и названием открытого чата, сам список — в панели у левого края (у Тандема панель без анимации: его выезд идёт справа).
 * Без `list` (у чата запрещено право `chatList`) — только чат; место чата в разметке то же, он не перерисовывается заново.
 */
export function OduvanchikChatWorkspace({
  list,
  children,
  activeTitle,
  listOpen,
  onListOpenChange,
}: ComponentProps<ChatListSkin["ChatWorkspace"]>) {
  const labels = useChatLabels();
  const wide = useScreenQuery(wideScreenQuery, true);

  if (wide) {
    return (
      <OduvanchikSkinLabels>
        <div className="oduvanchik-chat flex h-full min-h-0 bg-[var(--canvas)]">
          {list !== undefined && (
            <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)]">
              <h2 className="px-4 pb-1 pt-4 text-sm font-semibold text-[var(--foreground-muted)]">{labels.chatListHeading}</h2>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">{list}</div>
            </aside>
          )}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </OduvanchikSkinLabels>
    );
  }

  return (
    <OduvanchikSkinLabels>
      <div className="oduvanchik-chat flex h-full min-h-0 flex-col bg-[var(--canvas)]">
        {list !== undefined && (
          <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
            <Button
              variant="ghost"
              size="icon"
              aria-label={labels.chatListHeading}
              aria-expanded={listOpen}
              onClick={() => onListOpenChange(!listOpen)}
            >
              <Menu />
            </Button>
            <span className="min-w-0 truncate text-sm font-medium text-[var(--foreground)]">{activeTitle}</span>
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
        <Dialog open={listOpen && list !== undefined} onOpenChange={onListOpenChange}>
          <DialogContent
            side="right"
            aria-describedby={undefined}
            // Escape в поле переименования отменяет правку, а не закрывает панель.
            onEscapeKeyDown={(event) => {
              if (event.target instanceof HTMLInputElement) event.preventDefault();
            }}
            className="left-0 right-auto w-[min(20rem,85vw)] border-l-0 border-r animate-none!"
          >
            <DialogTitle className="px-4 pb-1 pt-4 text-sm font-semibold text-[var(--foreground-muted)]">
              {labels.chatListHeading}
            </DialogTitle>
            <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto px-2 pb-3">{list}</div>
          </DialogContent>
        </Dialog>
      </div>
    </OduvanchikSkinLabels>
  );
}
