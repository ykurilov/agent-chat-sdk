import { fileURLToPath } from "node:url";
import {
  aliveAtByLocalClock,
  assertChatDataFilter,
  assertKnownFormatVersion,
  ChatAlreadyExistsError,
  chatDataFields,
  chatDataOfInput,
  DuplicateChatSubjectError,
  DuplicateMessageError,
  isOptimizationBlocked,
  mergeChatData,
  ChatTurnLeaseLostError,
  MessageAlreadyFinishedError,
  MessageNotAwaitingError,
  revertRefusal,
  sameMessageParts,
  silenceBoundaryByLocalClock,
} from "@ykurilov/agent-chat-core";
import type { AnswerAliveMark, Chat, ChatDataFilter, ChatListOptions, ChatStorage, ChatSubjectFilter, MemoryMergeGroup, MemoryNote, MemoryNoteInput, MemoryOptimizationRun, MergedMemoryNote, StoredMessage } from "@ykurilov/agent-chat-core";
import Database from "better-sqlite3";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { branchSelections, chats, chatTurnLeases, compactions, memoryNotes, memoryOptimizationRuns, messages, pendingBursts, spendingLimitStates, usageRecords, userModelChoices, voiceChoices } from "./schema";

export interface SqliteChatStorage extends ChatStorage {
  /** Закрывает файл базы. */
  close(): void;
}

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
/** Свой журнал миграций SDK: общий журнал drizzle в файле может вести и приложение. */
const MIGRATIONS_TABLE = "__agent_chat_migrations";
/** Общий журнал drizzle: в нём SDK вёл свои миграции до 0.32. */
const SHARED_MIGRATIONS_TABLE = "__drizzle_migrations";

/** В файле таблицы `chats` или `messages` создал не SDK: открывать такой файл нельзя, миграции испортили бы чужие данные. */
export class ForeignChatTablesError extends Error {
  constructor(
    readonly filePath: string,
    readonly tables: readonly string[],
  ) {
    super(
      `В файле ${filePath} чужие таблицы ${tables.join(" и ")}: их создало не SDK чата. ` +
        `Дайте SDK отдельный файл (например, data/chat.sqlite): общий файл с таблицами приложения не поддерживается. Файл не тронут.`,
    );
    this.name = "ForeignChatTablesError";
  }
}

/**
 * Таблицы SDK узнаются по журналу миграций: в нём есть запись первой миграции SDK. Нет `chats`/`messages` — файл
 * пустой или со своими другими таблицами приложения, SDK создаст свои рядом. Есть, а записи нет — таблицы чужие.
 */
function assertNoForeignChatTables(sqlite: Database.Database, filePath: string): void {
  const names = tableNames(sqlite);
  const found = ["chats", "messages"].filter((name) => names.has(name));
  if (found.length === 0) return;
  const firstMigrationHash = readMigrationFiles({ migrationsFolder })[0]?.hash;
  const ours = [MIGRATIONS_TABLE, SHARED_MIGRATIONS_TABLE].some((table) => {
    try {
      return names.has(table) && sqlite.prepare(`select 1 from "${table}" where hash = ?`).get(firstMigrationHash) !== undefined;
    } catch {
      // У журнала приложения другие колонки: он не наш.
      return false;
    }
  });
  if (!ours) throw new ForeignChatTablesError(filePath, found);
}

function tableNames(sqlite: Database.Database): Set<string> {
  return new Set(sqlite.prepare("select name from sqlite_master where type = 'table'").pluck().all() as string[]);
}

/**
 * До 0.32 SDK вёл миграции в общем журнале drizzle. drizzle смотрит только на время последней записи: запись приложения
 * новее миграций SDK заставляла их пропускать. Записи SDK (узнаются по хешу или времени своих миграций) один раз
 * копируются в свой журнал; общий журнал не меняется. Под замком записи: две копии сервера не перенесут дважды.
 */
