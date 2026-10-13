import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createImageGeneration, memoryImageJobStore } from "../src/index";
import type { CreateImageGenerationOptions, GeneratedImage, ImageDelivery, ImageDeliveryContext, ImageGeneration } from "../src/index";
import { executeOptions, fakeRunware, KEY, ready } from "./support/fake-runware";
import { fakeKie, KIE_KEY } from "./support/fake-kie";

const turn = { ownerId: "anna", chatId: "chat-1", turnId: "answer-1" };
const created: ImageGeneration[] = [];

afterEach(async () => {
  for (const images of created.splice(0)) await images.stop();
  vi.useRealTimers();
});

function setup(fetch: typeof globalThis.fetch, overrides: Partial<CreateImageGenerationOptions> = {}) {
  const storage = createMemoryAttachmentStorage();
  const save = vi.spyOn(storage, "save");
  const usage: UsageRecord[] = [];
  const logError = vi.fn();
  const onLateImage = vi.fn();
  const limits = { assertWithinLimit: vi.fn(async (_input: { userId: string; chatId: string; pendingUsd?: { user: number; chat: number } }) => {}) };
  const images = createImageGeneration({
    attachments: { storage },
    env: { KIE_API_KEY: KIE_KEY, RUNWARE_API_KEY: KEY },
    fetch,
    spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) }, limits },
    logError,
    onLateImage,
    ...overrides,
  });
  created.push(images);
  return { images, storage, save, usage, logError, onLateImage, limits };
}

/** Как ядро: вход проходит схему (значения по умолчанию), затем `execute`. */
async function generate(tools: ToolSet, input: Record<string, unknown>, abortSignal?: AbortSignal) {
  const parsed = await asSchema(tools.generate_images!.inputSchema).validate!(input);
  if (!parsed.success) throw parsed.error;
  return (await tools.generate_images!.execute!(parsed.value as never, executeOptions(abortSignal))) as Record<string, any>;
}

/** Обещания и таймеры с настоящим setImmediate: подменённые часы его не трогают. */
async function flush(rounds = 20) {
  for (let round = 0; round < rounds; round++) await new Promise((resolve) => setImmediate(resolve));
}

