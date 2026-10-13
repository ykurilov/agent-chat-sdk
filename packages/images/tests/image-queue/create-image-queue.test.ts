import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOVE_BACKGROUND_PROMPT, memoryImageJobStore } from "../../src/index";
import type { ImageDeliveryContext, ImageJob, ImageJobRecord, ImageJobStore, ImageQueue } from "../../src/index";
import { deferred, fakeRunware, hanging, json, ready } from "../support/fake-runware";
import { fakeKie, KIE_KEY } from "../support/fake-kie";
import { costs, flush, order, queueSetup, stopQueues, usageBook } from "./queue-harness";

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-05T10:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(async () => {
  await stopQueues();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Заказ, который очередь приняла: отказ здесь — ошибка теста. */
async function ordered(queue: ImageQueue, input: Parameters<ImageQueue["order"]>[0] = order): Promise<ImageJob> {
  const job = await queue.order(input);
  if (job.status === "refused") throw new Error(`заказ отклонён: ${job.reason}`);
  return job;
}

/** Время вперёд и дать дойти всем цепочкам после него. */
async function pass(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
}

const RESULT_1 = "https://tempfile.kie.test/1-0.png";

describe("createImageQueue: картинка — приёмнику приложения", () => {
  it("ответ сразу после отправки задачи; готовая картинка — в приёмник с данными заказа; расход — ровно один", async () => {
    const kie = fakeKie({ states: { 1: { state: "success", credits: 0.8 } } });
    const { queue, usage, delivered, deliver, limits } = queueSetup(kie);

    const job = await ordered(queue);
    expect(job).toMatchObject({ status: "generating", key: order.key, ownerId: "anna", chatId: "chat-1", turnId: "answer-1", group: "app-1", prompt: order.prompt, aspectRatio: "1:1", data: order.data, attempt: 1 });
    expect(kie.tasks).toHaveLength(1);
    expect(kie.checks).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();

    await pass(3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    const [{ image, job: seen }] = delivered as [(typeof delivered)[number]];
    expect(image).toMatchObject({ mediaType: "image/png", modelId: "z-image", width: 1024, height: 1024 });
    expect(image.bytes).toBeInstanceOf(Uint8Array);
    expect(seen).toMatchObject({ id: job.id, key: order.key, data: order.data, prompt: order.prompt });
    expect(await queue.get(job.id)).toMatchObject({ status: "ready", result: { path: "img/hero.webp" } });
    expect(await queue.list({ ownerId: "anna", group: "app-1" })).toMatchObject([{ id: job.id, status: "ready" }]);
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
    expect(usage[0]).toMatchObject({ ownerId: "anna", chatId: "chat-1", source: "images" });
    expect(limits.afterSpending).toHaveBeenCalledWith({ userId: "anna", chatId: "chat-1" });
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0, chat: 0 });
  });

  it("приёмник вернул false (место занято) — задача «отброшена», без ошибки", async () => {
    const { queue, deliver, logError } = queueSetup();
    deliver.mockResolvedValueOnce(false as never);
    const job = await ordered(queue);
    await pass(3_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "discarded" });
    expect(logError).not.toHaveBeenCalled();
  });

  it("вытеснение во время доставки: приёмник видит его по ctx.signal и ctx.isCurrent()", async () => {
    const kie = fakeKie({ states: { 2: { state: "generating" } } });
    const { queue, deliver } = queueSetup(kie);
    const gate = deferred<void>();
    let context: ImageDeliveryContext | undefined;
    let currentAtStart: boolean | undefined;
    deliver.mockImplementationOnce(async (_image, _job, received) => {
      context = received;
      currentAtStart = await received!.isCurrent();
      await gate.promise;
      return (await received!.isCurrent()) ? { path: "img/hero.webp" } : false;
    });
    const first = await ordered(queue);
    await pass(3_000);
    expect(currentAtStart).toBe(true);
    expect(context!.signal.aborted).toBe(false);

    await ordered(queue, { ...order, prompt: "Зелёное яблоко" });
    expect(context!.signal.aborted).toBe(true);
    expect(await context!.isCurrent()).toBe(false);
    gate.resolve();
    await flush();
    expect(await queue.get(first.id)).toMatchObject({ status: "superseded" });
  });

  it("проверки — с шагом pollIntervalMs", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { queue } = queueSetup(kie);
    await ordered(queue);
    await pass(2_999);
    expect(kie.checks).toHaveLength(0);
    await pass(1);
    expect(kie.checks).toHaveLength(1);
    await pass(3_000);
    expect(kie.checks).toHaveLength(2);
    await pass(3_000);
    expect(kie.checks).toHaveLength(3);
  });
});

