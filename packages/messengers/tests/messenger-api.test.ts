import { describe, expect, it, vi } from "vitest";
import { createMessengerApi, MessengerApiError } from "../src/messenger-api";

const TOKEN = "123456:telegram-bot-token-abcdef";

function recordingFetch(response: Response | Error = new Response("{}")) {
  const calls: Array<{ url: string; headers: Headers }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("messenger-api: адрес, прокси, чистка секретов", () => {
  it("по умолчанию — официальный адрес", async () => {
    const recorder = recordingFetch();
    const original = globalThis.fetch;
    globalThis.fetch = recorder.fetch;
    try {
      const api = createMessengerApi({ messenger: "telegram", token: TOKEN, defaultBaseUrl: "https://api.telegram.org" });
      await api.fetch(`/bot${TOKEN}/getMe`);
    } finally {
      globalThis.fetch = original;
    }
    expect(recorder.calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
  });

  it("baseUrl и заголовки прокси уходят в каждый запрос", async () => {
    const recorder = recordingFetch();
    const original = globalThis.fetch;
    globalThis.fetch = recorder.fetch;
    try {
      const api = createMessengerApi({
        messenger: "telegram",
        token: TOKEN,
        defaultBaseUrl: "https://api.telegram.org",
        api: { baseUrl: "https://proxy.example.com/tg/", headers: { "X-Proxy-Key": "proxy-secret-value" } },
      });
      expect(api.baseUrl).toBe("https://proxy.example.com/tg");
      await api.fetch("/method", { headers: { "Content-Type": "application/json" } });
    } finally {
      globalThis.fetch = original;
    }
    expect(recorder.calls[0]?.url).toBe("https://proxy.example.com/tg/method");
    expect(recorder.calls[0]?.headers.get("x-proxy-key")).toBe("proxy-secret-value");
    expect(recorder.calls[0]?.headers.get("content-type")).toBe("application/json");
  });

  it("своя функция fetch заменяет общую, адрес остаётся официальным", async () => {
    const recorder = recordingFetch();
    const api = createMessengerApi({ messenger: "vk", token: TOKEN, defaultBaseUrl: "https://api.vk.com", api: { fetch: recorder.fetch } });
    await api.fetch("/method/messages.send");
    expect(recorder.calls[0]?.url).toBe("https://api.vk.com/method/messages.send");
  });

  it("сбой сети: токен и значения заголовков вычищены из текста ошибки", async () => {
    const recorder = recordingFetch(new Error(`connect failed https://api.telegram.org/bot${TOKEN}/send header=proxy-secret-value`));
    const api = createMessengerApi({
      messenger: "telegram",
      token: TOKEN,
      defaultBaseUrl: "https://api.telegram.org",
      api: { fetch: recorder.fetch },
    });
    const withHeaders = createMessengerApi({
      messenger: "telegram",
      token: TOKEN,
      defaultBaseUrl: "https://api.telegram.org",
      api: { baseUrl: "https://proxy.example.com", headers: { "X-Proxy-Key": "proxy-secret-value" } },
    });
    const failure = await api.fetch(`/bot${TOKEN}/send`).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MessengerApiError);
    expect(String((failure as Error).message)).not.toContain(TOKEN);
    expect(String((failure as Error).message)).toContain("telegram");
    expect(withHeaders.hideSecrets(`ответ: proxy-secret-value и ${TOKEN}`)).toBe("ответ: [скрыто] и [скрыто]");
  });

  it("значение заголовка короче 8 знаков — ошибка сразу при создании", () => {
    expect(() =>
      createMessengerApi({ messenger: "max", token: TOKEN, defaultBaseUrl: "https://platform-api.max.ru", api: { headers: { "X-Key": "short" } } }),
    ).toThrow(/max: значение заголовка «X-Key» короче 8 знаков/);
  });

  it("ошибка API несёт код ответа и текст без секретов", () => {
    const api = createMessengerApi({ messenger: "telegram", token: TOKEN, defaultBaseUrl: "https://api.telegram.org" });
    const error = api.error(400, `Bad Request: token ${TOKEN} wrong`);
    expect(error).toBeInstanceOf(MessengerApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("telegram: Bad Request: token [скрыто] wrong");
  });
});
