import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ImageLibraryError, createImageLibrary } from "../src/index";
import type { ImageEntry, ImageSource } from "../src/index";

const cell: ImageEntry = {
  id: "cell",
  title: "Строение клетки",
  alt: "Схема клетки: ядро, мембрана, митохондрии",
  url: "/library/cell.png",
  width: 1200,
  height: 800,
  description: "Длинное описание клетки. ".repeat(30),
  concepts: ["клетка"],
  tags: ["биология"],
};
const atom: ImageEntry = { id: "atom", title: "Модель атома", alt: "Ядро и электроны", url: "https://cdn.school.example/atom.webp", width: 640, height: 640 };

const model = { ownerId: "user-1", chatId: "chat-1" };
const options = { toolCallId: "call-1", messages: [] };

async function run(tools: ToolSet, name: string, input: unknown): Promise<any> {
  return await tools[name]!.execute!(input as never, options as never);
}

/** Отказ инструмента — ошибка: лента показывает неудачу, модель получает тот же текст. */
async function refusal(result: Promise<unknown>): Promise<ImageLibraryError> {
  const error = await result.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ImageLibraryError);
  return error as ImageLibraryError;
}

async function modelSees(tools: ToolSet, name: string, output: unknown): Promise<unknown> {
  return await tools[name]!.toModelOutput!({ toolCallId: "call-1", input: {}, output } as never);
}

const allowedHosts = ["cdn.school.example"];

describe("createImageLibrary: find_images и show_image", () => {
  it("без ownerId или chatId — пустой набор", () => {
    const library = createImageLibrary({ images: [cell] });
    expect(library.tools({})).toEqual({});
    expect(Object.keys(library.tools(model)).sort()).toEqual(["find_images", "show_image"]);
  });

  it("каталог-массив копируется при создании: правка исходных записей потом ни на что не влияет", async () => {
    const entry = { ...cell, concepts: ["клетка"] };
    const list: ImageEntry[] = [entry];
    const tools = createImageLibrary({ images: list }).tools(model);
    entry.url = "https://evil.example/x.png";
    entry.title = "Подмена";
    entry.concepts.push("подмена");
    list.push({ ...atom, id: "extra", url: "/extra.png" });
    const shown = await run(tools, "show_image", { id: "cell" });
    expect(shown.картинка).toMatchObject({ адрес: "/library/cell.png", название: "Строение клетки" });
    expect((await run(tools, "find_images", { query: "подмена" })).найдено).toEqual([]);
    expect((await refusal(run(tools, "show_image", { id: "extra" }))).kind).toBe("not_in_catalog");
  });

  it("негодный каталог-массив — исключение при создании; домен вне allowedHosts — тоже", () => {
    expect(() => createImageLibrary({ images: [{ ...cell, alt: " " }] })).toThrow(/cell/);
    expect(() => createImageLibrary({ images: [atom] })).toThrow(/atom/);
    expect(() => createImageLibrary({ images: [atom], allowedHosts })).not.toThrow();
  });

  it("find_images отдаёт id, название, обрезанное описание, понятия и теги — без адреса", async () => {
    const tools = createImageLibrary({ images: [cell, atom], allowedHosts }).tools(model);
    const result = await run(tools, "find_images", { query: "клетка" });
    expect(result.найдено).toHaveLength(1);
    const [found] = result.найдено;
    expect(found).toMatchObject({ id: "cell", название: "Строение клетки", понятия: ["клетка"], теги: ["биология"] });
    expect(found.описание.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(result)).not.toContain("/library/cell.png");
  });

  it("ничего не нашлось — пустой список и совет", async () => {
    const result = await run(createImageLibrary({ images: [cell] }).tools(model), "find_images", { query: "квантовая физика" });
    expect(result).toEqual({ найдено: [], совет: expect.stringMatching(/други/) });
  });

  it("show_image хранит всё для показа, модель видит только «показано: название»", async () => {
    const tools = createImageLibrary({ images: [cell, atom], allowedHosts }).tools(model);
    const shown = await run(tools, "show_image", { id: "cell" });
    expect(shown).toEqual({
      картинка: { id: "cell", название: "Строение клетки", подпись: "Схема клетки: ядро, мембрана, митохондрии", адрес: "/library/cell.png", ширина: 1200, высота: 800 },
    });
    expect(await modelSees(tools, "show_image", shown)).toEqual({ type: "json", value: { показано: "Строение клетки" } });
  });

  it("id не из каталога (в том числе адрес) — ошибка инструмента «нет в каталоге»", async () => {
    const tools = createImageLibrary({ images: [cell] }).tools(model);
    for (const id of ["nope", "/library/cell.png", "https://evil.example/x.png"]) {
      const error = await refusal(run(tools, "show_image", { id }));
      expect(error.kind).toBe("not_in_catalog");
      expect(error.message).toMatch(/нет в каталоге.*find_images/);
    }
  });

  it("старый отказ из истории (до ошибок инструмента) модель по-прежнему видит отказом", async () => {
    const tools = createImageLibrary({ images: [cell] }).tools(model);
    expect(await modelSees(tools, "show_image", { отказ: "нет" })).toEqual({ type: "json", value: { отказ: "нет" } });
  });

  it("описания и схемы инструментов одинаковы при любом каталоге и после его изменения", async () => {
    const shape = (tools: ToolSet) =>
      JSON.stringify(Object.entries(tools).map(([name, tool]) => [name, tool.description, asSchema(tool.inputSchema).jsonSchema]));
    const small = shape(createImageLibrary({ images: [cell] }).tools(model));
    const live: ImageEntry[] = [cell];
    const growing = createImageLibrary({ images: () => live, allowedHosts });
    const before = shape(growing.tools(model));
    live.push(atom);
    expect(shape(growing.tools(model))).toBe(before);
    expect(before).toBe(small);
    expect(shape(createImageLibrary({ images: [atom], allowedHosts }).tools({ ownerId: "x", chatId: "y" }))).toBe(small);
    expect(shape(createImageLibrary({ source: { search: () => [], get: () => undefined } }).tools(model))).toBe(small);
    expect(small).not.toContain("клетк");
  });
});