describe("createImageQueue: попытки и позднее окно", () => {
  it("срок попытки вышел — вторая попытка проверяет ту же задачу, новой платной нет", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { queue, usage, deliver } = queueSetup(kie, { attempts: 2 });
    const job = await ordered(queue);
    await pass(90_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "generating", attempt: 2 });
    expect(kie.tasks).toHaveLength(1);
    expect(usage).toEqual([]);

    kie.states[1] = { state: "success", credits: 0.8 };
    await pass(3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(kie.tasks).toHaveLength(1);
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
  });

  it("попытки кончились — «не получилась», но задача опрашивается в позднем окне; пришла — в приёмник", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { queue, usage, deliver } = queueSetup(kie, { lateResultWindowMs: 600_000 });
    const job = await ordered(queue);
    await pass(90_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "failed", reason: expect.stringMatching(/не успела/), lateUntil: expect.any(String) });
    expect(usage).toEqual([]);
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.005, chat: 0.005 });

    kie.states[1] = { state: "success", credits: 0.8 };
    await pass(10_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    const done = await queue.get(job.id);
    expect(done).toMatchObject({ status: "ready" });
    expect(done).not.toHaveProperty("reason");
    expect(done).not.toHaveProperty("lateUntil");
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
  });

  it("позднее окно кончилось без результата — расход по цене модели один раз, опрос остановлен", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const { queue, usage, deliver } = queueSetup(kie, { lateResultWindowMs: 600_000 });
    const job = await ordered(queue);
    await pass(90_000 + 600_000 + 10_000);
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.005 }]);
    const failed = await queue.get(job.id);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed).not.toHaveProperty("lateUntil");
    const checks = kie.checks.length;
    await pass(60_000);
    expect(kie.checks).toHaveLength(checks);
    expect(deliver).not.toHaveBeenCalled();
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0, chat: 0 });
  });

  it("провайдер без очереди (Runware): попытка не успела — оборвана и оплачена по цене модели, вторая — новая задача", async () => {
    const runware = fakeRunware({ tasks: { 1: hanging, 2: ready(2, 0.019) } });
    const { queue, usage, delivered } = queueSetup(runware, { model: "gpt-image-2", attempts: 2 });
    // Провайдер не говорит «принял»: заказ ждёт его ответа не дольше acceptWaitMs (по умолчанию 5 с).
    const pending = queue.order(order);
    await pass(4_999);
    let answered = false;
    void pending.then(() => (answered = true));
    await flush();
    expect(answered).toBe(false);
    await pass(1);
    expect(await pending).toMatchObject({ status: "generating" });
    expect(runware.sent).toHaveLength(1);

    await pass(85_000);
    expect(runware.sent).toHaveLength(2);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.image.modelId).toBe("gpt-image-2");
    expect(costs(usage)).toEqual([
      { modelId: "gpt-image-2", providerId: "runware", costUsd: 0.005 },
      { modelId: "gpt-image-2", providerId: "runware", costUsd: 0.019 },
    ]);
  });
});

