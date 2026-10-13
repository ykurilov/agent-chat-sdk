import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import type { ModelCallPurpose } from "@ykurilov/agent-chat-core";

/** Надписи песочницы. Надписи чата внутри песочницы — обычный `ChatLabels`. */
export interface SandboxLabels {
  title: string;
  chatPanel: string;
  journalPanel: string;
  /** Подпись выпадающего списка ходов внутри журнала. */
  turnPicker: string;
  openJournal: string;
  closeJournal: string;
  journalLoading: string;
  journalFailed: string;
  journalEmpty: string;
  retry: string;
  wholeChat: string;
  /** Подпись хода в выборе над журналом: `index` считается с 1. */
  turnLabel: (index: number) => string;
  purposes: Record<ModelCallPurpose, string>;
  modelCallStatus: Record<"complete" | "error" | "aborted", string>;
  attempt: (attempt: number) => string;
  durationMs: (ms: number) => string;
  firstChunk: (ms: number) => string;
  tokens: (input: number, cached: number, output: number) => string;
  costUnknown: string;
  instructionsChanged: string;
  outputEdited: string;
  fromMessage: string;
  truncated: string;
  instructions: string;
  messages: string;
  newMessage: string;
  tools: string;
  settings: string;
  response: string;
  reasoning: string;
  toolCalls: string;
  finishReason: string;
  error: string;
  toolInput: string;
  toolOutput: string;
  noOutput: string;
  instructionEditor: string;
  /** Подпись самого поля текста инструкции (кнопка раскрытия подписана `instructionEditor`). */
  instructionText: string;
  appInstructions: string;
  instructionsEdited: string;
  instructionsSave: string;
  instructionsSaving: string;
  instructionsReset: string;
  instructionsTooLong: (maxLength: number) => string;
  instructionsSaveFailed: string;
  answerEditor: string;
  answerText: string;
  answerTextEmpty: string;
  toolOutputJson: (toolName: string) => string;
  toolOutputInvalidJson: string;
  toolOutputTooLarge: string;
  answerEditSave: string;
  answerEditSaving: string;
  answerEditCancel: string;
  answerEditFailed: string;
  /** Раздел «Чаты людей»; нет в словаре — русские надписи `russianPeopleChatsLabels`. */
  peopleChats?: PeopleChatsLabels;
  /** Кнопка «Открыть чат снова»; нет в словаре — русские надписи `russianChatReopenLabels`. */
  chatReopen?: ChatReopenLabels;
}

/** Надписи кнопки «Открыть чат снова» (чат, закрытый инструментом, в песочнице). */
export interface ChatReopenLabels {
  reopen: string;
  reopening: string;
  failed: string;
}

export const russianChatReopenLabels: ChatReopenLabels = {
  reopen: "Открыть чат снова",
  reopening: "Открываем…",
  failed: "Чат не открылся",
};

export const englishChatReopenLabels: ChatReopenLabels = {
  reopen: "Reopen chat",
  reopening: "Reopening…",
  failed: "The chat was not reopened",
};

/** Надписи раздела «Чаты людей» и переключателя разделов песочницы. */
export interface PeopleChatsLabels {
  /** Подпись переключателя разделов. */
  sections: string;
  sandboxSection: string;
  peopleSection: string;
  /** Поле поиска, когда приложение дало поиск людей. */
  searchPerson: string;
  /** Поле id человека, когда поиска нет. */
  personId: string;
  search: string;
  openPerson: string;
  searching: string;
  searchFailed: string;
  nobodyFound: string;
  chatsLoading: string;
  chatsFailed: string;
  noChats: string;
  untitledChat: string;
  /** Отметка чата объекта (урок, заказ). */
  subjectChat: string;
  chooseChat: string;
  /** Отметка над лентой: чат человека открыт только на чтение. */
  readOnly: string;
  copy: string;
  copying: string;
  copyFailed: string;
  emptyChat: string;
}

