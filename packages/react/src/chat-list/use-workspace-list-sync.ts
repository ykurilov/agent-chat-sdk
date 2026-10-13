import { useEffect, useRef } from "react";
import type { ChatListState } from "./use-chat-list";

/** Пока у открытого чата, где идёт ответ, нет названия, список спрашивает сервер так часто (название ставится с первым сообщением). */
const TITLE_POLL_MS = 1000;

/**
 * Список чатов следит за открытым чатом: ответ начался или закончился — тихое обновление (порядок и название могли
 * измениться); пока идёт ответ, а названия у чата нет, — опрос раз в секунду. Общее у `ChatWorkspace` и панели агента.
 * `enabled: false` — список не нужен (у чата запрещён `chatList`): ничего не запрашивается.
 */
export function useWorkspaceListSync(list: Pick<ChatListState, "items" | "activeChatId" | "refresh">, busy: boolean, enabled = true): void {
  const { items, activeChatId, refresh } = list;

  const previousBusy = useRef<boolean | null>(null);
  useEffect(() => {
    const before = previousBusy.current;
    previousBusy.current = busy;
    if (enabled && before !== null && before !== busy) void refresh();
  }, [busy, enabled, refresh]);

  const activeItem = items.find((item) => item.id === activeChatId);
  const waitingForTitle = enabled && busy && activeItem !== undefined && activeItem.title === null;
  useEffect(() => {
    if (!waitingForTitle) return;
    const timer = setInterval(() => void refresh(), TITLE_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, waitingForTitle]);
}
