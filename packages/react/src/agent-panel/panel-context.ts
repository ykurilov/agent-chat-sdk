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
  bridge: AppBridgeControl["bridge"];
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
