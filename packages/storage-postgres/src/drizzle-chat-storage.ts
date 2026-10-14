import {
  assertChatDataFilter,
  assertKnownFormatVersion,
  ChatAlreadyExistsError,
  chatDataFields,
  chatDataOfInput,
  DuplicateChatSubjectError,
  DuplicateMessageError,
  isOptimizationBlocked,
  mergeChatData,
  MessageAlreadyFinishedError,
  MessageNotAwaitingError,
  RELEASED_ANSWER_ALIVE_AT,
  revertRefusal,
  sameMessageParts,
} from "@ykurilov/agent-chat-core";
import type {
  AnswerAliveMark,
  Chat,
  ChatDataFilter,
  ChatListOptions,
  ChatStorage,
  ChatSubjectFilter,
  MemoryMergeGroup,
  MemoryNote,
  MemoryNoteInput,
  MemoryOptimizationRun,
  MergedMemoryNote,
  StoredMessage,
} from "@ykurilov/agent-chat-core";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { branchSelections, chats, compactions, memoryNotes, memoryOptimizationRuns, messages, spendingLimitStates, usageRecords, userModelChoices, voiceChoices } from "./schema";

export const storageSchema = { chats, messages, compactions, branchSelections, usageRecords, userModelChoices, voiceChoices, spendingLimitStates, memoryNotes, memoryOptimizationRuns };

/** Слияние не сошлось со снимком: бросается внутри транзакции, чтобы откатить её, и не выходит наружу. */
class StaleMerge extends Error {}

/** Любая база Drizzle для PostgreSQL: `pg` в проде, pglite в тестах. Схема должна быть уже создана. */
export type ChatDatabase = PgDatabase<PgQueryResultHKT, typeof storageSchema>;

