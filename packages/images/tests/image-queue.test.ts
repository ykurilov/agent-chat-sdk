import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createImageGeneration } from "../src/index";
import type { CreateImageGenerationOptions } from "../src/index";
import { executeOptions, KEY } from "./support/fake-runware";
import { fakeKie, KIE_KEY } from "./support/fake-kie";

const NOW = new Date("2026-10-05T10:00:00.000Z");
const turn = { ownerId: "anna", chatId: "chat-1" };

function setup(kie = fakeKie(), overrides: Partial<CreateImageGenerationOptions> = {}) {
  const storage = createMemoryAttachmentStorage();
  const usage: UsageRecord[] = [];
  const logError = vi.fn();
  const onLateImage = vi.fn();
  const limits = { assertWithinLimit: vi.fn(async (_input: { userId: string; chatId: string; pendingUsd?: { user: number; chat: number } }) => {}) };
  const images = createImageGeneration({
    attachments: { storage },
    env: { KIE_API_KEY: KIE_KEY, RUNWARE_API_KEY: KEY },
    fetch: kie.fetch,
    model: "z-image",
    spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) }, limits },
    logError,
    onLateImage,
    now: () => NOW,
    requestTimeoutMs: 30_000,
    lateResultWindowMs: 120_000,
    ...overrides,
  });
  return { images, storage, usage, logError, limits, onLateImage, kie };
}

async function generate(tools: ToolSet, input: Record<string, unknown>, abortSignal?: AbortSignal) {
  const parsed = await asSchema(tools.generate_images!.inputSchema).validate!(input);
  if (!parsed.success) throw parsed.error;
  return (await tools.generate_images!.execute!(parsed.value as never, executeOptions(abortSignal))) as Record<string, any>;
}

