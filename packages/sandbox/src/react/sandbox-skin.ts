import type { ComponentType, ReactNode } from "react";
import type { ModelCallPurpose } from "@ykurilov/agent-chat-core";

/** Что с подробностями или списком: грузятся, готовы, не загрузились (тогда `onRetry`). */
export type SandboxLoadState = "loading" | "ready" | "failed";

/** Строка журнала: обращение к модели. */
export interface JournalModelRowView {
  kind: "model";
  id: string;
  purpose: ModelCallPurpose;
  attempt: number;
  modelId: string;
  status: "complete" | "error" | "aborted";
  /** Время обращения готовой надписью («12:05:31»). */
  time: string;
  durationMs: number;
  firstChunkMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /** Цена готовой надписью; нет — цена неизвестна. */
  cost?: string;
  /** Инструкция отличается от прошлого обращения: показать отметку `labels.instructionsChanged`. */
  instructionsChanged: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Раскрытая строка: `ModelCallDetails`, собранный слоем поведения. */
  details?: ReactNode;
}

/** Строка журнала: вызов инструмента. */
export interface JournalToolRowView {
  kind: "tool";
  id: string;
  toolName: string;
  /** Название действия по-человечески, если приложение его задало. */
  title?: string;
  /** `server` — из журнала; `message` — вызов без `execute` (виджет, браузер, подтверждение): вход и ответ из частей сообщения. */
  source: "server" | "message";
  status: "complete" | "error";
  time: string;
  durationMs: number | null;
  /** Результат исправил человек: показать отметку `labels.outputEdited`. */
  outputEdited: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Раскрытая строка: `ToolCallDetails`, собранный слоем поведения. */
  details?: ReactNode;
}

export type JournalRowView = JournalModelRowView | JournalToolRowView;

/** Ход в выборе над журналом: «весь чат» или один ответ агента. */
export interface JournalTurnView {
  /** `null` — весь чат. */
  id: string | null;
  label: string;
}

/** Одно сообщение запроса к модели. */
export interface ModelCallMessageView {
  role: string;
  /** Содержимое как JSON-текст, отформатированный для чтения. */
  content: string;
  /** Сообщение появилось в этом обращении, в прошлом его не было. */
  isNew: boolean;
  /** Кусок обрезан пределом журнала: показать `labels.truncated`. */
  truncated: boolean;
}

/** Подробности обращения к модели: что ушло и что пришло. */
export type ModelCallDetailsView =
  | { state: "loading" }
  | { state: "failed"; onRetry: () => void }
  | {
      state: "ready";
      instructions: string;
      messages: ModelCallMessageView[];
      tools: Array<{ name: string; description?: string; inputSchema: string }>;
      /** Настройки запроса JSON-текстом. */
      settings: string;
      response: { text: string; reasoning: string; toolCalls: Array<{ toolCallId: string; toolName: string; input: string }>; finishReason: string | null };
      error: string | null;
    };

/** Подробности вызова инструмента: вход и результат JSON-текстом. */
export type ToolCallDetailsView =
  | { state: "loading" }
  | { state: "failed"; onRetry: () => void }
  | { state: "ready"; input: string; output: string | null; error: string | null; truncated: boolean };

/** Поле JSON результата одного вызова в редакторе ответа. */
export interface AnswerEditorToolOutputView {
  toolCallId: string;
  toolName: string;
  title?: string;
  /** Результат JSON-текстом. */
  value: string;
  onValueChange: (value: string) => void;
  /** Неверный JSON или больше 64 КБ — готовой надписью; сохранение недоступно. */
  error?: string;
  /** Значение отличается от исходного: при сохранении уйдёт только оно. */
  edited: boolean;
}

/** Раздел экрана песочницы: свои песочные чаты или чаты людей. */
export type SandboxSection = "sandbox" | "people";

/** Человек в найденных. */
export interface PersonView {
  id: string;
  name?: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}

/** Чат человека в списке. */
export interface PersonChatView {
  id: string;
  /** `null` — у чата нет названия (`labels.peopleChats.untitledChat`). */
  title: string | null;
  /** Время последнего изменения, ISO. */
  updatedAt: string;
  /** Чат объекта приложения (урок, заказ): показать отметку `labels.peopleChats.subjectChat`. */
  subject: boolean;
  selected: boolean;
  onOpen: () => void;
}