/** Время базы `moment` (timestamptz) строкой ISO в UTC, как `Date.toISOString()`: так оно сравнимо с `created_at`. */
function isoAtDatabase(moment: SQL): SQL<string> {
  return sql<string>`to_char((${moment}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/**
 * Знак жизни в колонку `alive_at`. «Сейчас» — по часам базы: копии сервера на разных машинах пишут и сравнивают знак
 * по одним часам, и расхождение часов машин не делает живой ответ брошенным.
 */
function aliveAtColumn(alive: AnswerAliveMark | undefined): { aliveAt?: SQL<string> | string } {
  if (!alive) return {};
  return { aliveAt: alive === "released" ? RELEASED_ANSWER_ALIVE_AT : isoAtDatabase(sql`now()`) };
}

/** Запросы хранилища; соединением и миграциями занимается вызывающий. */
export function createDrizzleChatStorage(db: ChatDatabase): ChatStorage {
  /** Пишет в идущий ответ; отличает «нет такого» от «уже в конечном состоянии». */
  async function updateStreaming(
    messageId: string,
    { alive, ...values }: Partial<typeof messages.$inferInsert> & { alive?: AnswerAliveMark },
  ): Promise<void> {
    const updated = await db
      .update(messages)
      .set({ ...values, ...aliveAtColumn(alive) })
      .where(and(eq(messages.id, messageId), eq(messages.status, "streaming")))
      .returning({ id: messages.id });
    if (updated.length > 0) return;
    const [existing] = await db.select({ id: messages.id }).from(messages).where(eq(messages.id, messageId));
    if (!existing) throw new Error(`Сообщения ${messageId} нет`);
    throw new MessageAlreadyFinishedError(messageId);
  }

  /** Запросы в транзакции или без неё: транзакция Drizzle умеет то же, что и база. */
  type Executor = ChatDatabase;

  /** Записи человека пишутся по одному: замок держится до конца транзакции. Без него две вставки видят одинаковый список и обе проходят проверку. */
  async function lockMemoryNotes(tx: Executor, ownerId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent_chat.memory_notes:${ownerId}`}, 0))`);
  }

  async function visibleNotes(exec: Executor, ownerId: string): Promise<MemoryNote[]> {
    const rows = await exec
      .select()
      .from(memoryNotes)
      .where(and(eq(memoryNotes.ownerId, ownerId), isNull(memoryNotes.mergedInto)))
      // Идентификаторы сравниваются по кодам знаков, как в договоре, а не по правилам языка базы.
      .orderBy(desc(memoryNotes.updatedAt), desc(memoryNotes.createdAt), sql`${memoryNotes.id} collate "C" desc`);
    return rows.map(toMemoryNote);
  }

  async function insertNotes(exec: Executor, ownerId: string, inputs: MemoryNoteInput[]): Promise<MemoryNote[]> {
    inputs.forEach(assertWellFormedNote);
    if (inputs.length === 0) return [];
    const now = new Date();
    // Одна вставка: пакет ложится целиком или не ложится вовсе.
    const rows = await exec
      .insert(memoryNotes)
      .values(
        inputs.map(({ categories, content }) => ({
          id: crypto.randomUUID(),
          ownerId,
          categories: [...categories],
          content,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })),
      )
      .returning();
    return rows.map(toMemoryNote);
  }

  async function updateNote(exec: Executor, ownerId: string, id: string, expectedVersion: number, input: MemoryNoteInput): Promise<MemoryNote | "not_found" | "stale_version"> {
    assertWellFormedNote(input);
    const updated = await exec
      .update(memoryNotes)
      .set({ categories: [...input.categories], content: input.content, version: sql`${memoryNotes.version} + 1`, updatedAt: new Date() })
      .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, id), eq(memoryNotes.version, expectedVersion), isNull(memoryNotes.mergedInto)))
      .returning();
    if (updated[0]) return toMemoryNote(updated[0]);
    return (await memoryNoteExists(exec, ownerId, id)) ? "stale_version" : "not_found";
  }

  async function memoryNoteExists(exec: Executor, ownerId: string, id: string): Promise<boolean> {
    const [existing] = await exec
      .select({ id: memoryNotes.id })
      .from(memoryNotes)
      .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, id), isNull(memoryNotes.mergedInto)));
    return existing !== undefined;
  }

  return {
    async createChat({ createdAt, ...input }) {
      const at = createdAt ?? new Date().toISOString();
      const row = chatRow({ ...input, createdAt: at, updatedAt: at });
      try {
        await db.insert(chats).values(row);
      } catch (error) {
        if (isConflictOn(error, "chats_owner_subject_idx")) throw new DuplicateChatSubjectError(input.ownerId, input.subjectKey!);
        throw error;
      }
      return toChat(row);
    },

    async findChatBySubject(ownerId, subjectKey) {
      const [row] = await db.select().from(chats).where(and(eq(chats.ownerId, ownerId), eq(chats.subjectKey, subjectKey)));
      return row ? toChat(row) : null;
    },

    async importChat(chat, imported) {
      // Ошибка внутри транзакции откатывает её целиком: ни чата, ни сообщений.
      await db.transaction(async (tx) => {
        try {
          await tx.insert(chats).values(chatRow(chat));
        } catch (error) {
          if (isConflictOn(error, "chats_owner_subject_idx")) throw new DuplicateChatSubjectError(chat.ownerId, chat.subjectKey!);
          if (isConflictOn(error, "chats_pkey")) throw new ChatAlreadyExistsError(chat.id);
          throw error;
        }
        // По одному: порядок записи (`seq`) — порядок сообщений при равном времени создания.
        for (const message of imported) {
          const { alive: _alive, ...stored } = message;
          try {
            await tx.insert(messages).values(stored);
          } catch (error) {
            if (isPrimaryKeyConflict(error)) throw new DuplicateMessageError(message.id);
            throw error;
          }
        }
      });
    },

    async setAfterTurnState(messageId, state, options) {
      // Строка заперта до конца транзакции: другая копия сервера не закроет хук между проверкой и записью.
      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ parts: messages.parts, afterTurn: messages.afterTurn })
          .from(messages)
          .where(eq(messages.id, messageId))
          .for("update");
        if (!existing || (state !== "pending" && existing.afterTurn !== "pending")) return false;
        await tx
          .update(messages)
          .set({
            afterTurn: state,
            ...(options?.appendParts && { parts: [...existing.parts, ...options.appendParts] }),
            // Отметка ожидания хука — в колонке знака жизни, по часам базы: у законченного ответа она больше ни для чего.
            ...(state === "pending" && aliveAtColumn("now")),
          })
          .where(eq(messages.id, messageId));
        return true;
      });
    },

    async listPendingAfterTurn(filter) {
      const pending = eq(messages.afterTurn, "pending");
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          filter?.pendingForMs === undefined
            ? pending
            : and(
                pending,
                sql`coalesce(${messages.aliveAt}, ${messages.createdAt}) < ${isoAtDatabase(sql`now() - ${filter.pendingForMs} * interval '1 millisecond'`)}`,
              ),
        );
      return rows.map((row) => row.id);
    },

    async getChat(chatId) {
      const [chat] = await db.select().from(chats).where(eq(chats.id, chatId));
      return chat ? toChat(chat) : null;
    },

    async updateChatModel(chatId, model) {
      await db
        .update(chats)
        .set({ modelId: model.modelId, providerId: model.providerId, reasoning: model.reasoning ?? null })
        .where(eq(chats.id, chatId));
    },

    async updateChatData(chatId, patch, { maxBytes }) {
      // Строка чата блокируется на время слияния: параллельные правки идут по очереди и не затирают друг друга.
      return db.transaction(async (tx) => {
        const [row] = await tx.select().from(chats).where(eq(chats.id, chatId)).for("update");
        if (!row) return null;
        const merged = mergeChatData(row.subjectData ?? undefined, patch, maxBytes);
        await tx.update(chats).set({ subjectData: merged ?? null }).where(eq(chats.id, chatId));
        return toChat({ ...row, subjectData: merged ?? null });
      });
    },

    async listChats(ownerId, options?: ChatListOptions) {
      if (options?.data) assertChatDataFilter(options.data);
      const rows = await db
        .select()
        .from(chats)
        .where(and(eq(chats.ownerId, ownerId), subjectCondition(options?.subjects), dataCondition(options?.data)))
        .orderBy(desc(chats.updatedAt), desc(chats.createdAt), desc(chats.id));
      return rows.map(toChat);
    },

    async renameChat(chatId, title) {
      await db.update(chats).set({ title }).where(eq(chats.id, chatId));
    },

    async setChatClosed(chatId, closed) {
      await db.update(chats).set({ closed: closed && { code: closed.code, message: closed.message } }).where(eq(chats.id, chatId));
    },

    async deleteChat(chatId) {
      await db.transaction(async (tx) => {
        await tx.delete(compactions).where(eq(compactions.chatId, chatId));
        await tx.delete(branchSelections).where(eq(branchSelections.chatId, chatId));
        await tx.delete(messages).where(eq(messages.chatId, chatId));
        await tx.delete(chats).where(eq(chats.id, chatId));
      });
    },

    async getMessage(messageId) {
      const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
      if (!row) return null;
      const message = toMessage(row);
      assertKnownFormatVersion(message);
      return message;
    },

    async listMessages(chatId) {
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), asc(messages.seq));
      const found: StoredMessage[] = rows.map(toMessage);
      found.forEach(assertKnownFormatVersion);
      return found;
    },

    async listMessageLinks(chatId) {
      return db
        .select({ id: messages.id, parentId: messages.parentId, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), asc(messages.seq));
    },

    // Части нужных типов выбираются внутри базы: тексты и выводы инструментов в процесс не идут.
    async listMessagePartsOfTypes(chatId, types) {
      const wanted = JSON.stringify([...types]);
      const rows = await db
        .select({
          id: messages.id,
          parentId: messages.parentId,
          createdAt: messages.createdAt,
          parts: sql<unknown>`(select coalesce(json_agg(part.value order by part.position), '[]'::json) from json_array_elements(${messages.parts}) with ordinality as part(value, position) where part.value->>'type' in (select json_array_elements_text(${wanted}::json)))`,
        })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), asc(messages.seq));
      return rows.map((row) => ({ ...row, parts: (typeof row.parts === "string" ? JSON.parse(row.parts) : row.parts) as StoredMessage["parts"] }));
    },

    async insertMessage(message) {
      try {
        await db.transaction(async (tx) => {
          const { alive, ...stored } = message;
          await tx.insert(messages).values({ ...stored, ...aliveAtColumn(alive) });
          await tx.update(chats).set({ updatedAt: message.createdAt }).where(eq(chats.id, message.chatId));
        });
      } catch (error) {
        if (isPrimaryKeyConflict(error)) throw new DuplicateMessageError(message.id);
        throw error;
      }
    },

    updateStreamingMessage: (messageId, patch) => updateStreaming(messageId, patch),

    markAnswerAlive: (messageId) => updateStreaming(messageId, { alive: "now" }),

    finishMessage: (messageId, final) => updateStreaming(messageId, { ...final, ...(final.afterTurn === "pending" && { alive: "now" as const }) }),

    async updateAwaitingMessage(messageId, patch) {
      // Строка заперта до конца транзакции: другая копия сервера не запишет между сравнением частей и записью.
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ status: messages.status, parts: messages.parts })
          .from(messages)
          .where(eq(messages.id, messageId))
          .for("update");
        if (!existing) throw new Error(`Сообщения ${messageId} нет`);
        if (existing.status !== "awaiting_approval") throw new MessageNotAwaitingError(messageId);
        if (patch.expectedParts && !sameMessageParts(existing.parts, patch.expectedParts)) throw new MessageNotAwaitingError(messageId);
        await tx
          .update(messages)
          .set({ parts: patch.parts, ...(patch.status && { status: patch.status }), ...aliveAtColumn(patch.alive) })
          .where(eq(messages.id, messageId));
      });
    },

    async listStreamingMessageIds() {
      const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.status, "streaming")).orderBy(asc(messages.seq));
      return rows.map((row) => row.id);
    },

    async listSilentAnswerIds({ silentForMs, chatId }) {
      const silent = sql`coalesce(${messages.aliveAt}, ${messages.createdAt}) < ${isoAtDatabase(sql`now() - ${silentForMs} * interval '1 millisecond'`)}`;
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.status, "streaming"), silent, chatId === undefined ? undefined : eq(messages.chatId, chatId)))
        .orderBy(asc(messages.seq));
      return rows.map((row) => row.id);
    },

    async insertCompaction(record) {
      await db.insert(compactions).values(record);
    },

    async listCompactions(chatId) {
      const rows = await db.select().from(compactions).where(eq(compactions.chatId, chatId)).orderBy(asc(compactions.seq));
      return rows.map(({ seq: _seq, ...record }) => record);
    },

    async insertBranchSelection(record) {
      await db.insert(branchSelections).values(record);
    },

    async listBranchSelections(chatId) {
      const rows = await db.select().from(branchSelections).where(eq(branchSelections.chatId, chatId)).orderBy(asc(branchSelections.seq));
      return rows.map(({ seq: _seq, ...record }) => record);
    },

    async insertUsageRecord(record) {
      await db.insert(usageRecords).values(record);
    },

    async hasUsageRecord(id) {
      const rows = await db.select({ id: usageRecords.id }).from(usageRecords).where(eq(usageRecords.id, id)).limit(1);
      return rows.length > 0;
    },

    async sumUsage({ ownerId, chatId, messageId, source, since }) {
      const filters = [
        ...(ownerId !== undefined ? [eq(usageRecords.ownerId, ownerId)] : []),
        ...(chatId !== undefined ? [eq(usageRecords.chatId, chatId)] : []),
        ...(messageId !== undefined ? [eq(usageRecords.messageId, messageId)] : []),
        ...(source !== undefined ? [eq(usageRecords.source, source)] : []),
        ...(since !== undefined ? [gte(usageRecords.createdAt, since)] : []),
      ];
      // sum() по bigint приходит строкой: суммы токенов помещаются в число.
      return db
        .select({
          modelId: usageRecords.modelId,
          providerId: usageRecords.providerId,
          inputTokens: sql<number>`sum(${usageRecords.inputTokens})`.mapWith(Number),
          cachedInputTokens: sql<number>`sum(${usageRecords.cachedInputTokens})`.mapWith(Number),
          cacheWriteTokens: sql<number>`sum(${usageRecords.cacheWriteTokens})`.mapWith(Number),
          outputTokens: sql<number>`sum(${usageRecords.outputTokens})`.mapWith(Number),
          reasoningTokens: sql<number>`sum(${usageRecords.reasoningTokens})`.mapWith(Number),
          costUsd: sql<number>`sum(${usageRecords.costUsd})`.mapWith(Number),
        })
        .from(usageRecords)
        .where(and(...filters))
        .groupBy(usageRecords.modelId, usageRecords.providerId);
    },

    async sumUsageByChat({ chatIds, ownerId, source, since }) {
      if (chatIds.length === 0) return [];
      const filters = [
        inArray(usageRecords.chatId, [...chatIds]),
        ...(ownerId !== undefined ? [eq(usageRecords.ownerId, ownerId)] : []),
        ...(source !== undefined ? [eq(usageRecords.source, source)] : []),
        ...(since !== undefined ? [gte(usageRecords.createdAt, since)] : []),
      ];
      return db
        .select({
          chatId: usageRecords.chatId,
          modelId: usageRecords.modelId,
          providerId: usageRecords.providerId,
          inputTokens: sql<number>`sum(${usageRecords.inputTokens})`.mapWith(Number),
          cachedInputTokens: sql<number>`sum(${usageRecords.cachedInputTokens})`.mapWith(Number),
          cacheWriteTokens: sql<number>`sum(${usageRecords.cacheWriteTokens})`.mapWith(Number),
          outputTokens: sql<number>`sum(${usageRecords.outputTokens})`.mapWith(Number),
          reasoningTokens: sql<number>`sum(${usageRecords.reasoningTokens})`.mapWith(Number),
          costUsd: sql<number>`sum(${usageRecords.costUsd})`.mapWith(Number),
        })
        .from(usageRecords)
        .where(and(...filters))
        .groupBy(usageRecords.chatId, usageRecords.modelId, usageRecords.providerId);
    },

    async getUserModelChoice(ownerId) {
      const [row] = await db.select().from(userModelChoices).where(eq(userModelChoices.ownerId, ownerId));
      if (!row) return null;
      return { modelId: row.modelId, providerId: row.providerId, ...(row.reasoning !== null && { reasoning: row.reasoning }) };
    },

    async saveUserModelChoice(ownerId, choice) {
      const values = { modelId: choice.modelId, providerId: choice.providerId, reasoning: choice.reasoning ?? null, updatedAt: new Date().toISOString() };
      await db.insert(userModelChoices).values({ ownerId, ...values }).onConflictDoUpdate({ target: userModelChoices.ownerId, set: values });
    },

    async setVoiceCut({ ownerId, chatId, messageId, voiceCut }) {
      await db
        .update(messages)
        .set({ voiceCut })
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.chatId, chatId),
            sql`exists (select 1 from ${chats} where ${chats.id} = ${chatId} and ${chats.ownerId} = ${ownerId})`,
          ),
        );
    },

    async getSpendingLimitState(key) {
      const [row] = await db.select().from(spendingLimitStates).where(eq(spendingLimitStates.key, key));
      return row ? { value: row.value, version: row.version } : null;
    },

    // Одна команда без чтения: вставка или правка срабатывает только при совпавшей версии, из двух одновременных проходит одна.
    async saveSpendingLimitState(key, value, expectedVersion) {
      const updatedAt = new Date().toISOString();
      if (expectedVersion === null) {
        const inserted = await db
          .insert(spendingLimitStates)
          .values({ key, value, version: 1, updatedAt })
          .onConflictDoNothing()
          .returning({ key: spendingLimitStates.key });
        return inserted.length === 1;
      }
      const updated = await db
        .update(spendingLimitStates)
        .set({ value, version: expectedVersion + 1, updatedAt })
        .where(and(eq(spendingLimitStates.key, key), eq(spendingLimitStates.version, expectedVersion)))
        .returning({ key: spendingLimitStates.key });
      return updated.length === 1;
    },

    async deleteSpendingLimitStates(keys) {
      if (keys.length > 0) await db.delete(spendingLimitStates).where(inArray(spendingLimitStates.key, keys));
    },

    async getVoiceChoice(ownerId) {
      const [row] = await db.select().from(voiceChoices).where(eq(voiceChoices.ownerId, ownerId));
      return row?.voiceId ?? null;
    },

    async setVoiceChoice(ownerId, voiceId) {
      const values = { voiceId, updatedAt: new Date().toISOString() };
      await db.insert(voiceChoices).values({ ownerId, ...values }).onConflictDoUpdate({ target: voiceChoices.ownerId, set: values });
    },

    async listMemoryNotes(ownerId) {
      return visibleNotes(db, ownerId);
    },

    async insertMemoryNotes(ownerId, inputs) {
      return insertNotes(db, ownerId, inputs);
    },

    async insertMemoryNotesChecked(ownerId, inputs, guard) {
      return db.transaction(async (tx) => {
        await lockMemoryNotes(tx, ownerId);
        const error = guard(await visibleNotes(tx, ownerId));
        return error ?? (await insertNotes(tx, ownerId, inputs));
      });
    },

    async updateMemoryNote(ownerId, id, expectedVersion, input) {
      return updateNote(db, ownerId, id, expectedVersion, input);
    },

    async updateMemoryNoteChecked(ownerId, id, expectedVersion, input, guard) {
      return db.transaction(async (tx) => {
        await lockMemoryNotes(tx, ownerId);
        const error = guard(await visibleNotes(tx, ownerId));
        return error ?? (await updateNote(tx, ownerId, id, expectedVersion, input));
      });
    },

    async deleteMemoryNote(ownerId, id, expectedVersion) {
      const deleted = await db.transaction(async (tx) => {
        const rows = await tx
          .delete(memoryNotes)
          .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, id), eq(memoryNotes.version, expectedVersion), isNull(memoryNotes.mergedInto)))
          .returning({ id: memoryNotes.id });
        // Скрытые оригиналы слияния уходят вместе с результатом.
        if (rows.length > 0) await tx.delete(memoryNotes).where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.mergedInto, id)));
        return rows.length > 0;
      });
      if (deleted) return "ok";
      return (await memoryNoteExists(db, ownerId, id)) ? "stale_version" : "not_found";
    },

    async clearMemoryNotes(ownerId) {
      return db.transaction(async (tx) => {
        const deleted = await tx.delete(memoryNotes).where(eq(memoryNotes.ownerId, ownerId)).returning({ mergedInto: memoryNotes.mergedInto });
        await tx.delete(memoryOptimizationRuns).where(eq(memoryOptimizationRuns.ownerId, ownerId));
        // Считаются записи, которые человек видел; скрытые оригиналы — служебные.
        return deleted.filter((row) => row.mergedInto === null).length;
      });
    },

    // Взятие запуска — одна транзакция под замком человека: проверка правил и вставка не разрываются между процессами.
    async claimMemoryOptimizationRun(ownerId, rules, now) {
      const nowMs = Date.parse(now);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent_chat.memory_optimization:${ownerId}`}, 0))`);
        const runs = await tx.select().from(memoryOptimizationRuns).where(eq(memoryOptimizationRuns.ownerId, ownerId));
        const state = runs.map((run) => {
          const leaseEnd = run.startedAt.getTime() + rules.leaseMs;
          const expired = run.status === "running" && nowMs >= leaseEnd;
          return { status: expired ? "failed" : run.status, endedAt: expired ? leaseEnd : (run.finishedAt ?? run.startedAt).getTime(), expired, id: run.id };
        });
        for (const run of state.filter((item) => item.expired)) {
          await tx
            .update(memoryOptimizationRuns)
            .set({ status: "failed", error: "lease_expired", finishedAt: new Date(run.endedAt) })
            .where(eq(memoryOptimizationRuns.id, run.id));
        }
        const blocked = isOptimizationBlocked(
          runs.map((run, index) => ({ status: state[index]!.status, startedAtMs: run.startedAt.getTime(), endedAtMs: state[index]!.endedAt })),
          rules,
          nowMs,
        );
        if (blocked) return null;
        const [created] = await tx
          .insert(memoryOptimizationRuns)
          .values({ id: crypto.randomUUID(), ownerId, startedAt: new Date(nowMs), status: "running" })
          .returning();
        return toOptimizationRun(created!);
      });
    },

    async finishMemoryOptimizationRun(ownerId, runId, outcome) {
      const finished = await db
        .update(memoryOptimizationRuns)
        .set({ status: outcome.status, finishedAt: new Date(outcome.finishedAt), error: outcome.error ?? null, usageRecordId: outcome.usageRecordId ?? null })
        .where(and(eq(memoryOptimizationRuns.id, runId), eq(memoryOptimizationRuns.ownerId, ownerId), eq(memoryOptimizationRuns.status, "running")))
        .returning({ id: memoryOptimizationRuns.id });
      return finished.length > 0 ? "ok" : "not_found";
    },

    // Слияние — одна транзакция: несошедшийся оригинал бросает StaleMerge, и откатывается всё, включая запуск.
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
      try {
        return await db.transaction(async (tx) => {
          const [run] = await tx
            .select()
            .from(memoryOptimizationRuns)
            .where(and(eq(memoryOptimizationRuns.id, merge.runId), eq(memoryOptimizationRuns.ownerId, ownerId)))
            .for("update");
          if (run?.status !== "running") return "run_not_active" as const;
          const now = new Date();
          const groups: MemoryMergeGroup[] = [];
          for (const { result, originals } of merges) {
            const created = { id: crypto.randomUUID(), ownerId, categories: [...result.categories], content: result.content, version: 1, createdAt: now, updatedAt: now };
            await tx.insert(memoryNotes).values(created);
            // Оригинал прячется, только если он ещё обычный и той же версии; условие проверяет сама база.
            for (const { id, version } of originals) {
              const hidden = await tx
                .update(memoryNotes)
                .set({ mergedInto: created.id })
                .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, id), eq(memoryNotes.version, version), isNull(memoryNotes.mergedInto)))
                .returning({ id: memoryNotes.id });
              if (hidden.length === 0) throw new StaleMerge();
            }
            groups.push({ resultId: created.id, originalIds: originals.map(({ id }) => id), resultVersion: 1 });
          }
          const [finished] = await tx
            .update(memoryOptimizationRuns)
            .set({ status: "applied", finishedAt: new Date(merge.finishedAt), groups, usageRecordId: merge.usageRecordId ?? null })
            .where(eq(memoryOptimizationRuns.id, run.id))
            .returning();
          return toOptimizationRun(finished!);
        });
      } catch (error) {
        if (error instanceof StaleMerge) return "stale_version";
        throw error;
      }
    },

    async revertMemoryMerge(ownerId, runId, guard) {
      return db.transaction(async (tx) => {
        await lockMemoryNotes(tx, ownerId);
        const [run] = await tx
          .select()
          .from(memoryOptimizationRuns)
          .where(and(eq(memoryOptimizationRuns.id, runId), eq(memoryOptimizationRuns.ownerId, ownerId)))
          .for("update");
        if (run?.status !== "applied") return "not_found" as const;
        for (const { resultId, originalIds, resultVersion } of run.groups) {
          const [result] = await tx
            .select({ version: memoryNotes.version })
            .from(memoryNotes)
            .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, resultId), isNull(memoryNotes.mergedInto)))
            .for("update");
          if (result?.version !== resultVersion) return "conflict" as const;
          const hidden = await tx
            .select({ id: memoryNotes.id })
            .from(memoryNotes)
            .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.mergedInto, resultId), inArray(memoryNotes.id, originalIds)))
            .for("update");
          if (hidden.length !== originalIds.length) return "conflict" as const;
        }
        if (guard) {
          const resultIds = run.groups.map(({ resultId }) => resultId);
          const remaining = (await visibleNotes(tx, ownerId)).filter((note) => !resultIds.includes(note.id));
          const restoredRows = await tx
            .select()
            .from(memoryNotes)
            .where(and(eq(memoryNotes.ownerId, ownerId), inArray(memoryNotes.mergedInto, resultIds)))
            .orderBy(desc(memoryNotes.updatedAt), desc(memoryNotes.createdAt), sql`${memoryNotes.id} collate "C" desc`);
          const error = guard(remaining, restoredRows.map(toMemoryNote));
          if (error) return revertRefusal(error);
        }
        for (const { resultId } of run.groups) {
          await tx.update(memoryNotes).set({ mergedInto: null }).where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.mergedInto, resultId)));
          await tx.delete(memoryNotes).where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, resultId)));
        }
        await tx.update(memoryOptimizationRuns).set({ status: "reverted" }).where(eq(memoryOptimizationRuns.id, run.id));
        return "ok" as const;
      });
    },

    async listMemoryOptimizationRuns(ownerId, filter) {
      const query = db
        .select()
        .from(memoryOptimizationRuns)
        .where(and(eq(memoryOptimizationRuns.ownerId, ownerId), ...(filter?.status ? [inArray(memoryOptimizationRuns.status, filter.status)] : [])))
        .orderBy(desc(memoryOptimizationRuns.startedAt), sql`${memoryOptimizationRuns.id} collate "C" desc`);
      const rows = await (filter?.limit === undefined ? query : query.limit(filter.limit));
      return rows.map(toOptimizationRun);
    },

    async listMergedMemoryNotes(ownerId) {
      const rows = await db
        .select()
        .from(memoryNotes)
        .where(and(eq(memoryNotes.ownerId, ownerId), isNotNull(memoryNotes.mergedInto)))
        .orderBy(desc(memoryNotes.updatedAt), desc(memoryNotes.createdAt), sql`${memoryNotes.id} collate "C" desc`);
      return rows.map((row): MergedMemoryNote => ({ ...toMemoryNote(row), mergedInto: row.mergedInto! }));
    },
  };
}

type UniqueViolation = { code?: unknown; constraint?: unknown; cause?: UniqueViolation };

function isPrimaryKeyConflict(error: unknown): boolean {
  return isConflictOn(error, "messages_pkey");
}

/** Нарушен уникальный ключ или индекс с этим именем. */
function isConflictOn(error: unknown, constraintName: string): boolean {
  const { code, constraint, cause } = (error ?? {}) as UniqueViolation;
  return [code, cause?.code].includes("23505") && [constraint, cause?.constraint].includes(constraintName);
}

/** Запись чата в строку: поле без значения — пусто. */
function chatRow(chat: Chat): typeof chats.$inferSelect {
  return {
    id: chat.id,
    ownerId: chat.ownerId,
    modelId: chat.modelId,
    providerId: chat.providerId,
    reasoning: chat.reasoning ?? null,
    title: chat.title ?? null,
    origin: chat.origin ?? null,
    subjectKey: chat.subjectKey ?? null,
    subjectData: chatDataOfInput(chat) ?? null,
    closed: chat.closed ?? null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
  };
}

/** Строка чата в запись ядра: пустые необязательные поля — отсутствие поля. */
function toChat(row: typeof chats.$inferSelect): Chat {
  const { reasoning, title, origin, subjectKey, subjectData, closed, ...chat } = row;
  return {
    ...chat,
    ...(reasoning !== null && { reasoning }),
    ...(title !== null && { title }),
    ...(origin !== null && { origin }),
    ...(subjectKey !== null && { subjectKey }),
    ...chatDataFields(subjectData),
    ...(closed !== null && { closed }),
  };
}

/** Фильтр `listChats` по ключу объекта; по умолчанию — только чаты без ключа. */
function subjectCondition(subjects: ChatSubjectFilter = "exclude") {
  if (subjects === "include") return undefined;
  return subjects === "only" ? isNotNull(chats.subjectKey) : isNull(chats.subjectKey);
}

/** Фильтр `listChats` по данным чата: одно «содержит» (`@>`) по всем ключам; тип значения важен (`true` не равно `1`). */
function dataCondition(filter: ChatDataFilter | undefined) {
  if (!filter || Object.keys(filter).length === 0) return undefined;
  return sql`${chats.subjectData}::jsonb @> ${JSON.stringify(filter)}::jsonb`;
}

/** Строка сообщения в запись ядра: без служебных колонок; пустое состояние хука итога — отсутствие поля. */
function toMessage(row: typeof messages.$inferSelect): StoredMessage {
  const { seq: _seq, aliveAt: _aliveAt, afterTurn, ...message } = row;
  return { ...message, ...(afterTurn !== null && { afterTurn }) };
}

/** Строка памяти в запись ядра: без владельца, время — ISO 8601. */
function toMemoryNote(row: typeof memoryNotes.$inferSelect): MemoryNote {
  return {
    id: row.id,
    categories: [...row.categories],
    content: row.content,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Строка запуска в запись ядра: без владельца, время — ISO 8601. */
function toOptimizationRun(row: typeof memoryOptimizationRuns.$inferSelect): MemoryOptimizationRun {
  return {
    id: row.id,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status,
    groups: row.groups.map((group) => ({ ...group, originalIds: [...group.originalIds] })),
    error: row.error,
    usageRecordId: row.usageRecordId,
  };
}

/** Как база с NOT NULL: разделы — список строк, текст — строка. Иначе jsonb принял бы любое значение. */
function assertWellFormedNote(note: MemoryNoteInput): void {
  if (!Array.isArray(note?.categories) || !note.categories.every((category) => typeof category === "string")) {
    throw new TypeError("Разделы записи памяти — список строк");
  }
  if (typeof note.content !== "string") throw new TypeError("Текст записи памяти — строка");
}
