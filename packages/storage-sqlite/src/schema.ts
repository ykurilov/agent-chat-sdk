import type {
  AnswerStatus,
  ChatClosure,
  ChatErrorKind,
  MemoryMergeGroup,
  MemoryOptimizationStatus,
  StoredMessage,
  TokenUsage,
  TurnRequestContext,
  UsageSource,
  VoiceCut,
} from "@ykurilov/agent-chat-core";
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id").notNull(),
    reasoning: text("reasoning"),
    /** Название для списка чатов; пусто — чат без названия. */
    title: text("title"),
    /** Мессенджер, из которого создан чат; пусто — чат создан в вебе. */
    origin: text("origin", { enum: ["telegram", "vk", "max"] }),
    /** Ключ объекта приложения; пусто — обычный чат. У владельца ключ не повторяется. */
    subjectKey: text("subject_key"),
    /** Данные объекта (JSON-объект); пусто — данных нет. */
    subjectData: text("subject_data", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Закрытие чата (JSON `{ code, message }`); пусто — чат открыт. */
    closed: text("closed", { mode: "json" }).$type<ChatClosure>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("chats_owner_updated_idx").on(table.ownerId, table.updatedAt),
    uniqueIndex("chats_owner_subject_idx").on(table.ownerId, table.subjectKey),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: text("parts", { mode: "json" }).$type<StoredMessage["parts"]>().notNull(),
    formatVersion: integer("format_version").notNull(),
    status: text("status").$type<AnswerStatus>().notNull(),
    modelId: text("model_id"),
    providerId: text("provider_id"),
    usage: text("usage", { mode: "json" }).$type<TokenUsage>(),
    reasoningDurationsMs: text("reasoning_durations_ms", { mode: "json" }).$type<Record<string, number>>().notNull(),
    error: text("error", { mode: "json" }).$type<{ kind: ChatErrorKind }>(),
    /** Отметка обрыва озвучки (голосовой режим); пусто — озвучку не обрывали. */
    voiceCut: text("voice_cut", { mode: "json" }).$type<VoiceCut>(),
    /** Состояние хука итога хода; пусто — хук не зовётся. */
    afterTurn: text("after_turn", { enum: ["pending", "done", "failed"] }),
    createdAt: text("created_at").notNull(),
    /** Последний знак жизни идущего ответа (ISO); пусто — время создания. Только для восстановления, при чтении не отдаётся. */
    aliveAt: text("alive_at"),
    /** Порядок записи: при равном `created_at` сообщения читаются по возрастанию `seq`. Задаётся при вставке. */
    seq: integer("seq").notNull().default(0),
  },
  (table) => [
    index("messages_chat_created_idx").on(table.chatId, table.createdAt, table.seq),
    uniqueIndex("messages_seq_idx").on(table.seq),
    index("messages_streaming_idx").on(table.status).where(sql`${table.status} = 'streaming'`),
    index("messages_after_turn_pending_idx").on(table.afterTurn).where(sql`${table.afterTurn} = 'pending'`),
  ],
);

/** Записи сжатия: только добавляются. Порядок добавления — `seq`. */
export const compactions = sqliteTable(
  "compactions",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    fromMessageId: text("from_message_id").notNull(),
    throughMessageId: text("through_message_id").notNull(),
    summary: text("summary").notNull(),
    summaryTokens: integer("summary_tokens").notNull(),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id").notNull(),
    usage: text("usage", { mode: "json" }).$type<TokenUsage>(),
    createdAt: text("created_at").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (table) => [
    index("compactions_chat_seq_idx").on(table.chatId, table.seq),
    uniqueIndex("compactions_seq_idx").on(table.seq),
  ],
);

/** Отметки выбора ветки: только добавляются. Порядок добавления — `seq`. */
export const branchSelections = sqliteTable(
  "branch_selections",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    selectedAt: text("selected_at").notNull(),
    seq: integer("seq").notNull().default(0),
  },
  (table) => [
    index("branch_selections_chat_seq_idx").on(table.chatId, table.seq),
    uniqueIndex("branch_selections_seq_idx").on(table.seq),
  ],
);

