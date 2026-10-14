import type { ModelChoice } from "../models/model-choice";
import type { MemoryNote, MemoryNoteInput } from "../memory/long-term-memory";
import { isOptimizationBlocked, revertRefusal } from "../memory/memory-optimization";
import type { MemoryMergeGroup, MemoryOptimizationRun, MergedMemoryNote } from "../memory/memory-optimization";
import type { Chat, StoredBranchSelection, StoredCompaction, StoredMessage, UsageRecord, UsageSum } from "../conversation/types";
import {
  aliveAtByLocalClock,
  assertKnownFormatVersion,
  ChatAlreadyExistsError,
  DuplicateChatSubjectError,
  DuplicateMessageError,
  MessageAlreadyFinishedError,
  MessageNotAwaitingError,
  sameMessageParts,
  silenceBoundaryByLocalClock,
} from "./chat-storage";
import { assertChatDataFilter, chatDataFields, chatDataMatches, chatDataOfInput, mergeChatData } from "./chat-data";
import type { ChatListOptions, ChatStorage, ChatSubjectFilter, SpendingLimitStateRecord } from "./chat-storage";

/** Хранилище в памяти процесса — для тестов. Копирует данные на входе и выходе, как база. */
type StoredNote = MemoryNote & { mergedInto?: string };

