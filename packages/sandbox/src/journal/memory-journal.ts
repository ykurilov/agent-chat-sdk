import type { AnswerEditRecord, SandboxChatSettings, SandboxJournal } from "../types";
import { createSandboxJournal, type JournalOptions } from "./journal";
import type { BlobRow, JournalStore, ModelCallRow, ToolCallRow } from "./journal-store";

/** Хранилище журнала в памяти процесса: для тестов и приложений без базы. */
export function createMemoryJournalStore(): JournalStore & { blobCount(): number } {
  const modelCalls = new Map<string, ModelCallRow>();
  const toolCalls = new Map<string, ToolCallRow>();
  const blobs = new Map<string, BlobRow>();
  const settings = new Map<string, SandboxChatSettings>();
  const edits = new Map<string, AnswerEditRecord>();

  function addBlobs(rows: BlobRow[]): void {
    for (const row of rows) if (!blobs.has(row.hash)) blobs.set(row.hash, row);
  }

  function referencedHashes(): Set<string> {
    const hashes = new Set<string>();
    for (const row of modelCalls.values()) for (const hash of [row.instructionsHash, ...row.messageHashes, row.toolsHash, row.settingsHash, row.responseHash]) hashes.add(hash);
    for (const row of toolCalls.values()) {
      hashes.add(row.inputHash);
      if (row.outputHash) hashes.add(row.outputHash);
    }
    return hashes;
  }

  function dropUnreferencedBlobs(): void {
    const used = referencedHashes();
    for (const hash of blobs.keys()) if (!used.has(hash)) blobs.delete(hash);
  }

  return {
    blobCount: () => blobs.size,
    async saveModelCall(row, rowBlobs) {
      addBlobs(rowBlobs);
      if (!modelCalls.has(row.id)) modelCalls.set(row.id, row);
    },
    async saveToolCall(row, rowBlobs) {
      addBlobs(rowBlobs);
      if (!toolCalls.has(row.id)) toolCalls.set(row.id, row);
    },
    async listModelCalls(chatId) {
      return [...modelCalls.values()].filter((row) => row.chatId === chatId);
    },
    async listToolCalls(chatId) {
      return [...toolCalls.values()].filter((row) => row.chatId === chatId);
    },
    async findModelCall(id) {
      return modelCalls.get(id) ?? null;
    },
    async findToolCall(id) {
      return toolCalls.get(id) ?? null;
    },
    async loadBlobs(hashes) {
      return hashes.flatMap((hash) => blobs.get(hash) ?? []);
    },
    async loadBlobForOwner(hash, ownerId) {
      const blob = blobs.get(hash);
      if (!blob) return null;
      const owned = [...modelCalls.values()].some(
        (row) => row.ownerId === ownerId && (row.instructionsHash === hash || row.toolsHash === hash || row.settingsHash === hash || row.responseHash === hash || row.messageHashes.includes(hash)),
      ) || [...toolCalls.values()].some((row) => row.ownerId === ownerId && (row.inputHash === hash || row.outputHash === hash));
      return owned ? blob : null;
    },
    async getSettings(chatId) {
      return settings.get(chatId) ?? null;
    },
    async setSettings(value) {
      settings.set(value.chatId, value);
    },
    async saveAnswerEdit(record) {
      edits.set(record.messageId, record);
    },
    async listAnswerEdits(chatId) {
      return [...edits.values()].filter((record) => record.chatId === chatId).sort((a, b) => a.editedAt.getTime() - b.editedAt.getTime());
    },
    async deleteChat(chatId) {
      for (const [id, row] of modelCalls) if (row.chatId === chatId) modelCalls.delete(id);
      for (const [id, row] of toolCalls) if (row.chatId === chatId) toolCalls.delete(id);
      for (const [id, record] of edits) if (record.chatId === chatId) edits.delete(id);
      settings.delete(chatId);
      dropUnreferencedBlobs();
    },
    async deleteOlderThan(before) {
      let removed = 0;
      for (const [id, row] of modelCalls) if (row.startedAt < before) (modelCalls.delete(id), (removed += 1));
      for (const [id, row] of toolCalls) if (row.startedAt < before) (toolCalls.delete(id), (removed += 1));
      dropUnreferencedBlobs();
      return removed;
    },
    async close() {},
  };
}

export function createMemorySandboxJournal(options: JournalOptions = {}): SandboxJournal {
  return createSandboxJournal(createMemoryJournalStore(), options);
}