/**
 * Журнал расхода токенов: только добавляется и не связан с чатами внешним ключом, чтобы переживать их удаление.
 * Месячный расход человека от удаления переписки не убывает.
 */
export const usageRecords = sqliteTable(
  "usage_records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id"),
    source: text("source").$type<UsageSource>().notNull(),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    cachedInputTokens: integer("cached_input_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    reasoningTokens: integer("reasoning_tokens").notNull(),
    costUsd: real("cost_usd").notNull(),
    createdAt: text("created_at").notNull(),
    /** Числа «примерно»: прикинуты по длине текста, а не сообщены провайдером. */
    estimated: integer("estimated", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    index("usage_records_owner_created_idx").on(table.ownerId, table.createdAt),
    index("usage_records_chat_created_idx").on(table.chatId, table.createdAt),
  ],
);

/** Последний выбор модели человека для новых чатов: одна строка на человека; с чатами не связан. */
export const userModelChoices = sqliteTable("user_model_choices", {
  ownerId: text("owner_id").primaryKey(),
  modelId: text("model_id").notNull(),
  providerId: text("provider_id").notNull(),
  /** Пусто — у модели нет уровней рассуждений. */
  reasoning: text("reasoning"),
  updatedAt: text("updated_at").notNull(),
});

/** Выбранный человеком голос озвучки: одна строка на человека; с чатами и выбором модели не связан. */
export const voiceChoices = sqliteTable("voice_choices", {
  ownerId: text("owner_id").primaryKey(),
  voiceId: text("voice_id").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Состояние лимитов расходов по ключу: значение — строка (JSON решает ядро); `version` растёт на 1 при каждой записи и служит замком. */
export const spendingLimitStates = sqliteTable("spending_limit_states", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Аренда хода чата между копиями сервера: кто держит (`holder`) и до какого времени (`until`, мс по часам машины с базой).
 * Внешним ключом с чатом не связана: удаление чата снимает её само.
 */
export const chatTurnLeases = sqliteTable("chat_turn_leases", {
  chatId: text("chat_id").primaryKey(),
  holder: text("holder").notNull(),
  until: integer("until").notNull(),
});

/**
 * Ждущие пачки сообщений человека: одна запись на чат. Сроки — мс по часам службы; `page` — JSON страницы хода.
 * Внешним ключом с чатом не связана: удаление чата снимает её само.
 */
export const pendingBursts = sqliteTable("pending_bursts", {
  chatId: text("chat_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  messageId: text("message_id").notNull(),
  dueAt: integer("due_at").notNull(),
  holder: text("holder").notNull(),
  heldUntil: integer("held_until").notNull(),
  page: text("page", { mode: "json" }).$type<TurnRequestContext>(),
});

/**
 * Долгая память: записи человека. С чатами внешним ключом не связаны — удаление чата память не трогает.
 * Время в миллисекундах; `categories` — JSON-список из 1–3 разделов.
 */
export const memoryNotes = sqliteTable(
  "memory_notes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    categories: text("categories", { mode: "json" }).$type<string[]>().notNull(),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    /** Оптимизация дублей: id записи-результата у скрытого оригинала слияния; у обычных записей пусто. */
    mergedInto: text("merged_into"),
  },
  (table) => [
    index("memory_notes_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("memory_notes_merged_into_idx").on(table.mergedInto),
  ],
);

/**
 * Оптимизация дублей: запуски человека. Время в миллисекундах; `groups` — JSON-список склеек
 * (результат, оригиналы, версия результата на момент слияния). Запуск `running` у человека не больше одного.
 */
export const memoryOptimizationRuns = sqliteTable(
  "memory_optimization_runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    status: text("status").$type<MemoryOptimizationStatus>().notNull(),
    groups: text("groups", { mode: "json" }).$type<MemoryMergeGroup[]>().notNull().default(sql`'[]'`),
    error: text("error"),
    usageRecordId: text("usage_record_id"),
  },
  (table) => [
    index("memory_optimization_runs_owner_started_idx").on(table.ownerId, table.startedAt),
    uniqueIndex("memory_optimization_runs_one_running_idx").on(table.ownerId).where(sql`${table.status} = 'running'`),
  ],
);
