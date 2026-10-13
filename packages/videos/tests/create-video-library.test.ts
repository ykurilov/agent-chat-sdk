import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createVideoLibrary } from "../src/index";
import type { VideoEntry, VideoSource } from "../src/index";

const lesson: VideoEntry = {
  id: "prompts",
  title: "Как писать промпты",
  url: "https://www.youtube.com/watch?v=aircAruvnKk",
  description: "Длинное описание. ".repeat(40),
  durationSeconds: 1120,
  poster: "/posters/prompts.jpg",
  chapters: [
    { title: "Вступление", startSeconds: 0 },
    { title: "Примеры", startSeconds: 200 },
  ],
};
const webinar: VideoEntry = { id: "webinar", title: "Вебинар про автоматизацию", url: "https://kinescope.io/gPhDX2pPFyCG77vboYnRCZ" };

const model = { ownerId: "user-1", chatId: "chat-1" };
const options = { toolCallId: "call-1", messages: [] };

async function run(tools: ToolSet, name: string, input: unknown): Promise<any> {
  const execute = tools[name]!.execute!;
  return await execute(input as never, options as never);
}

async function modelSees(tools: ToolSet, name: string, output: unknown): Promise<unknown> {
  return await tools[name]!.toModelOutput!({ toolCallId: "call-1", input: {}, output } as never);
}

describe("createVideoLibrary: инструменты find_videos и show_video (FR-001)", () => {
  it("без ownerId или chatId — пустой набор", () => {
    const library = createVideoLibrary({ videos: [lesson] });
    expect(library.tools({})).toEqual({});
    expect(library.tools({ ownerId: "u" })).toEqual({});
    expect(Object.keys(library.tools(model)).sort()).toEqual(["find_videos", "show_video"]);
  });

  it("негодный каталог-массив — исключение при создании", () => {
    expect(() => createVideoLibrary({ videos: [{ ...lesson, url: "https://vimeo.com/1" }] })).toThrow(/prompts/);
  });

  it("find_videos отдаёт модели id, название, обрезанное описание, длительность и главы (FR-005)", async () => {
    const tools = createVideoLibrary({ videos: [lesson, webinar] }).tools(model);
    const result = await run(tools, "find_videos", { query: "промпты" });
    expect(result.найдено).toHaveLength(1);
    const [found] = result.найдено;
    expect(found).toMatchObject({
      id: "prompts",
      название: "Как писать промпты",
      длительность: "18:40",
      главы: [
        { название: "Вступление", начало: "0:00", секунда: 0 },
        { название: "Примеры", начало: "3:20", секунда: 200 },
      ],
    });
    expect(found.описание.length).toBeLessThanOrEqual(300);
    expect(found).not.toHaveProperty("url");
    expect(result).not.toHaveProperty("совет");
  });

  it("find_videos ничего не нашёл — пустой список и совет", async () => {
    const tools = createVideoLibrary({ videos: [lesson] }).tools(model);
    const result = await run(tools, "find_videos", { query: "квантовая физика" });
    expect(result.найдено).toEqual([]);
    expect(result.совет).toMatch(/други/);
  });

  it("show_video хранит всё для карточки, модель видит коротко (FR-008)", async () => {
    const tools = createVideoLibrary({ videos: [lesson, webinar] }).tools(model);
    const shown = await run(tools, "show_video", { id: "prompts", startSeconds: 200 });
    expect(shown).toEqual({
      видео: {
        id: "prompts",
        название: "Как писать промпты",
        площадка: "youtube",
        код: "aircAruvnKk",
        длительность: 1120,
        обложка: "/posters/prompts.jpg",
        начало: 200,
      },
    });
    expect(await modelSees(tools, "show_video", shown)).toEqual({ type: "json", value: { показано: "Как писать промпты", с: "3:20" } });

    const plain = await run(tools, "show_video", { id: "webinar" });
    expect(plain).toEqual({ видео: { id: "webinar", название: "Вебинар про автоматизацию", площадка: "kinescope", код: "gPhDX2pPFyCG77vboYnRCZ" } });
    expect(await modelSees(tools, "show_video", plain)).toEqual({ type: "json", value: { показано: "Вебинар про автоматизацию" } });
  });

  it("show_video: id не из каталога и начало за концом — отказ словами (FR-007, SC-005)", async () => {
    const tools = createVideoLibrary({ videos: [lesson] }).tools(model);
    const missing = await run(tools, "show_video", { id: "https://www.youtube.com/watch?v=IlU-zDU6aGo" });
    expect(missing.отказ).toMatch(/нет в каталоге/);
    expect(await modelSees(tools, "show_video", missing)).toEqual({ type: "json", value: { отказ: missing.отказ } });

    const late = await run(tools, "show_video", { id: "prompts", startSeconds: 1120 });
    expect(late.отказ).toMatch(/18:40/);
  });

  it("описания и схемы инструментов одинаковы при любом каталоге (SC-003, FR-009)", () => {
    const describe = (tools: ToolSet) =>
      Object.fromEntries(
        Object.entries(tools).map(([name, tool]) => [name, { description: tool.description, schema: asSchema(tool.inputSchema).jsonSchema }]),
      );
    const small = describe(createVideoLibrary({ videos: [lesson] }).tools(model));
    const other = describe(createVideoLibrary({ videos: [webinar] }).tools({ ownerId: "x", chatId: "y" }));
    const functions = describe(createVideoLibrary({ source: { search: () => [], get: () => undefined } }).tools(model));
    expect(other).toEqual(small);
    expect(functions).toEqual(small);
    expect(JSON.stringify(small)).not.toContain("промпт");
  });
});

