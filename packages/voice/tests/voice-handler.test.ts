import { describe, expect, it, vi } from "vitest";
import { createVoiceHandler } from "../src/server";
import type { VoiceHandlerOptions } from "../src/server";

const MAIN_KEY = "main-secret-key-0123456789";
const TEMPORARY_KEY = "temp:ABCDEF";

interface SonioxCall {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** Подмена `fetch`: Soniox отвечает временным ключом, все обращения записываются. */
function fakeSoniox(respond?: () => Response | Promise<Response>) {
  const calls: SonioxCall[] = [];
  const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return (
      (await respond?.()) ??
      Response.json({ api_key: TEMPORARY_KEY, expires_at: "2026-09-30T02:32:16.399Z" }, { status: 201 })
    );
  });
  return { calls, fetch: fetchStub as unknown as typeof fetch };
}

function handlerWith(options: Partial<VoiceHandlerOptions> = {}, soniox = fakeSoniox()) {
  const logged: string[] = [];
  const handler = createVoiceHandler({
    basePath: "/api/voice",
    resolveUser: async () => ({ id: "anna" }),
    apiKey: MAIN_KEY,
    fetch: soniox.fetch,
    logError: (message) => logged.push(message),
    ...options,
  });
  return { handler, soniox, logged };
}

const sessionRequest = (init?: RequestInit) => new Request("http://app.test/api/voice/session", { method: "POST", ...init });

describe("обработчик голоса: параметры сессии", () => {
  it("вошедшему пользователю отдаёт временный ключ и параметры распознавания", async () => {
    const { handler } = handlerWith();

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apiKey: TEMPORARY_KEY,
      expiresAt: "2026-09-30T02:32:16.399Z",
      websocketUrl: "wss://stt-rt.soniox.com/transcribe-websocket",
      model: "stt-rt-v5",
      languageHints: ["ru"],
      maxSessionSeconds: 300,
    });
  });

  it("ключ у Soniox просит одноразовый, только на распознавание, с ограничением длины сессии, от имени пользователя", async () => {
    const { handler, soniox } = handlerWith();

    await handler.fetch(sessionRequest());

    expect(soniox.calls).toHaveLength(1);
    const [call] = soniox.calls;
    expect(call?.url).toBe("https://api.soniox.com/v1/auth/temporary-api-key");
    expect(call?.method).toBe("POST");
    expect(call?.headers.get("authorization")).toBe(`Bearer ${MAIN_KEY}`);
    expect(call?.body).toEqual({
      usage_type: "transcribe_websocket",
      expires_in_seconds: 60,
      single_use: true,
      max_session_duration_seconds: 300,
      client_reference_id: "anna",
    });
  });

  it("главного ключа нет ни в теле ответа, ни в заголовках", async () => {
    const { handler } = handlerWith();

    const response = await handler.fetch(sessionRequest());

    expect(JSON.stringify(await response.json())).not.toContain(MAIN_KEY);
    expect([...response.headers.values()].join("\n")).not.toContain(MAIN_KEY);
  });

  it("resolveUser отказал словами приложения — их и получает человек, без кэша; к Soniox не ходит", async () => {
    const refused = { code: "no_course", message: "Нужен доступ к курсу", status: 401 as const };
    const { handler, soniox } = handlerWith({ resolveUser: async () => ({ refused }) });

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" } });
    expect(soniox.calls).toHaveLength(0);
  });

  it("отказ без статуса — 403; неверный код — 503 service_unavailable и строка в журнале", async () => {
    const closed = handlerWith({ resolveUser: async () => ({ refused: { code: "no_course", message: "Закрыто" } }) });
    expect((await closed.handler.fetch(sessionRequest())).status).toBe(403);

    const broken = handlerWith({ resolveUser: async () => ({ refused: { code: "Нет Доступа", message: "x" } }) });
    expect((await broken.handler.fetch(sessionRequest())).status).toBe(503);
    expect(broken.logged.length).toBeGreaterThan(0);
  });

  it("без пользователя — 401, к Soniox не ходит", async () => {
    const { handler, soniox } = handlerWith({ resolveUser: async () => null });

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect(soniox.calls).toHaveLength(0);
  });

  it("настройки: адреса, заголовки к API, модель, язык, подсказка, сроки", async () => {
    const soniox = fakeSoniox();
    const { handler } = handlerWith(
      {
        apiBaseUrl: "https://proxy.test/soniox/",
        websocketUrl: "wss://ws.proxy.test/stt",
        apiHeaders: { "X-Proxy-Token": "proxy-token" },
        model: "stt-rt-v6",
        languageHints: ["ru", "en"],
        context: { text: "Разговор про бухгалтерию", terms: ["УСН"] },
        tokenLifetimeSeconds: 30,
        maxSessionSeconds: 120,
      },
      soniox,
    );

    const response = await handler.fetch(sessionRequest());

    expect(await response.json()).toMatchObject({
      websocketUrl: "wss://ws.proxy.test/stt",
      model: "stt-rt-v6",
      languageHints: ["ru", "en"],
      context: { text: "Разговор про бухгалтерию", terms: ["УСН"] },
    });
    const [call] = soniox.calls;
    expect(call?.url).toBe("https://proxy.test/soniox/v1/auth/temporary-api-key");
    expect(call?.headers.get("x-proxy-token")).toBe("proxy-token");
    expect(call?.body).toMatchObject({ expires_in_seconds: 30, max_session_duration_seconds: 120 });
  });

  it("главный ключ берётся из env.SONIOX_API_KEY, если явно не задан", async () => {
    const soniox = fakeSoniox();
    const handler = createVoiceHandler({
      basePath: "/api/voice",
      resolveUser: async () => ({ id: "anna" }),
      env: { SONIOX_API_KEY: "key-from-env" },
      fetch: soniox.fetch,
    });

    await handler.fetch(sessionRequest());

    expect(soniox.calls[0]?.headers.get("authorization")).toBe("Bearer key-from-env");
  });
});