/** Сумма записей расхода по ключу (`group` — поля ключа: пара «модель × провайдер», у суммы по чатам — ещё чат). */
function sumRecords<K extends Pick<UsageSum, "modelId" | "providerId">>(records: readonly UsageRecord[], group: (record: UsageRecord) => K): Array<K & UsageSum> {
  const sums = new Map<string, K & UsageSum>();
  for (const record of records) {
    const fields = group(record);
    const key = Object.values(fields).join("\u0000");
    const sum = sums.get(key) ?? { ...fields, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
    sum.inputTokens += record.inputTokens;
    sum.cachedInputTokens += record.cachedInputTokens;
    sum.cacheWriteTokens += record.cacheWriteTokens;
    sum.outputTokens += record.outputTokens;
    sum.reasoningTokens += record.reasoningTokens;
    sum.costUsd += record.costUsd;
    sums.set(key, sum);
  }
  return [...sums.values()];
}

export function createInMemoryChatStorage(): ChatStorage {
  const chats = new Map<string, Chat>();
  const messages = new Map<string, StoredMessage>();
  /** Время последнего знака жизни идущих ответов по id: при чтении не отдаётся. */
  const aliveAt = new Map<string, string>();
  /** Аренды хода по чатам: кто держит и до какого времени (мс по часам этой машины). */
  const turnLeases = new Map<string, { holder: string; until: number }>();
  const compactions: StoredCompaction[] = [];
  const branchSelections: StoredBranchSelection[] = [];
  const usageRecords: UsageRecord[] = [];
  const userModelChoices = new Map<string, ModelChoice>();
  const voiceChoices = new Map<string, string>();
  const spendingLimitStates = new Map<string, SpendingLimitStateRecord>();
  /** Долгая память: у каждого человека свои записи; у скрытых оригиналов слияния есть `mergedInto`. */
  const memoryNotes = new Map<string, Map<string, StoredNote>>();
  const optimizationRuns = new Map<string, MemoryOptimizationRun[]>();

  function streamingMessage(messageId: string): StoredMessage {
    const message = messages.get(messageId);
    if (!message) throw new Error(`Сообщения ${messageId} нет`);
    if (message.status !== "streaming") throw new MessageAlreadyFinishedError(messageId);
    return message;
  }

  /** Сообщение для чтения: копия, `voiceCut` — `null`, если не задан. */
  function readable(message: StoredMessage): StoredMessage {
    const copy = structuredClone(message);
    return { ...copy, voiceCut: copy.voiceCut ?? null };
  }

  function ownerNotes(ownerId: string): Map<string, StoredNote> {
    let notes = memoryNotes.get(ownerId);
    if (!notes) {
      notes = new Map();
      memoryNotes.set(ownerId, notes);
    }
    return notes;
  }

  function ownerRuns(ownerId: string): MemoryOptimizationRun[] {
    let runs = optimizationRuns.get(ownerId);
    if (!runs) {
      runs = [];
      optimizationRuns.set(ownerId, runs);
    }
    return runs;
  }

  /** Порядок списка по договору: `updatedAt`, затем `createdAt`, затем `id` — новее и больше первыми. */
  function newestFirst<T extends MemoryNote>(notes: T[]): T[] {
    return notes.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        (right.id > left.id ? 1 : right.id < left.id ? -1 : 0),
    );
  }

  /** Обычная запись без служебного признака скрытия. */
  function publicNote({ mergedInto: _hidden, ...note }: StoredNote): MemoryNote {
    return note;
  }

  /** Как база с NOT NULL: разделы — список строк, текст — строка. */
  function assertWellFormedNote(note: MemoryNoteInput): void {
    if (!Array.isArray(note?.categories) || !note.categories.every((category) => typeof category === "string")) {
      throw new TypeError("Разделы записи памяти — список строк");
    }
    if (typeof note.content !== "string") throw new TypeError("Текст записи памяти — строка");
  }

  /** Записи, которые видит человек: без скрытых оригиналов, копиями. */
  function visibleNotes(ownerId: string): MemoryNote[] {
    const visible = [...ownerNotes(ownerId).values()].filter((note) => !note.mergedInto);
    return structuredClone(newestFirst(visible).map(publicNote));
  }

  function insertNotes(ownerId: string, inputs: MemoryNoteInput[]): MemoryNote[] {
    // Сначала проверяем весь пакет: негодная запись не оставляет в памяти и остальных.
    inputs.forEach(assertWellFormedNote);
    const now = new Date().toISOString();
    const created = inputs.map(
      ({ categories, content }): MemoryNote => ({
        id: crypto.randomUUID(),
        categories: [...categories],
        content,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const notes = ownerNotes(ownerId);
    for (const note of created) notes.set(note.id, note);
    return structuredClone(created);
  }

  function updateNote(ownerId: string, id: string, expectedVersion: number, input: MemoryNoteInput): MemoryNote | "not_found" | "stale_version" {
    assertWellFormedNote(input);
    const notes = ownerNotes(ownerId);
    const note = notes.get(id);
    if (!note || note.mergedInto) return "not_found";
    if (note.version !== expectedVersion) return "stale_version";
    const updated: MemoryNote = {
      ...note,
      categories: [...input.categories],
      content: input.content,
      version: note.version + 1,
      updatedAt: new Date().toISOString(),
    };
    notes.set(id, updated);
    return structuredClone(updated);
  }

  /** Как уникальный индекс (владелец, ключ): чат без ключа не мешает никому. */
  function assertSubjectFree(chat: Pick<Chat, "ownerId" | "subjectKey">): void {
    if (chat.subjectKey === undefined) return;
    for (const existing of chats.values()) {
      if (existing.ownerId === chat.ownerId && existing.subjectKey === chat.subjectKey) {
        throw new DuplicateChatSubjectError(chat.ownerId, chat.subjectKey);
      }
    }
  }

  function sortedMessages(chatId: string): StoredMessage[] {
    return [...messages.values()]
      .filter((message) => message.chatId === chatId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  return {
    async createChat({ createdAt, ...input }) {
      const at = createdAt ?? new Date().toISOString();
      const chat: Chat = withChatData(withoutUndefined({ ...structuredClone(input), createdAt: at, updatedAt: at }));
      assertSubjectFree(chat);
      chats.set(chat.id, chat);
      return structuredClone(chat);
    },

    async findChatBySubject(ownerId, subjectKey) {
      const chat = [...chats.values()].find((existing) => existing.ownerId === ownerId && existing.subjectKey === subjectKey);
      return chat ? structuredClone(chat) : null;
    },

    async importChat(input, imported) {
      // Сначала все проверки: при ошибке ничего не записано.
      if (chats.has(input.id)) throw new ChatAlreadyExistsError(input.id);
      const chat: Chat = withChatData(withoutUndefined(structuredClone(input)));
      assertSubjectFree(chat);
      const ids = new Set<string>();
      for (const message of imported) {
        if (messages.has(message.id) || ids.has(message.id)) throw new DuplicateMessageError(message.id);
        ids.add(message.id);
      }
      chats.set(chat.id, chat);
      for (const message of imported) {
        const { alive: _alive, ...stored } = message;
        messages.set(message.id, structuredClone(stored));
      }
    },

    async setAfterTurnState(messageId, state, options) {
      const message = messages.get(messageId);
      if (!message || (state !== "pending" && message.afterTurn !== "pending")) return false;
      const parts = options?.appendParts ? [...message.parts, ...structuredClone(options.appendParts)] : message.parts;
      messages.set(messageId, { ...message, parts, afterTurn: state });
      // Отметка ожидания хука — в той же колонке, что знак жизни: у законченного ответа она больше ни для чего.
      if (state === "pending") aliveAt.set(messageId, aliveAtByLocalClock("now"));
      return true;
    },

    async listPendingAfterTurn(filter) {
      const boundary = filter?.pendingForMs === undefined ? null : silenceBoundaryByLocalClock(filter.pendingForMs);
      return [...messages.values()]
        .filter((message) => message.afterTurn === "pending")
        .filter((message) => boundary === null || (aliveAt.get(message.id) ?? message.createdAt) < boundary)
        .map((message) => message.id);
    },

    async getChat(chatId) {
      const chat = chats.get(chatId);
      return chat ? structuredClone(chat) : null;
    },

    async updateChatModel(chatId, model) {
      const chat = chats.get(chatId);
      if (!chat) return;
      const { reasoning: _dropped, ...rest } = chat;
      chats.set(chatId, { ...rest, ...model });
    },

    async listChats(ownerId, options?: ChatListOptions) {
      if (options?.data) assertChatDataFilter(options.data);
      const owned = [...chats.values()].filter(
        (chat) => chat.ownerId === ownerId && matchesSubjects(chat, options?.subjects) && (!options?.data || chatDataMatches(chat.data, options.data)),
      );
      owned.sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.createdAt.localeCompare(left.createdAt) ||
          (right.id > left.id ? 1 : right.id < left.id ? -1 : 0),
      );
      return structuredClone(owned);
    },

    async updateChatData(chatId, patch, { maxBytes }) {
      const chat = chats.get(chatId);
      if (!chat) return null;
      // Слияние и проверка размера до записи: при ошибке данные прежние.
      const merged = mergeChatData(chat.data, patch, maxBytes);
      const { data: _data, subjectData: _subjectData, ...rest } = chat;
      const updated: Chat = { ...rest, ...chatDataFields(merged) };
      chats.set(chatId, updated);
      return structuredClone(updated);
    },

    async renameChat(chatId, title) {
      const chat = chats.get(chatId);
      if (!chat) return;
      const { title: _dropped, ...rest } = chat;
      chats.set(chatId, title === null ? rest : { ...rest, title });
    },

    async setChatClosed(chatId, closed) {
      const chat = chats.get(chatId);
      if (!chat) return;
      const { closed: _dropped, ...rest } = chat;
      chats.set(chatId, closed === null ? rest : { ...rest, closed: { code: closed.code, message: closed.message } });
    },

    async deleteChat(chatId) {
      if (!chats.delete(chatId)) return;
      turnLeases.delete(chatId);
      for (const message of [...messages.values()]) {
        if (message.chatId !== chatId) continue;
        messages.delete(message.id);
        aliveAt.delete(message.id);
      }
      // Записи сжатия — на месте, с обратным ходом, чтобы индексы не сдвигались.
      for (let index = compactions.length - 1; index >= 0; index -= 1) {
        if (compactions[index]!.chatId === chatId) compactions.splice(index, 1);
      }
      for (let index = branchSelections.length - 1; index >= 0; index -= 1) {
        if (branchSelections[index]!.chatId === chatId) branchSelections.splice(index, 1);
      }
    },

    async getMessage(messageId) {
      const message = messages.get(messageId);
      if (!message) return null;
      assertKnownFormatVersion(message);
      return readable(message);
    },

    async listMessages(chatId) {
      const found = sortedMessages(chatId);
      found.forEach(assertKnownFormatVersion);
      return found.map(readable);
    },

    async listMessageLinks(chatId) {
      return sortedMessages(chatId).map(({ id, parentId, createdAt }) => ({ id, parentId, createdAt }));
    },

    async listMessagePartsOfTypes(chatId, types) {
      return sortedMessages(chatId).map(({ id, parentId, createdAt, parts }) => ({
        id,
        parentId,
        createdAt,
        parts: structuredClone(parts.filter((part) => types.includes(part.type))),
      }));
    },

    async insertMessage(message) {
      if (messages.has(message.id)) throw new DuplicateMessageError(message.id);
      // Как внешний ключ в базе: сообщение без чата не пишется.
      const chat = chats.get(message.chatId);
      if (!chat) throw new Error(`Чата ${message.chatId} нет`);
      const { alive, ...stored } = message;
      messages.set(message.id, structuredClone(stored));
      if (alive) aliveAt.set(message.id, aliveAtByLocalClock(alive));
      chats.set(chat.id, { ...chat, updatedAt: message.createdAt });
    },

    async updateStreamingMessage(messageId, patch) {
      const message = streamingMessage(messageId);
      const { alive, ...rest } = structuredClone(patch);
      messages.set(messageId, { ...message, ...rest });
      if (alive) aliveAt.set(messageId, aliveAtByLocalClock(alive));
    },

    async markAnswerAlive(messageId) {
      streamingMessage(messageId);
      aliveAt.set(messageId, aliveAtByLocalClock("now"));
    },

    async finishMessage(messageId, final) {
      const message = streamingMessage(messageId);
      messages.set(messageId, { ...message, ...structuredClone(final) });
      if (final.afterTurn === "pending") aliveAt.set(messageId, aliveAtByLocalClock("now"));
    },

    async updateAwaitingMessage(messageId, patch) {
      const message = messages.get(messageId);
      if (!message) throw new Error(`Сообщения ${messageId} нет`);
      if (message.status !== "awaiting_approval") throw new MessageNotAwaitingError(messageId);
      if (patch.expectedParts && !sameMessageParts(message.parts, patch.expectedParts)) throw new MessageNotAwaitingError(messageId);
      messages.set(messageId, {
        ...message,
        parts: structuredClone(patch.parts),
        ...(patch.status && { status: patch.status }),
      });
      if (patch.alive) aliveAt.set(messageId, aliveAtByLocalClock(patch.alive));
    },

    async listStreamingMessageIds() {
      return [...messages.values()].filter((message) => message.status === "streaming").map((message) => message.id);
    },

    async listSilentAnswerIds({ silentForMs, chatId }) {
      const boundary = silenceBoundaryByLocalClock(silentForMs);
      return [...messages.values()]
        .filter((message) => message.status === "streaming" && (chatId === undefined || message.chatId === chatId))
        .filter((message) => (aliveAt.get(message.id) ?? message.createdAt) < boundary)
        .map((message) => message.id);
    },

    async claimChatTurn(chatId, holder, leaseMs) {
      const now = Date.now();
      const lease = turnLeases.get(chatId);
      if (lease && lease.holder !== holder && lease.until > now) return false;
      turnLeases.set(chatId, { holder, until: now + leaseMs });
      return true;
    },

    async releaseChatTurn(chatId, holder) {
      if (turnLeases.get(chatId)?.holder === holder) turnLeases.delete(chatId);
    },

    async clearChatTurnLeases() {
      turnLeases.clear();
    },

    async insertCompaction(record) {
      if (compactions.some((existing) => existing.id === record.id)) throw new Error(`Запись сжатия ${record.id} уже есть`);
      compactions.push(structuredClone(record));
    },

    async listCompactions(chatId) {
      return structuredClone(compactions.filter((record) => record.chatId === chatId));
    },

    async insertBranchSelection(record) {
      if (branchSelections.some((existing) => existing.id === record.id)) throw new Error(`Выбор ветки ${record.id} уже есть`);
      branchSelections.push(structuredClone(record));
    },

    async listBranchSelections(chatId) {
      return structuredClone(branchSelections.filter((record) => record.chatId === chatId));
    },

    async insertUsageRecord(record) {
      if (usageRecords.some((existing) => existing.id === record.id)) throw new Error(`Запись расхода ${record.id} уже есть`);
      usageRecords.push(structuredClone(record));
    },

    async hasUsageRecord(id) {
      return usageRecords.some((record) => record.id === id);
    },

    async sumUsage({ ownerId, chatId, messageId, source, since }) {
      return sumRecords(
        usageRecords.filter(
          (record) =>
            (ownerId === undefined || record.ownerId === ownerId) &&
            (chatId === undefined || record.chatId === chatId) &&
            (messageId === undefined || record.messageId === messageId) &&
            (source === undefined || record.source === source) &&
            (since === undefined || record.createdAt >= since),
        ),
        (record) => ({ modelId: record.modelId, providerId: record.providerId }),
      );
    },

    async sumUsageByChat({ chatIds, ownerId, source, since }) {
      const wanted = new Set(chatIds);
      return sumRecords(
        usageRecords.filter(
          (record) =>
            wanted.has(record.chatId) &&
            (ownerId === undefined || record.ownerId === ownerId) &&
            (source === undefined || record.source === source) &&
            (since === undefined || record.createdAt >= since),
        ),
        (record) => ({ chatId: record.chatId, modelId: record.modelId, providerId: record.providerId }),
      );
    },

    async setVoiceCut({ ownerId, chatId, messageId, voiceCut }) {
      const message = messages.get(messageId);
      if (!message || message.chatId !== chatId || chats.get(chatId)?.ownerId !== ownerId) return;
      messages.set(messageId, { ...message, voiceCut: structuredClone(voiceCut) });
    },

    async getSpendingLimitState(key) {
      const record = spendingLimitStates.get(key);
      return record ? { ...record } : null;
    },

    async saveSpendingLimitState(key, value, expectedVersion) {
      const current = spendingLimitStates.get(key);
      if ((current?.version ?? null) !== expectedVersion) return false;
      spendingLimitStates.set(key, { value, version: (current?.version ?? 0) + 1 });
      return true;
    },

    async deleteSpendingLimitStates(keys) {
      for (const key of keys) spendingLimitStates.delete(key);
    },

    async getVoiceChoice(ownerId) {
      return voiceChoices.get(ownerId) ?? null;
    },

    async setVoiceChoice(ownerId, voiceId) {
      voiceChoices.set(ownerId, voiceId);
    },

    async getUserModelChoice(ownerId) {
      const choice = userModelChoices.get(ownerId);
      return choice ? structuredClone(choice) : null;
    },

    async saveUserModelChoice(ownerId, choice) {
      userModelChoices.set(ownerId, structuredClone(choice));
    },

    async listMemoryNotes(ownerId) {
      return visibleNotes(ownerId);
    },

    async insertMemoryNotes(ownerId, inputs) {
      return insertNotes(ownerId, inputs);
    },

    // Всё выполняется без ожидания, поэтому между проверкой и вставкой никто не успеет вклиниться.
    async insertMemoryNotesChecked(ownerId, inputs, guard) {
      const error = guard(visibleNotes(ownerId));
      return error ?? insertNotes(ownerId, inputs);
    },

    async updateMemoryNote(ownerId, id, expectedVersion, input) {
      return updateNote(ownerId, id, expectedVersion, input);
    },

    async updateMemoryNoteChecked(ownerId, id, expectedVersion, input, guard) {
      return guard(visibleNotes(ownerId)) ?? updateNote(ownerId, id, expectedVersion, input);
    },

    async deleteMemoryNote(ownerId, id, expectedVersion) {
      const notes = ownerNotes(ownerId);
      const note = notes.get(id);
      if (!note || note.mergedInto) return "not_found";
      if (note.version !== expectedVersion) return "stale_version";
      notes.delete(id);
      for (const [hiddenId, hidden] of notes) if (hidden.mergedInto === id) notes.delete(hiddenId);
      return "ok";
    },

    async clearMemoryNotes(ownerId) {
      const count = [...ownerNotes(ownerId).values()].filter((note) => !note.mergedInto).length;
      memoryNotes.delete(ownerId);
      optimizationRuns.delete(ownerId);
      return count;
    },

    async claimMemoryOptimizationRun(ownerId, rules, now) {
      const runs = ownerRuns(ownerId);
      const nowMs = Date.parse(now);
      for (const run of runs) {
        const leaseEnd = Date.parse(run.startedAt) + rules.leaseMs;
        if (run.status === "running" && nowMs >= leaseEnd) Object.assign(run, { status: "failed", error: "lease_expired", finishedAt: new Date(leaseEnd).toISOString() });
      }
      const blocked = isOptimizationBlocked(
        runs.map((run) => ({ status: run.status, startedAtMs: Date.parse(run.startedAt), endedAtMs: run.finishedAt ? Date.parse(run.finishedAt) : null })),
        rules,
        nowMs,
      );
      if (blocked) return null;
      const run: MemoryOptimizationRun = { id: crypto.randomUUID(), startedAt: now, finishedAt: null, status: "running", groups: [], error: null, usageRecordId: null };
      runs.push(run);
      return structuredClone(run);
    },

    async finishMemoryOptimizationRun(ownerId, runId, outcome) {
      const run = ownerRuns(ownerId).find((candidate) => candidate.id === runId);
      if (run?.status !== "running") return "not_found";
      Object.assign(run, { status: outcome.status, finishedAt: outcome.finishedAt, error: outcome.error ?? null, usageRecordId: outcome.usageRecordId ?? null });
      return "ok";
    },

    async applyMemoryMerge(ownerId, merge) {
      const { merges } = merge;
      if (merges.length === 0) throw new TypeError("Слияние без склеек");
      const seen = new Set<string>();
      for (const { result, originals } of merges) {
        assertWellFormedNote(result);
        if (originals.length === 0) throw new TypeError("Склейка без оригиналов");
        for (const { id } of originals) {
          if (seen.has(id)) throw new TypeError(`Запись ${id} названа в двух склейках`);
          seen.add(id);
        }
      }
      const run = ownerRuns(ownerId).find((candidate) => candidate.id === merge.runId);
      if (run?.status !== "running") return "run_not_active";
      const notes = ownerNotes(ownerId);
      for (const { originals } of merges) {
        for (const { id, version } of originals) {
          const original = notes.get(id);
          if (!original || original.mergedInto || original.version !== version) return "stale_version";
        }
      }
      const now = new Date().toISOString();
      const groups: MemoryMergeGroup[] = merges.map(({ result, originals }) => {
        const created: StoredNote = { id: crypto.randomUUID(), categories: [...result.categories], content: result.content, version: 1, createdAt: now, updatedAt: now };
        notes.set(created.id, created);
        for (const { id } of originals) notes.get(id)!.mergedInto = created.id;
        return { resultId: created.id, originalIds: originals.map(({ id }) => id), resultVersion: 1 };
      });
      Object.assign(run, { status: "applied", finishedAt: merge.finishedAt, groups, usageRecordId: merge.usageRecordId ?? null });
      return structuredClone(run);
    },

    async revertMemoryMerge(ownerId, runId, guard) {
      const run = ownerRuns(ownerId).find((candidate) => candidate.id === runId);
      if (run?.status !== "applied") return "not_found";
      const notes = ownerNotes(ownerId);
      const intact = run.groups.every(
        ({ resultId, originalIds, resultVersion }) =>
          notes.get(resultId)?.version === resultVersion && !notes.get(resultId)?.mergedInto && originalIds.every((id) => notes.get(id)?.mergedInto === resultId),
      );
      if (!intact) return "conflict";
      if (guard) {
        const resultIds = new Set(run.groups.map(({ resultId }) => resultId));
        const restoredIds = new Set(run.groups.flatMap(({ originalIds }) => originalIds));
        const inPlay = [...notes.values()];
        const remaining = newestFirst(inPlay.filter((note) => !note.mergedInto && !resultIds.has(note.id))).map(publicNote);
        const restored = newestFirst(inPlay.filter((note) => restoredIds.has(note.id))).map(publicNote);
        const error = guard(structuredClone(remaining), structuredClone(restored));
        if (error) return revertRefusal(error);
      }
      for (const { resultId, originalIds } of run.groups) {
        notes.delete(resultId);
        for (const id of originalIds) delete notes.get(id)!.mergedInto;
      }
      run.status = "reverted";
      return "ok";
    },

    async listMemoryOptimizationRuns(ownerId, filter) {
      const runs = ownerRuns(ownerId)
        .map((run, index) => ({ run, index }))
        .filter(({ run }) => !filter?.status || filter.status.includes(run.status))
        .sort((left, right) => right.run.startedAt.localeCompare(left.run.startedAt) || right.index - left.index)
        .map(({ run }) => run);
      return structuredClone(filter?.limit === undefined ? runs : runs.slice(0, filter.limit));
    },

    async listMergedMemoryNotes(ownerId) {
      const hidden = [...ownerNotes(ownerId).values()].filter((note): note is StoredNote & { mergedInto: string } => Boolean(note.mergedInto));
      return structuredClone(newestFirst(hidden) as MergedMemoryNote[]);
    },
  };
}

/** Подходит ли чат под фильтр `listChats` по ключу объекта. */
function matchesSubjects(chat: Chat, subjects: ChatSubjectFilter = "exclude"): boolean {
  if (subjects === "include") return true;
  return subjects === "only" ? chat.subjectKey !== undefined : chat.subjectKey === undefined;
}

/** `data` и `subjectData` — один объект; данных нет — полей нет. */
function withChatData<T extends Pick<Chat, "data" | "subjectData">>(chat: T): T {
  const { data: _data, subjectData: _subjectData, ...rest } = chat;
  return { ...rest, ...chatDataFields(chatDataOfInput(chat)) } as T;
}

/** Как база: поле без значения не хранится. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
