/** Правка готового ответа агента: новый текст целиком и, по желанию, новые результаты инструментов. */
export interface AnswerEdit {
  /** Весь текст ответа после правки. */
  text: string;
  /** toolCallId → новый результат (JSON до 64 КБ). */
  toolOutputs?: Record<string, unknown>;
}

/** Почему правка ответа не принята. */
export type AnswerEditErrorKind =
  | "chat_not_found"
  | "message_not_found"
  | "not_an_answer"
  | "answer_busy"
  | "not_on_current_branch"
  | "empty_text"
  | "invalid_tool_output"
  | "nothing_changed";