function moveSharedMigrationJournal(sqlite: Database.Database): void {
  sqlite
    .transaction(() => {
      const names = tableNames(sqlite);
      if (names.has(MIGRATIONS_TABLE) || !names.has(SHARED_MIGRATIONS_TABLE)) return;
      let rows: Array<{ hash: string; created_at: number }>;
      try {
        rows = sqlite.prepare(`select hash, created_at from "${SHARED_MIGRATIONS_TABLE}"`).all() as typeof rows;
      } catch {
        // У журнала приложения другие колонки: записей SDK в нём нет.
        return;
      }
      const sdk = readMigrationFiles({ migrationsFolder });
      const ours = rows.filter((row) => sdk.some((migration) => migration.hash === row.hash || migration.folderMillis === Number(row.created_at)));
      if (ours.length === 0) return;
      // Та же таблица, что создаёт drizzle для журнала.
      sqlite.exec(`create table "${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
      const insert = sqlite.prepare(`insert into "${MIGRATIONS_TABLE}" (hash, created_at) values (?, ?)`);
      for (const row of ours) insert.run(row.hash, row.created_at);
    })
    .immediate();
}

/**
 * Применяет миграции SDK, которых нет в своём журнале. Применённой считается миграция, чей хеш или время есть в журнале
 * (drizzle пишет время миграции из `_journal.json`). drizzle сверяет только последнюю запись, поэтому дыру в середине,
 * оставленную общим журналом до 0.32, не видит; здесь она закрывается. Такие миграции идут не по порядку, и это безопасно:
 * пропасть могли только миграции до 0.32, а они лишь добавляют таблицы, столбцы и индексы (это проверяет тест).
 * Журнал тот же, что у drizzle. Всё — одной транзакцией под замком записи: две копии сервера не применят миграцию дважды.
 */
function applyMigrations(sqlite: Database.Database): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  sqlite
    .transaction(() => {
      sqlite.exec(`create table if not exists "${MIGRATIONS_TABLE}" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
      const rows = sqlite.prepare(`select hash, created_at from "${MIGRATIONS_TABLE}"`).all() as Array<{ hash: string; created_at: number }>;
      const hashes = new Set(rows.map((row) => row.hash));
      const times = new Set(rows.map((row) => Number(row.created_at)));
      const record = sqlite.prepare(`insert into "${MIGRATIONS_TABLE}" (hash, created_at) values (?, ?)`);
      for (const migration of migrations) {
        if (hashes.has(migration.hash) || times.has(migration.folderMillis)) continue;
        for (const statement of migration.sql) if (statement.trim()) sqlite.exec(statement);
        record.run(migration.hash, migration.folderMillis);
      }
    })
    .immediate();
}

/** Хранилище в файле SQLite. Схема приводится к последней миграции при открытии. */
export function createSqliteChatStorage(options: { filePath: string }): SqliteChatStorage {
  const sqlite = new Database(options.filePath);
  try {
    assertNoForeignChatTables(sqlite, options.filePath);
    moveSharedMigrationJournal(sqlite);
  } catch (error) {
    sqlite.close();
    throw error;
  }
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema: { chats, messages, compactions, branchSelections, usageRecords, userModelChoices, voiceChoices, spendingLimitStates, memoryNotes, memoryOptimizationRuns } });
  applyMigrations(sqlite);

  // Транзакции, которые пишут, — «immediate»: запись базы берётся сразу. Иначе чтение и запись разрывались бы, и вторая
  // копия сервера на том же файле роняла бы запись ошибкой «database is locked» вместо ожидания очереди.
  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

  function visibleNotes(tx: Transaction, ownerId: string): MemoryNote[] {
    return tx
      .select()
      .from(memoryNotes)
      .where(and(eq(memoryNotes.ownerId, ownerId), isNull(memoryNotes.mergedInto)))
      .orderBy(desc(memoryNotes.updatedAt), desc(memoryNotes.createdAt), desc(memoryNotes.id))
      .all()
      .map(toMemoryNote);
  }

  function insertNotes(tx: Transaction, ownerId: string, inputs: MemoryNoteInput[]): MemoryNote[] {
    const now = Date.now();
    const rows = inputs.map(({ categories, content }): typeof memoryNotes.$inferInsert => ({
      id: crypto.randomUUID(),
      ownerId,
      categories,
      content,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }));
    for (const row of rows) tx.insert(memoryNotes).values(row).run();
    return rows.map((row) => toMemoryNote(row as typeof memoryNotes.$inferSelect));
  }

  function updateNote(tx: Transaction, ownerId: string, id: string, expectedVersion: number, input: MemoryNoteInput): MemoryNote | "not_found" | "stale_version" {
    const row = tx.select().from(memoryNotes).where(ownerNote(ownerId, id)).get();
    if (!row) return "not_found";
    if (row.version !== expectedVersion) return "stale_version";
    const updated = tx
      .update(memoryNotes)
      .set({
        categories: input.categories,
        content: input.content,
        version: row.version + 1,
        // Часы не отстают от записи: время правки не убывает.
        updatedAt: Math.max(Date.now(), row.updatedAt),
      })
      .where(and(ownerNote(ownerId, id), eq(memoryNotes.version, expectedVersion)))
      .returning()
      .get();
    return updated ? toMemoryNote(updated) : "stale_version";
  }

  /** Знак жизни в колонку `alive_at`: SQLite живёт на одной машине с сервером, время — по её часам. */
  const aliveAtColumn = (alive: AnswerAliveMark | undefined) => (alive ? { aliveAt: aliveAtByLocalClock(alive) } : {});

  function assertTurnHolder(tx: Pick<typeof db, "select">, chatId: string, holder: string | undefined, messageId: string): void {
    if (holder === undefined) return;
    const row = tx.select({ chatId: chatTurnLeases.chatId }).from(chatTurnLeases)
      .where(and(eq(chatTurnLeases.chatId, chatId), eq(chatTurnLeases.holder, holder), sql`${chatTurnLeases.until} > ${Date.now()}`)).get();
    if (!row) throw new ChatTurnLeaseLostError(messageId);
  }

  /** Проверка владельца входит в ту же атомарную запись SQLite. */
  function turnLeaseCondition(holder: string | undefined) {
    if (holder === undefined) return undefined;
    return sql`exists (select 1 from ${chatTurnLeases} where ${chatTurnLeases.chatId} = ${messages.chatId} and ${chatTurnLeases.holder} = ${holder} and ${chatTurnLeases.until} > ${Date.now()})`;
  }

  /** Пишет в идущий ответ; отличает «нет такого» от «уже в конечном состоянии». */
  function updateStreaming(messageId: string, { alive, expectedTurnHolder, ...values }: Partial<typeof messages.$inferInsert> & { alive?: AnswerAliveMark; expectedTurnHolder?: string }): void {
    const result = db
      .update(messages)
      .set({ ...values, ...aliveAtColumn(alive) })
      .where(and(eq(messages.id, messageId), eq(messages.status, "streaming"), turnLeaseCondition(expectedTurnHolder)))
      .run();
    if (result.changes > 0) return;
    const existing = db.select({ id: messages.id, status: messages.status }).from(messages).where(eq(messages.id, messageId)).get();
    if (!existing) throw new Error(`Сообщения ${messageId} нет`);
    if (expectedTurnHolder !== undefined && existing.status === "streaming") throw new ChatTurnLeaseLostError(messageId);
    throw new MessageAlreadyFinishedError(messageId);
  }

  return {
    guardedTurnWrites: true,
    async createChat({ createdAt, ...input }) {
      const at = createdAt ?? new Date().toISOString();
      const row = chatRow({ ...input, createdAt: at, updatedAt: at });
      try {
        db.insert(chats).values(row).run();
      } catch (error) {
        if (isSubjectConflict(error)) throw new DuplicateChatSubjectError(input.ownerId, input.subjectKey!);
        throw error;
      }
      return toChat(row);
    },

    async findChatBySubject(ownerId, subjectKey) {
      const row = db.select().from(chats).where(and(eq(chats.ownerId, ownerId), eq(chats.subjectKey, subjectKey))).get();
      return row ? toChat(row) : null;
    },

    async importChat(chat, imported) {
      db.transaction((tx) => {
        try {
          tx.insert(chats).values(chatRow(chat)).run();
        } catch (error) {
          if (isSubjectConflict(error)) throw new DuplicateChatSubjectError(chat.ownerId, chat.subjectKey!);
          if (isPrimaryKeyConflict(error)) throw new ChatAlreadyExistsError(chat.id);
          throw error;
        }
        for (const message of imported) {
          const nextSeq = sql<number>`(select coalesce(max(${messages.seq}), 0) + 1 from ${messages})`;
          const { alive: _alive, ...stored } = message;
          try {
            tx.insert(messages).values({ ...stored, seq: nextSeq }).run();
          } catch (error) {
            if (isPrimaryKeyConflict(error)) throw new DuplicateMessageError(message.id);
            throw error;
          }
        }
      }, { behavior: "immediate" });
    },

    async setAfterTurnState(messageId, state, options) {
      // Чтение, проверка состояния и запись — одна транзакция с блокировкой записи: другая копия не вклинится.
      return db.transaction(
        (tx) => {
          const existing = tx.select({ parts: messages.parts, afterTurn: messages.afterTurn }).from(messages).where(eq(messages.id, messageId)).get();
          if (!existing || (state !== "pending" && existing.afterTurn !== "pending")) return false;
          tx.update(messages)
            .set({
              afterTurn: state,
              ...(options?.appendParts && { parts: [...existing.parts, ...options.appendParts] }),
              // Отметка ожидания хука — в колонке знака жизни: у законченного ответа она больше ни для чего.
              ...(state === "pending" && aliveAtColumn("now")),
            })
            .where(eq(messages.id, messageId))
            .run();
          return true;
        },
        { behavior: "immediate" },
      );
    },

    async listPendingAfterTurn(filter) {
      return db
        .select({ id: messages.id })
        .from(messages)
        .where(
          filter?.pendingForMs === undefined
            ? eq(messages.afterTurn, "pending")
            : and(
                eq(messages.afterTurn, "pending"),
                sql`coalesce(${messages.aliveAt}, ${messages.createdAt}) < ${silenceBoundaryByLocalClock(filter.pendingForMs)}`,
              ),
        )
        .all()
        .map((row) => row.id);
    },

    async getChat(chatId) {
      const row = db.select().from(chats).where(eq(chats.id, chatId)).get();
      return row ? toChat(row) : null;
    },

    async updateChatModel(chatId, model) {
      db.update(chats)
        .set({ modelId: model.modelId, providerId: model.providerId, reasoning: model.reasoning ?? null })
        .where(eq(chats.id, chatId))
        .run();
    },

    async updateChatData(chatId, patch, { maxBytes }) {
      // Чтение, слияние и запись — одна транзакция с блокировкой на запись: параллельные правки не затирают друг друга.
      return db.transaction(
        (tx) => {
          const row = tx.select().from(chats).where(eq(chats.id, chatId)).get();
          if (!row) return null;
          const merged = mergeChatData(row.subjectData ?? undefined, patch, maxBytes);
          tx.update(chats).set({ subjectData: merged ?? null }).where(eq(chats.id, chatId)).run();
          return toChat({ ...row, subjectData: merged ?? null });
        },
        { behavior: "immediate" },
      );
    },

    async listChats(ownerId, options?: ChatListOptions) {
      if (options?.data) assertChatDataFilter(options.data);
      const rows = db
        .select()
        .from(chats)
        .where(and(eq(chats.ownerId, ownerId), subjectCondition(options?.subjects), ...dataConditions(options?.data)))
        .orderBy(desc(chats.updatedAt), desc(chats.createdAt), desc(chats.id))
        .all();
      return rows.map(toChat);
    },

    async renameChat(chatId, title) {
      db.update(chats).set({ title }).where(eq(chats.id, chatId)).run();
    },

    async setChatClosed(chatId, closed) {
      db.update(chats).set({ closed: closed && { code: closed.code, message: closed.message } }).where(eq(chats.id, chatId)).run();
    },

    async deleteChat(chatId) {
      db.transaction((tx) => {
        tx.delete(compactions).where(eq(compactions.chatId, chatId)).run();
        tx.delete(branchSelections).where(eq(branchSelections.chatId, chatId)).run();
        tx.delete(messages).where(eq(messages.chatId, chatId)).run();
        tx.delete(chats).where(eq(chats.id, chatId)).run();
        tx.delete(chatTurnLeases).where(eq(chatTurnLeases.chatId, chatId)).run();
        tx.delete(pendingBursts).where(eq(pendingBursts.chatId, chatId)).run();
      }, { behavior: "immediate" });
    },

    async claimChatTurn(chatId, holder, leaseMs) {
      const now = Date.now();
      // Одной записью: свободный чат — вставка; своя или просроченная чужая — замена; живая чужая — ничего.
      const claimed = db
        .insert(chatTurnLeases)
        .values({ chatId, holder, until: now + leaseMs })
        .onConflictDoUpdate({
          target: chatTurnLeases.chatId,
          set: { holder, until: now + leaseMs },
          setWhere: sql`${chatTurnLeases.holder} = ${holder} or ${chatTurnLeases.until} <= ${now}`,
        })
        .returning({ chatId: chatTurnLeases.chatId })
        .all();
      return claimed.length > 0;
    },

    async releaseChatTurn(chatId, holder) {
      db.delete(chatTurnLeases).where(and(eq(chatTurnLeases.chatId, chatId), eq(chatTurnLeases.holder, holder))).run();
    },

    async clearChatTurnLeases() {
      db.delete(chatTurnLeases).run();
    },

    async savePendingBurst(burst) {
      const row = {
        chatId: burst.chatId,
        ownerId: burst.ownerId,
        messageId: burst.messageId,
        dueAt: Date.parse(burst.dueAt),
        holder: burst.holder,
        heldUntil: Date.parse(burst.heldUntil),
        page: burst.page ?? null,
      };
      db.insert(pendingBursts).values(row).onConflictDoUpdate({ target: pendingBursts.chatId, set: row }).run();
    },

    async takeAbandonedBursts({ abandonedBefore, holder, heldUntil, limit, exceptHolder }) {
      // Выбор и захват — одной записью: другая копия на той же базе ждёт замка и видит пачку уже взятой.
      return db.transaction((tx) => {
        const abandoned = tx
          .select()
          .from(pendingBursts)
          .where(and(lte(pendingBursts.heldUntil, Date.parse(abandonedBefore)), exceptHolder === undefined ? undefined : ne(pendingBursts.holder, exceptHolder)))
          .orderBy(asc(pendingBursts.dueAt))
          .limit(limit)
          .all();
        const until = Date.parse(heldUntil);
        for (const row of abandoned) tx.update(pendingBursts).set({ holder, heldUntil: until }).where(eq(pendingBursts.chatId, row.chatId)).run();
        return abandoned.map((row) => ({
          chatId: row.chatId,
          ownerId: row.ownerId,
          messageId: row.messageId,
          dueAt: new Date(row.dueAt).toISOString(),
          holder,
          heldUntil,
          ...(row.page && { page: row.page }),
        }));
      }, { behavior: "immediate" });
    },

    async renewPendingBurst({ chatId, messageId, holder, heldUntil }) {
      const renewed = db
        .update(pendingBursts)
        .set({ heldUntil: Date.parse(heldUntil) })
        .where(and(eq(pendingBursts.chatId, chatId), eq(pendingBursts.messageId, messageId), eq(pendingBursts.holder, holder)))
        .run();
      return renewed.changes > 0;
    },

    async removePendingBurst(chatId, messageId) {
      db.delete(pendingBursts).where(and(eq(pendingBursts.chatId, chatId), eq(pendingBursts.messageId, messageId))).run();
    },

    async getMessage(messageId) {
      const row = db.select().from(messages).where(eq(messages.id, messageId)).get();
      if (!row) return null;
      const message = toMessage(row);
      assertKnownFormatVersion(message);
      return message;
    },

    // При равном времени порядок записи задаёт `seq`: `rowid` VACUUM вправе перенумеровать.
    async listMessages(chatId) {
      const rows = db
        .select()
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), messages.seq)
        .all();
      const found: StoredMessage[] = rows.map(toMessage);
      found.forEach(assertKnownFormatVersion);
      return found;
    },

    async hasMessages(chatId) {
      return db.select({ present: sql<number>`1` }).from(messages).where(eq(messages.chatId, chatId)).limit(1).all().length > 0;
    },

    async listMessageLinks(chatId) {
      return db
        .select({ id: messages.id, parentId: messages.parentId, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), messages.seq)
        .all();
    },

    // Части нужных типов выбираются внутри базы: тексты и выводы инструментов в процесс не идут.
    async listMessagePartsOfTypes(chatId, types) {
      const wanted = JSON.stringify([...types]);
      const rows = db
        .select({
          id: messages.id,
          parentId: messages.parentId,
          createdAt: messages.createdAt,
          parts: sql<string>`(select coalesce(json_group_array(json(picked.value)), '[]') from (select part.value from json_each(${messages.parts}) as part where json_extract(part.value, '$.type') in (select value from json_each(${wanted})) order by part.key) as picked)`,
        })
        .from(messages)
        .where(eq(messages.chatId, chatId))
        .orderBy(asc(messages.createdAt), messages.seq)
        .all();
      return rows.map((row) => ({ ...row, parts: JSON.parse(row.parts) as StoredMessage["parts"] }));
    },

    async insertMessage(message, guard) {
      try {
        db.transaction((tx) => {
          assertTurnHolder(tx, message.chatId, guard?.expectedTurnHolder, message.id);
          const nextSeq = sql<number>`(select coalesce(max(${messages.seq}), 0) + 1 from ${messages})`;
          const { alive, ...stored } = message;
          tx.insert(messages).values({ ...stored, ...aliveAtColumn(alive), seq: nextSeq }).run();
          tx.update(chats).set({ updatedAt: message.createdAt }).where(eq(chats.id, message.chatId)).run();
        }, { behavior: "immediate" });
      } catch (error) {
        if (isPrimaryKeyConflict(error)) throw new DuplicateMessageError(message.id);
        throw error;
      }
    },

    updateStreamingMessage: async (messageId, patch) => updateStreaming(messageId, patch),

    markAnswerAlive: async (messageId, guard) => updateStreaming(messageId, { alive: "now", ...guard }),

    finishMessage: async (messageId, final) => updateStreaming(messageId, { ...final, ...(final.afterTurn === "pending" && { alive: "now" as const }) }),

    async updateAwaitingMessage(messageId, patch) {
      // Чтение, сравнение частей и запись — одна транзакция с блокировкой записи: другая копия не вклинится между ними.
      db.transaction(
        (tx) => {
          const existing = tx.select({ status: messages.status, parts: messages.parts, chatId: messages.chatId }).from(messages).where(eq(messages.id, messageId)).get();
          if (!existing) throw new Error(`Сообщения ${messageId} нет`);
          if (existing.status !== "awaiting_approval") throw new MessageNotAwaitingError(messageId);
          assertTurnHolder(tx, existing.chatId, patch.expectedTurnHolder, messageId);
          if (patch.expectedParts && !sameMessageParts(existing.parts, patch.expectedParts)) throw new MessageNotAwaitingError(messageId);
          tx.update(messages)
            .set({ parts: patch.parts, ...(patch.status && { status: patch.status }), ...aliveAtColumn(patch.alive) })
            .where(eq(messages.id, messageId))
            .run();
        },
        { behavior: "immediate" },
      );
    },

    async listStreamingMessageIds() {
      return db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.status, "streaming"))
        .all()
        .map((row) => row.id);
    },

    async listSilentAnswerIds({ silentForMs, chatId }) {
      const silent = sql`coalesce(${messages.aliveAt}, ${messages.createdAt}) < ${silenceBoundaryByLocalClock(silentForMs)}`;
      return db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.status, "streaming"), silent, chatId === undefined ? undefined : eq(messages.chatId, chatId)))
        .all()
        .map((row) => row.id);
    },

    async insertCompaction(record) {
      const nextSeq = sql<number>`(select coalesce(max(${compactions.seq}), 0) + 1 from ${compactions})`;
      db.insert(compactions).values({ ...record, seq: nextSeq }).run();
    },

    async listCompactions(chatId) {
      const rows = db.select().from(compactions).where(eq(compactions.chatId, chatId)).orderBy(asc(compactions.seq)).all();
      return rows.map(({ seq: _seq, ...record }) => record);
    },

    async insertBranchSelection(record) {
      const nextSeq = sql<number>`(select coalesce(max(${branchSelections.seq}), 0) + 1 from ${branchSelections})`;
      db.insert(branchSelections).values({ ...record, seq: nextSeq }).run();
    },

    async listBranchSelections(chatId) {
      const rows = db.select().from(branchSelections).where(eq(branchSelections.chatId, chatId)).orderBy(asc(branchSelections.seq)).all();
      return rows.map(({ seq: _seq, ...record }) => record);
    },

    async insertUsageRecord(record) {
      db.insert(usageRecords).values(record).run();
    },

    async hasUsageRecord(id) {
      return db.select({ id: usageRecords.id }).from(usageRecords).where(eq(usageRecords.id, id)).get() !== undefined;
    },

    async sumUsage({ ownerId, chatId, messageId, source, since }) {
      const filters = [
        ...(ownerId !== undefined ? [eq(usageRecords.ownerId, ownerId)] : []),
        ...(chatId !== undefined ? [eq(usageRecords.chatId, chatId)] : []),
        ...(messageId !== undefined ? [eq(usageRecords.messageId, messageId)] : []),
        ...(source !== undefined ? [eq(usageRecords.source, source)] : []),
        ...(since !== undefined ? [gte(usageRecords.createdAt, since)] : []),
      ];
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
        .groupBy(usageRecords.modelId, usageRecords.providerId)
        .all();
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
        .groupBy(usageRecords.chatId, usageRecords.modelId, usageRecords.providerId)
        .all();
    },

    async getUserModelChoice(ownerId) {
      const row = db.select().from(userModelChoices).where(eq(userModelChoices.ownerId, ownerId)).get();
      if (!row) return null;
      return { modelId: row.modelId, providerId: row.providerId, ...(row.reasoning !== null && { reasoning: row.reasoning }) };
    },

    async saveUserModelChoice(ownerId, choice) {
      const values = { modelId: choice.modelId, providerId: choice.providerId, reasoning: choice.reasoning ?? null, updatedAt: new Date().toISOString() };
      db.insert(userModelChoices).values({ ownerId, ...values }).onConflictDoUpdate({ target: userModelChoices.ownerId, set: values }).run();
    },

    async setVoiceCut({ ownerId, chatId, messageId, voiceCut }) {
      db.update(messages)
        .set({ voiceCut })
        .where(
          and(
            eq(messages.id, messageId),
            eq(messages.chatId, chatId),
            sql`exists (select 1 from ${chats} where ${chats.id} = ${chatId} and ${chats.ownerId} = ${ownerId})`,
          ),
        )
        .run();
    },

    async getSpendingLimitState(key) {
      const row = db.select().from(spendingLimitStates).where(eq(spendingLimitStates.key, key)).get();
      return row ? { value: row.value, version: row.version } : null;
    },

    // Одна команда без чтения: вставка или правка срабатывает только при совпавшей версии, лишнего «вклинивания» нет.
    async saveSpendingLimitState(key, value, expectedVersion) {
      const updatedAt = new Date().toISOString();
      if (expectedVersion === null) {
        return db.insert(spendingLimitStates).values({ key, value, version: 1, updatedAt }).onConflictDoNothing().run().changes === 1;
      }
      const changed = db
        .update(spendingLimitStates)
        .set({ value, version: expectedVersion + 1, updatedAt })
        .where(and(eq(spendingLimitStates.key, key), eq(spendingLimitStates.version, expectedVersion)))
        .run().changes;
      return changed === 1;
    },

    async deleteSpendingLimitStates(keys) {
      if (keys.length > 0) db.delete(spendingLimitStates).where(inArray(spendingLimitStates.key, keys)).run();
    },

    async getVoiceChoice(ownerId) {
      return db.select().from(voiceChoices).where(eq(voiceChoices.ownerId, ownerId)).get()?.voiceId ?? null;
    },

    async setVoiceChoice(ownerId, voiceId) {
      const values = { voiceId, updatedAt: new Date().toISOString() };
      db.insert(voiceChoices).values({ ownerId, ...values }).onConflictDoUpdate({ target: voiceChoices.ownerId, set: values }).run();
    },

    async listMemoryNotes(ownerId) {
      return db.transaction((tx) => visibleNotes(tx, ownerId));
    },

    // Пакет вставляется одной транзакцией: негодная запись (NOT NULL) откатывает и остальные.
    async insertMemoryNotes(ownerId, inputs) {
      return db.transaction((tx) => insertNotes(tx, ownerId, inputs), { behavior: "immediate" });
    },

    async insertMemoryNotesChecked(ownerId, inputs, guard) {
      return db.transaction(
        (tx) => {
          const error = guard(visibleNotes(tx, ownerId));
          return error ?? insertNotes(tx, ownerId, inputs);
        },
        { behavior: "immediate" },
      );
    },

    async updateMemoryNote(ownerId, id, expectedVersion, input) {
      return db.transaction((tx) => updateNote(tx, ownerId, id, expectedVersion, input), { behavior: "immediate" });
    },

    async updateMemoryNoteChecked(ownerId, id, expectedVersion, input, guard) {
      return db.transaction((tx) => guard(visibleNotes(tx, ownerId)) ?? updateNote(tx, ownerId, id, expectedVersion, input), { behavior: "immediate" });
    },

    async deleteMemoryNote(ownerId, id, expectedVersion) {
      return db.transaction((tx) => {
        const row = tx.select({ version: memoryNotes.version }).from(memoryNotes).where(ownerNote(ownerId, id)).get();
        if (!row) return "not_found";
        if (row.version !== expectedVersion) return "stale_version";
        const result = tx.delete(memoryNotes).where(and(ownerNote(ownerId, id), eq(memoryNotes.version, expectedVersion))).run();
        if (result.changes === 0) return "stale_version";
        // Скрытые оригиналы слияния уходят вместе с результатом.
        tx.delete(memoryNotes).where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.mergedInto, id))).run();
        return "ok";
      }, { behavior: "immediate" });
    },

    async clearMemoryNotes(ownerId) {
      return db.transaction((tx) => {
        const deleted = tx.delete(memoryNotes).where(eq(memoryNotes.ownerId, ownerId)).returning({ mergedInto: memoryNotes.mergedInto }).all();
        tx.delete(memoryOptimizationRuns).where(eq(memoryOptimizationRuns.ownerId, ownerId)).run();
        // Считаются записи, которые человек видел; скрытые оригиналы — служебные.
        return deleted.filter((row) => row.mergedInto === null).length;
      }, { behavior: "immediate" });
    },

    // Взятие запуска — одна транзакция: проверка правил и вставка не разрываются (SQLite пишет по одному).
    async claimMemoryOptimizationRun(ownerId, rules, now) {
      const nowMs = Date.parse(now);
      return db.transaction((tx) => {
        const runs = tx.select().from(memoryOptimizationRuns).where(eq(memoryOptimizationRuns.ownerId, ownerId)).all();
        for (const run of runs) {
          const leaseEnd = run.startedAt + rules.leaseMs;
          if (run.status !== "running" || nowMs < leaseEnd) continue;
          tx.update(memoryOptimizationRuns).set({ status: "failed", error: "lease_expired", finishedAt: leaseEnd }).where(eq(memoryOptimizationRuns.id, run.id)).run();
          Object.assign(run, { status: "failed", finishedAt: leaseEnd });
        }
        const blocked = isOptimizationBlocked(
          runs.map((run) => ({ status: run.status, startedAtMs: run.startedAt, endedAtMs: run.finishedAt })),
          rules,
          nowMs,
        );
        if (blocked) return null;
        const row = { id: crypto.randomUUID(), ownerId, startedAt: nowMs, finishedAt: null, status: "running" as const, groups: [], error: null, usageRecordId: null };
        tx.insert(memoryOptimizationRuns).values(row).run();
        return toOptimizationRun(row);
      }, { behavior: "immediate" });
    },

    async finishMemoryOptimizationRun(ownerId, runId, outcome) {
      const result = db
        .update(memoryOptimizationRuns)
        .set({ status: outcome.status, finishedAt: Date.parse(outcome.finishedAt), error: outcome.error ?? null, usageRecordId: outcome.usageRecordId ?? null })
        .where(and(eq(memoryOptimizationRuns.id, runId), eq(memoryOptimizationRuns.ownerId, ownerId), eq(memoryOptimizationRuns.status, "running")))
        .run();
      return result.changes > 0 ? "ok" : "not_found";
    },

    // Слияние — одна транзакция: любая неудача (в том числе негодный результат) откатывает всё.
    async applyMemoryMerge(ownerId, merge) {
      const { merges } = merge;
      if (merges.length === 0) throw new TypeError("Слияние без склеек");
      const seen = new Set<string>();
      for (const { originals } of merges) {
        if (originals.length === 0) throw new TypeError("Склейка без оригиналов");
        for (const { id } of originals) {
          if (seen.has(id)) throw new TypeError(`Запись ${id} названа в двух склейках`);
          seen.add(id);
        }
      }
      return db.transaction((tx) => {
        const run = tx.select().from(memoryOptimizationRuns).where(and(eq(memoryOptimizationRuns.id, merge.runId), eq(memoryOptimizationRuns.ownerId, ownerId))).get();
        if (run?.status !== "running") return "run_not_active";
        // Сначала проверка всех оригиналов, потом запись: откат в транзакции только по исключению.
        for (const { originals } of merges) {
          for (const { id, version } of originals) {
            const original = tx.select({ version: memoryNotes.version }).from(memoryNotes).where(ownerNote(ownerId, id)).get();
            if (original?.version !== version) return "stale_version";
          }
        }
        const now = Date.now();
        const groups: MemoryMergeGroup[] = merges.map(({ result, originals }) => {
          const created = { id: crypto.randomUUID(), ownerId, categories: result.categories, content: result.content, version: 1, createdAt: now, updatedAt: now };
          tx.insert(memoryNotes).values(created).run();
          for (const { id } of originals) tx.update(memoryNotes).set({ mergedInto: created.id }).where(ownerNote(ownerId, id)).run();
          return { resultId: created.id, originalIds: originals.map(({ id }) => id), resultVersion: 1 };
        });
        const finished = { status: "applied" as const, finishedAt: Date.parse(merge.finishedAt), groups, usageRecordId: merge.usageRecordId ?? null };
        tx.update(memoryOptimizationRuns).set(finished).where(eq(memoryOptimizationRuns.id, run.id)).run();
        return toOptimizationRun({ ...run, ...finished });
      }, { behavior: "immediate" });
    },

    async revertMemoryMerge(ownerId, runId, guard) {
      return db.transaction((tx) => {
        const run = tx.select().from(memoryOptimizationRuns).where(and(eq(memoryOptimizationRuns.id, runId), eq(memoryOptimizationRuns.ownerId, ownerId))).get();
        if (run?.status !== "applied") return "not_found";
        for (const { resultId, originalIds, resultVersion } of run.groups) {
          const result = tx.select({ version: memoryNotes.version }).from(memoryNotes).where(ownerNote(ownerId, resultId)).get();
          if (result?.version !== resultVersion) return "conflict";
          const hidden = tx
            .select({ id: memoryNotes.id })
            .from(memoryNotes)
            .where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.mergedInto, resultId), inArray(memoryNotes.id, originalIds)))
            .all();
          if (hidden.length !== originalIds.length) return "conflict";
        }
        if (guard) {
          const resultIds = run.groups.map(({ resultId }) => resultId);
          const remaining = visibleNotes(tx, ownerId).filter((note) => !resultIds.includes(note.id));
          const restored = tx
            .select()
            .from(memoryNotes)
            .where(and(eq(memoryNotes.ownerId, ownerId), inArray(memoryNotes.mergedInto, resultIds)))
            .orderBy(desc(memoryNotes.updatedAt), desc(memoryNotes.createdAt), desc(memoryNotes.id))
            .all()
            .map(toMemoryNote);
          const error = guard(remaining, restored);
          if (error) return revertRefusal(error);
        }
        for (const { resultId } of run.groups) {
          tx.update(memoryNotes).set({ mergedInto: null }).where(and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.mergedInto, resultId))).run();
          tx.delete(memoryNotes).where(ownerNote(ownerId, resultId)).run();
        }
        tx.update(memoryOptimizationRuns).set({ status: "reverted" }).where(eq(memoryOptimizationRuns.id, run.id)).run();
        return "ok";
      }, { behavior: "immediate" });
    },

    async listMemoryOptimizationRuns(ownerId, filter) {
      const rows = db
        .select()
        .from(memoryOptimizationRuns)
        .where(and(eq(memoryOptimizationRuns.ownerId, ownerId), ...(filter?.status ? [inArray(memoryOptimizationRuns.status, filter.status)] : [])))
        .orderBy(desc(memoryOptimizationRuns.startedAt), sql`rowid desc`)
        .limit(filter?.limit ?? -1)
        .all();
      return rows.map(toOptimizationRun);
    },

    async listMergedMemoryNotes(ownerId) {
      const rows = db
        .select()
        .from(memoryNotes)
        .where(and(eq(memoryNotes.ownerId, ownerId), isNotNull(memoryNotes.mergedInto)))
        .orderBy(desc(memoryNotes.updatedAt), desc(memoryNotes.createdAt), desc(memoryNotes.id))
        .all();
      return rows.map((row): MergedMemoryNote => ({ ...toMemoryNote(row), mergedInto: row.mergedInto! }));
    },

    close() {
      sqlite.close();
    },
  };
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

