import type { ToolExecutionOptions } from "ai";
import { asSchema } from "ai";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { AgentToolsModel, ChatStorage } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createLongTermMemory } from "../src/create-long-term-memory";
import type { LongTermMemoryOptions } from "../src/create-long-term-memory";
import { memoryToolTitles } from "../src/tool-titles";

const executionOptions = { toolCallId: "call-1", messages: [] } as unknown as ToolExecutionOptions<never>;

function toolsModel(ownerId: string): AgentToolsModel {
  return { ownerId, chatId: "chat-1", providerId: "mock", profile: {} as AgentToolsModel["profile"], place: null, notifyDataChanged: () => {} };
}

function setup(limits: Partial<Omit<LongTermMemoryOptions, "storage">> = {}, storage: ChatStorage = createInMemoryChatStorage()) {
  const memory = createLongTermMemory({ storage, ...limits });
  const run = async (ownerId: string, input: unknown): Promise<any> => {
    const tool = memory.tools(toolsModel(ownerId)).manage_memory!;
    return tool.execute!(input as never, executionOptions);
  };
  return { memory, storage, run };
}

const notesOf = async (storage: ChatStorage, ownerId = "anna") => storage.listMemoryNotes!(ownerId);

describe("manage_memory: create", () => {
  it("два факта — одной операцией; в ответе id и версии", async () => {
    const { run, storage } = setup();
    const result = await run("anna", {
      action: "create",
      notes: [
        { categories: ["Правила", "Ответы"], content: "Обращаться на «ты»" },
        { categories: ["Работа"], content: "Менеджер пакетов — pnpm" },
      ],
    });
    expect(result.error).toBeUndefined();
    expect(result.notes).toHaveLength(2);
    for (const created of result.notes) expect(created).toMatchObject({ version: 1, id: expect.any(String) });
    expect((await notesOf(storage)).map((item) => item.content).sort()).toEqual(["Менеджер пакетов — pnpm", "Обращаться на «ты»"]);
  });

  it("пакет с дублем — не записано ни одной, причина названа", async () => {
    const { run, storage } = setup();
    await run("anna", { action: "create", notes: [{ categories: ["а"], content: "Уже есть" }] });
    const result = await run("anna", {
      action: "create",
      notes: [
        { categories: ["а"], content: "Новая" },
        { categories: ["а"], content: "уже  есть" },
        { categories: ["а"], content: "Ещё новая" },
      ],
    });
    expect(result.error?.kind).toBe("duplicate");
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(await notesOf(storage)).toHaveLength(1);
  });

  it("шесть записей или пустой пакет — invalid", async () => {
    const { run, storage } = setup();
    const six = Array.from({ length: 6 }, (_, index) => ({ categories: ["а"], content: `текст ${index}` }));
    expect((await run("anna", { action: "create", notes: six })).error?.kind).toBe("invalid");
    expect((await run("anna", { action: "create", notes: [] })).error?.kind).toBe("invalid");
    expect((await run("anna", { action: "create" })).error?.kind).toBe("invalid");
    expect(await notesOf(storage)).toHaveLength(0);
  });

  it("предел записей — limit_reached, существующее цело", async () => {
    const { run, storage } = setup({ maxNotes: 1 });
    await run("anna", { action: "create", notes: [{ categories: ["а"], content: "Первая" }] });
    const result = await run("anna", { action: "create", notes: [{ categories: ["а"], content: "Вторая" }] });
    expect(result.error?.kind).toBe("limit_reached");
    expect(await notesOf(storage)).toHaveLength(1);
  });

  it("негодная форма (раздел со «/») — invalid", async () => {
    const { run } = setup();
    const result = await run("anna", { action: "create", notes: [{ categories: ["а/б"], content: "текст" }] });
    expect(result.error?.kind).toBe("invalid");
  });
});

