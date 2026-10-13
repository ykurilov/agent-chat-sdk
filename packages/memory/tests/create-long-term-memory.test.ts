import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ContextBlock, ContextBlockEntry } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory, MemoryStorageNotSupportedError } from "../src/create-long-term-memory";
import { memoryInstructions } from "../src/instructions";

const input = (content: string, categories = ["О себе"]) => ({ categories, content });

function setup(options: Partial<Parameters<typeof createLongTermMemory>[0]> = {}) {
  const storage = createInMemoryChatStorage();
  return { storage, memory: createLongTermMemory({ storage, ...options }) };
}

/** Только показанные блоки: скрытые ради места (`{ key, hidden: true }`) без текста. */
const shownOnly = (entries: readonly ContextBlockEntry[]): ContextBlock[] => entries.filter((entry): entry is ContextBlock => !("hidden" in entry));

describe("createLongTermMemory: хранилище", () => {
  it("хранилище без методов памяти — ошибка со списком недостающих", () => {
    const storage: ChatStorage = { ...createInMemoryChatStorage() };
    delete storage.updateMemoryNote;
    delete storage.clearMemoryNotes;
    let caught: unknown;
    try {
      createLongTermMemory({ storage });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MemoryStorageNotSupportedError);
    const message = (caught as Error).message;
    expect(message).toContain("updateMemoryNote");
    expect(message).toContain("clearMemoryNotes");
    expect(message).not.toContain("listMemoryNotes");
    expect((caught as MemoryStorageNotSupportedError).missing).toEqual(["updateMemoryNote", "clearMemoryNotes"]);
  });

  it("полное хранилище — без ошибки", () => {
    expect(() => createLongTermMemory({ storage: createInMemoryChatStorage() })).not.toThrow();
  });
});

describe("createLongTermMemory: инструкция", () => {
  it("постоянный текст: одинаков у любых экземпляров и настроек", () => {
    expect(setup().memory.instructions).toBe(memoryInstructions);
    expect(setup({ maxNotes: 5, maxBlockChars: 100 }).memory.instructions).toBe(memoryInstructions);
  });

  it("говорит всё, что требует FR-013", () => {
    const text = memoryInstructions;
    expect(text).toMatch(/не инструкци/i);
    expect(text).toMatch(/прямому уточнению/i);
    expect(text).toMatch(/устойчив/i);
    expect(text).toMatch(/догадк/i);
    expect(text).toMatch(/секрет/i);
    expect(text).toMatch(/не двой|обнов/i);
    expect(text).toContain("manage_memory");
    expect(text).toContain("search");
    expect(text).toMatch(/забудь/i);
    expect(text).toMatch(/одним вызовом/i);
  });

  it("запрещает записывать прочитанное на страницах и в ответах инструментов: память не захватить через чужой текст", () => {
    expect(memoryInstructions).toMatch(/только то, что сказал сам человек/i);
    expect(memoryInstructions).toMatch(/страниц/i);
    expect(memoryInstructions).toMatch(/результат\S* (поиска|инструмент)/i);
  });
});

describe("createLongTermMemory: snapshot", () => {
  it("нет записей — null", async () => {
    expect(await setup().memory.snapshot({ userId: "anna", chatId: "c1" })).toBeNull();
  });

  it("блок с записями этого человека; чужих нет", async () => {
    const { memory } = setup();
    await memory.create("anna", input("Живёт на Бали"));
    await memory.create("boris", input("Живёт в Осло"));
    const block = await memory.snapshot({ userId: "anna", chatId: "c1" });
    expect(block).toContain("Живёт на Бали");
    expect(block).not.toContain("Осло");
  });

  it("не зависит от чата", async () => {
    const { memory } = setup();
    await memory.create("anna", input("Живёт на Бали"));
    expect(await memory.snapshot({ userId: "anna", chatId: "c1" })).toBe(await memory.snapshot({ userId: "anna", chatId: "c2" }));
  });

  it("бюджет блока — настройка", async () => {
    const { memory } = setup({ maxBlockChars: 400 });
    for (let index = 0; index < 5; index += 1) await memory.create("anna", input(`${index}${"я".repeat(150)}`));
    const block = (await memory.snapshot({ userId: "anna", chatId: "c1" }))!;
    expect(block.length).toBeLessThanOrEqual(400);
    expect(block).toContain("Ещё");
  });
});