/**
 * Фильтр `listChats` по данным чата: на каждый ключ — проверка через `json_each`: ключ как есть (точки и кавычки не
 * путаются с путём), тип значения важен (`true` не равно `1`, `"1"` не равно `1`).
 */
function dataConditions(filter: ChatDataFilter | undefined) {
  return Object.entries(filter ?? {}).map(([key, value]) => {
    const typed =
      value === null
        ? sql`type = 'null'`
        : typeof value === "string"
          ? sql`type = 'text' and value = ${value}`
          : typeof value === "boolean"
            ? sql`type = ${value ? "true" : "false"}`
            : sql`type in ('integer', 'real') and value = ${value}`;
    return sql`exists (select 1 from json_each(${chats.subjectData}) where key = ${key} and ${typed})`;
  });
}

/** Строка сообщения в запись ядра: без служебных колонок; пустое состояние хука итога — отсутствие поля. */
function toMessage(row: typeof messages.$inferSelect): StoredMessage {
  const { seq: _seq, aliveAt: _aliveAt, afterTurn, ...message } = row;
  return { ...message, ...(afterTurn !== null && { afterTurn }) };
}

/** Видимая запись памяти этого человека: чужая по тому же id и скрытый оригинал слияния не находятся. */
function ownerNote(ownerId: string, id: string) {
  return and(eq(memoryNotes.ownerId, ownerId), eq(memoryNotes.id, id), isNull(memoryNotes.mergedInto));
}