describe("обработчик голоса: сбои", () => {
  it("Soniox отказал — 502 «сервис недоступен», в журнале причина без ключей", async () => {
    const soniox = fakeSoniox(() => Response.json({ error_type: "limit_exceeded", message: "Too many" }, { status: 429 }));
    const { handler, logged } = handlerWith({}, soniox);

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { kind: "service_unavailable" } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("429");
    expect(logged.join("\n")).not.toContain(MAIN_KEY);
  });

  it("сеть упала — 502, в журнале нет ключа, даже если он попал в текст ошибки", async () => {
    const soniox = fakeSoniox(() => {
      throw new Error(`connect failed for Bearer ${MAIN_KEY}`);
    });
    const { handler, logged } = handlerWith({}, soniox);

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(502);
    expect(logged).toHaveLength(1);
    expect(logged.join("\n")).not.toContain(MAIN_KEY);
  });

  it("неожиданное тело ответа Soniox — 502", async () => {
    const { handler } = handlerWith({}, fakeSoniox(() => Response.json({ hello: "world" }, { status: 201 })));

    expect((await handler.fetch(sessionRequest())).status).toBe(502);
  });

  it("Soniox молчит дольше 10 секунд — 502", async () => {
    vi.useFakeTimers();
    try {
      const hanging = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ) as unknown as typeof fetch;
      const { handler } = handlerWith({ fetch: hanging });

      const pending = handler.fetch(sessionRequest());
      await vi.advanceTimersByTimeAsync(10_001);

      expect((await pending).status).toBe(502);
    } finally {
      vi.useRealTimers();
    }
  });

  it("нет главного ключа — 503, в журнале сказано, чего не хватает", async () => {
    const soniox = fakeSoniox();
    const logged: string[] = [];
    const handler = createVoiceHandler({
      basePath: "/api/voice",
      resolveUser: async () => ({ id: "anna" }),
      env: {},
      fetch: soniox.fetch,
      logError: (message) => logged.push(message),
    });

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { kind: "service_unavailable" } });
    expect(logged.join("\n")).toContain("SONIOX_API_KEY");
    expect(soniox.calls).toHaveLength(0);
  });

  it("свой путь и метод только один: остальное — 404", async () => {
    const { handler } = handlerWith();

    for (const [url, method] of [
      ["http://app.test/api/voice", "POST"],
      ["http://app.test/api/voice/session", "GET"],
      ["http://app.test/api/voice/other", "POST"],
      ["http://app.test/api/voice/session/extra", "POST"],
      ["http://app.test/api/chat/session", "POST"],
    ] as const) {
      const response = await handler.fetch(new Request(url, { method }));
      expect(response.status, `${method} ${url}`).toBe(404);
    }
  });

  it("basePath: слэш на конце не мешает", async () => {
    const { handler } = handlerWith({ basePath: "/api/voice/" });

    expect(handler.basePath).toBe("/api/voice");
    expect((await handler.fetch(sessionRequest())).status).toBe(200);
  });
});