describe("manage_memory: update и delete", () => {
  async function withOneNote() {
    const context = setup();
    const created = await context.run("anna", { action: "create", notes: [{ categories: ["Работа"], content: "Пишет на JavaScript" }] });
    return { ...context, id: created.notes[0].id as string };
  }

  it("update с верной версией: запись обновлена, версия выросла", async () => {
    const { run, storage, id } = await withOneNote();
    const result = await run("anna", { action: "update", id, version: 1, categories: ["Работа"], content: "Пишет на TypeScript" });
    expect(result.note).toMatchObject({ id, version: 2, content: "Пишет на TypeScript" });
    expect((await notesOf(storage))[0]).toMatchObject({ version: 2, content: "Пишет на TypeScript" });
  });

  it("update со старой версией — stale_version с подсказкой найти запись заново; запись не тронута", async () => {
    const { run, storage, id } = await withOneNote();
    await run("anna", { action: "update", id, version: 1, categories: ["Работа"], content: "Первая правка" });
    const result = await run("anna", { action: "update", id, version: 1, categories: ["Работа"], content: "Опоздавшая правка" });
    expect(result.error?.kind).toBe("stale_version");
    expect(result.error.message).toContain("search");
    expect((await notesOf(storage))[0]?.content).toBe("Первая правка");
  });

  it("update в текст другой записи — duplicate", async () => {
    const { run, id } = await withOneNote();
    await run("anna", { action: "create", notes: [{ categories: ["Работа"], content: "Второй факт" }] });
    const result = await run("anna", { action: "update", id, version: 1, categories: ["Работа"], content: "второй факт" });
    expect(result.error?.kind).toBe("duplicate");
  });

  it("update неизвестной записи — not_found", async () => {
    const { run } = await withOneNote();
    const result = await run("anna", { action: "update", id: "нет-такой", version: 1, categories: ["а"], content: "текст" });
    expect(result.error?.kind).toBe("not_found");
  });

  it("чужая запись — ровно как несуществующая: not_found, запись цела", async () => {
    const { run, storage, id } = await withOneNote();
    const update = await run("boris", { action: "update", id, version: 1, categories: ["а"], content: "взлом" });
    const remove = await run("boris", { action: "delete", id, version: 1 });
    expect(update.error?.kind).toBe("not_found");
    expect(remove.error?.kind).toBe("not_found");
    expect(await notesOf(storage)).toHaveLength(1);
    expect((await notesOf(storage))[0]?.content).toBe("Пишет на JavaScript");
  });

  it("delete: верная версия удаляет, старая — stale_version, неизвестная — not_found", async () => {
    const { run, storage, id } = await withOneNote();
    await run("anna", { action: "update", id, version: 1, categories: ["Работа"], content: "Другой текст" });
    expect((await run("anna", { action: "delete", id, version: 1 })).error?.kind).toBe("stale_version");
    expect((await run("anna", { action: "delete", id: "нет", version: 1 })).error?.kind).toBe("not_found");
    expect(await run("anna", { action: "delete", id, version: 2 })).toEqual({ deleted: id });
    expect(await notesOf(storage)).toHaveLength(0);
  });

  it.each([
    ["update без id", { action: "update", version: 1, categories: ["а"], content: "текст" }],
    ["update без версии", { action: "update", id: "x", categories: ["а"], content: "текст" }],
    ["update без текста", { action: "update", id: "x", version: 1, categories: ["а"] }],
    ["delete без версии", { action: "delete", id: "x" }],
    ["delete без id", { action: "delete", version: 1 }],
    ["неизвестное действие", { action: "list" }],
  ])("не хватает полей: %s — invalid", async (_name, input) => {
    const { run } = setup();
    const result = await run("anna", input);
    expect(result.error?.kind).toBe("invalid");
  });
});

describe("manage_memory: search", () => {
  it("находит скрытую запись по слову; ответ — записи с id и версией и общее число", async () => {
    const { run } = setup();
    await run("anna", { action: "create", notes: [{ categories: ["Работа"], content: "Верстает на Tailwind" }] });
    const result = await run("anna", { action: "search", query: "tailwind" });
    expect(result.total).toBe(1);
    expect(result.notes[0]).toMatchObject({ content: "Верстает на Tailwind", version: 1, id: expect.any(String) });
  });

  it("ищет только в памяти этого человека", async () => {
    const { run } = setup();
    await run("anna", { action: "create", notes: [{ categories: ["Работа"], content: "Верстает на Tailwind" }] });
    expect((await run("boris", { action: "search", query: "tailwind" })).total).toBe(0);
  });

  it("пустой запрос — invalid", async () => {
    const { run } = setup();
    expect((await run("anna", { action: "search", query: " " })).error?.kind).toBe("invalid");
    expect((await run("anna", { action: "search" })).error?.kind).toBe("invalid");
  });
});

describe("manage_memory: устройство инструмента", () => {
  it("описание и схема не зависят от человека (кэш модели)", async () => {
    const { memory } = setup();
    const anna = memory.tools(toolsModel("anna")).manage_memory!;
    const boris = memory.tools(toolsModel("boris")).manage_memory!;
    expect(boris.description).toBe(anna.description);
    expect(await asSchema(boris.inputSchema).jsonSchema).toEqual(await asSchema(anna.inputSchema).jsonSchema);
  });

  it("описание не содержит записей человека", async () => {
    const { memory, run } = setup();
    await run("anna", { action: "create", notes: [{ categories: ["Тайное"], content: "Уникальныйтекстдляпроверки" }] });
    expect(memory.tools(toolsModel("anna")).manage_memory!.description).not.toContain("Уникальныйтекстдляпроверки");
  });

  it("без номера человека выполнять нечего: исключение, а не общая память", async () => {
    const { run, storage } = setup();
    await expect(run("", { action: "create", notes: [{ categories: ["а"], content: "текст" }] })).rejects.toThrow();
    expect(await storage.listMemoryNotes!("")).toEqual([]);
  });

  it("сбой хранилища — исключение (обычная ошибка инструмента), а не ответ с кодом", async () => {
    const storage = createInMemoryChatStorage();
    const broken = async () => {
      throw new Error("диск недоступен");
    };
    storage.insertMemoryNotes = broken;
    storage.insertMemoryNotesChecked = broken;
    const { run } = setup({}, storage);
    await expect(run("anna", { action: "create", notes: [{ categories: ["а"], content: "текст" }] })).rejects.toThrow("диск недоступен");
  });

  it("названия строк вызова: manage_memory по-человечески", () => {
    expect(memoryToolTitles.manage_memory).toBeTruthy();
    expect(setup().memory.toolTitles).toBe(memoryToolTitles);
  });
});