describe("createImageQueue: провайдер без очереди", () => {
  it("ответ заказа — после ответа провайдера: ошибка ключа видна сразу, без расхода и доставки", async () => {
    const refusal = () => new Promise<Response>((resolve) => setTimeout(() => resolve(json({ errors: [{ code: "invalidApiKey", message: "no" }] }, 401)), 1_000));
    const runware = fakeRunware({ tasks: { 1: refusal } });
    const { queue, usage, deliver } = queueSetup(runware, { model: "gpt-image-2" });
    const pending = queue.order(order);
    await pass(1_000);
    expect(await pending).toMatchObject({ status: "failed", reason: expect.stringContaining("invalidApiKey") });
    expect(usage).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("createImageQueue: деньги", () => {
  it("отказ провайдера до работы — «не получилась» сразу, без расхода; ключа в причине нет", async () => {
    const kie = fakeKie({ created: { 1: json({ code: 402, msg: `no credits for ${KIE_KEY}` }) } });
    const { queue, usage, deliver } = queueSetup(kie);
    const job = await ordered(queue);
    expect(job).toMatchObject({ status: "failed", reason: expect.stringContaining("KIE 402") });
    expect(job.reason).not.toContain(KIE_KEY);
    await pass(10_000);
    expect(usage).toEqual([]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("проверка зависла — оборвана сроком вызова, опрос идёт дальше", async () => {
    const kie = fakeKie();
    let hung = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/jobs/recordInfo") && hung++ === 0) return hanging(init!);
      return kie.fetch(input, init);
    });
    const { queue, deliver } = queueSetup({ fetch }, { callTimeoutMs: 5_000 });
    await ordered(queue);
    await pass(3_000 + 5_000);
    expect(deliver).not.toHaveBeenCalled();
    expect(hung).toBe(1);
    await pass(3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("отправка зависла — оборвана сроком вызова; ушла ли задача, неизвестно — расход по цене модели", async () => {
    const kie = fakeKie();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (String(input).endsWith("/jobs/createTask") ? hanging(init!) : kie.fetch(input, init)));
    const { queue, usage } = queueSetup({ fetch }, { callTimeoutMs: 5_000 });
    const pending = queue.order(order);
    await pass(5_000);
    expect(await pending).toMatchObject({ status: "failed" });
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.005 }]);
  });

  it("скачивание не удалось — повтор по тому же адресу, новой задачи нет", async () => {
    const kie = fakeKie();
    const downloads: string[] = [];
    let failures = 2;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://tempfile.kie.test/")) {
        downloads.push(String(input));
        if (failures-- > 0) return new Response("bad gateway", { status: 502 });
      }
      return kie.fetch(input, init);
    });
    const { queue, usage, deliver } = queueSetup({ fetch }, { downloadAttempts: 3 });
    await ordered(queue);
    await pass(3_000 + 3_000 + 3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([RESULT_1, RESULT_1, RESULT_1]);
    expect(kie.tasks).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("скачивание не удалось ни разу — «не получилась»; «Повторить» скачивает тот же адрес, без новой задачи и оплаты", async () => {
    const kie = fakeKie();
    const downloads: string[] = [];
    let failures = 3;
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://tempfile.kie.test/")) {
        downloads.push(String(input));
        if (failures-- > 0) return new Response("bad gateway", { status: 502 });
      }
      return kie.fetch(input, init);
    });
    const { queue, usage, deliver } = queueSetup({ fetch }, { downloadAttempts: 3 });
    const job = await ordered(queue);
    await pass(3_000 + 3_000 + 3_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "failed", reason: expect.stringMatching(/не скачалась/) });
    expect(deliver).not.toHaveBeenCalled();

    expect(await queue.retry({ ownerId: "anna", key: order.key })).toMatchObject({ id: job.id, status: "generating" });
    await pass(0);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([RESULT_1, RESULT_1, RESULT_1, RESULT_1]);
    expect(kie.tasks).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("«Повторить» после сбоя скачивания бронирует цену нового заказа: она видна лимиту, пока адрес скачивается снова", async () => {
    const kie = fakeKie({ states: { 2: { state: "generating" } } });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://tempfile.kie.test/") ? new Response("bad gateway", { status: 502 }) : kie.fetch(input, init),
    );
    const { queue, limits } = queueSetup({ fetch }, { downloadAttempts: 3 });
    const job = await ordered(queue);
    await pass(3_000 + 3_000 + 3_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "failed" });
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0, chat: 0 });

    const gate = deferred<void>();
    limits.assertWithinLimit.mockImplementationOnce(() => gate.promise);
    const retried = queue.retry({ ownerId: "anna", key: order.key });
    await flush();
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.005, chat: 0.005 });
    gate.resolve();
    expect(await retried).toMatchObject({ id: job.id, status: "generating" });
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.005, chat: 0.005 });

    await pass(3_000 + 3_000);
    expect(kie.tasks).toHaveLength(2);
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.005, chat: 0.005 });
  });

  it("без фона: второй шаг не удался — «Повторить» заказывает только его, первый не оплачивается заново", async () => {
    const subject = "https://tempfile.kie.test/3-1.png";
    const kie = fakeKie({
      states: {
        1: { state: "success", credits: 0.8 },
        2: { state: "fail", failMsg: "layers failed", credits: 6.48 },
        3: { state: "success", urls: ["https://tempfile.kie.test/3-0.png", subject], credits: 6.48 },
      },
    });
    const { queue, usage, delivered } = queueSetup(kie, {
      model: undefined,
      purposes: { no_background: { model: "z-image", removeBackground: { model: "seedream-5-flash-layers" } } },
    });
    const job = await ordered(queue, { ...order, purpose: "no_background" });
    expect(job.purpose).toBe("no_background");
    await pass(3_000 + 3_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "failed", reason: expect.stringContaining("layers failed") });

    await queue.retry({ ownerId: "anna", key: order.key });
    await pass(3_000);
    expect(kie.tasks.map((task) => task.model)).toEqual(["z-image", "seedream/5-flash-layer-decomposition", "seedream/5-flash-layer-decomposition"]);
    expect(kie.tasks[2]!.input).toMatchObject({ image_url: RESULT_1, prompt: DEFAULT_REMOVE_BACKGROUND_PROMPT });
    expect(kie.downloads.at(-1)).toBe(subject);
    expect(delivered).toHaveLength(1);
    expect(costs(usage)).toEqual([
      { modelId: "z-image", providerId: "kie", costUsd: 0.004 },
      { modelId: "seedream-5-flash-layers", providerId: "kie", costUsd: 0.0324 },
      { modelId: "seedream-5-flash-layers", providerId: "kie", costUsd: 0.0324 },
    ]);
  });

  it("новый заказ на то же место вытесняет прежний: прежний больше не опрашивается и не доставляется, его задача — по цене модели", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" }, 2: { state: "generating" } } });
    const { queue, usage, delivered } = queueSetup(kie);
    const first = await ordered(queue);
    const second = await ordered(queue, { ...order, prompt: "Зелёное яблоко" });
    expect(await queue.get(first.id)).toMatchObject({ status: "superseded" });
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.005 }]);

    kie.states[1] = { state: "success" };
    kie.states[2] = { state: "success", credits: 0.8 };
    await pass(3_000);
    expect(kie.checks.filter((taskId) => taskId === "task-1")).toEqual([]);
    expect(delivered.map(({ job }) => job.id)).toEqual([second.id]);
    expect(costs(usage)).toEqual([
      { modelId: "z-image", providerId: "kie", costUsd: 0.005 },
      { modelId: "z-image", providerId: "kie", costUsd: 0.004 },
    ]);
  });

  it("два одновременных «Повторить» — одна новая платная задача; повтор идущей задачи ничего не заказывает", async () => {
    const kie = fakeKie({ states: { 1: { state: "fail", credits: 0.8 }, 2: { state: "generating" } } });
    const { queue } = queueSetup(kie);
    const job = await ordered(queue);
    await pass(3_000);
    expect(await queue.get(job.id)).toMatchObject({ status: "failed" });

    const [a, b] = await Promise.all([queue.retry({ ownerId: "anna", key: order.key }), queue.retry({ ownerId: "anna", key: order.key })]);
    expect(a).toMatchObject({ id: job.id, status: "generating" });
    expect(b).toMatchObject({ id: job.id, status: "generating" });
    expect(kie.tasks).toHaveLength(2);
    await queue.retry({ ownerId: "anna", key: order.key });
    expect(kie.tasks).toHaveLength(2);
  });

  it("два «Повторить» на двух копиях сервера с одной базой — одна новая платная задача", async () => {
    const kie = fakeKie({ states: { 1: { state: "fail", credits: 0.8 }, 2: { state: "generating" } } });
    const store = memoryImageJobStore();
    const { queue: first } = queueSetup(kie, { store });
    const { queue: second } = queueSetup(kie, { store });
    const job = await ordered(first);
    await pass(3_000);
    const [a, b] = await Promise.all([first.retry({ ownerId: "anna", key: order.key }), second.retry({ ownerId: "anna", key: order.key })]);
    expect(a).toMatchObject({ id: job.id, status: "generating" });
    expect(b).toMatchObject({ id: job.id, status: "generating" });
    expect(kie.tasks).toHaveLength(2);
  });

  it("«Повторить», когда место только что заняла другая копия, — отдаёт её задачу; старая не оживает и не платит", async () => {
    const kie = fakeKie({ states: { 1: { state: "fail", credits: 0.8 } } });
    const base = memoryImageJobStore();
    let competitor: ImageJobRecord | undefined;
    const store: ImageJobStore = {
      ...base,
      async update(id, patch, version) {
        if (competitor && patch.status === "generating") {
          await base.insert(competitor);
          competitor = undefined;
        }
        return base.update(id, patch, version);
      },
    };
    const { queue } = queueSetup(kie, { store });
    const job = await ordered(queue);
    await pass(3_000);
    const failed = (await base.get(job.id))!;
    expect(failed).toMatchObject({ status: "failed" });
    const { reason: _reason, finishedAt: _finished, ...rest } = failed;
    competitor = { ...rest, id: "other", status: "generating", active: true, run: 1, version: 1, steps: [{ charges: [] }], leaseOwner: "copy-b", leaseUntil: "2026-10-05T11:00:00.000Z" };

    expect(await queue.retry({ ownerId: "anna", key: order.key })).toMatchObject({ id: "other", status: "generating" });
    expect(await base.get(job.id)).toMatchObject({ status: "failed" });
    expect(kie.tasks).toHaveLength(1);
  });

  it("параллельные заказы видны в pendingUsd сразу, до первого await; проверка лимита видит заказы перед собой", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" }, 2: { state: "generating" } } });
    const { queue, limits } = queueSetup(kie);
    const gate = deferred<void>();
    limits.assertWithinLimit.mockImplementation(() => gate.promise);

    const first = queue.order({ ...order, key: "a" });
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.005, chat: 0.005 });
    const second = queue.order({ ...order, key: "b", chatId: "chat-2" });
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.01, chat: 0.005 });
    gate.resolve();
    await Promise.all([first, second]);
    expect(limits.assertWithinLimit.mock.calls.map(([input]) => input.pendingUsd)).toEqual([undefined, { user: 0.005, chat: 0 }]);
    // Задачи ушли и не оплачены: всё ещё заказанное.
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0.01, chat: 0.005 });
  });

  it("лимит исчерпан — отказ, бронь снята, задачи нет", async () => {
    const kie = fakeKie();
    const { queue, limits } = queueSetup(kie);
    limits.assertWithinLimit.mockRejectedValueOnce(new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null }));
    expect(await queue.order(order)).toEqual({ status: "refused", reason: "лимит расходов исчерпан" });
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0, chat: 0 });
    expect(kie.tasks).toEqual([]);
    expect(await queue.list({ ownerId: "anna" })).toEqual([]);
  });

  it("предел картинок за ход считается по turnId; отказ лимита место не занимает", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" }, 2: { state: "generating" }, 3: { state: "generating" }, 4: { state: "generating" } } });
    const { queue, limits } = queueSetup(kie, { maxImagesPerTurn: 2 });
    limits.assertWithinLimit.mockRejectedValueOnce(new SpendingLimitReachedError({ scope: "user", period: "day", resetsAt: null }));
    expect(await queue.order({ ...order, key: "a" })).toMatchObject({ status: "refused" });
    await ordered(queue, { ...order, key: "b" });
    await ordered(queue, { ...order, key: "c" });
    expect(await queue.order({ ...order, key: "d" })).toEqual({ status: "refused", reason: expect.stringContaining("2") });
    await ordered(queue, { ...order, key: "e", turnId: "answer-2" });
    expect(kie.tasks).toHaveLength(3);
  });
});

