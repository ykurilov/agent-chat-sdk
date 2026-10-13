import { afterEach, describe, expect, it } from "vitest";
import type { JournalOptions } from "../../src/journal/journal";
import { BLOB_LIMIT_BYTES } from "../../src/journal/journal-blobs";
import type { JournalCallDetails, JournalEntry, SandboxJournal } from "../../src/types";
import { modelCallEvent, textMessage, toolCallEvent } from "./support/events";

export interface JournalHarness {
  journal: SandboxJournal;
  /** Сколько кусков лежит в базе (для проверки дедупликации). */
  blobCount(): Promise<number>;
}

const SECRET = "sk-or-v1-0123456789abcdef";
const day = (offset: number) => new Date(Date.UTC(2026, 8, 1 + offset));

/**
 * Проверки договора журнала (по образцу `describeChatStorageContract`).
 * Каждый адаптер подключает их: `describeSandboxJournalContract(() => createMyJournal())`.
 */
export function describeSandboxJournalContract(create: (options: JournalOptions) => Promise<JournalHarness>): void {
  const opened: SandboxJournal[] = [];
  afterEach(async () => {
    for (const journal of opened.splice(0)) await journal.close().catch(() => {});
  });
  async function open(options: JournalOptions = { env: {} }): Promise<JournalHarness> {
    const harness = await create({ env: {}, ...options });
    opened.push(harness.journal);
    return harness;
  }
  async function write(journal: SandboxJournal, ...events: Array<ReturnType<typeof modelCallEvent> | ReturnType<typeof toolCallEvent>>): Promise<void> {
    for (const event of events) {
      if ("callId" in event) journal.enqueueModelCall(event);
      else journal.enqueueToolCall(event);
    }
    await journal.flush();
  }
  function modelDetails(details: JournalCallDetails | null) {
    expect(details?.kind).toBe("model");
    return details as Extract<JournalCallDetails, { kind: "model" }>;
  }

  describe("запись и чтение", () => {
    it("обращение к модели читается со всеми кусками", async () => {
      const { journal } = await open();
      const event = modelCallEvent({
        request: {
          instructions: "Инструкция агента",
          messages: [textMessage("user", "вопрос"), textMessage("assistant", "ответ")],
          tools: [{ name: "search", description: "Поиск", inputSchema: { type: "object" } }],
          settings: { temperature: 0.3, maxOutputTokens: 1000 },
        },
        response: { text: "итог", reasoning: "мысли", toolCalls: [], finishReason: "stop" },
      });
      await write(journal, event);

      const [entry] = await journal.listForChat("chat-1");
      expect(entry).toMatchObject({ kind: "model", id: event.callId, chatId: "chat-1", ownerId: "sandbox:admin-1", messageId: "answer-1", purpose: "answer", attempt: 1, modelId: "test-model", providerId: "test-provider", costUsd: 0.001, status: "complete", durationMs: 900, firstChunkMs: 120, error: null, instructionsChanged: false });
      expect(entry?.kind === "model" && entry.usage).toEqual(event.usage);
      expect(entry?.kind === "model" && entry.startedAt).toEqual(event.startedAt);

      const details = modelDetails(await journal.getCall(event.callId));
      expect(details.instructions.content).toBe("Инструкция агента");
      expect(details.messages.map((blob) => blob.content)).toEqual(event.request.messages);
      expect(details.tools.content).toEqual(event.request.tools);
      expect(details.settings.content).toEqual(event.request.settings);
      expect(details.response.content).toEqual(event.response);
      expect(details.call.messageHashes).toEqual(details.messages.map((blob) => blob.hash));
    });

    it("сбойное и оборванное обращение хранит статус и ошибку", async () => {
      const { journal } = await open();
      await write(
        journal,
        modelCallEvent({ chatId: "c", status: "error", error: "502 Bad Gateway", usage: null, costUsd: null, firstChunkMs: null }),
        modelCallEvent({ chatId: "c", status: "aborted", startedAt: new Date("2026-10-01T10:00:05.000Z") }),
      );
      const entries = await journal.listForChat("c");
      expect(entries.map((entry) => entry.kind === "model" && entry.status)).toEqual(["error", "aborted"]);
      expect(entries[0]).toMatchObject({ error: "502 Bad Gateway", usage: null, costUsd: null, firstChunkMs: null });
    });

    it("повторы после сбоя — отдельные записи с номером попытки", async () => {
      const { journal } = await open();
      await write(
        journal,
        modelCallEvent({ chatId: "c", attempt: 1, status: "error", error: "сеть", startedAt: new Date("2026-10-01T10:00:00.000Z") }),
        modelCallEvent({ chatId: "c", attempt: 2, startedAt: new Date("2026-10-01T10:00:02.000Z") }),
      );
      const entries = await journal.listForChat("c");
      expect(entries.map((entry) => entry.kind === "model" && entry.attempt)).toEqual([1, 2]);
    });

    it("вызов инструмента: вход, выход, привязка к обращению, порядок «обращение → вызов → обращение»", async () => {
      const { journal } = await open();
      const first = modelCallEvent({
        chatId: "c",
        startedAt: day(0),
        response: { text: "", reasoning: "", toolCalls: [{ toolCallId: "tc-1", toolName: "search", input: { q: "а" } }], finishReason: "tool-calls" },
      });
      const tool = toolCallEvent({ chatId: "c", toolCallId: "tc-1", input: { q: "а" }, output: { found: 3 }, startedAt: new Date(day(0).getTime() + 1000) });
      const second = modelCallEvent({ chatId: "c", startedAt: new Date(day(0).getTime() + 2000) });
      // Инструмент мог закончиться раньше, чем дописалось обращение: порядок записи не важен.
      await write(journal, tool, second, first);

      const entries = await journal.listForChat("c");
      expect(entries.map((entry) => entry.kind)).toEqual(["model", "tool", "model"]);
      const toolEntry = entries[1];
      expect(toolEntry).toMatchObject({ kind: "tool", toolCallId: "tc-1", toolName: "search", modelCallId: first.callId, error: null, durationMs: 50 });
      const details = await journal.getCall((toolEntry as Extract<JournalEntry, { kind: "tool" }>).id);
      expect(details?.kind === "tool" && details.input.content).toEqual({ q: "а" });
      expect(details?.kind === "tool" && details.output?.content).toEqual({ found: 3 });
    });

    it("вызов инструмента с ошибкой: выхода нет, ошибка записана; чужой toolCallId — modelCallId null", async () => {
      const { journal } = await open();
      await write(journal, toolCallEvent({ chatId: "c", toolCallId: "lonely", output: undefined, error: "таймаут" }));
      const [entry] = await journal.listForChat("c");
      expect(entry).toMatchObject({ kind: "tool", error: "таймаут", outputHash: null, modelCallId: null });
      const details = await journal.getCall((entry as Extract<JournalEntry, { kind: "tool" }>).id);
      expect(details?.kind === "tool" && details.output).toBeNull();
    });

    it("listForChat: по ходу и по чату; чужой чат не виден; неизвестный вызов — null", async () => {
      const { journal } = await open();
      await write(
        journal,
        modelCallEvent({ chatId: "a", messageId: "m1", startedAt: day(0) }),
        modelCallEvent({ chatId: "a", messageId: "m2", startedAt: day(1) }),
        toolCallEvent({ chatId: "a", messageId: "m2", startedAt: day(1) }),
        modelCallEvent({ chatId: "b", messageId: "m1", startedAt: day(2) }),
      );
      expect(await journal.listForChat("a")).toHaveLength(3);
      expect(await journal.listForChat("a", { messageId: "m2" })).toHaveLength(2);
      expect(await journal.listForChat("a", { messageId: "m1" })).toHaveLength(1);
      expect(await journal.listForChat("b")).toHaveLength(1);
      expect(await journal.listForChat("nobody")).toEqual([]);
      expect(await journal.getCall("no-such-call")).toBeNull();
    });

    it("instructionsChanged: инструкция отличается от предыдущего обращения того же назначения", async () => {
      const { journal } = await open();
      const base = modelCallEvent().request;
      await write(
        journal,
        modelCallEvent({ chatId: "c", startedAt: day(0), request: { ...base, instructions: "Первая" } }),
        modelCallEvent({ chatId: "c", startedAt: day(1), request: { ...base, instructions: "Первая" } }),
        modelCallEvent({ chatId: "c", startedAt: day(2), request: { ...base, instructions: "Правленая" } }),
        modelCallEvent({ chatId: "c", startedAt: day(3), purpose: "memory", request: { ...base, instructions: "Память" } }),
        modelCallEvent({ chatId: "c", startedAt: day(4), request: { ...base, instructions: "Правленая" } }),
      );
      const flags = (await journal.listForChat("c")).map((entry) => entry.kind === "model" && entry.instructionsChanged);
      expect(flags).toEqual([false, false, true, false, false]);
      // Ход, выбранный по messageId, тоже сравнивается с обращением вне хода.
      await write(journal, modelCallEvent({ chatId: "c", messageId: "later", startedAt: day(5), request: { ...base, instructions: "Ещё одна" } }));
      const [later] = await journal.listForChat("c", { messageId: "later" });
      expect(later?.kind === "model" && later.instructionsChanged).toBe(true);
    });
  });

  describe("дедупликация и объём", () => {
    it("второе обращение хода добавляет только новые сообщения (SC-007)", async () => {
      const { journal, blobCount } = await open();
      const request = modelCallEvent().request;
      const history = [textMessage("user", "один"), textMessage("assistant", "два"), textMessage("user", "три")];
      await write(journal, modelCallEvent({ chatId: "c", request: { ...request, messages: history } }));
      const before = await blobCount();
      expect(before).toBe(1 + 3 + 1 + 1 + 1); // инструкция, три сообщения, инструменты, настройки, ответ
      await write(
        journal,
        modelCallEvent({
          chatId: "c",
          startedAt: day(1),
          request: { ...request, messages: [...history, textMessage("assistant", "четыре"), textMessage("user", "пять")] },
          response: { text: "другой ответ", reasoning: "", toolCalls: [], finishReason: "stop" },
        }),
      );
      expect((await blobCount()) - before).toBe(2 + 1); // два новых сообщения и новый ответ
    });

    it("50 обращений длинного чата с картинкой: журнал растёт по новым сообщениям, а не по истории целиком", async () => {
      const { journal, blobCount } = await open();
      const image = new Uint8Array(1_200_000).fill(7);
      const request = modelCallEvent().request;
      const history: unknown[] = [{ role: "user", content: [{ type: "file", mediaType: "image/png", data: image }, { type: "text", text: "что на картинке?" }] }];
      let naiveMessages = 0;
      for (let index = 0; index < 50; index += 1) {
        naiveMessages += history.length;
        journal.enqueueModelCall(
          modelCallEvent({
            chatId: "long",
            startedAt: new Date(day(0).getTime() + index * 1000),
            request: { ...request, messages: [...history] },
            response: { text: `ответ ${index}`, reasoning: "", toolCalls: [], finishReason: "stop" },
          }),
        );
        history.push(textMessage("assistant", `ответ ${index}`), textMessage("user", `вопрос ${index}`));
      }
      await journal.flush();
      expect(naiveMessages).toBeGreaterThanOrEqual(2500);
      const total = await blobCount();
      // На каждое обращение: два новых сообщения и ответ; плюс общие инструкция, инструменты, настройки.
      expect(total).toBeLessThanOrEqual(1 + 1 + 1 + 1 + 50 * 3 + 1);
      const entries = await journal.listForChat("long");
      const last = modelDetails(await journal.getCall(entries[49]!.id));
      expect(last.messages).toHaveLength(99);
      const picture = (last.messages[0]!.content as { content: Array<{ data?: string }> }).content[0];
      expect(picture?.data).toBe("картинка, image/png, 1,1 МБ");
    });

    it("огромное сообщение обрезается до предела с пометкой", async () => {
      const { journal } = await open();
      const huge = textMessage("user", "ы".repeat(400_000));
      const event = modelCallEvent({ chatId: "c", request: { ...modelCallEvent().request, messages: [huge] } });
      await write(journal, event);
      const details = modelDetails(await journal.getCall(event.callId));
      expect(details.messages[0]?.truncated).toBe(true);
      expect(details.messages[0]?.bytes).toBeGreaterThan(BLOB_LIMIT_BYTES);
    });
  });

  describe("секреты (SC-006)", () => {
    it("ключа из окружения и значений Authorization-полей нет ни в одном куске", async () => {
      const { journal } = await open({ env: { OPENROUTER_API_KEY: SECRET, SHORT: "abc" } });
      const event = modelCallEvent({
        chatId: "c",
        request: {
          instructions: `Служебная заметка: ключ ${SECRET}`,
          messages: [textMessage("user", `мой ключ ${SECRET}`), { role: "tool", content: [{ type: "tool-result", output: JSON.stringify({ echoed: SECRET }) }] }],
          tools: [{ name: "http", description: `Ключ ${SECRET}`, inputSchema: {} }],
          settings: { providerOptions: { openrouter: { headers: { Authorization: "Bearer bearer-token-12345" } } } },
        },
        response: { text: `Ваш ключ ${SECRET}, токен bearer-token-12345`, reasoning: SECRET, toolCalls: [{ toolCallId: "t", toolName: "http", input: { key: SECRET } }], finishReason: "tool-calls" },
      });
      const tool = toolCallEvent({ chatId: "c", toolCallId: "t", input: { auth: SECRET }, output: `ответ ${SECRET}`, error: `сбой с ${SECRET}` });
      await write(journal, event, tool);

      const details = modelDetails(await journal.getCall(event.callId));
      const toolEntry = (await journal.listForChat("c")).find((entry) => entry.kind === "tool")!;
      const toolDetails = await journal.getCall(toolEntry.id);
      const everything = JSON.stringify([details, toolDetails, toolEntry]);
      expect(everything).not.toContain(SECRET);
      expect(everything).not.toContain("bearer-token-12345");
      expect(everything).toContain("[скрыто]");
      // Сам запрос не испорчен: остальной текст на месте.
      expect(JSON.stringify(details.instructions.content)).toContain("Служебная заметка");
      // Через getBlob — то же.
      for (const hash of [details.call.instructionsHash, ...details.call.messageHashes, details.call.toolsHash, details.call.settingsHash, details.call.responseHash]) {
        const blob = await journal.getBlob(hash, "sandbox:admin-1");
        expect(JSON.stringify(blob)).not.toContain(SECRET);
        expect(JSON.stringify(blob)).not.toContain("bearer-token-12345");
      }
    });
  });

  describe("удаление чата во время хода", () => {
    it("события удалённого чата, пришедшие после deleteChat, не пишутся", async () => {
      const { journal, blobCount } = await open();
      await write(journal, modelCallEvent({ chatId: "gone" }), modelCallEvent({ chatId: "stays" }));
      await journal.deleteChat("gone");
      journal.enqueueModelCall(modelCallEvent({ chatId: "gone" }));
      journal.enqueueToolCall(toolCallEvent({ chatId: "gone" }));
      await journal.flush();
      expect(await journal.listForChat("gone")).toEqual([]);
      expect(await journal.listForChat("stays")).toHaveLength(1);
      expect(await blobCount()).toBeGreaterThan(0);
    });
  });

  describe("куски по владельцу", () => {
    it("getBlob отдаёт кусок только владельцу записи", async () => {
      const { journal } = await open();
      const event = modelCallEvent({ chatId: "c", ownerId: "sandbox:alice" });
      await write(journal, event);
      const hash = modelDetails(await journal.getCall(event.callId)).call.instructionsHash;
      expect((await journal.getBlob(hash, "sandbox:alice"))?.content).toBe("Ты помощник. Отвечай коротко.");
      expect(await journal.getBlob(hash, "sandbox:bob")).toBeNull();
      expect(await journal.getBlob("0".repeat(64), "sandbox:alice")).toBeNull();
    });

    it("общий кусок виден обоим владельцам, у которых он есть; после удаления чата одного — только второму", async () => {
      const { journal } = await open();
      const alice = modelCallEvent({ chatId: "ca", ownerId: "sandbox:alice" });
      const bob = modelCallEvent({ chatId: "cb", ownerId: "sandbox:bob" });
      await write(journal, alice, bob);
      const hash = modelDetails(await journal.getCall(alice.callId)).call.instructionsHash;
      expect(await journal.getBlob(hash, "sandbox:alice")).not.toBeNull();
      expect(await journal.getBlob(hash, "sandbox:bob")).not.toBeNull();
      await journal.deleteChat("ca");
      expect(await journal.getBlob(hash, "sandbox:alice")).toBeNull();
      expect((await journal.getBlob(hash, "sandbox:bob"))?.content).toBe("Ты помощник. Отвечай коротко.");
    });
  });

  describe("настройки и правки ответов", () => {
    it("настройки чата: записать, прочитать, заменить, вернуть боевую (null)", async () => {
      const { journal } = await open();
      expect(await journal.getSettings("c")).toBeNull();
      await journal.setSettings({ chatId: "c", instructions: "Своя инструкция", updatedBy: "admin-1", updatedAt: day(0) });
      expect(await journal.getSettings("c")).toEqual({ chatId: "c", instructions: "Своя инструкция", updatedBy: "admin-1", updatedAt: day(0) });
      await journal.setSettings({ chatId: "c", instructions: "Другая", updatedBy: "admin-2", updatedAt: day(1) });
      expect((await journal.getSettings("c"))?.instructions).toBe("Другая");
      await journal.setSettings({ chatId: "c", instructions: null, updatedBy: "admin-2", updatedAt: day(2) });
      expect(await journal.getSettings("c")).toEqual({ chatId: "c", instructions: null, updatedBy: "admin-2", updatedAt: day(2) });
      expect(await journal.getSettings("other")).toBeNull();
    });

    it("правки ответов: отметки с списком editedToolCallIds, по чату, в порядке времени", async () => {
      const { journal } = await open();
      await journal.markAnswerEdited({ messageId: "new-2", sourceMessageId: "old-2", chatId: "c", textEdited: false, editedToolCallIds: ["t1", "t2"], editedBy: "admin-1", editedAt: day(1) });
      await journal.markAnswerEdited({ messageId: "new-1", sourceMessageId: "old-1", chatId: "c", textEdited: true, editedToolCallIds: [], editedBy: "admin-1", editedAt: day(0) });
      await journal.markAnswerEdited({ messageId: "x", sourceMessageId: "y", chatId: "other", textEdited: true, editedToolCallIds: [], editedBy: "a", editedAt: day(0) });
      const edits = await journal.listEditedAnswers("c");
      expect(edits.map((edit) => edit.messageId)).toEqual(["new-1", "new-2"]);
      expect(edits[1]).toEqual({ messageId: "new-2", sourceMessageId: "old-2", chatId: "c", textEdited: false, editedToolCallIds: ["t1", "t2"], editedBy: "admin-1", editedAt: day(1) });
      expect(await journal.listEditedAnswers("nobody")).toEqual([]);
    });
  });

  describe("удаление", () => {
    it("deleteChat убирает записи, настройки, правки и куски без ссылок; чужие чаты и общие куски остаются", async () => {
      const { journal, blobCount } = await open();
      const shared = textMessage("user", "общий вопрос");
      const mine = modelCallEvent({ chatId: "mine", request: { ...modelCallEvent().request, messages: [shared, textMessage("user", "только мой")] } });
      const other = modelCallEvent({ chatId: "other", request: { ...modelCallEvent().request, messages: [shared] }, response: { text: "иной", reasoning: "", toolCalls: [], finishReason: "stop" } });
      await write(journal, mine, toolCallEvent({ chatId: "mine" }), other);
      await journal.setSettings({ chatId: "mine", instructions: "x", updatedBy: "a", updatedAt: day(0) });
      await journal.markAnswerEdited({ messageId: "n", sourceMessageId: "o", chatId: "mine", textEdited: true, editedToolCallIds: [], editedBy: "a", editedAt: day(0) });

      await journal.deleteChat("mine");
      expect(await journal.listForChat("mine")).toEqual([]);
      expect(await journal.getCall(mine.callId)).toBeNull();
      expect(await journal.getSettings("mine")).toBeNull();
      expect(await journal.listEditedAnswers("mine")).toEqual([]);
      // У «other»: инструкция, один общий вопрос, инструменты, настройки, ответ — других кусков в базе нет.
      expect(await blobCount()).toBe(5);
      const details = modelDetails(await journal.getCall(other.callId));
      expect(details.messages[0]?.content).toEqual(shared);
    });

    it("deleteOlderThan удаляет обращения и вызовы старше даты и куски без ссылок", async () => {
      const { journal, blobCount } = await open();
      const base = modelCallEvent().request;
      const old = modelCallEvent({ chatId: "c", startedAt: day(0), request: { ...base, messages: [textMessage("user", "старое")] }, response: { text: "старый", reasoning: "", toolCalls: [], finishReason: "stop" } });
      const fresh = modelCallEvent({ chatId: "c", startedAt: day(40), request: { ...base, messages: [textMessage("user", "старое"), textMessage("user", "свежее")] }, response: { text: "свежий", reasoning: "", toolCalls: [], finishReason: "stop" } });
      const oldTool = toolCallEvent({ chatId: "c", startedAt: day(0), input: { q: "старый" }, output: "o1" });
      const freshTool = toolCallEvent({ chatId: "c", startedAt: day(40), input: { q: "свежий" }, output: "o2" });
      await write(journal, old, oldTool, fresh, freshTool);

      const removed = await journal.deleteOlderThan(day(30));
      expect(removed).toBe(2);
      const left = await journal.listForChat("c");
      expect(left.map((entry) => entry.kind)).toEqual(["model", "tool"]);
      expect(await journal.getCall(old.callId)).toBeNull();
      // Общее сообщение «старое» и инструкция живут: на них ссылается свежее обращение. Пропали: ответ «старый», вход и выход старого вызова.
      const details = modelDetails(await journal.getCall(fresh.callId));
      expect(details.messages.map((blob) => JSON.stringify(blob.content))).toEqual([JSON.stringify(textMessage("user", "старое")), JSON.stringify(textMessage("user", "свежее"))]);
      // инструкция, 2 сообщения, инструменты, настройки, ответ + вход и выход вызова
      expect(await blobCount()).toBe(1 + 2 + 1 + 1 + 1 + 2);
      expect(await journal.deleteOlderThan(day(30))).toBe(0);
      expect(await journal.deleteOlderThan(day(100))).toBe(2);
      expect(await blobCount()).toBe(0);
    });
  });
}