/** Раздел «Чаты людей»: поиск человека, его чаты и открытый чат на чтение. */
export interface PeopleChatsView {
  /** Приложение дало поиск людей; нет — поле принимает id человека (`labels.peopleChats.personId`). */
  searchable: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  /** Искать (или открыть человека по id, когда поиска нет). */
  onSearch: () => void;
  /** `idle` — ещё не искали; `empty` — никого (`nobodyFound`). */
  peopleState: SandboxLoadState | "idle" | "empty";
  people: PersonView[];
  /** Выбранный человек; нет — чатов не показывать. */
  person?: { id: string; name?: string };
  /** `empty` — чатов нет (`noChats`). */
  chatsState: SandboxLoadState | "empty";
  chats: PersonChatView[];
  onChatsRetry: () => void;
  /** Открытый чат человека: лента только на чтение (скин чата без поля ввода); нет — `chooseChat`. */
  chat?: ReactNode;
  /** «Проверить в копии»; есть, когда чат открыт. */
  onCopy?: () => void;
  copying: boolean;
  /** Почему копия не создалась, готовой надписью: показать как `role="alert"`. */
  copyError?: string;
}

/**
 * Договор скина песочницы, версия 1 (docs/sandbox.md). Слой поведения решает, что показать, и хранит
 * черновики; скин рисует. Чат внутри песочницы рисует обычный `ChatSkin` (версия 15: правка ответа и отметки
 * «изменено»), список чатов — `ChatListSkin`. Надписи компоненты берут из `useSandboxLabels()`.
 */
export interface SandboxSkin {
  /**
   * Каркас «чат | журнал». На широком экране журнал рядом с чатом; на узком — выдвижная панель (открыта при
   * `journalOpen`). У панелей `aria-label` из `labels.chatPanel` и `labels.journalPanel`.
   */
  SandboxLayout: ComponentType<{
    /** Над чатом: редактор инструкции и прочее управление чатом. */
    header: ReactNode;
    /** `ChatWorkspace` со списком песочных чатов. */
    chat: ReactNode;
    journal: ReactNode;
    journalOpen: boolean;
    onJournalOpenChange: (open: boolean) => void;
  }>;
  /** Список обращений и вызовов хода или всего чата. */
  JournalList: ComponentType<{
    /** `empty` — записей нет (`labels.journalEmpty`). */
    state: SandboxLoadState | "empty";
    rows: JournalRowView[];
    onRetry?: () => void;
    turns: JournalTurnView[];
    currentTurnId: string | null;
    onTurnChange: (turnId: string | null) => void;
  }>;
  ModelCallDetails: ComponentType<ModelCallDetailsView>;
  ToolCallDetails: ComponentType<ToolCallDetailsView>;
  /** Правка инструкции песочного чата; боевая рядом для сравнения. */
  InstructionEditor: ComponentType<{
    value: string;
    onValueChange: (value: string) => void;
    /** Боевая инструкция приложения. */
    appInstructions: string;
    /** Чат идёт с правленой инструкцией: показать отметку `labels.instructionsEdited`. */
    edited: boolean;
    /** В поле есть несохранённые изменения. */
    dirty: boolean;
    onSave: () => void;
    canSave: boolean;
    saving: boolean;
    /** «Вернуть боевую»; нет — чат и так с боевой. */
    onReset?: () => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Почему не сохранилось, готовой надписью: показать как `role="alert"`. */
    error?: string;
    maxLength: number;
  }>;
  /**
   * Правка ответа агента: текст целиком и JSON результата у каждого обычного вызова (у картинок, видео и виджетов
   * редактора нет). Показывается вместо ответа; после сохранения появляется новая ветка.
   */
  AnswerEditor: ComponentType<{
    text: string;
    onTextChange: (text: string) => void;
    /** Пустой текст — готовой надписью. */
    textError?: string;
    toolOutputs: AnswerEditorToolOutputView[];
    onSave: () => void;
    onCancel: () => void;
    canSave: boolean;
    saving: boolean;
    /** Почему не сохранилось, готовой надписью: показать как `role="alert"`; черновик остаётся. */
    error?: string;
  }>;
  /**
   * Переключатель разделов «Песочница | Чаты людей» вокруг активного раздела (подпись `labels.peopleChats.sections`).
   * Необязательный: нет — простые кнопки над разделом.
   */
  SandboxSections?: ComponentType<{ section: SandboxSection; onSectionChange: (section: SandboxSection) => void; children: ReactNode }>;
  /** Раздел «Чаты людей». Необязательный: нет — простой вид слоя поведения. */
  PeopleChats?: ComponentType<PeopleChatsView>;
  /**
   * Кнопка «Открыть чат снова» (`labels.chatReopen.reopen`) над чатом, пока открытый песочный чат закрыт инструментом.
   * `pending` — запрос идёт (`labels.chatReopen.reopening`, кнопку не нажимать повторно); `error` — почему не вышло,
   * готовой надписью: показать как `role="alert"`. Необязательный: нет — простая кнопка слоя поведения.
   */
  ChatReopen?: ComponentType<{ onReopen: () => void; pending: boolean; error?: string }>;
}