export const russianPeopleChatsLabels: PeopleChatsLabels = {
  sections: "Разделы песочницы",
  sandboxSection: "Песочница",
  peopleSection: "Чаты людей",
  searchPerson: "Найти человека",
  personId: "Id человека",
  search: "Найти",
  openPerson: "Открыть",
  searching: "Ищем…",
  searchFailed: "Поиск не удался",
  nobodyFound: "Никого не нашли",
  chatsLoading: "Чаты загружаются…",
  chatsFailed: "Чаты не загрузились",
  noChats: "Чатов нет",
  untitledChat: "Без названия",
  subjectChat: "Чат объекта",
  chooseChat: "Выберите чат",
  readOnly: "Только чтение: чат человека не меняется",
  copy: "Проверить в копии",
  copying: "Копируем…",
  copyFailed: "Копия не создалась",
  emptyChat: "В чате нет сообщений",
};

export const englishPeopleChatsLabels: PeopleChatsLabels = {
  sections: "Sandbox sections",
  sandboxSection: "Sandbox",
  peopleSection: "People's chats",
  searchPerson: "Find a person",
  personId: "Person id",
  search: "Search",
  openPerson: "Open",
  searching: "Searching…",
  searchFailed: "Search failed",
  nobodyFound: "Nobody found",
  chatsLoading: "Loading chats…",
  chatsFailed: "Chats failed to load",
  noChats: "No chats",
  untitledChat: "Untitled",
  subjectChat: "Object chat",
  chooseChat: "Choose a chat",
  readOnly: "Read only: the person's chat does not change",
  copy: "Check in a copy",
  copying: "Copying…",
  copyFailed: "Copy was not created",
  emptyChat: "The chat has no messages",
};

export const russianSandboxLabels: SandboxLabels = {
  title: "Песочница",
  chatPanel: "Чат",
  journalPanel: "Журнал",
  turnPicker: "Выбор хода",
  openJournal: "Открыть журнал",
  closeJournal: "Закрыть журнал",
  journalLoading: "Журнал загружается…",
  journalFailed: "Журнал не загрузился",
  journalEmpty: "Записей пока нет",
  retry: "Повторить",
  wholeChat: "Весь чат",
  turnLabel: (index) => `Ответ ${index}`,
  purposes: { answer: "Ответ", compaction: "Сжатие истории", memory: "Память", title: "Название чата", helper: "Помощник", other: "Другое" },
  modelCallStatus: { complete: "Готово", error: "Ошибка", aborted: "Прервано" },
  attempt: (attempt) => `Попытка ${attempt}`,
  durationMs: (ms) => `${(ms / 1000).toFixed(1)} с`,
  firstChunk: (ms) => `Первый кусок через ${(ms / 1000).toFixed(1)} с`,
  tokens: (input, cached, output) => `Вход ${input} (из кэша ${cached}) · выход ${output}`,
  costUnknown: "Цена неизвестна",
  instructionsChanged: "Инструкция изменилась",
  outputEdited: "Результат изменён",
  fromMessage: "Из сообщения",
  truncated: "Обрезано",
  instructions: "Инструкция",
  messages: "Сообщения",
  newMessage: "Новое",
  tools: "Инструменты",
  settings: "Настройки",
  response: "Ответ",
  reasoning: "Рассуждение",
  toolCalls: "Вызовы инструментов",
  finishReason: "Причина остановки",
  error: "Ошибка",
  toolInput: "Вход",
  toolOutput: "Результат",
  noOutput: "Результата нет",
  instructionEditor: "Инструкция чата",
  instructionText: "Текст инструкции",
  appInstructions: "Боевая инструкция",
  instructionsEdited: "Инструкция изменена",
  instructionsSave: "Сохранить",
  instructionsSaving: "Сохраняем…",
  instructionsReset: "Вернуть боевую",
  instructionsTooLong: (maxLength) => `Не длиннее ${maxLength} знаков`,
  instructionsSaveFailed: "Инструкция не сохранилась",
  answerEditor: "Правка ответа",
  answerText: "Текст ответа",
  answerTextEmpty: "Текст ответа не может быть пустым",
  toolOutputJson: (toolName) => `Результат ${toolName}`,
  toolOutputInvalidJson: "Неверный JSON",
  toolOutputTooLarge: "Больше 64 КБ",
  answerEditSave: "Сохранить",
  answerEditSaving: "Сохраняем…",
  answerEditCancel: "Отмена",
  answerEditFailed: "Правка не сохранилась",
  peopleChats: russianPeopleChatsLabels,
  chatReopen: russianChatReopenLabels,
};