describe("каталог меняется без перезапуска", () => {
  it("функция-каталог перечитывается на каждом вызове: новая картинка сразу находится и показывается", async () => {
    const live: ImageEntry[] = [cell];
    const read = vi.fn(() => live);
    const tools = createImageLibrary({ images: read, allowedHosts }).tools(model);
    expect((await run(tools, "find_images", { query: "атом" })).найдено).toEqual([]);
    expect((await refusal(run(tools, "show_image", { id: "atom" }))).kind).toBe("not_in_catalog");
    live.push(atom);
    expect((await run(tools, "find_images", { query: "атом" })).найдено.map((image: { id: string }) => image.id)).toEqual(["atom"]);
    expect((await run(tools, "show_image", { id: "atom" })).картинка.id).toBe("atom");
    live.splice(0, 1);
    expect((await refusal(run(tools, "show_image", { id: "cell" }))).kind).toBe("not_in_catalog");
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("асинхронная функция (база, файл) тоже годится", async () => {
    const tools = createImageLibrary({ images: async () => [cell] }).tools(model);
    expect((await run(tools, "show_image", { id: "cell" })).картинка.id).toBe("cell");
  });

  it("негодная запись из функции пропущена, повтор id — берётся первая; в журнал один раз, только id и причина", async () => {
    const logError = vi.fn();
    const broken = { ...cell, id: "broken", url: "https://evil.example/x.png", description: "секретное описание" };
    const tools = createImageLibrary({ images: () => [broken, cell, { ...cell, title: "Двойник" }], logError }).tools(model);
    expect((await run(tools, "find_images", { query: "клетки" })).найдено.map((image: { название: string }) => image.название)).toEqual(["Строение клетки"]);
    expect((await refusal(run(tools, "show_image", { id: "broken" }))).kind).toBe("not_in_catalog");
    expect(logError).toHaveBeenCalledTimes(2);
    for (const [message] of logError.mock.calls) {
      expect(message).not.toContain("секретное");
      expect(message).not.toContain("evil.example");
    }
  });

  it("функция упала или вернула не список — поиск и показ кончаются ошибкой «недоступен», причина в журнале", async () => {
    for (const images of [() => { throw new Error("db password=hunter2"); }, () => ({ items: [] })]) {
      const logError = vi.fn();
      const tools = createImageLibrary({ images: images as never, logError }).tools(model);
      const found = await refusal(run(tools, "find_images", { query: "клетка" }));
      expect(found.kind).toBe("catalog_unavailable");
      expect(found.message).toMatch(/каталог картинок сейчас недоступен/i);
      expect(found.message).not.toContain("hunter2");
      const error = await refusal(run(tools, "show_image", { id: "cell" }));
      expect(error.kind).toBe("catalog_unavailable");
      expect(error.message).toMatch(/недоступен/);
      expect(error.message).not.toContain("hunter2");
      expect(logError).toHaveBeenCalled();
    }
  });
});

describe("срок на каталог приложения", () => {
  it("функция-каталог, search и get дольше 5 с — ошибка «недоступен», причина в журнале", async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise<never>(() => undefined);
      const logError = vi.fn();
      const fromFunction = createImageLibrary({ images: never, logError }).tools(model);
      const fromSource = createImageLibrary({ source: { search: never, get: never }, logError }).tools(model);
      for (const [tools, name, input] of [
        [fromFunction, "find_images", { query: "клетка" }],
        [fromFunction, "show_image", { id: "cell" }],
        [fromSource, "find_images", { query: "клетка" }],
        [fromSource, "show_image", { id: "cell" }],
      ] as const) {
        const pending = refusal(run(tools, name, input));
        await vi.advanceTimersByTimeAsync(5_000);
        expect((await pending).kind).toBe("catalog_unavailable");
      }
      expect(logError).toHaveBeenCalledTimes(4);
      expect(logError.mock.calls[0]![0]).toMatch(/5 с/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("быстрый ответ раньше срока — обычный результат", async () => {
    vi.useFakeTimers();
    try {
      const slow = () => new Promise<ImageEntry[]>((resolve) => setTimeout(() => resolve([cell]), 4_000));
      const tools = createImageLibrary({ images: slow }).tools(model);
      const pending = run(tools, "show_image", { id: "cell" });
      await vi.advanceTimersByTimeAsync(4_000);
      expect((await pending).картинка.id).toBe("cell");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("каталог функциями source: { search, get }", () => {
  it("живые запросы с тем, кто спрашивает; запись проверяется на каждом вызове", async () => {
    const source: ImageSource = { search: vi.fn(async () => [cell, atom]), get: vi.fn(async (id) => (id === "cell" ? cell : id === "atom" ? atom : undefined)) };
    const tools = createImageLibrary({ source, logError: () => undefined }).tools(model);
    expect((await run(tools, "find_images", { query: "клетка" })).найдено.map((image: { id: string }) => image.id)).toEqual(["cell"]);
    expect(source.search).toHaveBeenCalledWith("клетка", { ownerId: "user-1", chatId: "chat-1" });
    expect((await run(tools, "show_image", { id: "cell" })).картинка.id).toBe("cell");
    expect(source.get).toHaveBeenCalledWith("cell", { ownerId: "user-1", chatId: "chat-1" });
    expect((await refusal(run(tools, "show_image", { id: "atom" }))).kind).toBe("not_in_catalog");
  });

  it("get вернул запись с другим id — отказ; поиск отдаёт не больше восьми", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ ...cell, id: `c${index}` }));
    const tools = createImageLibrary({ source: { search: () => many, get: () => cell } }).tools(model);
    expect((await refusal(run(tools, "show_image", { id: "other" }))).kind).toBe("not_in_catalog");
    expect((await run(tools, "find_images", { query: "x" })).найдено).toHaveLength(8);
  });

  it("search упал — find_images кончается ошибкой «недоступен» без текста исключения", async () => {
    const tools = createImageLibrary({ source: { search: () => { throw new Error("hunter2"); }, get: () => undefined }, logError: () => undefined }).tools(model);
    const error = await refusal(run(tools, "find_images", { query: "клетка" }));
    expect(error.kind).toBe("catalog_unavailable");
    expect(error.message).not.toContain("hunter2");
  });

  it("get упал — нейтральная ошибка «недоступен» без текста исключения", async () => {
    const logError = vi.fn();
    const tools = createImageLibrary({ source: { search: () => [], get: () => Promise.reject(new Error("hunter2")) }, logError }).tools(model);
    const error = await refusal(run(tools, "show_image", { id: "cell" }));
    expect(error.kind).toBe("catalog_unavailable");
    expect(error.message).toMatch(/недоступен/);
    expect(error.message).not.toContain("hunter2");
    expect(logError.mock.calls[0]![0]).toContain("hunter2");
  });
});