const fakeClock = () => vi.useFakeTimers({ now: new Date("2026-10-05T10:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });

async function pass(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

describe("generate_images: свой приёмник в прежнем режиме", () => {
  it("картинка уходит в deliver, а не во вложения; ответ приёмника — модели; расход один", async () => {
    const runware = fakeRunware({ tasks: { 1: ready(1, 0.02) } });
    const deliver = vi.fn(async (_image: GeneratedImage, delivery: ImageDelivery, _context: ImageDeliveryContext) => ({ path: `img/${delivery.number}.png` }));
    const { images, save, usage } = setup(runware.fetch, { deliver });

    const result = await generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "3:2" });

    expect(result).toEqual({ создано: 1, заказано: 1, картинки: [{ номер: 1, ширина: expect.any(Number), высота: expect.any(Number), результат: { path: "img/1.png" } }] });
    expect(deliver).toHaveBeenCalledTimes(1);
    const [image, delivery] = deliver.mock.calls[0]!;
    expect(image).toMatchObject({ mediaType: "image/png", modelId: "gpt-image-2", width: expect.any(Number), height: expect.any(Number) });
    expect(image.bytes).toBeInstanceOf(Uint8Array);
    expect(delivery).toEqual({ ownerId: "anna", chatId: "chat-1", turnId: "answer-1", number: 1, prompt: "Красное яблоко", aspectRatio: "3:2", modelId: "gpt-image-2" });
    const context = deliver.mock.calls[0]![2];
    expect(context.signal).toBeInstanceOf(AbortSignal);
    expect(await context.isCurrent()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(usage.map((record) => record.costUsd)).toEqual([0.02]);
  });

  it("приёмник вернул false — картинка не нужна: в ошибках, а расход всё равно записан", async () => {
    const runware = fakeRunware({ tasks: { 1: ready(1, 0.02) } });
    const { images, usage } = setup(runware.fetch, { deliver: async () => false });
    const result = await generate(images.tools(turn), { prompt: "Красное яблоко" });
    expect(result).toEqual({ создано: 0, заказано: 1, картинки: [], ошибки: [{ номер: 1, причина: "картинка больше не нужна приложению" }] });
    expect(usage).toHaveLength(1);
  });

  it("приёмник упал — в ошибках «не принята», причина приёмника в журнале, не модели", async () => {
    const runware = fakeRunware({ tasks: { 1: ready(1, 0.02) } });
    const { images, logError } = setup(runware.fetch, {
      deliver: async () => {
        throw new Error("диск полон");
      },
    });
    const result = await generate(images.tools(turn), { prompt: "Красное яблоко" });
    expect(result.ошибки).toEqual([{ номер: 1, причина: "Приложение не приняло картинку" }]);
    expect(logError.mock.calls.flat().join("\n")).toMatch(/диск полон/);
  });
});

describe("generate_images: предел картинок за ход", () => {
  it("считает по turnId через вызовы и наборы tools(); лишние — в ошибках без заказа; новый ход — заново", async () => {
    const runware = fakeRunware();
    const { images } = setup(runware.fetch, { maxImagesPerTurn: 2 });

    const first = await generate(images.tools(turn), { prompt: "Яблоко", count: 3 });
    expect(first.создано).toBe(2);
    expect(first.ошибки).toEqual([{ номер: 3, причина: expect.stringContaining("2") }]);
    // Повтор хода (другая попытка, запасной провайдер) — новый набор tools() с тем же turnId.
    const retry = await generate(images.tools(turn), { prompt: "Груша" });
    expect(retry.создано).toBe(0);
    const next = await generate(images.tools({ ...turn, turnId: "answer-2" }), { prompt: "Слива" });
    expect(next.создано).toBe(1);
    expect(runware.sent).toHaveLength(3);
  });

  it("без turnId предел — на набор tools()", async () => {
    const runware = fakeRunware();
    const { images } = setup(runware.fetch, { maxImagesPerTurn: 1 });
    const tools = images.tools({ ownerId: "anna", chatId: "chat-1" });
    expect((await generate(tools, { prompt: "Яблоко" })).создано).toBe(1);
    expect((await generate(tools, { prompt: "Груша" })).создано).toBe(0);
    expect((await generate(images.tools({ ownerId: "anna", chatId: "chat-1" }), { prompt: "Слива" })).создано).toBe(1);
  });

  it("отказ лимита расходов место хода не занимает", async () => {
    const runware = fakeRunware();
    const { images, limits } = setup(runware.fetch, { maxImagesPerTurn: 1 });
    limits.assertWithinLimit.mockRejectedValueOnce(new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null }));
    expect(await generate(images.tools(turn), { prompt: "Яблоко" })).toEqual({ отказ: "лимит расходов исчерпан" });
    expect((await generate(images.tools(turn), { prompt: "Груша" })).создано).toBe(1);
  });
});

describe("generate_images в фоне (mode: background)", () => {
  it("ответ сразу после отправки, с полями onQueued; опрос с шагом pollIntervalMs; готовая — во вложения и в onLateImage", async () => {
    fakeClock();
    const kie = fakeKie({ states: { 1: { state: "success", credits: 0.8 } } });
    const onQueued = vi.fn(async () => ({ место: "hero" }));
    const { images, storage, usage, onLateImage } = setup(kie.fetch, { mode: "background", model: "z-image", pollIntervalMs: 3_000, onQueued });

    const result = await generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "3:2" });
    expect(result).toEqual({ заказано: 1, принято: 1, задачи: [{ номер: 1, id: expect.any(String), место: "hero" }], сообщение: expect.any(String) });
    expect(onQueued).toHaveBeenCalledWith(expect.objectContaining({ id: result.задачи[0].id, ownerId: "anna", chatId: "chat-1", turnId: "answer-1", status: "generating" }));
    expect(kie.checks).toHaveLength(0);

    await pass(2_999);
    expect(kie.checks).toHaveLength(0);
    await pass(1);
    expect(kie.checks).toHaveLength(1);
    expect(onLateImage).toHaveBeenCalledTimes(1);
    const late = onLateImage.mock.calls[0]![0];
    expect(late).toMatchObject({ ownerId: "anna", chatId: "chat-1", number: 1, prompt: "Красное яблоко", aspectRatio: "3:2", modelId: "z-image" });
    expect(await storage.get(late.attachmentId)).toMatchObject({ chatId: "chat-1", ownerId: "anna", kind: "image", attached: true, name: "image-1.png" });
    expect(usage.map((record) => record.costUsd)).toEqual([0.004]);
  });

  it("описание постоянное и говорит, что картинка придёт сама; повтор вызова не советует", () => {
    const { images } = setup(fakeKie().fetch, { mode: "background", model: "z-image" });
    const first = images.tools(turn).generate_images!.description!;
    expect(images.tools({ ownerId: "boris", chatId: "chat-9", turnId: "x" }).generate_images!.description).toBe(first);
    expect(first).toMatch(/в фоне/);
    expect(first).not.toMatch(/повтори вызов/);
  });

  it("свой приёмник: получает номер, ход и id задачи; вложения и onLateImage не трогаются", async () => {
    fakeClock();
    const kie = fakeKie({ states: { 1: { state: "success", credits: 0.8 } } });
    let currentInside: boolean | undefined;
    const deliver = vi.fn(async (_image: GeneratedImage, _delivery: ImageDelivery, context: ImageDeliveryContext) => {
      currentInside = await context.isCurrent();
      return { path: "img/hero.webp" };
    });
    const { images, save, onLateImage } = setup(kie.fetch, { mode: "background", model: "z-image", pollIntervalMs: 3_000, deliver });
    const result = await generate(images.tools(turn), { prompt: "Красное яблоко" });
    await pass(3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]![1]).toEqual({
      ownerId: "anna",
      chatId: "chat-1",
      turnId: "answer-1",
      number: 1,
      prompt: "Красное яблоко",
      aspectRatio: "1:1",
      modelId: "z-image",
      jobId: result.задачи[0].id,
    });
    expect(currentInside).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(onLateImage).not.toHaveBeenCalled();
  });

  it("попытки: после срока попытки — та же задача, без новой оплаты", async () => {
    fakeClock();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { images, usage, onLateImage } = setup(kie.fetch, { mode: "background", model: "z-image", pollIntervalMs: 3_000, requestTimeoutMs: 90_000, attempts: 2, lateResultWindowMs: 0 });
    await generate(images.tools(turn), { prompt: "Красное яблоко" });
    await pass(90_000);
    kie.states[1] = { state: "success", credits: 0.8 };
    await pass(3_000);
    expect(onLateImage).toHaveBeenCalledTimes(1);
    expect(kie.tasks).toHaveLength(1);
    expect(usage.map((record) => record.costUsd)).toEqual([0.004]);
  });

  it("лимит расходов — заказа нет, причина в ошибках; «Стоп» до начала — ничего не заказано", async () => {
    fakeClock();
    const kie = fakeKie();
    const { images, limits } = setup(kie.fetch, { mode: "background", model: "z-image" });
    limits.assertWithinLimit.mockRejectedValueOnce(new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null }));
    expect(await generate(images.tools(turn), { prompt: "Яблоко" })).toEqual({ заказано: 1, принято: 0, задачи: [], ошибки: [{ номер: 1, причина: "лимит расходов исчерпан" }] });
    const stopped = new AbortController();
    stopped.abort();
    expect(await generate(images.tools(turn), { prompt: "Яблоко" }, stopped.signal)).toMatchObject({ заказано: 1, принято: 0, остановлено: true });
    expect(kie.tasks).toHaveLength(0);
  });

  it("stop() снимает таймеры; новая генерация на том же хранилище задач доводит картинку", async () => {
    fakeClock();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const jobStore = memoryImageJobStore();
    const first = setup(kie.fetch, { mode: "background", model: "z-image", pollIntervalMs: 3_000, jobStore });
    await generate(first.images.tools(turn), { prompt: "Красное яблоко" });
    await first.images.stop();
    expect(vi.getTimerCount()).toBe(0);

    kie.states[1] = { state: "success", credits: 0.8 };
    const second = setup(kie.fetch, { mode: "background", model: "z-image", pollIntervalMs: 3_000, jobStore });
    await flush();
    expect(second.onLateImage).toHaveBeenCalledTimes(1);
    expect(kie.tasks).toHaveLength(1);
  });

  it("предел за ход работает и в фоне", async () => {
    fakeClock();
    const kie = fakeKie();
    const { images } = setup(kie.fetch, { mode: "background", model: "z-image", maxImagesPerTurn: 1 });
    const result = await generate(images.tools(turn), { prompt: "Яблоко", count: 2 });
    expect(result).toMatchObject({ заказано: 2, принято: 1, ошибки: [{ номер: 2, причина: expect.stringContaining("1") }] });
    expect(kie.tasks).toHaveLength(1);
  });

  it("один заказ из нескольких упал — принятые отданы модели, упавший в ошибках, его место хода возвращено", async () => {
    fakeClock();
    const kie = fakeKie();
    const base = memoryImageJobStore();
    let inserts = 0;
    const jobStore = {
      ...base,
      async insert(job: Parameters<typeof base.insert>[0]) {
        if (++inserts === 2) throw new Error("база недоступна");
        return base.insert(job);
      },
    };
    const { images, logError } = setup(kie.fetch, { mode: "background", model: "z-image", maxImagesPerTurn: 2, jobStore });
    const result = await generate(images.tools(turn), { prompt: "Яблоко", count: 2 });
    expect(result).toMatchObject({ заказано: 2, принято: 1, задачи: [{ id: expect.any(String) }], ошибки: [{ причина: "Не удалось заказать картинку" }] });
    expect(kie.tasks).toHaveLength(1);
    expect(logError.mock.calls.flat().join("\n")).toMatch(/база недоступна/);
    expect(await generate(images.tools(turn), { prompt: "Груша" })).toMatchObject({ принято: 1 });
  });

  it("прежний режим: start и stop есть и ничего не ломают", async () => {
    const runware = fakeRunware();
    const { images } = setup(runware.fetch);
    await expect(images.start()).resolves.toBeUndefined();
    await expect(images.stop()).resolves.toBeUndefined();
    expect(runware.fetch).not.toHaveBeenCalled();
  });
});
