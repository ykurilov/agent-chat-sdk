import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationError, kieProvider, standardImageCatalog } from "../src/index";
import type { ImageGenerationRequest, ImageProviderConnection } from "../src/index";
import { json } from "./support/fake-runware";
import { fakeKie, KIE_KEY, KIE_URL } from "./support/fake-kie";

const request = (overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest => ({
  taskUUID: "11111111-2222-4333-8444-555555555555",
  providerModelId: "z-image",
  prompt: "Красное яблоко на столе",
  width: 1024,
  height: 1024,
  aspectRatio: "1:1",
  timeoutMs: 60_000,
  ...overrides,
});

const connection = (fetch: typeof globalThis.fetch, overrides: Partial<ImageProviderConnection> = {}): ImageProviderConnection => ({ apiKey: KIE_KEY, fetch, ...overrides });
const queue = kieProvider.queue!;

async function failureOf(promise: Promise<unknown>): Promise<ImageGenerationError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ImageGenerationError);
    return error as ImageGenerationError;
  }
  throw new Error("ждали ошибку");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("провайдер KIE: отправка задачи", () => {
  it("POST createTask с Bearer-ключом и заголовками подключения: модель, prompt, пропорция и поля профиля во input", async () => {
    const kie = fakeKie();
    const taskId = await queue.submit(
      request({ providerSettings: { size: "1K", output_format: "png" } }),
      connection(kie.fetch, { headers: { "x-proxy-token": "proxy-token-abcdef" } }),
    );

    expect(taskId).toBe("task-1");
    const [url, init] = kie.fetch.mock.calls[0]!;
    expect(url).toBe(`${KIE_URL}/jobs/createTask`);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KIE_KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-proxy-token")).toBe("proxy-token-abcdef");
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "z-image",
      input: { prompt: "Красное яблоко на столе", aspect_ratio: "1:1", size: "1K", output_format: "png" },
    });
  });

  it("правка картинки (разделение на слои): исходник в image_url, пропорции нет — она берётся у исходника", async () => {
    const kie = fakeKie();
    await queue.submit(request({ providerModelId: "seedream/5-flash-layer-decomposition", imageUrl: "https://tempfile.kie.test/base.png" }), connection(kie.fetch));
    expect(kie.tasks[0]!.input).toEqual({ prompt: "Красное яблоко на столе", image_url: "https://tempfile.kie.test/base.png" });
  });

  it("адрес подключения из каталога (прокси) заменяет адрес по умолчанию", async () => {
    const kie = fakeKie();
    await queue.submit(request(), connection(kie.fetch, { baseURL: "https://proxy.test/kie/api/v1" }));
    expect(kie.fetch.mock.calls[0]![0]).toBe("https://proxy.test/kie/api/v1/jobs/createTask");
  });

  it("отказ 4xx (в теле или статусом) — до работы, расхода нет; 5xx — задача могла уйти; ключ в причину не попадает", async () => {
    const refused = await failureOf(queue.submit(request(), connection(vi.fn(async () => json({ code: 402, msg: `Credits insufficient for ${KIE_KEY}` })))));
    expect(refused.refusedBeforeWork).toBe(true);
    expect(refused.reason).toContain("402");
    expect(refused.reason).toContain("Credits insufficient");
    expect(refused.reason).not.toContain(KIE_KEY);

    const byStatus = await failureOf(queue.submit(request(), connection(vi.fn(async () => json({ code: 422, msg: "prompt too long" }, 422)))));
    expect(byStatus).toMatchObject({ refusedBeforeWork: true, reason: expect.stringContaining("prompt too long") });

    const broken = await failureOf(queue.submit(request(), connection(vi.fn(async () => json({ code: 500, msg: "Server error" })))));
    expect(broken.refusedBeforeWork).toBe(false);

    const offline = await failureOf(queue.submit(request(), connection(vi.fn(async () => Promise.reject(new TypeError("fetch failed"))))));
    expect(offline).toMatchObject({ refusedBeforeWork: false, reason: "Провайдер недоступен" });
  });

  it("«Стоп» во время отправки пробрасывается как есть", async () => {
    const stop = new AbortController();
    stop.abort(new DOMException("stop", "AbortError"));
    await expect(queue.submit(request({ abortSignal: stop.signal }), connection(fakeKie().fetch))).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("провайдер KIE: состояние задачи", () => {
  it("ждёт — pending; готово — адреса из resultJson и цена кредитами × $0.005; провал — причина и цена", async () => {
    const kie = fakeKie({ states: { 1: { state: "queuing" } } });
    await queue.submit(request(), connection(kie.fetch));
    expect(await queue.check("task-1", connection(kie.fetch))).toEqual({ status: "pending" });
    expect(kie.fetch.mock.calls[1]![0]).toBe(`${KIE_URL}/jobs/recordInfo?taskId=task-1`);
    expect(new Headers(kie.fetch.mock.calls[1]![1]?.headers).get("authorization")).toBe(`Bearer ${KIE_KEY}`);

    kie.states[1] = { state: "success", urls: ["https://tempfile.kie.test/a.png", "https://tempfile.kie.test/b.png"], credits: 12.96 };
    const ready = await queue.check("task-1", connection(kie.fetch));
    expect(ready).toEqual({
      status: "ready",
      results: [{ url: "https://tempfile.kie.test/a.png", costUsd: expect.closeTo(0.0648, 10) }, { url: "https://tempfile.kie.test/b.png" }],
    });

    kie.states[1] = { state: "fail", failMsg: "Content blocked", credits: 0 };
    expect(await queue.check("task-1", connection(kie.fetch))).toEqual({ status: "failed", failureKind: "unknown", providerCode: "500", reason: expect.stringContaining("Content blocked"), costUsd: 0 });
  });

  it("неизвестная задача — провал «не найдена»; сбой сети и 5xx — обычная ошибка (опрос повторит)", async () => {
    const kie = fakeKie();
    expect(await queue.check("task-404", connection(kie.fetch))).toEqual({ status: "failed", reason: expect.stringMatching(/не найдена/) });
    await expect(queue.check("task-1", connection(vi.fn(async () => Promise.reject(new TypeError("fetch failed")))))).rejects.not.toBeInstanceOf(ImageGenerationError);
    await expect(queue.check("task-1", connection(vi.fn(async () => json({ code: 500, msg: "busy" }, 500))))).rejects.not.toBeInstanceOf(ImageGenerationError);
  });

  it("неверный ключ при проверке — ImageGenerationError: опрашивать дальше бессмысленно", async () => {
    const failure = await failureOf(queue.check("task-1", connection(vi.fn(async () => json({ code: 401, msg: "Unauthorized" })))));
    expect(failure.reason).toContain("401");
  });
});

describe("провайдер KIE: generate — задача и опрос с нарастающим интервалом", () => {
  it("опрашивает с нарастающим интервалом до готовности и отдаёт адреса", async () => {
    vi.useFakeTimers();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const done = kieProvider.generate(request(), connection(kie.fetch));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(kie.checks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(kie.checks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(kie.checks).toHaveLength(2);
    kie.states[1] = { state: "success", credits: 0.8 };
    await vi.advanceTimersByTimeAsync(4_500);
    expect(await done).toEqual([{ url: "https://tempfile.kie.test/1-0.png", costUsd: expect.closeTo(0.004, 10) }]);
    expect(kie.checks).toHaveLength(3);
  });

  it("интервал не растёт выше 10 с; срок вышел — «не ответил за N с», задача могла выполниться", async () => {
    vi.useFakeTimers();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const failure = failureOf(kieProvider.generate(request({ timeoutMs: 60_000 }), connection(kie.fetch)));
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await failure;
    expect(error).toMatchObject({ refusedBeforeWork: false, reason: "Провайдер не ответил за 60 с" });
    // 2 + 3 + 4,5 + 6,75 + 10 + 10 + 10 + 10 = 56,25 с — восемь проверок, девятая упирается в срок.
    expect(kie.checks.length).toBeGreaterThanOrEqual(8);
    expect(kie.checks.length).toBeLessThanOrEqual(9);
  });

  it("сбой сети во время опроса не роняет задачу: следующая проверка", async () => {
    vi.useFakeTimers();
    const kie = fakeKie();
    let first = true;
    const flaky = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("recordInfo") && first) {
        first = false;
        throw new TypeError("fetch failed");
      }
      return kie.fetch(input, init);
    });
    const done = kieProvider.generate(request(), connection(flaky as typeof globalThis.fetch));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await done).toEqual([{ url: "https://tempfile.kie.test/1-0.png" }]);
  });

  it("провал задачи — ImageGenerationError с причиной KIE", async () => {
    vi.useFakeTimers();
    const kie = fakeKie({ states: { 1: { state: "fail", failMsg: "NSFW" } } });
    const failure = failureOf(kieProvider.generate(request(), connection(kie.fetch)));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await failure).toMatchObject({ refusedBeforeWork: false, reason: expect.stringContaining("NSFW") });
  });

  it("«Стоп» во время опроса — сразу, без следующих проверок", async () => {
    vi.useFakeTimers();
    const kie = fakeKie({ states: { 1: { state: "generating" } } });
    const stop = new AbortController();
    const done = kieProvider.generate(request({ abortSignal: stop.signal }), connection(kie.fetch));
    const settled = done.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_500);
    stop.abort(new DOMException("stop", "AbortError"));
    expect(await settled).toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(kie.checks).toHaveLength(1);
  });
});

describe("KIE в стандартном каталоге", () => {
  it("провайдер kie с ключом KIE_API_KEY и три модели: z-image, Seedream 5 Flash, разделение на слои", () => {
    expect(standardImageCatalog.providers.map((provider) => provider.id)).toEqual(["runware", "kie"]);
    expect(kieProvider).toMatchObject({ id: "kie", apiKeyEnv: "KIE_API_KEY", baseURL: KIE_URL });
    const kieModels = standardImageCatalog.models.filter((model) => model.providerModelIds.kie !== undefined);
    expect(kieModels.map((model) => [model.id, model.providerModelIds.kie])).toEqual([
      ["z-image", "z-image"],
      ["seedream-5-flash-kie", "seedream/5-flash-text-to-image"],
      ["seedream-5-flash-layers", "seedream/5-flash-layer-decomposition"],
    ]);
    const layers = kieModels[2]!;
    expect(layers).toMatchObject({ needsSourceImage: true, firstResultIsBase: true });
    // z-image не знает 3:2 и 2:3 — ближайшие 4:3 и 3:4.
    expect(kieModels[0]!.aspectRatioValues).toEqual({ "3:2": "4:3", "2:3": "3:4" });
  });
});
