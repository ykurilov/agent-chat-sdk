import { afterEach, describe, expect, it, vi } from "vitest";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { searchEarlierConversation } from "../src/search-earlier-conversation";
import { assistantMessage, chatId, compactionThrough, seedChat, userMessage } from "./support";

const storages: Array<{ close(): void }> = [];
afterEach(() => {
  for (const storage of storages.splice(0)) storage.close();
});

const backends: Array<[string, () => ChatStorage]> = [
  ["память", () => createInMemoryChatStorage()],
  [
    "SQLite",
    () => {
      const storage = createSqliteChatStorage({ filePath: ":memory:" });
      storages.push(storage);
      return storage;
    },
  ],
];

describe.each(backends)("поиск по старой переписке — %s", (_name, open) => {
  const search = (storage: ChatStorage, query: string, options: { maxResults?: number; snippetChars?: number } = {}, chat = chatId) =>
    searchEarlierConversation({ storage, chatId: chat, query, maxResults: 5, snippetChars: 200, ...options });

  async function compactedChat(): Promise<ChatStorage> {
    const storage = open();
    await seedChat(storage, [
      ["Заведи чат про переезд. Адрес склада: Тверская, 15", "Записал адрес склада."],
      ["Какой пароль от роутера?", "Пароль от роутера — kuku-2026, храни его."],
      ["А что с бюджетом?", "Бюджет на переезд — 120 тысяч."],
      ["Ну как там у нас дела?", "Всё идёт по плану."],
    ]);
    await storage.insertCompaction(compactionThrough("a3"));
    return storage;
  }

  it("слова в скобках: в ответе голосового хода это теги голоса и их не ищут, в текстовом — обычный текст", async () => {
    const storage = open();
    await storage.createChat({ id: chatId, ownerId: "anna", modelId: "m", providerId: "p" });
    const voiceQuestion = { ...userMessage("u1", "Что в докладе?", 0), parts: [{ type: "text" as const, text: "Что в докладе?" }, { type: "data-voice-mode" as const, data: true }] };
    await storage.insertMessage(voiceQuestion);
    await storage.insertMessage(assistantMessage("a1", "u1", [{ type: "text", text: "[laughs] Вот [whispers] итог доклада." }], 1));
    await storage.insertMessage(userMessage("u2", "А в тексте?", 2, "a1"));
    await storage.insertMessage(assistantMessage("a2", "u2", [{ type: "text", text: "Смотри [laughs] и [docs] там." }], 3));
    await storage.insertMessage(userMessage("u3", "Ещё", 4, "a2"));
    await storage.insertMessage(assistantMessage("a3", "u3", [{ type: "text", text: "Ещё" }], 5));
    await storage.insertMessage(userMessage("u4", "Дальше", 6, "a3"));
    await storage.insertMessage(assistantMessage("a4", "u4", [{ type: "text", text: "Дальше" }], 7));
    await storage.insertCompaction(compactionThrough("a3"));

    const tags = await search(storage, "whispers");
    expect(tags.status).toBe("none");
    const voice = await search(storage, "итог доклада");
    expect(voice.status === "found" && voice.findings[0]?.snippet).toBe("Вот итог доклада.");
    const text = await search(storage, "docs");
    expect(text.status === "found" && text.findings[0]?.snippet).toBe("Смотри [laughs] и [docs] там.");
  });

  it("склейка голосовых фраз: обрывок «Так.» отдельной репликой человека не всплывает — даже если когда-то был выбран веткой", async () => {
    const storage = open();
    await storage.createChat({ id: chatId, ownerId: "anna", modelId: "m", providerId: "p" });
    const voice = (id: string, text: string, minute: number, replaces?: string) => ({
      ...userMessage(id, text, minute),
      parts: [{ type: "text" as const, text }, { type: "data-voice-mode" as const, data: replaces === undefined ? true : { replaces } }],
    });
    await storage.insertMessage(voice("u0", "Так, сверчок.", 0));
    await storage.insertMessage(assistantMessage("a0", "u0", [], 1));
    await storage.insertMessage(voice("u1", "Так, сверчок. Расскажи про бюджет.", 2, "u0"));
    await storage.insertMessage(assistantMessage("a1", "u1", [{ type: "text", text: "Бюджет — 120 тысяч." }], 3));
    await storage.insertMessage(userMessage("u2", "Ещё", 4, "a1"));
    await storage.insertMessage(assistantMessage("a2", "u2", [{ type: "text", text: "Ещё" }], 5));
    await storage.insertMessage(userMessage("u3", "Дальше", 6, "a2"));
    await storage.insertMessage(assistantMessage("a3", "u3", [{ type: "text", text: "Дальше" }], 7));
    await storage.insertCompaction(compactionThrough("a2"));
    await storage.insertBranchSelection({ id: "old-pick", chatId, messageId: "u0", selectedAt: "2099-01-01T00:00:00.000Z" });

    const result = await search(storage, "сверчок");

    expect(result.status === "found" && result.findings.map((finding) => finding.messageId)).toEqual(["u1"]);
  });

  it("история не сжималась — так и говорит, ничего не ищет", async () => {
    const storage = open();
    await seedChat(storage, [["Пароль от роутера kuku-2026", "Ок"], ["ещё", "ещё"]]);
    const result = await search(storage, "роутера");
    expect(result.status).toBe("not-compacted");
  });

  it("находит в сжатой части: сообщение, кто сказал и время", async () => {
    const result = await search(await compactedChat(), "пароль kuku-2026");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.findings[0]).toMatchObject({ messageId: "a2", role: "assistant" });
    expect(result.findings[0]!.snippet).toContain("kuku-2026");
    expect(result.findings[0]!.createdAt).toBe("2026-03-01T10:03:00.000Z");
  });

  it("текст каждого сообщения нормализуется один раз за вызов, сколько бы слов ни было в запросе", async () => {
    const storage = open();
    await seedChat(storage, [
      ["Уникальныймаркер адрес склада Тверская пароль роутера бюджет", "Записал."],
      ["Ещё вопрос", "Ещё ответ"],
    ]);
    await storage.insertCompaction(compactionThrough("a1"));
    const toLowerCase = vi.spyOn(String.prototype, "toLowerCase");
    try {
      await search(storage, "склада Тверская пароль роутера бюджет адрес");
      const marked = toLowerCase.mock.contexts.filter((text) => String(text).includes("Уникальныймаркер"));
      expect(marked).toHaveLength(1);
    } finally {
      toLowerCase.mockRestore();
    }
  });

  it("ищет и в вопросах человека", async () => {
    const result = await search(await compactedChat(), "склада");
    expect(result.status === "found" && result.findings.map((finding) => finding.messageId)).toEqual(["u1", "a1"]);
  });

  it("то, что после сжатого куска, не показывает: оно и так перед глазами", async () => {
    const result = await search(await compactedChat(), "плану");
    expect(result.status).toBe("none");
  });

  it("сначала те, где нашлось больше слов запроса; при равенстве — по порядку в чате", async () => {
    const result = await search(await compactedChat(), "бюджет переезд");
    expect(result.status === "found" && result.findings.map((finding) => finding.messageId)).toEqual(["a3", "u1", "u3"]);
  });

  it("не больше maxResults, но сообщает, сколько нашлось всего", async () => {
    const result = await search(await compactedChat(), "склада бюджет пароль", { maxResults: 2 });
    expect(result.status === "found" && result.findings).toHaveLength(2);
    expect(result.status === "found" && result.totalFound).toBeGreaterThan(2);
  });

  it("фрагмент короткий и вокруг найденного слова", async () => {
    const storage = open();
    await seedChat(storage, [
      ["вопрос", `${"начало ".repeat(100)}секретное слово ляпис${" конец".repeat(100)}`],
      ["ещё", "ещё"],
      ["и ещё", "и ещё"],
    ]);
    await storage.insertCompaction(compactionThrough("a2"));
    const result = await search(storage, "ляпис", { snippetChars: 100 });
    if (result.status !== "found") throw new Error("не нашлось");
    const { snippet } = result.findings[0]!;
    expect(snippet).toContain("ляпис");
    expect(snippet.length).toBeLessThan(130);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("находит в вызове инструмента, не читает рассуждения", async () => {
    const storage = open();
    await seedChat(storage, [
      [
        "найди курс",
        [
          { type: "reasoning", text: "втайне думаю про каракатицу", state: "done" },
          { type: "tool-web_search", toolCallId: "t1", state: "output-available", input: { query: "курс" }, output: "евро стоит 101 рубль" },
          { type: "text", text: "Нашёл." },
        ],
      ],
      ["ещё", "ещё"],
      ["и ещё", "и ещё"],
    ]);
    await storage.insertCompaction(compactionThrough("a2"));
    const found = await search(storage, "101 рубль");
    expect(found.status === "found" && found.findings[0]!.messageId).toBe("a1");
    expect((await search(storage, "каракатица")).status).toBe("none");
  });

  it("не находит — отвечает «ничего не найдено»; пустой запрос — «нет слов»", async () => {
    const storage = await compactedChat();
    expect((await search(storage, "самолёт")).status).toBe("none");
    expect((await search(storage, "  ,, ")).status).toBe("empty-query");
  });

  it("другая ветка не видна: правка вопроса оставляет старую ветку в базе, но её не ищем", async () => {
    const storage = open();
    await seedChat(storage, [
      ["Первый вопрос", "Ответ с фиолетовым словом"],
      ["Второй", "Ответ два"],
      ["Третий", "Ответ три"],
    ]);
    // Ветка-двойник от u1: новый вопрос вместо «Второй», и её продолжение.
    await storage.insertMessage(userMessage("u2b", "Второй, но иначе", 20, "a1"));
    await storage.insertMessage(assistantMessage("a2b", "u2b", [{ type: "text", text: "Ответ про зелёное" }], 21));
    await storage.insertMessage(userMessage("u3b", "Третий, иначе", 22, "a2b"));
    await storage.insertMessage(assistantMessage("a3b", "u3b", [{ type: "text", text: "Ответ три-б" }], 23));
    await storage.insertCompaction(compactionThrough("a2b"));
    expect((await search(storage, "зелёное")).status).toBe("found");
    expect((await search(storage, "два")).status).toBe("none");
  });

  it("переключение ветки переключает и поиск: после выбора прежней ветки ищет в ней", async () => {
    const storage = open();
    await seedChat(storage, [
      ["Первый вопрос", "Ответ с фиолетовым словом"],
      ["Второй", "Ответ два"],
      ["Третий", "Ответ три"],
    ]);
    await storage.insertMessage(userMessage("u2b", "Второй, но иначе", 20, "a1"));
    await storage.insertMessage(assistantMessage("a2b", "u2b", [{ type: "text", text: "Ответ про зелёное" }], 21));
    await storage.insertMessage(userMessage("u3b", "Третий, иначе", 22, "a2b"));
    await storage.insertMessage(assistantMessage("a3b", "u3b", [{ type: "text", text: "Ответ три-б" }], 23));
    await storage.insertCompaction(compactionThrough("a2"));
    await storage.insertCompaction(compactionThrough("a2b"));
    expect((await search(storage, "зелёное")).status).toBe("found");

    await storage.insertBranchSelection({ id: "s1", chatId, messageId: "u2", selectedAt: "2026-03-01T12:00:00.000Z" });
    expect((await search(storage, "зелёное")).status).toBe("none");
    expect((await search(storage, "два")).status).toBe("found");
  });

  it("чужой чат не виден", async () => {
    const storage = await compactedChat();
    await seedChat(storage, [["Тайна чата два: абракадабра", "ок"], ["ещё", "ещё"], ["и ещё", "и ещё"]], "chat-2", "x-");
    await storage.insertCompaction(compactionThrough("x-a2", "chat-2", "x-u1"));
    expect((await search(storage, "абракадабра")).status).toBe("none");
    expect((await search(storage, "абракадабра", {}, "chat-2")).status).toBe("found");
  });

  it("после повторного сжатия ищет во всём сжатом от начала чата", async () => {
    const storage = await compactedChat();
    await storage.insertCompaction(compactionThrough("a4"));
    // a4 — последнее сообщение: запись «до конца» не активна, остаётся прежняя (до a3).
    expect((await search(storage, "склада")).status).toBe("found");
    expect((await search(storage, "плану")).status).toBe("none");
    await storage.insertMessage(userMessage("u5", "Пятый вопрос", 30, "a4"));
    await storage.insertMessage(assistantMessage("a5", "u5", [{ type: "text", text: "Пятый ответ" }], 31));
    const found = await search(storage, "плану");
    expect(found.status).toBe("found");
  });
});
