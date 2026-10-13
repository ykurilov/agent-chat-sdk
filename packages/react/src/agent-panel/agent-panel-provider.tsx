import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { AgentAppBridge, AppDataChange, BrowserToolFunction } from "../app-bridge/app-bridge";
import { createAppBridge } from "../app-bridge/create-app-bridge";
import type { AppBridgeOptions } from "../app-bridge/create-app-bridge";
import { useChatList } from "../chat-list/use-chat-list";
import { useWorkspaceListSync } from "../chat-list/use-workspace-list-sync";
import { useChatLabels } from "../labels";
import { AppBridgeContext, PanelControlsContext, PanelViewContext } from "./panel-context";
import type { AgentPanelControls, PanelView } from "./panel-context";
import { panelChatKey, usePanelOpen } from "./panel-state";

export interface AgentPanelProviderProps {
  /** Адрес обработчика чата, например `/api/chat`. */
  api: string;
  /** Номер человека в приложении: открыта ли панель и какой чат открыт, помнится отдельно для каждого. Смена — состояние другого человека. */
  userKey: string;
  /** Функции браузерных инструментов по именам (описания задаёт сервер в `agent.browserTools`). */
  browserTools?: Record<string, BrowserToolFunction>;
  /** `overlay` — панель поверх страницы, `push` — приложение сдвигает страницу на `pageInset`. По умолчанию `overlay`. */
  mode?: "overlay" | "push";
  /** Ширина панели на широком экране, px. По умолчанию 420. */
  width?: number;
  /** Каждое сообщение об изменении данных, любой метки. */
  onDataChanged?: (change: AppDataChange) => void;
  /** Свой `fetch` для списка чатов. Сам чат, как и `AgentChat`, ходит через `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
  children?: ReactNode;
}

const DEFAULT_WIDTH = 420;
const NARROW_SCREEN = "(max-width: 640px)";

/**
 * Состояние панели агента и связь чата с приложением. Ставится в корневой макет, над маршрутами:
 * панель, открытый чат и идущий ответ живут при переходах по страницам приложения.
 */
export function AgentPanelProvider({ api, userKey, browserTools, mode = "overlay", width = DEFAULT_WIDTH, onDataChanged, fetch, children }: AgentPanelProviderProps) {
  const labels = useChatLabels();
  const bridgeOptions = useRef<AppBridgeOptions>({ toolUnavailableMessage: labels.agentPanelToolUnavailable });
  bridgeOptions.current = {
    toolUnavailableMessage: labels.agentPanelToolUnavailable,
    ...(browserTools && { browserTools }),
    ...(onDataChanged && { onDataChanged }),
  };
  const [bridgeControl] = useState(() => createAppBridge(() => bridgeOptions.current));

  const [open, setOpen] = usePanelOpen(api, userKey);
  const list = useChatList({ api, rememberKey: panelChatKey(api, userKey), ...(fetch && { fetch }) });
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Готовый текст для поля ввода; `chatId: null` — привяжется к чату, который откроет `openNewChat`. */
  const [draft, setDraft] = useState<{ text: string; nonce: number; chatId: string | null } | null>(null);
  const draftCount = useRef(0);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const { activeChatId } = list;

  // Сменился человек: его панель, без списка и текста прежнего.
  const [sessionUser, setSessionUser] = useState(userKey);
  if (sessionUser !== userKey) {
    setSessionUser(userKey);
    setListOpen(false);
    setDraft(null);
    setBusy(false);
  }
  /** Человек на экране сейчас: действие, начатое для прежнего, после ожидания ничего не меняет. */
  const currentUser = useRef(userKey);
  currentUser.current = userKey;
  // Мост чата этого человека: поток чата прежнего, который ещё не оборвался, не раздаёт изменения и не делает действий на странице.
  const userBridge = useMemo(
    () => bridgeForUser(bridgeControl.bridge, () => currentUser.current === userKey, () => bridgeOptions.current.toolUnavailableMessage),
    [bridgeControl, userKey],
  );
  if (draft !== null) {
    if (draft.chatId === null) {
      if (activeChatId !== null) setDraft({ ...draft, chatId: activeChatId });
    } else if (draft.chatId !== activeChatId) {
      setDraft(null);
    }
  }
  const boundDraft = draft !== null && draft.chatId !== null && draft.chatId === activeChatId ? draft : null;

  const chatBusy = activeChatId !== null && busy;
  useWorkspaceListSync(list, chatBusy);
  const narrow = useSyncExternalStore(subscribeToScreen, readNarrowScreen, () => false);
  const pageInset = mode === "push" && open && !narrow ? width : 0;

  const { select, create, deleteRequest, refresh } = list;
  // Список открывается поверх чата: свежий с сервера (чат могли удалить или переименовать в другой вкладке).
  const showList = useCallback(
    (show: boolean) => {
      setListOpen(show);
      if (show) void refresh();
    },
    [refresh],
  );
  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const openChat = useCallback(
    (chatId: string) => {
      setOpen(true);
      setListOpen(false);
      select(chatId);
    },
    [select, setOpen],
  );
  const openNewChat = useCallback(
    async (options?: { draft?: string }) => {
      setOpen(true);
      setListOpen(false);
      const created = await create();
      if (currentUser.current !== userKey) return false;
      if (!created) {
        showList(true);
        return false;
      }
      if (options?.draft !== undefined) {
        draftCount.current += 1;
        setDraft({ text: options.draft, nonce: draftCount.current, chatId: null });
      }
      return true;
    },
    [create, setOpen, showList, userKey],
  );
  const closeList = useCallback(() => setListOpen(false), []);
  // Esc: ждёт подтверждения удаления — ничего; открыт список — назад к чату; иначе закрыть панель.
  const escape = useCallback(() => {
    if (deleteRequest !== null) return;
    if (listOpen) setListOpen(false);
    else setOpen(false);
  }, [deleteRequest, listOpen, setOpen]);

  const controls = useMemo<AgentPanelControls>(
    () => ({ open, setOpen, toggle, openChat, openNewChat, pageInset, mode, width, busy: chatBusy }),
    [chatBusy, mode, open, openChat, openNewChat, pageInset, setOpen, toggle, width],
  );
  const view: PanelView = {
    api,
    controls,
    list,
    // Список не загрузился и открыть нечего: показать его с ошибкой и «Повторить» сразу.
    listOpen: listOpen || (activeChatId === null && list.status === "error"),
    setListOpen: showList,
    closeList,
    escape,
    chatKey: boundDraft ? `draft:${boundDraft.nonce}:${activeChatId}` : `chat:${activeChatId}`,
    initialDraft: boundDraft?.text,
    setBusy,
    launcherRef,
    bridge: userBridge,
  };

  return (
    <AppBridgeContext.Provider value={bridgeControl}>
      <PanelControlsContext.Provider value={controls}>
        <PanelViewContext.Provider value={view}>{children}</PanelViewContext.Provider>
      </PanelControlsContext.Provider>
    </AppBridgeContext.Provider>
  );
}

/** Мост, который молчит, когда `isCurrent()` ложно: сообщения об изменениях не раздаются, браузерные вызовы не исполняются. */
function bridgeForUser(bridge: AgentAppBridge, isCurrent: () => boolean, unavailableMessage: () => string): AgentAppBridge {
  return {
    get tabId() {
      return bridge.tabId;
    },
    currentPlace: () => bridge.currentPlace(),
    dataChanged(change) {
      if (isCurrent()) bridge.dataChanged(change);
    },
    browserCall: (call, options) => (isCurrent() ? bridge.browserCall(call, options) : Promise.resolve({ error: unavailableMessage() })),
  };
}

function subscribeToScreen(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(NARROW_SCREEN);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function readNarrowScreen(): boolean {
  return typeof matchMedia === "function" && matchMedia(NARROW_SCREEN).matches;
}
