import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { SpendingLimitReachedError, TOOL_TIMEOUT_HINT } from "@ykurilov/agent-chat-core";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import { createImageGeneration, extendImageCatalog, imageToolTimeoutMs, standardImageCatalog } from "../src/index";
import type { CreateImageGenerationOptions, ImageProviderDescription } from "../src/index";
import { deferred, executeOptions, fakeRunware, hanging, json, KEY, ready } from "./support/fake-runware";

const NOW = new Date("2026-10-03T10:00:00.000Z");
const turn = { ownerId: "anna", chatId: "chat-1" };

function setup(runware = fakeRunware(), overrides: Partial<CreateImageGenerationOptions> = {}) {
  const storage = createMemoryAttachmentStorage();
  const usage: UsageRecord[] = [];
  const logError = vi.fn();
  const limits = { assertWithinLimit: vi.fn(async (_input: { userId: string; chatId: string; pendingUsd?: { user: number; chat: number } }) => {}) };
  const images = createImageGeneration({
    attachments: { storage },
    env: { RUNWARE_API_KEY: KEY },
    fetch: runware.fetch,
    spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) }, limits },
    logError,
    now: () => NOW,
    ...overrides,
  });
  return { images, storage, usage, logError, limits, runware };
}

/** Как ядро: вход проходит схему (значения по умолчанию), затем `execute`. */
async function generate(tools: ToolSet, input: Record<string, unknown>, abortSignal?: AbortSignal) {
  const parsed = await asSchema(tools.generate_images!.inputSchema).validate!(input);
  if (!parsed.success) throw parsed.error;
  return (await tools.generate_images!.execute!(parsed.value as never, executeOptions(abortSignal))) as Record<string, unknown>;
}

const schemaOf = (tools: ToolSet) => asSchema(tools.generate_images!.inputSchema);

describe("настройка генерации картинок (T043)", () => {
  it("нет модели, провайдера или ключа — исключение при создании; в тексте имя переменной, а не ключ", () => {
    const storage = createMemoryAttachmentStorage();
    const base = { attachments: { storage }, env: { RUNWARE_API_KEY: KEY } };
    expect(() => createImageGeneration({ ...base, model: "dall-e-9" })).toThrow(/dall-e-9/);
    expect(() => createImageGeneration({ ...base, provider: "fal" })).toThrow(/fal/);
    for (const env of [{}, { RUNWARE_API_KEY: "" }, { RUNWARE_API_KEY: "   " }]) {
      expect(() => createImageGeneration({ ...base, env })).toThrow(/RUNWARE_API_KEY/);
    }
    expect(() => createImageGeneration({ ...base, maxImageBytes: 0 })).toThrow(/maxImageBytes/);
    expect(() => createImageGeneration(base)).not.toThrow();
  });

  it("без ownerId или chatId набор пуст; с ними — generate_images; описание и схема постоянны", async () => {
    const { images } = setup();
    expect(images.tools({})).toEqual({});
    expect(images.tools({ ownerId: "anna" })).toEqual({});
    const first = images.tools(turn);
    const second = images.tools({ ownerId: "boris", chatId: "chat-9" });
    expect(Object.keys(first)).toEqual(["generate_images"]);
    expect(first.generate_images!.description).toBe(second.generate_images!.description);
    expect(await schemaOf(first).jsonSchema).toEqual(await schemaOf(second).jsonSchema);
    expect(imageToolTimeoutMs).toBe(210_000);
  });

  it("инструмент сам объявляет ядру свой срок: генерация и скачивание; дольше срок генерации — дольше и он", () => {
    const hint = (tools: ToolSet) => (tools.generate_images as unknown as Record<symbol, unknown>)[TOOL_TIMEOUT_HINT];
    expect(hint(setup().images.tools(turn))).toBe(imageToolTimeoutMs);
    expect(hint(setup(fakeRunware(), { requestTimeoutMs: 300_000 }).images.tools(turn))).toBe(360_000);
  });

  it("вход: prompt 2..2000, count 1..8 по умолчанию 1, aspectRatio из пяти по умолчанию 1:1", async () => {
    const { images } = setup();
    const schema = schemaOf(images.tools(turn));
    const parse = async (value: unknown) => (await schema.validate!(value)).success;
    expect(await schema.validate!({ prompt: "Кот" })).toEqual({ success: true, value: { prompt: "Кот", count: 1, aspectRatio: "1:1" } });
    expect(await parse({ prompt: "К" })).toBe(false);
    expect(await parse({ prompt: "к".repeat(2001) })).toBe(false);
    expect(await parse({ prompt: "Кот", count: 0 })).toBe(false);
    expect(await parse({ prompt: "Кот", count: 9 })).toBe(false);
    expect(await parse({ prompt: "Кот", count: 1.5 })).toBe(false);
    expect(await parse({ prompt: "Кот", count: 8, aspectRatio: "9:16" })).toBe(true);
    expect(await parse({ prompt: "Кот", aspectRatio: "4:3" })).toBe(false);
  });
});