export const englishSandboxLabels: SandboxLabels = {
  title: "Sandbox",
  chatPanel: "Chat",
  journalPanel: "Journal",
  turnPicker: "Choose turn",
  openJournal: "Open journal",
  closeJournal: "Close journal",
  journalLoading: "Loading journal…",
  journalFailed: "Journal failed to load",
  journalEmpty: "No entries yet",
  retry: "Retry",
  wholeChat: "Whole chat",
  turnLabel: (index) => `Answer ${index}`,
  purposes: { answer: "Answer", compaction: "History compaction", memory: "Memory", title: "Chat title", helper: "Helper", other: "Other" },
  modelCallStatus: { complete: "Done", error: "Error", aborted: "Aborted" },
  attempt: (attempt) => `Attempt ${attempt}`,
  durationMs: (ms) => `${(ms / 1000).toFixed(1)} s`,
  firstChunk: (ms) => `First chunk after ${(ms / 1000).toFixed(1)} s`,
  tokens: (input, cached, output) => `Input ${input} (cached ${cached}) · output ${output}`,
  costUnknown: "Cost unknown",
  instructionsChanged: "Instructions changed",
  outputEdited: "Output edited",
  fromMessage: "From message",
  truncated: "Truncated",
  instructions: "Instructions",
  messages: "Messages",
  newMessage: "New",
  tools: "Tools",
  settings: "Settings",
  response: "Response",
  reasoning: "Reasoning",
  toolCalls: "Tool calls",
  finishReason: "Finish reason",
  error: "Error",
  toolInput: "Input",
  toolOutput: "Output",
  noOutput: "No output",
  instructionEditor: "Chat instructions",
  instructionText: "Instructions text",
  appInstructions: "App instructions",
  instructionsEdited: "Instructions edited",
  instructionsSave: "Save",
  instructionsSaving: "Saving…",
  instructionsReset: "Restore app instructions",
  instructionsTooLong: (maxLength) => `At most ${maxLength} characters`,
  instructionsSaveFailed: "Instructions were not saved",
  answerEditor: "Edit answer",
  answerText: "Answer text",
  answerTextEmpty: "Answer text cannot be empty",
  toolOutputJson: (toolName) => `${toolName} output`,
  toolOutputInvalidJson: "Invalid JSON",
  toolOutputTooLarge: "Larger than 64 KB",
  answerEditSave: "Save",
  answerEditSaving: "Saving…",
  answerEditCancel: "Cancel",
  answerEditFailed: "Edit was not saved",
  peopleChats: englishPeopleChatsLabels,
  chatReopen: englishChatReopenLabels,
};

const SandboxLabelsContext = createContext<SandboxLabels>(russianSandboxLabels);

/** Свой словарь песочницы; без провайдера — русский. */
export function SandboxLabelsProvider({ labels, children }: { labels: SandboxLabels; children?: ReactNode }) {
  return createElement(SandboxLabelsContext.Provider, { value: labels }, children);
}

export function useSandboxLabels(): SandboxLabels {
  return useContext(SandboxLabelsContext);
}

/** Надписи раздела «Чаты людей»: из словаря песочницы, а в старом словаре без них — русские. */
export function usePeopleChatsLabels(): PeopleChatsLabels {
  return useSandboxLabels().peopleChats ?? russianPeopleChatsLabels;
}

/** Надписи кнопки «Открыть чат снова»: из словаря песочницы, а в старом словаре без них — русские. */
export function useChatReopenLabels(): ChatReopenLabels {
  return useSandboxLabels().chatReopen ?? russianChatReopenLabels;
}