describe("createLongTermMemory: blocks", () => {
  it("нет записей — null", async () => {
    expect(await setup().memory.blocks!({ userId: "anna", chatId: "c1" })).toBeNull();
  });

  it("шапка и по блоку на запись этого человека; чужих нет; от чата не зависит", async () => {
    const { memory } = setup();
    await memory.create("anna", input("Живёт на Бали"));
    await memory.create("anna", input("Любит чай"));
    await memory.create("boris", input("Живёт в Осло"));
    const blocks = shownOnly((await memory.blocks!({ userId: "anna", chatId: "c1" }))!);
    expect(blocks.map((block) => block.key)[0]).toBe("memory");
    expect(blocks).toHaveLength(3);
    expect(blocks.every((block) => block.private === true)).toBe(true);
    expect(JSON.stringify(blocks)).not.toContain("Осло");
    expect(shownOnly((await memory.blocks!({ userId: "anna", chatId: "c2" }))!)).toEqual(blocks);
  });

  it("правка одной записи меняет один блок", async () => {
    const { memory } = setup();
    const first = await memory.create("anna", input("Живёт на Бали"));
    await memory.create("anna", input("Любит чай"));
    const before = shownOnly((await memory.blocks!({ userId: "anna", chatId: "c1" }))!);
    if (!first.ok) throw new Error("не создана");
    await memory.update("anna", first.value.id, first.value.version, input("Живёт в Таиланде"));
    const after = shownOnly((await memory.blocks!({ userId: "anna", chatId: "c1" }))!);
    const was = new Map(before.map((block) => [block.key, block.text]));
    const changed = after.filter((block) => was.get(block.key) !== block.text).map((block) => block.key);
    expect(changed).toEqual([`memory:${first.value.id}`]);
  });

  it("бюджет блоков — maxBlockChars", async () => {
    const { memory } = setup({ maxBlockChars: 400 });
    for (let index = 0; index < 5; index += 1) await memory.create("anna", input(`${index}${"я".repeat(150)}`));
    const all = (await memory.blocks!({ userId: "anna", chatId: "c1" }))!;
    const blocks = shownOnly(all);
    expect(blocks.reduce((sum, block) => sum + block.text.length, 0)).toBeLessThanOrEqual(400);
    expect(blocks[0]!.text).toContain("Ещё");
    // Не влезшие — скрытыми блоками: запись есть, её не удалили.
    expect(all.length - blocks.length).toBeGreaterThan(0);
    expect(all.slice(blocks.length).every((block) => "hidden" in block && block.hidden)).toBe(true);
  });
});

describe("createLongTermMemory: операции для сервера и приложения", () => {
  it("create → list со счётчиками", async () => {
    const { memory } = setup({ maxNotes: 10 });
    const created = await memory.create("anna", input("Пишет на TypeScript"));
    expect(created).toMatchObject({ ok: true, value: { content: "Пишет на TypeScript", version: 1 } });
    await memory.create("anna", input("Использует pnpm"));
    const listed = await memory.list("anna");
    expect(listed.notes).toHaveLength(2);
    expect(listed.counts).toEqual({ total: 2, limit: 10, shown: 2 });
  });

  it("счётчик shown: сколько записей попадает в запрос", async () => {
    const { memory } = setup({ maxBlockChars: 500 });
    for (let index = 0; index < 6; index += 1) await memory.create("anna", input(`${index}${"я".repeat(120)}`));
    const { counts } = await memory.list("anna");
    expect(counts.total).toBe(6);
    expect(counts.shown).toBeGreaterThan(0);
    expect(counts.shown).toBeLessThan(6);
  });

  it("list чужой памяти пуст", async () => {
    const { memory } = setup();
    await memory.create("anna", input("Пишет на TypeScript"));
    expect((await memory.list("boris")).notes).toEqual([]);
  });

  it("create: форма, дубль и предел — ответом с кодом", async () => {
    const { memory } = setup({ maxNotes: 1 });
    expect(await memory.create("anna", { categories: [], content: "текст" })).toMatchObject({ ok: false, error: { kind: "invalid" } });
    await memory.create("anna", input("Первая"));
    expect(await memory.create("anna", input("первая"))).toMatchObject({ ok: false, error: { kind: "duplicate" } });
    expect(await memory.create("anna", input("Вторая"))).toMatchObject({ ok: false, error: { kind: "limit_reached" } });
  });

  it("update: версия — замок; правка меняет запись", async () => {
    const { memory } = setup();
    const created = await memory.create("anna", input("Пишет на JavaScript"));
    if (!created.ok) throw new Error("не создалось");
    const id = created.value.id;
    expect(await memory.update("anna", id, 1, input("Пишет на TypeScript"))).toMatchObject({ ok: true, value: { version: 2, content: "Пишет на TypeScript" } });
    expect(await memory.update("anna", id, 1, input("Опоздал"))).toMatchObject({ ok: false, error: { kind: "stale_version" } });
    expect(await memory.update("boris", id, 2, input("Чужое"))).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(await memory.update("anna", "нет", 1, input("Текст"))).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(await memory.update("anna", id, 2, { categories: ["а/б"], content: "x" })).toMatchObject({ ok: false, error: { kind: "invalid" } });
  });

  it("remove: версия — замок; чужая запись — not_found", async () => {
    const { memory } = setup();
    const created = await memory.create("anna", input("Пишет на JavaScript"));
    if (!created.ok) throw new Error("не создалось");
    const id = created.value.id;
    expect(await memory.remove("boris", id, 1)).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(await memory.remove("anna", id, 7)).toMatchObject({ ok: false, error: { kind: "stale_version" } });
    expect(await memory.remove("anna", id, 1)).toEqual({ ok: true, value: { deleted: id } });
    expect((await memory.list("anna")).notes).toEqual([]);
  });

  it("clear: стирает всё своё и возвращает число; чужое цело", async () => {
    const { memory } = setup();
    await memory.create("anna", input("Первая"));
    await memory.create("anna", input("Вторая"));
    await memory.create("boris", input("Борисова"));
    expect(await memory.clear("anna")).toBe(2);
    expect((await memory.list("anna")).notes).toEqual([]);
    expect((await memory.list("boris")).notes).toHaveLength(1);
  });

  it("createMany: пакет всё или ничего", async () => {
    const { memory } = setup();
    await memory.create("anna", input("Есть"));
    const result = await memory.createMany("anna", [input("Новая"), input("есть")]);
    expect(result).toMatchObject({ ok: false, error: { kind: "duplicate" } });
    expect((await memory.list("anna")).notes).toHaveLength(1);
  });
});
