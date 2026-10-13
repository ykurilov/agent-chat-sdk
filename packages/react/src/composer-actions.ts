import type { ReactNode } from "react";

/** Что `AgentChat.composerActions` может сделать с полем ввода и отправкой. */
export interface ComposerHelper {
  /** Текст в поле ввода сейчас. */
  value: string;
  /** Заменить текст в поле ввода. */
  setValue(text: string): void;
  /**
   * Отправить сообщение по тем же правилам, что кнопка «Отправить». С `text` уходит он, поле не трогается;
   * без `text` — то, что в поле (с файлами). Пока `canSend` ложно (история не загрузилась, идёт ответ, лимит исчерпан),
   * обе формы отказывают сразу и ничего не откладывают: проверяйте `canSend` и гасите кнопку.
   */
  send(text?: string): void;
  /** Положить файлы в поле ввода, как скрепка. Без плагина вложений ничего не делает. */
  addFiles(files: File[]): void;
  /** Агент отвечает: отправка сейчас не пройдёт. */
  busy: boolean;
  /** Отправка остановлена (исчерпан лимит расходов). */
  blocked: boolean;
  /** Отправка сейчас пройдёт: история загружена, ответ не идёт, лимит не исчерпан. */
  canSend: boolean;
}

/**
 * Свои кнопки у поля ввода: готовый узел или функция от помощника. Функция вызывается при каждом рендере чата:
 * делайте её быстрой и без побочных эффектов; помощника не сохраняйте, каждый раз приходит новый.
 */
export type ComposerActions = ReactNode | ((composer: ComposerHelper) => ReactNode);

/** Готовый узел для `Composer.actions` скина; `undefined` — кнопок нет. */
export function renderComposerActions(actions: ComposerActions, helper: ComposerHelper): ReactNode {
  return typeof actions === "function" ? actions(helper) : actions;
}