const costs = (usage: UsageRecord[]) => usage.map(({ modelId, providerId, costUsd }) => ({ modelId, providerId, costUsd: Math.round(costUsd * 1e6) / 1e6 }));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("очередь KIE в generate_images", () => {
  it("z-image: задача, опрос, картинка сохранена в чат, расход ценой KIE (кредиты × $0.005)", async () => {
    const { images, storage, usage, kie } = setup(fakeKie({ states: { 1: { state: "success", credits: 0.8 } } }));
    const call = generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "3:2" });
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await call;

    expect(result).toEqual({ создано: 1, заказано: 1, картинки: [{ номер: 1, id: expect.any(String), ширина: expect.any(Number), высота: expect.any(Number) }] });
    expect(kie.tasks).toEqual([{ number: 1, taskId: "task-1", model: "z-image", input: { prompt: "Красное яблоко", aspect_ratio: "4:3" } }]);
    expect(await storage.get(result.картинки[0].id)).toMatchObject({ chatId: "chat-1", ownerId: "anna", kind: "image", attached: true, name: "image-1.png" });
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
  });

  it("не успела к сроку — итог «готовится, повтори», расхода пока нет; повтор того же вызова ждёт старую задачу, новой платной нет", async () => {
    const { images, usage, kie, onLateImage } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(30_000);
    const late = await first;
    expect(late).toMatchObject({ создано: 0, заказано: 1, картинки: [], ошибки: [{ номер: 1, причина: expect.stringMatching(/повтори/), готовится: true }] });
    expect(usage).toEqual([]);

    const second = generate(images.tools(turn), { prompt: "Красное яблоко" });
    kie.states[1] = { state: "success", credits: 0.8 };
    await vi.advanceTimersByTimeAsync(10_000);
    const repeated = await second;
    expect(repeated).toMatchObject({ создано: 1, картинки: [{ номер: 1 }] });
    expect(kie.tasks).toHaveLength(1);
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
    expect(onLateImage).not.toHaveBeenCalled();
  });

  it("результат с опозданием: опрос идёт в фоне, картинка сохраняется, расход пишется, приложение узнаёт через onLateImage; повтор отдаёт её сразу и бесплатно", async () => {
    const { images, storage, usage, kie, onLateImage } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "16:9" });
    await vi.advanceTimersByTimeAsync(30_000);
    await first;

    kie.states[1] = { state: "success", credits: 0.8 };
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(onLateImage).toHaveBeenCalledTimes(1));
    const late = onLateImage.mock.calls[0]![0];
    expect(late).toEqual({
      ownerId: "anna",
      chatId: "chat-1",
      number: 1,
      attachmentId: expect.any(String),
      mediaType: "image/png",
      width: expect.any(Number),
      height: expect.any(Number),
      prompt: "Красное яблоко",
      aspectRatio: "16:9",
      modelId: "z-image",
    });
    expect(await storage.get(late.attachmentId)).toMatchObject({ chatId: "chat-1", attached: true });
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
    const downloads = kie.downloads.length;

    // Повтор отдаёт готовую сразу: ни задачи, ни проверки, ни скачивания, ни расхода.
    const checks = kie.checks.length;
    const repeated = await generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "16:9" });
    expect(repeated).toMatchObject({ создано: 1, картинки: [{ номер: 1, id: late.attachmentId }] });
    expect(kie.tasks).toHaveLength(1);
    expect(kie.checks).toHaveLength(checks);
    expect(kie.downloads).toHaveLength(downloads);
    expect(usage).toHaveLength(1);

    // Отданная картинка «израсходована»: следующий такой же вызов — новая картинка.
    const again = generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "16:9" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await again).картинки[0].id).not.toBe(late.attachmentId);
    expect(kie.tasks).toHaveLength(2);
  });

  it("фоновое окно кончилось без результата — расход по цене модели один раз; повтор сначала проверяет старую задачу и второй раз не платит", async () => {
    const { images, usage, kie, onLateImage } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.005 }]);
    const checks = kie.checks.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(kie.checks).toHaveLength(checks);

    kie.states[1] = { state: "success", credits: 0.8 };
    const repeated = await generate(images.tools(turn), { prompt: "Красное яблоко" });
    expect(repeated).toMatchObject({ создано: 1, картинки: [{ номер: 1 }] });
    expect(kie.checks).toHaveLength(checks + 1);
    expect(kie.tasks).toHaveLength(1);
    expect(usage).toHaveLength(1);
    expect(onLateImage).not.toHaveBeenCalled();
  });

  it("«Стоп» во время опроса: опрос обрывается, ушедшая задача — в расход по цене модели; повтор проверяет её, а не платит заново", async () => {
    const { images, usage, kie } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    const stop = new AbortController();
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" }, stop.signal);
    await vi.advanceTimersByTimeAsync(3_000);
    stop.abort();
    expect(await first).toMatchObject({ создано: 0, заказано: 1, остановлено: true });
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.005 }]);
    const checks = kie.checks.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(kie.checks).toHaveLength(checks);

    kie.states[1] = { state: "success", credits: 0.8 };
    const repeated = await generate(images.tools(turn), { prompt: "Красное яблоко" });
    expect(repeated).toMatchObject({ создано: 1 });
    expect(kie.tasks).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("повтор узнаётся по человеку, чату, модели, описанию, пропорции и номеру: другое — новая задача", async () => {
    const { images, kie } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    const others = [
      generate(images.tools(turn), { prompt: "Зелёное яблоко" }),
      generate(images.tools(turn), { prompt: "Красное яблоко", aspectRatio: "9:16" }),
      generate(images.tools({ ownerId: "anna", chatId: "chat-2" }), { prompt: "Красное яблоко" }),
      generate(images.tools({ ownerId: "boris", chatId: "chat-1" }), { prompt: "Красное яблоко" }),
      generate(images.tools(turn), { prompt: "Красное яблоко", count: 2 }),
    ];
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.all(others);
    // Пять новых вызовов, у последнего картинка №1 — повтор старой, №2 — новая.
    expect(kie.tasks).toHaveLength(6);
  });

  it("задача в фоне видна лимиту как заказанное, но не записанное", async () => {
    const { images, limits } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    const next = generate(images.tools(turn), { prompt: "Груша" });
    await vi.advanceTimersByTimeAsync(2_000);
    await next;
    expect(limits.assertWithinLimit).toHaveBeenLastCalledWith({ userId: "anna", chatId: "chat-1", pendingUsd: { user: 0.005, chat: 0.005 } });
  });

  it("без фонового окна (lateResultWindowMs: 0) опрос кончается со сроком: расход по цене модели, повтор всё равно сначала проверяет задачу", async () => {
    const { images, usage, kie } = setup(fakeKie({ states: { 1: { state: "generating" } } }), { lateResultWindowMs: 0 });
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await first).toMatchObject({ ошибки: [{ номер: 1, готовится: true }] });
    expect(usage).toHaveLength(1);
    kie.states[1] = { state: "success", credits: 0.8 };
    expect(await generate(images.tools(turn), { prompt: "Красное яблоко" })).toMatchObject({ создано: 1 });
    expect(kie.tasks).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("провал задачи у KIE — причина в итоге, расход ценой из ответа; повтор создаёт новую задачу", async () => {
    const { images, usage, kie } = setup(fakeKie({ states: { 1: { state: "fail", failMsg: "Content blocked", credits: 0 } } }));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await first).toMatchObject({ создано: 0, ошибки: [{ номер: 1, причина: expect.stringContaining("Content blocked") }] });
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0 }]);
    kie.states[2] = { state: "success" };
    const second = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await second).toMatchObject({ создано: 1 });
    expect(kie.tasks).toHaveLength(2);
  });

  it("сбой onLateImage не роняет сервер: запись в журнал", async () => {
    const { images, onLateImage, logError, kie } = setup(fakeKie({ states: { 1: { state: "generating" } } }));
    onLateImage.mockRejectedValueOnce(new Error("приложение упало"));
    const first = generate(images.tools(turn), { prompt: "Красное яблоко" });
    await vi.advanceTimersByTimeAsync(30_000);
    await first;
    kie.states[1] = { state: "success" };
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining("приложение упало")));
  });
});