/** Строка запуска в запись ядра: владельца наружу не отдаём, время — в ISO 8601. */
function toOptimizationRun(row: typeof memoryOptimizationRuns.$inferSelect): MemoryOptimizationRun {
  return {
    id: row.id,
    startedAt: new Date(row.startedAt).toISOString(),
    finishedAt: row.finishedAt === null ? null : new Date(row.finishedAt).toISOString(),
    status: row.status,
    groups: row.groups.map((group) => ({ ...group, originalIds: [...group.originalIds] })),
    error: row.error,
    usageRecordId: row.usageRecordId,
  };
}

/** Строка памяти в запись ядра: владельца наружу не отдаём, время — в ISO 8601. */
function toMemoryNote(row: typeof memoryNotes.$inferSelect): MemoryNote {
  return {
    id: row.id,
    categories: [...row.categories],
    content: row.content,
    version: row.version,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Нарушен уникальный индекс (владелец, ключ объекта). */
function isSubjectConflict(error: unknown): boolean {
  const { code, message, cause } = (error ?? {}) as { code?: unknown; message?: unknown; cause?: { code?: unknown; message?: unknown } };
  return (
    [code, cause?.code].includes("SQLITE_CONSTRAINT_UNIQUE") &&
    [message, cause?.message].some((text) => typeof text === "string" && text.includes("chats.subject_key"))
  );
}

function isPrimaryKeyConflict(error: unknown): boolean {
  const { code, cause } = (error ?? {}) as { code?: unknown; cause?: { code?: unknown } };
  return [code, cause?.code].includes("SQLITE_CONSTRAINT_PRIMARYKEY");
}
