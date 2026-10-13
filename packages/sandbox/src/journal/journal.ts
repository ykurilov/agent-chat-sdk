import type { ModelCallEvent, ToolCallEvent } from "@ykurilov/agent-chat-core";
import type {
  AnswerEditRecord,
  JournalBlob,
  JournalCallDetails,
  JournalEntry,
  LogError,
  ModelCallRecord,
  ModelCallSummary,
  SandboxChatSettings,
  SandboxJournal,
  ToolCallRecord,
} from "../types";
import { createSecretHider } from "./hide-secrets";
import { splitModelCall, splitToolCall, unpackBlob } from "./journal-blobs";
import type { JournalStore, ModelCallRow, ToolCallRow } from "./journal-store";

export interface JournalOptions {
  /** Куда писать сбои журнала. По умолчанию `console.error`. */
  logError?: LogError;
  /** Окружение, из которого прячутся ключи и пароли (по именам KEY, TOKEN, SECRET, PASSWORD… и пароли в адресах). По умолчанию `process.env`. */
  env?: Record<string, string | undefined>;
  /** Ещё значения, которые не должны попасть в журнал. */
  secrets?: readonly string[];
  /** Сколько событий может ждать записи; больше — пропускаются. По умолчанию `QUEUE_LIMIT`. */
  queueLimit?: number;
}

/** Событий в очереди записи, после которых новые пропускаются: журнал не должен съесть память приложения. */
export const QUEUE_LIMIT = 1000;

/** Сколько удалённых чатов помнить, чтобы не писать для них события: id чата — UUID, повторов не бывает. */
const DELETED_CHATS_LIMIT = 10_000;

const MISSING_BLOB = "[кусок журнала удалён]";

/**
 * Журнал поверх простого хранилища. Запись идёт через очередь: `enqueue…` только ставит событие,
 * разбор и сохранение — в следующей задаче, по одному (записи и удаления не гоняются друг с другом).
 */
