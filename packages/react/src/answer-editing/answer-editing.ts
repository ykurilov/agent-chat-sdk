import type { ReactNode } from "react";
import type { AgentChatMessage } from "../chat-types";

/** Что в ответе изменено человеком: текст и (или) результаты вызовов инструментов. */
export interface AnswerEditMark {
  textEdited: boolean;
  editedToolCallIds: string[];
}

/** Что получает редактор ответа, который рисует страница. */
export interface AnswerEditorSlot {
  message: AgentChatMessage;
  /** Сервер принял правку и создал ответ `newMessageId`: чат переходит на его ветку и закрывает редактор. */
  onSaved: (newMessageId: string) => void;
  onCancel: () => void;
}

/**
 * Правка ответов агента (песочница). Чат даёт законченным ответам кнопку правки, показывает
 * отметки «изменено» и ставит редактор страницы на место ответа. Без этого свойства ответы не правятся.
 */
export interface AnswerEditing {
  /** Отметки правок по id ответа. */
  edits: ReadonlyMap<string, AnswerEditMark>;
  renderEditor: (slot: AnswerEditorSlot) => ReactNode;
}

/** Additional application fields of the built-in text editor. Values go to onAnswerEdited, never to the model. */
export interface AnswerEditorFields {
  message: AgentChatMessage;
  data: Record<string, unknown>;
  setData: (data: Record<string, unknown>) => void;
  disabled: boolean;
}
export interface AnswerTextEditing {
  renderFields?: (fields: AnswerEditorFields) => ReactNode;
  edits?: ReadonlyMap<string, AnswerEditMark>;
}

/** Изменён ли ответ человеком хоть в чём-то. */
export function answerEdited(mark: AnswerEditMark | undefined): boolean {
  return mark !== undefined && (mark.textEdited || mark.editedToolCallIds.length > 0);
}