describe("обработчик голоса: осторожность с ключом", () => {
  it("ответ с ключом и отказы не кэшируются", async () => {
    const { handler } = handlerWith();
    const ok = await handler.fetch(sessionRequest());
    const denied = await handlerWith({ resolveUser: async () => null }).handler.fetch(sessionRequest());

    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(denied.headers.get("cache-control")).toBe("no-store");
  });

  it("resolveUser упал — понятный отказ 503 с видом service_unavailable, в журнале причина, Soniox не тронут", async () => {
    const { handler, soniox, logged } = handlerWith({
      resolveUser: async () => {
        throw new Error("база сессий недоступна");
      },
    });

    const response = await handler.fetch(sessionRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { kind: "service_unavailable" } });
    expect(logged.join("\n")).toContain("база сессий недоступна");
    expect(soniox.calls).toHaveLength(0);
  });
});

describe("обработчик голоса: частота выдачи ключей", () => {
  const limited = (maxSessions: number, perSeconds: number, clock: { now: number }) =>
    handlerWith({ rateLimit: { maxSessions, perSeconds }, now: () => clock.now });

  it("сверх лимита — 429 с Retry-After и видом rate_limited; ключ у Soniox не запрашивается", async () => {
    const clock = { now: 1_000_000 };
    const { handler, soniox } = limited(2, 60, clock);

    expect((await handler.fetch(sessionRequest())).status).toBe(200);
    clock.now += 10_000;
    expect((await handler.fetch(sessionRequest())).status).toBe(200);
    clock.now += 10_000;
    const refused = await handler.fetch(sessionRequest());

    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("40");
    expect(await refused.json()).toEqual({ error: { kind: "rate_limited" } });
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(soniox.calls).toHaveLength(2);
  });

  it("лимит у каждого пользователя свой", async () => {
    const clock = { now: 1_000_000 };
    let user = "anna";
    const { handler } = handlerWith({ rateLimit: { maxSessions: 1, perSeconds: 60 }, now: () => clock.now, resolveUser: async () => ({ id: user }) });

    expect((await handler.fetch(sessionRequest())).status).toBe(200);
    expect((await handler.fetch(sessionRequest())).status).toBe(429);
    user = "boris";
    expect((await handler.fetch(sessionRequest())).status).toBe(200);
  });

  it("окно прошло — снова можно", async () => {
    const clock = { now: 1_000_000 };
    const { handler } = limited(1, 60, clock);

    await handler.fetch(sessionRequest());
    expect((await handler.fetch(sessionRequest())).status).toBe(429);
    clock.now += 60_001;

    expect((await handler.fetch(sessionRequest())).status).toBe(200);
  });

  it("по умолчанию — десять выдач в минуту на пользователя", async () => {
    const { handler } = handlerWith();

    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) statuses.push((await handler.fetch(sessionRequest())).status);

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });

  it("`rateLimit: false` выключает ограничение", async () => {
    const { handler } = handlerWith({ rateLimit: false });

    for (let attempt = 0; attempt < 30; attempt += 1) expect((await handler.fetch(sessionRequest())).status).toBe(200);
  });

  it("отказ по неавторизации в лимит не засчитывается", async () => {
    const { handler } = handlerWith({ rateLimit: { maxSessions: 1, perSeconds: 60 }, resolveUser: async () => null });

    expect((await handler.fetch(sessionRequest())).status).toBe(401);
    expect((await handler.fetch(sessionRequest())).status).toBe(401);
  });
});