describe("createImageQueue: таймеры, остановка и перезапуск", () => {
  it("таймеры очереди не держат процесс; stop() снимает их, задача остаётся в базе без аренды и продолжается следующим стартом", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const store = memoryImageJobStore();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { queue } = queueSetup(kie, { store });
    const job = await ordered(queue);
    await pass(10_000);
    const timers = setTimeoutSpy.mock.results.map((result) => result.value as { hasRef(): boolean });
    expect(timers.length).toBeGreaterThan(0);
    expect(timers.filter((timer) => timer.hasRef())).toEqual([]);

    await queue.stop();
    expect(vi.getTimerCount()).toBe(0);
    const checks = kie.checks.length;
    await pass(60_000);
    expect(kie.checks).toHaveLength(checks);
    const kept = await store.get(job.id);
    expect(kept).toMatchObject({ status: "generating", active: true });
    expect(kept).not.toHaveProperty("leaseOwner");

    kie.states[1] = { state: "success", credits: 0.8 };
    const { deliver, usage } = queueSetup(kie, { store });
    await pass(0);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(kie.tasks).toHaveLength(1);
    expect(costs(usage)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
  });

  it("stop() посреди заказа: отказ «очередь остановлена», ничего не заказано, аренды и таймеров нет", async () => {
    const kie = fakeKie();
    const base = memoryImageJobStore();
    const gate = deferred<void>();
    const store: ImageJobStore = {
      ...base,
      async insert(job) {
        await gate.promise;
        return base.insert(job);
      },
    };
    const { queue } = queueSetup(kie, { store });
    const pending = queue.order(order);
    await flush();
    const stopping = queue.stop();
    gate.resolve();
    await stopping;
    expect(await pending).toEqual({ status: "refused", reason: "очередь остановлена" });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(kie.tasks).toEqual([]);
    const jobs = await base.list({ ownerId: "anna" });
    expect(jobs.filter((job) => job.leaseOwner !== undefined || job.status === "generating")).toEqual([]);
  });

  it("stop() посреди «Повторить»: отказ «очередь остановлена», аренда отпущена; задача продолжается следующим стартом", async () => {
    const kie = fakeKie({ states: { 1: { state: "fail", credits: 0.8 } } });
    const base = memoryImageJobStore();
    let gate: ReturnType<typeof deferred<void>> | undefined;
    const store: ImageJobStore = {
      ...base,
      async update(id, patch, version) {
        if (gate && patch.status === "generating") await gate.promise;
        return base.update(id, patch, version);
      },
    };
    const { queue } = queueSetup(kie, { store });
    const job = await ordered(queue);
    await pass(3_000);
    expect(await base.get(job.id)).toMatchObject({ status: "failed" });

    gate = deferred<void>();
    const pending = queue.retry({ ownerId: "anna", key: order.key });
    await flush();
    const stopping = queue.stop();
    gate.resolve();
    await stopping;
    expect(await pending).toEqual({ status: "refused", reason: "очередь остановлена" });
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    expect(kie.tasks).toHaveLength(1);
    const kept = await base.get(job.id);
    expect(kept).toMatchObject({ status: "generating", active: true });
    expect(kept).not.toHaveProperty("leaseOwner");

    gate = undefined;
    kie.states[2] = { state: "success", credits: 0.8 };
    const { deliver } = queueSetup(kie, { store });
    await pass(3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(kie.tasks).toHaveLength(2);
  });

  it("сервер упал между записью расхода и отметкой «записан» — после перезапуска второй записи нет, картинка доставлена", async () => {
    const kie = fakeKie({ states: { 1: { state: "success", credits: 0.8 } } });
    const base = memoryImageJobStore();
    let crash = true;
    const store: ImageJobStore = {
      ...base,
      async update(id, patch, version) {
        if (crash && patch.steps?.some((step) => step.charges.some((charge) => charge.recorded))) {
          crash = false;
          throw new Error("сервер упал");
        }
        return base.update(id, patch, version);
      },
    };
    const book = usageBook();
    const { queue: first, deliver: firstDeliver } = queueSetup(kie, { store, spending: { storage: book } });
    const job = await ordered(first);
    await pass(3_000);
    expect(book.records).toHaveLength(1);
    expect(firstDeliver).not.toHaveBeenCalled();
    await first.stop();

    const { deliver } = queueSetup(kie, { store, spending: { storage: book } });
    await pass(60_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(book.records).toHaveLength(1);
    expect(kie.tasks).toHaveLength(1);
    expect(await base.get(job.id)).toMatchObject({ status: "ready", active: false });
  });

  it("временный сбой записи расхода — отметки «записан» нет, задача активна; обход дописывает расход", async () => {
    const kie = fakeKie({ states: { 1: { state: "success", credits: 0.8 } } });
    const store = memoryImageJobStore();
    const book = usageBook();
    let failures = 1;
    const storage = {
      ...book,
      async insertUsageRecord(record: Parameters<typeof book.insertUsageRecord>[0]) {
        if (failures-- > 0) throw new Error("connection reset");
        return book.insertUsageRecord(record);
      },
    };
    const { queue, deliver } = queueSetup(kie, { store, spending: { storage } });
    const job = await ordered(queue);
    await pass(3_000);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(book.records).toEqual([]);
    expect(await store.get(job.id)).toMatchObject({ status: "ready", active: true });

    await pass(30_000);
    expect(costs(book.records)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.004 }]);
    expect(await store.get(job.id)).toMatchObject({ status: "ready", active: false });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("назначения после перезапуска нет — задача «не получилась», ушедшая задача оплачена по цене модели", async () => {
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const store = memoryImageJobStore();
    const book = usageBook();
    const { queue: first } = queueSetup(kie, { store, model: undefined, purposes: { plain: { model: "z-image" } }, spending: { storage: book } });
    const job = await ordered(first, { ...order, purpose: "plain" });
    await first.stop();

    const { queue: second } = queueSetup(kie, { store, model: undefined, purposes: { other: { model: "z-image" } }, spending: { storage: book } });
    await pass(0);
    expect(await second.get(job.id)).toMatchObject({ status: "failed", reason: expect.stringContaining("plain") });
    expect(costs(book.records)).toEqual([{ modelId: "z-image", providerId: "kie", costUsd: 0.005 }]);
  });
});
