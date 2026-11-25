import { createContext, useContext } from "react";
import type { RefObject } from "react";
import type { AppBridgeControl } from "../app-bridge/create-app-bridge";
import type { ChatListState } from "../chat-list/use-chat-list";

/** Управление панелью из кода приложения (`useAgentPanel`). */
export interface AgentPanelControls {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** Open the panel on its current chat without replacing its draft or conversation. */
  showChat(): void;
  /** Open the current chat, dismiss the chat list and focus its composer; repeatable while open. */
  focusComposer(): void;
  /** Открыть панель на чате; чужой или удалённый — «Чат не найден», список — по кнопке «Чаты». */
  openChat(chatId: string): void;
  /**
   * Открыть панель на чате объекта (урок, заказ): `POST {api}/subject { key }` находит или создаёт чат человека, дальше —
   * как `openChat`. Нужен `subjectChats` в обработчике чата. Отказ сервера — его текст и «Повторить» в панели; выбор чата
   * из списка уводит из отказа.
   */
  openSubject(key: string): void;
  /** Id открытого чата (только чтение): вернуться к нему потом через `openChat`. `null` — чата нет или ищется чат объекта. */
  activeChatId: string | null;
  /** Новый (или пустой) чат и готовый текст в поле ввода. `false` — не создался (список открыт с ошибкой). */
  openNewChat(options?: { draft?: string }): Promise<boolean>;
  /** Отступ справа для страницы в режиме `push`; 0 — закрыто, режим `overlay` или экран ≤ 640 px. */
  pageInset: number;
  mode: "overlay" | "push";
  width: number;
  /** Идёт ответ в открытом чате — для значка на кнопке. */
  busy: boolean;
}

/** То, что нужно `AgentPanel`, чтобы нарисовать кнопку, рамку, список и открытый чат. */
export interface PanelView {
  api: string;
  controls: AgentPanelControls;
  list: ChatListState;
  listOpen: boolean;
  setListOpen(open: boolean): void;
  /** Список выбран или создан: закрыть его. */
  closeList(): void;
  /** Esc внутри панели: открыт список — закрыть его, иначе закрыть панель; при подтверждении удаления — ничего. */
  escape(): void;
  /** Ключ открытого чата: меняется вместе с чатом и с новым готовым текстом. */
  chatKey: string;
  initialDraft: string | undefined;
  focusRequest: number;
  setBusy(busy: boolean): void;
  launcherRef: RefObject<HTMLButtonElement | null>;
  /** Свои кнопки вызова (`useAgentPanelLauncher`): куда вернуть фокус, когда панель закрылась. */
  launchers: PanelLaunchers;
  /** Ищется чат объекта (`openSubject`): ключ и номер попытки; `null` — открыт обычный чат. */
  subjectRequest: { key: string; nonce: number } | null;
  /** Чат объекта найден: открыть его как обычный. */
  subjectFound(request: { key: string; nonce: number }, chatId: string): void;
  bridge: AppBridgeControl["bridge"];
}

/**
 * Кнопки вызова панели и куда вернуть фокус, когда панель закрылась: туда, откуда её открыли (нажатая кнопка вызова или
 * элемент, который был в фокусе при открытии из кода), если он ещё на странице и виден; иначе на свою кнопку вызова,
 * иначе на встроенную.
 */
export interface PanelLaunchers {
  /** Своя кнопка вызова (`useAgentPanelLauncher`) появилась на странице; возвращает уборку. */
  add(button: HTMLElement): () => void;
  /** Закрытую панель открывают этой кнопкой вызова (своей или встроенной). */
  pressed(button: HTMLElement): void;
  /** Панель открывается: запомнить, откуда. */
  opening(): void;
  /** Куда вернуть фокус; `builtIn` — встроенная кнопка, если она есть. `null` — некуда. */
  focusTarget(builtIn: HTMLElement | null): HTMLElement | null;
}

const isVisible = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement &&
  element.isConnected &&
  element.closest("[hidden], [inert]") === null &&
  (typeof element.checkVisibility !== "function" || element.checkVisibility());

export function createPanelLaunchers(): PanelLaunchers {
  const mounted = new Set<HTMLElement>();
  let lastOwn: HTMLElement | null = null;
  let pressed: HTMLElement | null = null;
  let origin: Element | null = null;
  return {
    add(button) {
      mounted.add(button);
      return () => {
        mounted.delete(button);
        if (lastOwn === button) lastOwn = null;
      };
    },
    pressed(button) {
      pressed = button;
      if (mounted.has(button)) lastOwn = button;
    },
    opening() {
      const focused = typeof document === "undefined" ? null : document.activeElement;
      origin = pressed ?? (focused === document.body ? null : focused);
      pressed = null;
    },
    focusTarget(builtIn) {
      if (isVisible(origin)) return origin;
      if (lastOwn !== null && isVisible(lastOwn)) return lastOwn;
      return [...mounted].find(isVisible) ?? (isVisible(builtIn) ? builtIn : null);
    },
  };
}

export const AppBridgeContext = createContext<AppBridgeControl | null>(null);
export const PanelControlsContext = createContext<AgentPanelControls | null>(null);
export const PanelViewContext = createContext<PanelView | null>(null);

function required<T>(value: T | null, user: string): T {
  if (value === null) throw new Error(`${user} needs AgentPanelProvider above it (import it from "@ykurilov/agent-chat-react/panel")`);
  return value;
}

/** Мост и регистрация мест и подписок; для хуков панели. */
export function useAppBridgeControl(user = "useAppBridgeControl"): AppBridgeControl {
  return required(useContext(AppBridgeContext), user);
}

export function usePanelControls(user: string): AgentPanelControls {
  return required(useContext(PanelControlsContext), user);
}

export function usePanelView(user: string): PanelView {
  return required(useContext(PanelViewContext), user);
}
