import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationError, runwareProvider } from "../src/index";
import type { ImageGenerationRequest, ImageProviderConnection } from "../src/index";

const KEY = "rw-key-0123456789";
const PROXY_TOKEN = "proxy-token-abcdef";

const request = (overrides: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest => ({
  taskUUID: "11111111-2222-4333-8444-555555555555",
  providerModelId: "openai:gpt-image@2",
  prompt: "Логотип кофейни",
  width: 816,
  height: 816,
  providerSettings: { providerSettings: { openai: { quality: "low" } } },
  timeoutMs: 150_000,
  ...overrides,
});

function connection(fetch: typeof globalThis.fetch, overrides: Partial<ImageProviderConnection> = {}): ImageProviderConnection {
  return { apiKey: KEY, fetch, ...overrides };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const imageData = (cost?: number) => ({
  data: [{ taskType: "imageInference", taskUUID: request().taskUUID, imageUUID: "img-1", imageURL: "https://im.runware.ai/image/img-1.jpg", ...(cost !== undefined && { cost }) }],
});

/** Поддельный `fetch`: отдаёт заданный ответ и помнит запросы. */
function fakeFetch(answer: Response | (() => Response | Promise<Response>)) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (typeof answer === "function" ? answer() : answer.clone()));
}

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

describe("провайдер Runware (T041)", () => {
  it("POST на адрес по умолчанию: Bearer-ключ, JSON, заголовки подключения; тело — массив из одной задачи по договору", async () => {
    const fetch = fakeFetch(json(imageData(0.0071)));
    const results = await runwareProvider.generate(request(), connection(fetch, { headers: { "x-proxy-token": PROXY_TOKEN } }));

    expect(results).toEqual([{ url: "https://im.runware.ai/image/img-1.jpg", costUsd: 0.0071 }]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.runware.ai/v1");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-proxy-token")).toBe(PROXY_TOKEN);
    expect(JSON.parse(String(init?.body))).toEqual([
      {
        taskType: "imageInference",
        taskUUID: request().taskUUID,
        model: "openai:gpt-image@2",
        positivePrompt: "Логотип кофейни",
        width: 816,
        height: 816,
        numberResults: 1,
        outputType: "URL",
        outputFormat: "JPG",
        deliveryMethod: "sync",
        includeCost: true,
        providerSettings: { openai: { quality: "low" } },
      },
    ]);
  });

  it("адрес подключения (прокси) вместо адреса по умолчанию; настройки GPT Image 2.5 — полем settings", async () => {
    const fetch = fakeFetch(json(imageData()));
    const results = await runwareProvider.generate(
      request({ providerModelId: "openai:gpt-image@2.5-flare", providerSettings: { settings: { quality: "low" } } }),
      connection(fetch, { baseURL: "https://proxy.test/runware/v1" }),
    );
    expect(results).toEqual([{ url: "https://im.runware.ai/image/img-1.jpg" }]);
    expect(fetch.mock.calls[0]![0]).toBe("https://proxy.test/runware/v1");
    const [task] = JSON.parse(String(fetch.mock.calls[0]![1]?.body)) as Array<Record<string, unknown>>;
    expect(task!.settings).toEqual({ quality: "low" });
    expect(task!.providerSettings).toBeUndefined();
  });

  it("errors[] с отказом 400: причина — код и короткий текст; отказ до работы; ключ и заголовки вычищены", async () => {
    const fetch = fakeFetch(
      json({ errors: [{ code: "invalidPositivePrompt", message: `Prompt rejected for key ${KEY} via ${PROXY_TOKEN}`, taskUUID: request().taskUUID }] }, 400),
    );
    const error = await failureOf(runwareProvider.generate(request(), connection(fetch, { headers: { "x-proxy-token": PROXY_TOKEN } })));
    expect(error.refusedBeforeWork).toBe(true);
    expect(error.reason).toContain("invalidPositivePrompt");
    expect(error.reason).toContain("Prompt rejected");
    expect(`${error.reason} ${error.message} ${error.stack}`).not.toContain(KEY);
    expect(`${error.reason} ${error.message} ${error.stack}`).not.toContain(PROXY_TOKEN);
  });

  it.each([
    [401, "invalidApiKey"],
    [402, "insufficientCredits"],
    [429, "rateLimitExceeded"],
  ])("ответ %i (%s) — отказ до работы", async (status, code) => {
    const fetch = fakeFetch(json({ errors: [{ code, message: "no" }] }, status));
    const error = await failureOf(runwareProvider.generate(request(), connection(fetch)));
    expect(error.refusedBeforeWork).toBe(true);
    expect(error.reason).toContain(code);
  });

  it("ответ 500 — сбой после отправки: расход возможен", async () => {
    const fetch = fakeFetch(new Response("upstream broke", { status: 502 }));
    const error = await failureOf(runwareProvider.generate(request(), connection(fetch)));
    expect(error.refusedBeforeWork).toBe(false);
    expect(error.reason).toContain("502");
  });

  it("ответ 200 без картинки, только errors[] — сбой задачи с причиной", async () => {
    const fetch = fakeFetch(json({ errors: [{ code: "contentModeration", message: "Blocked" }] }));
    const error = await failureOf(runwareProvider.generate(request(), connection(fetch)));
    expect(error.refusedBeforeWork).toBe(false);
    expect(error.reason).toContain("contentModeration");
  });

  it("обрыв связи: «провайдер недоступен», текст исходной ошибки с ключом наружу не идёт", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError(`connect ECONNREFUSED https://user:${KEY}@proxy.test`);
    });
    const error = await failureOf(runwareProvider.generate(request(), connection(fetch)));
    expect(error.refusedBeforeWork).toBe(false);
    expect(`${error.reason} ${error.message}`).not.toContain(KEY);
    expect(error.reason).toMatch(/недоступен/);
  });

  it("срок задачи: не ответил за timeoutMs — сбой «не успел», запрос оборван", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () => reject(signal!.reason));
        }),
    );
    const pending = failureOf(runwareProvider.generate(request({ timeoutMs: 150_000 }), connection(fetch)));
    await vi.advanceTimersByTimeAsync(149_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(signal?.aborted).toBe(true);
    expect(error.refusedBeforeWork).toBe(false);
    expect(error.reason).toMatch(/150 с/);
  });

  it("«Стоп» (общий abortSignal) обрывает запрос и пробрасывается как остановка, а не сбой задачи", async () => {
    const stop = new AbortController();
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const pending = runwareProvider.generate(request({ abortSignal: stop.signal }), connection(fetch));
    stop.abort();
    await expect(pending).rejects.not.toBeInstanceOf(ImageGenerationError);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
