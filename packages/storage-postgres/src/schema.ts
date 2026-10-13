import type {
  AnswerStatus,
  ChatClosure,
  ChatErrorKind,
  MemoryMergeGroup,
  MemoryOptimizationStatus,
  StoredMessage,
  TokenUsage,
  UsageSource,
  VoiceCut,
} from "@ykurilov/agent-chat-core";
import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, integer, json, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Своя схема базы: у приложения могут быть свои `chats` и `messages`. */
export const agentChatSchema = pgSchema("agent_chat");

export const chats = agentChatSchema.table(
  "chats",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id").notNull(),
    /** Уровень рассуждений выбранной модели; пусто — у модели нет уровней. */
    reasoning: text("reasoning"),
    /** Название для списка чатов; пусто — чат без названия. */
    title: text("title"),
    /** Мессенджер, из которого создан чат; пусто — чат создан в вебе. */
    origin: text("origin", { enum: ["telegram", "vk", "max"] }),
    /** Ключ объекта приложения; пусто — обычный чат. У владельца ключ не повторяется. */
    subjectKey: text("subject_key"),
    /** Данные объекта (JSON-объект); пусто — данных нет. */
    subjectData: json("subject_data").$type<Record<string, unknown>>(),
    /** Закрытие чата (`{ code, message }`); пусто — чат открыт. */
    closed: json("closed").$type<ChatClosure>(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("chats_owner_updated_idx").on(table.ownerId, table.updatedAt),
    uniqueIndex("chats_owner_subject_idx").on(table.ownerId, table.subjectKey),
  ],
);

// Части, использование и ошибка — `json`, а не `jsonb`: текст хранится как записан (порядок ключей, `\u0000`).
export const messages = agentChatSchema.table(
  "messages",
  {
    /** Порядок записи: сообщения с одинаковым временем создания отдаются по нему. */
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    parts: json("parts").$type<StoredMessage["parts"]>().notNull(),
    formatVersion: integer("format_version").notNull(),
    status: text("status").$type<AnswerStatus>().notNull(),
    modelId: text("model_id"),
    providerId: text("provider_id"),
    usage: json("usage").$type<TokenUsage>(),
    reasoningDurationsMs: json("reasoning_durations_ms").$type<Record<string, number>>().notNull(),
    error: json("error").$type<{ kind: ChatErrorKind }>(),
    /** Отметка обрыва озвучки (голосовой режим); пусто — озвучку не обрывали. */
    voiceCut: json("voice_cut").$type<VoiceCut>(),
    /** Состояние хука итога хода; пусто — хук не зовётся. */
    afterTurn: text("after_turn", { enum: ["pending", "done", "failed"] }),
    createdAt: text("created_at").notNull(),
    /** Последний знак жизни идущего ответа (ISO); пусто — время создания. Только для восстановления, при чтении не отдаётся. */
    aliveAt: text("alive_at"),
  },
  (table) => [
    index("messages_chat_created_idx").on(table.chatId, table.createdAt, table.seq),
    index("messages_streaming_idx").on(table.status).where(sql`${table.status} = 'streaming'`),
    index("messages_after_turn_pending_idx").on(table.afterTurn).where(sql`${table.afterTurn} = 'pending'`),
  ],
);

/** Записи сжатия: только добавляются. Порядок добавления — `seq`. */
export const compactions = agentChatSchema.table(
  "compactions",
  {
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
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
    usage: json("usage").$type<TokenUsage>(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("compactions_chat_seq_idx").on(table.chatId, table.seq)],
);

/** Отметки выбора ветки: только добавляются. Порядок добавления — `seq`. */
export const branchSelections = agentChatSchema.table(
  "branch_selections",
  {
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    selectedAt: text("selected_at").notNull(),
  },
  (table) => [index("branch_selections_chat_seq_idx").on(table.chatId, table.seq)],
);

/**
 * Журнал расхода токенов: только добавляется и не связан с чатами внешним ключом, чтобы переживать их удаление.
 * Месячный расход человека от удаления переписки не убывает.
 */
export const usageRecords = agentChatSchema.table(
  "usage_records",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: text("message_id"),
    source: text("source").$type<UsageSource>().notNull(),
    modelId: text("model_id").notNull(),
    providerId: text("provider_id").notNull(),
    inputTokens: bigint("input_tokens", { mode: "number" }).notNull(),
    cachedInputTokens: bigint("cached_input_tokens", { mode: "number" }).notNull(),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }).notNull(),
    outputTokens: bigint("output_tokens", { mode: "number" }).notNull(),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }).notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    createdAt: text("created_at").notNull(),
    /** Числа «примерно»: прикинуты по длине текста, а не сообщены провайдером. */
    estimated: boolean("estimated").notNull().default(false),
  },
  (table) => [
    index("usage_records_owner_created_idx").on(table.ownerId, table.createdAt),
    index("usage_records_chat_created_idx").on(table.chatId, table.createdAt),
  ],
);

/** Последний выбор модели человека для новых чатов: одна строка на человека; с чатами не связан. */
export const userModelChoices = agentChatSchema.table("user_model_choices", {
  ownerId: text("owner_id").primaryKey(),
  modelId: text("model_id").notNull(),
  providerId: text("provider_id").notNull(),
  /** Пусто — у модели нет уровней рассуждений. */
  reasoning: text("reasoning"),
  updatedAt: text("updated_at").notNull(),
});

/** Выбранный человеком голос озвучки: одна строка на человека; с чатами и выбором модели не связан. */
export const voiceChoices = agentChatSchema.table("voice_choices", {
  ownerId: text("owner_id").primaryKey(),
  voiceId: text("voice_id").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** Состояние лимитов расходов по ключу: значение — строка (JSON решает ядро); `version` растёт на 1 при каждой записи и служит замком. */
export const spendingLimitStates = agentChatSchema.table("spending_limit_states", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  version: integer("version").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Долгая память: записи принадлежат человеку и с чатами не связаны внешним ключом, чтобы переживать их удаление.
 * `version` — замок правки и удаления: растёт на 1 при каждой правке.
 */
export const memoryNotes = agentChatSchema.table(
  "memory_notes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    categories: jsonb("categories").$type<string[]>().notNull(),
    content: text("content").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull(),
    /** Оптимизация дублей: id записи-результата у скрытого оригинала слияния; у обычных записей пусто. */
    mergedInto: text("merged_into"),
  },
  (table) => [
    index("memory_notes_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("memory_notes_merged_into_idx").on(table.mergedInto),
  ],
);

/**
 * Оптимизация дублей: запуски человека. `groups` — список склеек (результат, оригиналы, версия результата на
 * момент слияния). Запуск `running` у человека не больше одного: за этим следит частичный уникальный индекс.
 */
export const memoryOptimizationRuns = agentChatSchema.table(
  "memory_optimization_runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    status: text("status").$type<MemoryOptimizationStatus>().notNull(),
    groups: jsonb("groups").$type<MemoryMergeGroup[]>().notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    usageRecordId: text("usage_record_id"),
  },
  (table) => [
    index("memory_optimization_runs_owner_started_idx").on(table.ownerId, table.startedAt),
    uniqueIndex("memory_optimization_runs_one_running_idx").on(table.ownerId).where(sql`${table.status} = 'running'`),
  ],
);