describe("назначения: агент выбирает модель параметром purpose", () => {
  const purposes = {
    picture: { description: "картинка без текста", model: "z-image" },
    "with-text": { description: "картинка с надписью", model: "seedream-5-flash-kie" },
    "no-background": { description: "предмет без фона, PNG с прозрачностью", model: "z-image", removeBackground: { model: "seedream-5-flash-layers" } },
  };

  it("схема: purpose из назначений, по умолчанию первое; описание перечисляет назначения и постоянно", async () => {
    const { images } = setup(fakeKie(), { model: undefined, purposes });
    const first = images.tools(turn);
    const second = images.tools({ ownerId: "boris", chatId: "chat-9" });
    expect(first.generate_images!.description).toBe(second.generate_images!.description);
    for (const [name, purpose] of Object.entries(purposes)) {
      expect(first.generate_images!.description).toContain(name);
      expect(first.generate_images!.description).toContain(purpose.description);
    }
    const schema = asSchema(first.generate_images!.inputSchema);
    expect(await schema.validate!({ prompt: "Кот" })).toEqual({ success: true, value: { prompt: "Кот", purpose: "picture", count: 1, aspectRatio: "1:1" } });
    expect((await schema.validate!({ prompt: "Кот", purpose: "video" })).success).toBe(false);
    expect(await asSchema(first.generate_images!.inputSchema).jsonSchema).toEqual(await asSchema(second.generate_images!.inputSchema).jsonSchema);
  });

  it("модель задачи — по назначению", async () => {
    const { images, kie } = setup(fakeKie(), { model: undefined, purposes });
    const call = generate(images.tools(turn), { prompt: "Вывеска «Кофе»", purpose: "with-text" });
    await vi.advanceTimersByTimeAsync(2_000);
    await call;
    expect(kie.tasks[0]).toMatchObject({ model: "seedream/5-flash-text-to-image", input: { prompt: "Вывеска «Кофе»", aspect_ratio: "1:1", size: "1K", output_format: "png" } });
  });

  it("без фона: сначала генерация, потом разделение на слои по её адресу; сохраняется слой предмета, расход — за оба шага", async () => {
    const kie = fakeKie({
      states: {
        1: { state: "success", urls: ["https://tempfile.kie.test/base.png"], credits: 0.8 },
        2: { state: "success", urls: ["https://tempfile.kie.test/background.png", "https://tempfile.kie.test/subject.png"], credits: 6.48 },
      },
    });
    const { images, usage, storage } = setup(kie, { model: undefined, purposes });
    const call = generate(images.tools(turn), { prompt: "Красное яблоко", purpose: "no-background" });
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await call;

    expect(result).toMatchObject({ создано: 1, картинки: [{ номер: 1 }] });
    expect(kie.tasks[1]).toMatchObject({
      model: "seedream/5-flash-layer-decomposition",
      input: { prompt: expect.stringMatching(/single layer/), image_url: "https://tempfile.kie.test/base.png", size: "1K", output_format: "png" },
    });
    expect(kie.downloads).toEqual(["https://tempfile.kie.test/subject.png"]);
    expect(await storage.get(result.картинки[0].id)).toMatchObject({ mediaType: "image/png" });
    expect(costs(usage)).toEqual([
      { modelId: "z-image", providerId: "kie", costUsd: 0.004 },
      { modelId: "seedream-5-flash-layers", providerId: "kie", costUsd: 0.0324 },
    ]);
  });

  it("без фона, разделение не успело: повтор не платит за генерацию второй раз и проверяет разделение", async () => {
    const kie = fakeKie({ states: { 1: { state: "success", credits: 0.8 }, 2: { state: "generating" } } });
    const { images, usage } = setup(kie, { model: undefined, purposes, lateResultWindowMs: 0 });
    const first = generate(images.tools(turn), { prompt: "Красное яблоко", purpose: "no-background" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await first).toMatchObject({ ошибки: [{ номер: 1, готовится: true }] });
    kie.states[2] = { state: "success", urls: ["https://tempfile.kie.test/bg.png", "https://tempfile.kie.test/subject.png"], credits: 6.48 };
    expect(await generate(images.tools(turn), { prompt: "Красное яблоко", purpose: "no-background" })).toMatchObject({ создано: 1 });
    expect(kie.tasks).toHaveLength(2);
    expect(usage.map(({ modelId }) => modelId)).toEqual(["z-image", "seedream-5-flash-layers"]);
  });

  it("ошибки настройки назначений — исключение при создании", () => {
    const storage = createMemoryAttachmentStorage();
    const base = { attachments: { storage }, env: { KIE_API_KEY: KIE_KEY, RUNWARE_API_KEY: KEY } };
    expect(() => createImageGeneration({ ...base, model: "z-image", purposes })).toThrow(/purposes/);
    expect(() => createImageGeneration({ ...base, purposes: {} })).toThrow(/purposes/);
    expect(() => createImageGeneration({ ...base, purposes: { a: { description: "x", model: "dall-e-9" } } })).toThrow(/dall-e-9/);
    expect(() => createImageGeneration({ ...base, purposes: { a: { description: "", model: "z-image" } } })).toThrow(/описание/);
    expect(() => createImageGeneration({ ...base, env: { RUNWARE_API_KEY: KEY }, purposes })).toThrow(/KIE_API_KEY/);
    expect(() => createImageGeneration({ ...base, purposes: { a: { description: "x", model: "seedream-5-flash-layers" } } })).toThrow(/исходн/);
    expect(() => createImageGeneration({ ...base, purposes: { a: { description: "x", model: "z-image", removeBackground: { model: "z-image" } } } })).toThrow(/исходн/);
    expect(() => createImageGeneration({ ...base, purposes })).not.toThrow();
  });
});