export function createSandboxJournal(store: JournalStore, options: JournalOptions = {}): SandboxJournal {
  const logError: LogError = options.logError ?? ((message) => console.error(message));
  const queueLimit = options.queueLimit ?? QUEUE_LIMIT;
  const hider = createSecretHider({ env: options.env, secrets: options.secrets });
  const pending = new Set<Promise<void>>();
  let waiting = 0;
  let turn: Promise<unknown> = Promise.resolve();
  let closed = false;
  // Чаты, удалённые через журнал: события хода, который ещё идёт, для них не пишутся (иначе остались бы сиротами).
  const deletedChats = new Set<string>();

  /** Одна операция над хранилищем за раз, в порядке постановки. */
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = turn.then(operation, operation);
    turn = result.catch(() => {});
    return result;
  }

  function enqueue(kind: string, save: () => Promise<void>): void {
    if (closed) return;
    if (waiting >= queueLimit) {
      logError(`журнал песочницы: очередь записи переполнена (${queueLimit}), ${kind} пропущено`);
      return;
    }
    waiting += 1;
    const task: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => serial(save))
      .catch((error: unknown) => logError(`журнал песочницы: не записано ${kind}: ${errorMessage(error)}`))
      .finally(() => {
        waiting -= 1;
        pending.delete(task);
      });
    pending.add(task);
  }

  async function flush(): Promise<void> {
    while (pending.size > 0) await Promise.all([...pending]);
  }

  async function entriesOf(chatId: string): Promise<{ models: ModelCallRow[]; tools: ToolCallRow[]; changed: Set<string> }> {
    const [models, tools] = await Promise.all([store.listModelCalls(chatId), store.listToolCalls(chatId)]);
    models.sort(byTime);
    tools.sort(byTime);
    return { models, tools, changed: changedInstructions(models) };
  }

  async function blobMap(hashes: string[]): Promise<Map<string, JournalBlob>> {
    const rows = await store.loadBlobs([...new Set(hashes)]);
    const blobs = await Promise.all(rows.map(unpackBlob));
    return new Map(blobs.map((blob) => [blob.hash, blob]));
  }

  return {
    addSecrets: (values) => hider.addSecrets(values),
    enqueueModelCall(event: ModelCallEvent) {
      if (deletedChats.has(event.chatId)) return;
      enqueue("обращение к модели", async () => {
        const { row, blobs } = await splitModelCall(event, hider.forSettings(event.request.settings));
        await store.saveModelCall(row, blobs);
      });
    },
    enqueueToolCall(event: ToolCallEvent) {
      if (deletedChats.has(event.chatId)) return;
      enqueue("вызов инструмента", async () => {
        const { row, blobs } = await splitToolCall(event, hider.forSettings(undefined));
        await store.saveToolCall(row, blobs);
      });
    },
    flush,
    async listForChat(chatId, listOptions) {
      await flush();
      const { models, tools, changed } = await entriesOf(chatId);
      const entries: JournalEntry[] = [
        ...models.map((row) => modelSummary(row, changed.has(row.id))),
        ...tools.map((row) => toolRecord(row, linkedModelCall(row, models))),
      ].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.kind === b.kind ? 0 : a.kind === "model" ? -1 : 1));
      const messageId = listOptions?.messageId;
      return messageId === undefined ? entries : entries.filter((entry) => entry.messageId === messageId);
    },
    async getCall(callId): Promise<JournalCallDetails | null> {
      await flush();
      const model = await store.findModelCall(callId);
      if (model) {
        const { changed } = await entriesOf(model.chatId);
        const blobs = await blobMap([model.instructionsHash, ...model.messageHashes, model.toolsHash, model.settingsHash, model.responseHash]);
        const blob = (hash: string): JournalBlob => blobs.get(hash) ?? { hash, content: MISSING_BLOB, bytes: 0, truncated: false };
        const call: ModelCallRecord = {
          ...modelSummary(model, changed.has(model.id)),
          instructionsHash: model.instructionsHash,
          messageHashes: model.messageHashes,
          toolsHash: model.toolsHash,
          settingsHash: model.settingsHash,
          responseHash: model.responseHash,
        };
        return {
          kind: "model",
          call,
          instructions: blob(model.instructionsHash),
          messages: model.messageHashes.map(blob),
          tools: blob(model.toolsHash),
          settings: blob(model.settingsHash),
          response: blob(model.responseHash),
        };
      }
      const tool = await store.findToolCall(callId);
      if (!tool) return null;
      const siblings = await store.listModelCalls(tool.chatId);
      const blobs = await blobMap(tool.outputHash ? [tool.inputHash, tool.outputHash] : [tool.inputHash]);
      const blob = (hash: string): JournalBlob => blobs.get(hash) ?? { hash, content: MISSING_BLOB, bytes: 0, truncated: false };
      return { kind: "tool", call: toolRecord(tool, linkedModelCall(tool, siblings)), input: blob(tool.inputHash), output: tool.outputHash ? blob(tool.outputHash) : null };
    },
    async getBlob(hash, ownerId) {
      await flush();
      const row = await store.loadBlobForOwner(hash, ownerId);
      return row ? unpackBlob(row) : null;
    },
    getSettings: (chatId) => store.getSettings(chatId),
    setSettings: (settings: SandboxChatSettings) => serial(() => store.setSettings(settings)),
    markAnswerEdited: (record: AnswerEditRecord) => serial(() => store.saveAnswerEdit(record)),
    listEditedAnswers: (chatId) => store.listAnswerEdits(chatId),
    async deleteChat(chatId) {
      if (deletedChats.size >= DELETED_CHATS_LIMIT) deletedChats.delete(deletedChats.values().next().value as string);
      deletedChats.add(chatId);
      await flush();
      await serial(() => store.deleteChat(chatId));
    },
    async deleteOlderThan(before) {
      await flush();
      return serial(() => store.deleteOlderThan(before));
    },
    async close() {
      if (closed) return;
      await flush();
      closed = true;
      await turn;
      await store.close();
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function byTime(a: { startedAt: Date; attempt?: number }, b: { startedAt: Date; attempt?: number }): number {
  return a.startedAt.getTime() - b.startedAt.getTime() || (a.attempt ?? 0) - (b.attempt ?? 0);
}

/** Обращения, чья инструкция отличается от инструкции предыдущего обращения того же назначения в чате. */
function changedInstructions(sortedModels: ModelCallRow[]): Set<string> {
  const lastByPurpose = new Map<string, string>();
  const changed = new Set<string>();
  for (const row of sortedModels) {
    const previous = lastByPurpose.get(row.purpose);
    if (previous !== undefined && previous !== row.instructionsHash) changed.add(row.id);
    lastByPurpose.set(row.purpose, row.instructionsHash);
  }
  return changed;
}

/** Обращение, которое попросило этот вызов: из того же чата, лучше всего из того же хода и начатое не позже вызова. */
function linkedModelCall(tool: ToolCallRow, models: ModelCallRow[]): string | null {
  const candidates = models.filter((model) => model.chatId === tool.chatId && model.toolCallIds.includes(tool.toolCallId));
  if (candidates.length === 0) return null;
  const sameTurn = candidates.filter((model) => model.messageId === tool.messageId);
  const pool = sameTurn.length > 0 ? sameTurn : candidates;
  const before = pool.filter((model) => model.startedAt.getTime() <= tool.startedAt.getTime()).sort(byTime);
  return (before.at(-1) ?? pool.sort(byTime)[0])?.id ?? null;
}

function modelSummary(row: ModelCallRow, instructionsChanged: boolean): ModelCallSummary {
  return {
    kind: "model",
    id: row.id,
    chatId: row.chatId,
    ownerId: row.ownerId,
    messageId: row.messageId,
    purpose: row.purpose,
    attempt: row.attempt,
    modelId: row.modelId,
    providerId: row.providerId,
    usage: row.usage,
    costUsd: row.costUsd,
    startedAt: row.startedAt,
    firstChunkMs: row.firstChunkMs,
    durationMs: row.durationMs,
    status: row.status,
    error: row.error,
    instructionsChanged,
  };
}

function toolRecord(row: ToolCallRow, modelCallId: string | null): ToolCallRecord {
  return {
    kind: "tool",
    id: row.id,
    chatId: row.chatId,
    ownerId: row.ownerId,
    messageId: row.messageId,
    modelCallId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    inputHash: row.inputHash,
    outputHash: row.outputHash,
    error: row.error,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
  };
}
