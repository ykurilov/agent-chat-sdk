import type { ModelCallEvent } from "@ykurilov/agent-chat-core";
import type { AnswerEditRecord, SandboxChatSettings } from "../types";

/** Кусок журнала в виде, в каком его хранит база: сжатый JSON. */
export interface BlobRow {
  hash: string;
  /** gzip от JSON-текста куска. */
  data: Uint8Array;
  /** Размер JSON-текста до сжатия. */
  bytes: number;
  truncated: boolean;
}

/** Обращение к модели в виде строки базы. */
export interface ModelCallRow {
  id: string;
  chatId: string;
  ownerId: string;
  messageId: string | null;
  purpose: ModelCallEvent["purpose"];
  attempt: number;
  modelId: string;
  providerId: string;
  usage: ModelCallEvent["usage"];
  costUsd: number | null;
  startedAt: Date;
  firstChunkMs: number | null;
  durationMs: number;
  status: ModelCallEvent["status"];
  error: string | null;
  instructionsHash: string;
  messageHashes: string[];
  toolsHash: string;
  settingsHash: string;
  responseHash: string;
  /** `toolCallId` вызовов, о которых попросила модель: по ним вызов инструмента находит своё обращение. */
  toolCallIds: string[];
}

/** Вызов инструмента в виде строки базы. */
export interface ToolCallRow {
  id: string;
  chatId: string;
  ownerId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  inputHash: string;
  outputHash: string | null;
  error: string | null;
  startedAt: Date;
  durationMs: number;
}

/**
 * Простые операции над таблицами журнала: то, что у трёх хранилищ (память, SQLite, Postgres) разное.
 * Очередь, чистка секретов, куски и сборка записей — общие, в `createSandboxJournal`.
 * Записи и удаления зовутся строго по одной (общая очередь): удаление кусков без ссылок не гонится с записью.
 */
export interface JournalStore {
  /** Строка, ссылки на куски и сами куски — одной транзакцией; повторный `id` и `hash` не дублируются. */
  saveModelCall(row: ModelCallRow, blobs: BlobRow[]): Promise<void>;
  saveToolCall(row: ToolCallRow, blobs: BlobRow[]): Promise<void>;
  /** Все обращения чата; порядок любой. */
  listModelCalls(chatId: string): Promise<ModelCallRow[]>;
  listToolCalls(chatId: string): Promise<ToolCallRow[]>;
  findModelCall(id: string): Promise<ModelCallRow | null>;
  findToolCall(id: string): Promise<ToolCallRow | null>;
  loadBlobs(hashes: string[]): Promise<BlobRow[]>;
  /** Кусок, только если на него ссылается запись этого владельца. */
  loadBlobForOwner(hash: string, ownerId: string): Promise<BlobRow | null>;
  getSettings(chatId: string): Promise<SandboxChatSettings | null>;
  setSettings(settings: SandboxChatSettings): Promise<void>;
  saveAnswerEdit(record: AnswerEditRecord): Promise<void>;
  listAnswerEdits(chatId: string): Promise<AnswerEditRecord[]>;
  /** Записи, настройки, правки чата и куски, оставшиеся без ссылок. */
  deleteChat(chatId: string): Promise<void>;
  /** Записи, начатые раньше `before`, и куски без ссылок; число удалённых записей. */
  deleteOlderThan(before: Date): Promise<number>;
  close(): Promise<void>;
}
