import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../src/create-long-term-memory";

// Пределы и дубли держатся, когда действия приходят одновременно: агент и человек, два окна, два сервера.

const input = (content: string) => ({ categories: ["О себе"], content });

/** Хранилище, которому чужие («старые») приложения не дали методов записи с проверкой внутри операции. */
function storageWithoutChecks(): ChatStorage {
  const storage = createInMemoryChatStorage();
  delete storage.insertMemoryNotesChecked;
  delete storage.updateMemoryNoteChecked;
  return storage;
}

const variants: [string, () => ChatStorage][] = [
  ["хранилище с проверкой внутри операции", () => createInMemoryChatStorage()],
  ["хранилище без неё (замок в пакете)", storageWithoutChecks],
];

describe.each(variants)("одновременные действия: %s", (_name, createStorage) => {
  async function withNotes(count: number, options: { maxNotes?: number } = {}) {
    const storage = createStorage();
    const memory = createLongTermMemory({ storage, optimizer: false, ...options });
    for (let index = 0; index < count; index++) await memory.create("anna", input(`Запись ${index}`));
    return { storage, memory };
  }

  it("два create при одном свободном месте: проходит один, второй — limit_reached", async () => {
    const { memory } = await withNotes(4, { maxNotes: 5 });
    const results = await Promise.all([memory.create("anna", input("Новая А")), memory.create("anna", input("Новая Б"))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, error: { kind: "limit_reached" } });
    expect((await memory.list("anna")).notes).toHaveLength(5);
  });

  it("много create сразу не превышают предел", async () => {
    const { memory } = await withNotes(1, { maxNotes: 4 });
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => memory.create("anna", input(`Новая ${index}`))));
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect((await memory.list("anna")).notes).toHaveLength(4);
  });

  it("два одинаковых create: одна запись, у второго — duplicate", async () => {
    const { memory } = await withNotes(0);
    const results = await Promise.all([memory.create("anna", input("Любит чай")), memory.create("anna", input("любит  чай"))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { kind: "duplicate" } });
    expect((await memory.list("anna")).notes).toHaveLength(1);
  });

  it("два update к одному тексту: одна запись меняется, у второго — duplicate", async () => {
    const { memory } = await withNotes(2);
    const [first, second] = (await memory.list("anna")).notes;
    const results = await Promise.all([memory.update("anna", first!.id, 1, input("Общий текст")), memory.update("anna", second!.id, 1, input("Общий текст"))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { kind: "duplicate" } });
    expect((await memory.list("anna")).notes.filter((note) => note.content === "Общий текст")).toHaveLength(1);
  });

  it("параллельные update не выводят за предел объёма", async () => {
    const storage = createStorage();
    const memory = createLongTermMemory({ storage, optimizer: false, maxTotalChars: 60 });
    await memory.create("anna", input("а".repeat(10)));
    await memory.create("anna", input("б".repeat(10)));
    const [first, second] = (await memory.list("anna")).notes;
    const longer = (letter: string) => input(letter.repeat(30));
    const results = await Promise.all([memory.update("anna", first!.id, 1, longer("в")), memory.update("anna", second!.id, 1, longer("г"))]);
    // Разделы «О себе» — по 7 знаков на запись: 30 + 7 + 10 + 7 = 54 проходит, 30 + 7 + 30 + 7 = 74 — нет.
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ error: { kind: "limit_reached" } });
  });

  it("createMany параллельно с create: пакет всё или ничего, предел цел", async () => {
    const { memory } = await withNotes(3, { maxNotes: 5 });
    const results = await Promise.all([
      memory.createMany("anna", [input("Пакет 1"), input("Пакет 2")]),
      memory.create("anna", input("Одна")),
    ]);
    expect((await memory.list("anna")).notes.length).toBeLessThanOrEqual(5);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("у разных людей записи считаются отдельно, действия одного не ждут ошибок другого", async () => {
    const { memory } = await withNotes(4, { maxNotes: 5 });
    const results = await Promise.all([memory.create("anna", input("А")), memory.create("boris", input("Б")), memory.create("boris", input("В"))]);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it("сбой хранилища в одном действии не ломает следующие", async () => {
    const storage = createStorage();
    const memory = createLongTermMemory({ storage, optimizer: false });
    let failNext = true;
    const failingOnce =
      <Args extends unknown[], Result>(method: (...args: Args) => Promise<Result>) =>
      async (...args: Args) => {
        if (failNext) {
          failNext = false;
          throw new Error("база недоступна");
        }
        return method(...args);
      };
    storage.insertMemoryNotes = failingOnce(storage.insertMemoryNotes!.bind(storage));
    if (storage.insertMemoryNotesChecked) storage.insertMemoryNotesChecked = failingOnce(storage.insertMemoryNotesChecked.bind(storage));
    const [broken, fine] = await Promise.allSettled([memory.create("anna", input("Первая")), memory.create("anna", input("Вторая"))]);
    expect(broken.status).toBe("rejected");
    expect(fine.status).toBe("fulfilled");
    expect((await memory.list("anna")).notes.map((note) => note.content)).toEqual(["Вторая"]);
  });
});

describe("несколько серверов на одной базе", () => {
  it("два экземпляра памяти на общем хранилище с проверкой внутри операции не обходят предел и дубли", async () => {
    const storage = createInMemoryChatStorage();
    const serverA = createLongTermMemory({ storage, optimizer: false, maxNotes: 5 });
    const serverB = createLongTermMemory({ storage, optimizer: false, maxNotes: 5 });
    for (let index = 0; index < 4; index++) await serverA.create("anna", input(`Запись ${index}`));
    const results = await Promise.all([serverA.create("anna", input("Новая А")), serverB.create("anna", input("Новая Б"))]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const same = await Promise.all([serverA.update("anna", (await serverA.list("anna")).notes[0]!.id, 1, input("Общий")), serverB.create("anna", input("Общий"))]);
    expect(same.filter((result) => result.ok).length).toBeLessThanOrEqual(1);
    const contents = (await serverA.list("anna")).notes.map((note) => note.content);
    expect(contents.filter((content) => content === "Общий").length).toBeLessThanOrEqual(1);
    expect(contents.length).toBeLessThanOrEqual(5);
  });
});