describe("каталог функциями (FR-004, US3)", () => {
  it("поиск и показ получают запрос и того, кто спрашивает", async () => {
    const source: VideoSource = { search: vi.fn(async () => [lesson]), get: vi.fn(async (id) => (id === "prompts" ? lesson : undefined)) };
    const tools = createVideoLibrary({ source }).tools(model);
    expect((await run(tools, "find_videos", { query: "промпты" })).найдено).toHaveLength(1);
    expect(source.search).toHaveBeenCalledWith("промпты", { ownerId: "user-1", chatId: "chat-1" });
    expect((await run(tools, "show_video", { id: "prompts" })).видео.id).toBe("prompts");
    expect(source.get).toHaveBeenCalledWith("prompts", { ownerId: "user-1", chatId: "chat-1" });
    expect((await run(tools, "show_video", { id: "secret" })).отказ).toMatch(/нет в каталоге/);
  });

  it("поиск отдаёт не больше восьми", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ ...webinar, id: `v${index}` }));
    const tools = createVideoLibrary({ source: { search: () => many, get: () => undefined } }).tools(model);
    expect((await run(tools, "find_videos", { query: "x" })).найдено).toHaveLength(8);
  });

  it("негодная запись из базы пропущена, причина в журнале только с id", async () => {
    const broken = { ...lesson, id: "broken", url: "https://evil.example/video", description: "секретное описание" };
    const logError = vi.fn();
    const tools = createVideoLibrary({ source: { search: () => [broken, webinar], get: () => broken }, logError }).tools(model);
    expect((await run(tools, "find_videos", { query: "x" })).найдено.map((video: { id: string }) => video.id)).toEqual(["webinar"]);
    expect((await run(tools, "show_video", { id: "broken" })).отказ).toMatch(/нет в каталоге/);
    expect(logError).toHaveBeenCalledTimes(2);
    for (const [message] of logError.mock.calls) {
      expect(message).toContain("broken");
      expect(message).not.toContain("секретное");
      expect(message).not.toContain("evil.example");
    }
  });

  const noVideo = (): undefined => undefined;
  it.each([
    ["поиск бросил исключение", { search: () => { throw new Error("db password=hunter2"); }, get: noVideo }],
    ["поиск вернул отклонённое обещание", { search: () => Promise.reject(new Error("db password=hunter2")), get: noVideo }],
    ["поиск вернул null", { search: () => null, get: noVideo }],
    ["поиск вернул не список", { search: () => ({ items: [lesson] }), get: noVideo }],
  ])("%s — модели нейтральный отказ, причина в журнале", async (_name, source) => {
    const logError = vi.fn();
    const tools = createVideoLibrary({ source: source as unknown as VideoSource, logError }).tools(model);
    const result = await run(tools, "find_videos", { query: "промпты" });
    expect(result).toEqual({ отказ: expect.stringMatching(/каталог видео сейчас недоступен/i) });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("get бросил исключение — модели нейтральный отказ, не «нет в каталоге», причина в журнале", async () => {
    const logError = vi.fn();
    const source = { search: () => [], get: () => Promise.reject(new Error("db password=hunter2")) };
    const tools = createVideoLibrary({ source, logError }).tools(model);
    const result = await run(tools, "show_video", { id: "prompts" });
    expect(result.отказ).toMatch(/каталог видео сейчас недоступен/i);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(await modelSees(tools, "show_video", result)).toEqual({ type: "json", value: { отказ: result.отказ } });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toContain("hunter2");
  });

  it("get вернул null — просто «нет в каталоге», без записи в журнал", async () => {
    const logError = vi.fn();
    const tools = createVideoLibrary({ source: { search: () => [], get: () => null as never }, logError }).tools(model);
    expect((await run(tools, "show_video", { id: "prompts" })).отказ).toMatch(/нет в каталоге/);
    expect(logError).not.toHaveBeenCalled();
  });

  it("get вернул запись с другим id — не показываем", async () => {
    const tools = createVideoLibrary({ source: { search: () => [], get: () => webinar } }).tools(model);
    expect((await run(tools, "show_video", { id: "prompts" })).отказ).toMatch(/нет в каталоге/);
  });
});