describe("вызов generate_images (T043, T044)", () => {
  it("count задач параллельно, у каждой свой taskUUID и размер пропорции; картинки сохранены, итог и расход по одной", async () => {
    const gates = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    const runware = fakeRunware({ tasks: { 1: () => gates[0]!.promise, 2: () => gates[1]!.promise, 3: () => gates[2]!.promise } });
    const { images, storage, usage, limits } = setup(runware);

    const call = generate(images.tools(turn), { prompt: "Маяк на рассвете", count: 3, aspectRatio: "16:9" });
    await vi.waitFor(() => expect(runware.sent).toHaveLength(3));
    expect(limits.assertWithinLimit).toHaveBeenCalledWith({ userId: "anna", chatId: "chat-1" });
    expect(new Set(runware.sent.map(({ task }) => task.taskUUID)).size).toBe(3);
    for (const { task } of runware.sent) expect(task).toMatchObject({ positivePrompt: "Маяк на рассвете", width: 1088, height: 608, model: "openai:gpt-image@2" });
    gates[2]!.resolve(ready(3, 0.007));
    gates[0]!.resolve(ready(1, 0.006));
    gates[1]!.resolve(ready(2));
    const result = await call;

    expect(result).toEqual({
      создано: 3,
      заказано: 3,
      картинки: [1, 2, 3].map((номер) => ({ номер, id: expect.any(String), ширина: 1088, высота: 608 })),
    });
    const ids = (result.картинки as Array<{ id: string }>).map(({ id }) => id);
    expect(await Promise.all(ids.map(async (id) => (await storage.get(id))?.name))).toEqual(["image-1.png", "image-2.png", "image-3.png"]);
    expect(await storage.get(ids[0]!)).toMatchObject({ chatId: "chat-1", ownerId: "anna", kind: "image", attached: true });
    expect(usage.map(({ source, modelId, providerId, costUsd }) => ({ source, modelId, providerId, costUsd })).sort((a, b) => a.costUsd - b.costUsd)).toEqual([
      { source: "images", modelId: "gpt-image-2", providerId: "runware", costUsd: 0.005 },
      { source: "images", modelId: "gpt-image-2", providerId: "runware", costUsd: 0.006 },
      { source: "images", modelId: "gpt-image-2", providerId: "runware", costUsd: 0.007 },
    ]);
  });

  it("часть упала: удачные в итоге, упавшие с причиной; отказ до работы расхода не пишет, сбой после отправки — по цене модели", async () => {
    const runware = fakeRunware({
      tasks: {
        2: json({ errors: [{ code: "invalidPositivePrompt", message: "Prompt rejected" }] }, 400),
        3: new Response("upstream broke", { status: 502 }),
        4: ready(4, 0.005),
      },
      downloads: { 4: new Response("nope", { status: 404 }) },
    });
    const { images, usage, storage } = setup(runware);
    const result = await generate(images.tools(turn), { prompt: "Маяк", count: 4 });

    expect(result).toMatchObject({ создано: 1, заказано: 4, картинки: [{ номер: 1, ширина: 816, высота: 816 }] });
    expect(result.ошибки).toEqual([
      { номер: 2, причина: expect.stringContaining("invalidPositivePrompt") },
      { номер: 3, причина: expect.stringContaining("502") },
      { номер: 4, причина: expect.stringMatching(/не скачалась/) },
    ]);
    expect(result.остановлено).toBeUndefined();
    expect(usage.map(({ costUsd }) => costUsd).sort()).toEqual([0.005, 0.005, 0.005]);
    expect(await storage.removeAllOfChat("chat-1")).toBe(1);
  });

  it("ни одной картинки — тоже итог, а не исключение", async () => {
    const refusal = () => json({ errors: [{ code: "insufficientCredits", message: "No money" }] }, 402);
    const { images, usage } = setup(fakeRunware({ tasks: { 1: refusal, 2: refusal } }));
    const result = await generate(images.tools(turn), { prompt: "Маяк", count: 2 });
    expect(result).toEqual({
      создано: 0,
      заказано: 2,
      картинки: [],
      ошибки: [
        { номер: 1, причина: expect.stringContaining("insufficientCredits") },
        { номер: 2, причина: expect.stringContaining("insufficientCredits") },
      ],
    });
    expect(usage).toEqual([]);
  });

  it("лимит исчерпан — отказ итогом, генерации нет (FR-041)", async () => {
    const { images, limits, runware, usage } = setup();
    limits.assertWithinLimit.mockRejectedValueOnce(new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null }));
    expect(await generate(images.tools(turn), { prompt: "Маяк", count: 3 })).toEqual({ отказ: "лимит расходов исчерпан" });
    expect(runware.fetch).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });

  it("сбой проверки лимита — отказ итогом и запись в журнал, генерации нет", async () => {
    const { images, limits, runware, logError } = setup();
    limits.assertWithinLimit.mockRejectedValueOnce(new Error("база недоступна"));
    expect(await generate(images.tools(turn), { prompt: "Маяк" })).toEqual({ отказ: expect.any(String) });
    expect(runware.fetch).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("база недоступна"));
  });

  it("после записи расхода — afterSpending лимитов (пороги); его сбой — в журнал, картинка не теряется", async () => {
    const order: string[] = [];
    const afterSpending = vi.fn(async (_input: { userId: string; chatId: string }) => void order.push("after"));
    const { images, logError } = setup(fakeRunware(), {
      spending: {
        storage: { insertUsageRecord: async () => void order.push("record") },
        limits: { assertWithinLimit: async () => {}, afterSpending },
      },
    });
    expect(await generate(images.tools(turn), { prompt: "Маяк" })).toMatchObject({ создано: 1 });
    await vi.waitFor(() => expect(afterSpending).toHaveBeenCalledWith({ userId: "anna", chatId: "chat-1" }));
    expect(order).toEqual(["record", "after"]);
    afterSpending.mockRejectedValueOnce(new Error("порог упал"));
    expect(await generate(images.tools(turn), { prompt: "Маяк" })).toMatchObject({ создано: 1 });
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("порог упал")));
  });

  it("без spending вызовы работают, расход не пишется", async () => {
    const { images } = setup(fakeRunware(), { spending: undefined });
    expect(await generate(images.tools(turn), { prompt: "Маяк" })).toMatchObject({ создано: 1, заказано: 1 });
  });

  it("«Стоп»: ожидание обрывается, готовое до «Стопа» остаётся, пришедшее после не сохраняется, ушедшие задачи — в расход по цене модели (FR-042)", async () => {
    const lateDownload = deferred<Response>();
    const runware = fakeRunware({
      tasks: { 1: ready(1, 0.006), 2: hanging, 3: ready(3, 0.007) },
      downloads: { 3: () => lateDownload.promise },
    });
    const { images, usage, storage } = setup(runware);
    const stop = new AbortController();
    const call = generate(images.tools(turn), { prompt: "Маяк", count: 3 }, stop.signal);
    await vi.waitFor(() => expect(usage.map(({ costUsd }) => costUsd).sort()).toEqual([0.006, 0.007]));
    await vi.waitFor(() => expect(runware.fetch).toHaveBeenCalledTimes(5));
    stop.abort();
    const result = await call;
    lateDownload.resolve(new Response(new Uint8Array(8) as BodyInit));

    expect(result).toMatchObject({ создано: 1, заказано: 3, остановлено: true, картинки: [{ номер: 1 }] });
    expect(usage.map(({ costUsd }) => costUsd).sort()).toEqual([0.005, 0.006, 0.007]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await storage.removeAllOfChat("chat-1")).toBe(1);
  });

  it("«Стоп»: задача, которую провайдер уже отклонил до работы, в расход не идёт", async () => {
    const runware = fakeRunware({ tasks: { 1: json({ errors: [{ code: "invalidPositivePrompt", message: "Prompt rejected" }] }, 400), 2: hanging } });
    const { images, usage } = setup(runware);
    const stop = new AbortController();
    const call = generate(images.tools(turn), { prompt: "Маяк", count: 2 }, stop.signal);
    await vi.waitFor(() => expect(runware.sent).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    stop.abort();
    expect(await call).toMatchObject({ создано: 0, остановлено: true, ошибки: [{ номер: 1, причина: expect.stringContaining("invalidPositivePrompt") }] });
    expect(usage.map(({ costUsd }) => costUsd)).toEqual([0.005]);
  });

  it("параллельные вызовы в одном шаге: заказанное, но ещё не записанное, лимит видит — сверх остатка не больше одного вызова", async () => {
    const runware = fakeRunware({ tasks: Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, hanging])) });
    const { images, usage, limits } = setup(runware);
    // Бюджет на пять картинок по цене модели: записанное вместе с «в полёте» дошло до бюджета — лимит исчерпан.
    limits.assertWithinLimit.mockImplementation(async ({ pendingUsd }) => {
      const spent = usage.reduce((total, record) => total + record.costUsd, 0) + (pendingUsd?.user ?? 0);
      if (spent >= 0.025) throw new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null });
    });
    const stop = new AbortController();
    const tools = images.tools(turn);
    const calls = Array.from({ length: 5 }, () => generate(tools, { prompt: "Маяк", count: 8 }, stop.signal));
    await vi.waitFor(() => expect(limits.assertWithinLimit).toHaveBeenCalledTimes(5));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(runware.sent).toHaveLength(8);
    expect(limits.assertWithinLimit.mock.calls.slice(1).map(([input]) => input.pendingUsd)).toEqual(Array(4).fill({ user: 0.04, chat: 0.04 }));
    stop.abort();
    const results = await Promise.all(calls);
    expect(results.filter((result) => result.отказ === "лимит расходов исчерпан")).toHaveLength(4);
    expect(usage).toHaveLength(8);

    // Вызов закончился — его бронь снята: следующий видит только записанный расход.
    limits.assertWithinLimit.mockClear();
    limits.assertWithinLimit.mockImplementation(async () => {});
    await generate(images.tools({ ownerId: "anna", chatId: "chat-2" }), { prompt: "Маяк" }, AbortSignal.abort());
    expect(limits.assertWithinLimit).not.toHaveBeenCalled();
    const next = generate(images.tools({ ownerId: "anna", chatId: "chat-2" }), { prompt: "Маяк" });
    await vi.waitFor(() => expect(limits.assertWithinLimit).toHaveBeenCalledTimes(1));
    expect(limits.assertWithinLimit).toHaveBeenCalledWith({ userId: "anna", chatId: "chat-2" });
    stop.abort();
    void next.catch(() => {});
  });

  it("брони в одном чате не задевают лимит чата в другом: в чат идёт только его бронь", async () => {
    const runware = fakeRunware({ tasks: { 1: hanging, 2: hanging, 3: hanging } });
    const { images, limits } = setup(runware);
    const stop = new AbortController();
    const first = generate(images.tools(turn), { prompt: "Маяк", count: 2 }, stop.signal);
    await vi.waitFor(() => expect(runware.sent).toHaveLength(2));
    const second = generate(images.tools({ ownerId: "anna", chatId: "chat-2" }), { prompt: "Маяк" }, stop.signal);
    await vi.waitFor(() => expect(runware.sent).toHaveLength(3));
    expect(limits.assertWithinLimit).toHaveBeenLastCalledWith({ userId: "anna", chatId: "chat-2", pendingUsd: { user: 0.01, chat: 0 } });
    stop.abort();
    await Promise.all([first, second]);
  });

  it("«Стоп» до начала вызова — генерации и расхода нет", async () => {
    const { images, runware, usage } = setup();
    const stop = new AbortController();
    stop.abort();
    expect(await generate(images.tools(turn), { prompt: "Маяк", count: 2 }, stop.signal)).toMatchObject({ создано: 0, заказано: 2, остановлено: true });
    expect(runware.fetch).not.toHaveBeenCalled();
    expect(usage).toEqual([]);
  });

  it("прокси подключения: задача идёт на адрес и с заголовками из каталога", async () => {
    const runware = fakeRunware();
    const catalog = extendImageCatalog(standardImageCatalog, { connectProviders: { runware: { baseURL: "https://proxy.test/rw", headers: { "x-proxy-token": "proxy-secret" } } } });
    const { images } = setup(runware, { catalog });
    await generate(images.tools(turn), { prompt: "Маяк" });
    expect(runware.sent[0]!.url).toBe("https://proxy.test/rw");
    expect(new Headers(runware.sent[0]!.init.headers).get("x-proxy-token")).toBe("proxy-secret");
    // Картинка скачивается без заголовков прокси: это чужой хост.
    const download = runware.fetch.mock.calls.find(([, init]) => init?.method !== "POST")!;
    expect(download[1]?.headers).toBeUndefined();
  });

  it("сайт подключения из настройки (свой прокси, поддельный провайдер на localhost): картинку с него можно скачать и по http", async () => {
    const local = "http://localhost:5173/api/demo/runware";
    const runware = fakeRunware({ tasks: { 1: json({ data: [{ imageURL: `${local}/images/1.png` }] }), 2: json({ data: [{ imageURL: "http://localhost:9999/images/2.png" }] }) } });
    const catalog = extendImageCatalog(standardImageCatalog, { connectProviders: { runware: { baseURL: `${local}/v1` } } });
    const { images } = setup(runware, { catalog });
    const result = await generate(images.tools(turn), { prompt: "Маяк", count: 2 });
    expect(result).toMatchObject({ создано: 1, картинки: [{ номер: 1 }], ошибки: [{ номер: 2, причина: expect.stringMatching(/не скачалась/) }] });
  });

  it("своя модель и свой провайдер; неожиданная ошибка провайдера — общая причина, ключ не светится ни в итоге, ни в журнале (FR-044)", async () => {
    const generateImage = vi.fn<ImageProviderDescription["generate"]>(async (_request, connection) => {
      throw new Error(`boom with ${connection.apiKey} and ${connection.headers?.["x-token"]}`);
    });
    const own: ImageProviderDescription = { id: "own", displayName: "Своя", apiKeyEnv: "OWN_IMAGES_KEY", headers: { "x-token": "header-secret" }, generate: generateImage };
    const catalog = extendImageCatalog(standardImageCatalog, {
      addProviders: [own],
      addModels: [{ ...standardImageCatalog.models[0]!, id: "own-model", displayName: "Своя модель", providerModelIds: { own: "own:1" }, pricePerImageUsd: 0.1 }],
    });
    const { images, logError, usage } = setup(fakeRunware(), { catalog, model: "own-model", env: { OWN_IMAGES_KEY: "own-secret-key" } });
    const result = await generate(images.tools(turn), { prompt: "Маяк" });

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ providerModelId: "own:1", timeoutMs: 150_000 }),
      expect.objectContaining({ apiKey: "own-secret-key", headers: { "x-token": "header-secret" } }),
    );
    expect(result).toMatchObject({ создано: 0, ошибки: [{ номер: 1, причина: expect.any(String) }] });
    const everything = JSON.stringify(result) + JSON.stringify(logError.mock.calls);
    expect(logError).toHaveBeenCalled();
    expect(everything).not.toContain("own-secret-key");
    expect(everything).not.toContain("header-secret");
    expect(usage).toMatchObject([{ modelId: "own-model", providerId: "own", costUsd: 0.1 }]);
  });
});
