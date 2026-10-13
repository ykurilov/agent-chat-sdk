import { afterEach, describe, expect, it, vi } from "vitest";
import { createTextPolisher } from "../src/server";
import type { PolishOptions } from "../src/server";

afterEach(() => vi.useRealTimers());

const TOGETHER_KEY = "together-secret-key-0123456789";
const dirty = "ну э-э привет как бы это проверка проверка голоса";
const clean = "Привет, это проверка голоса.";

interface Call {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    max_tokens: number;
    reasoning?: { enabled: boolean };
  };
  signal: AbortSignal | null | undefined;
}

function togetherReply(content: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ choices: [{ message: { content } }] }) } as unknown as Response;
}

function polisherWith(options: Partial<Extract<PolishOptions, { provider: "together" }>> = {}, answer: (call: Call) => Promise<Response> = async () => togetherReply(clean)) {
  const calls: Call[] = [];
  const logged: string[] = [];
  const fetchStub = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
      signal: init?.signal,
    };
    calls.push(call);
    return answer(call);
  });
  const polisher = createTextPolisher(
    { provider: "together", apiKey: TOGETHER_KEY, fetch: fetchStub as unknown as typeof fetch, ...options },
    (message) => logged.push(message),
  );
  return { polisher: polisher!, calls, logged };
}

describe("чистка текста: запрос к модели", () => {
  it("Together, OpenAI-совместимый чат: ключ в заголовке, модель из каталога, без рассуждений, без случайности", async () => {
    const { polisher, calls } = polisherWith();

    await polisher(dirty);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.together.xyz/v1/chat/completions");
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOGETHER_KEY}`);
    expect(calls[0]!.headers["User-Agent"]).toBeTruthy();
    expect(calls[0]!.body).toMatchObject({ model: "deepseek-ai/DeepSeek-V4.1-Flash", temperature: 0, reasoning: { enabled: false } });
    expect(calls[0]!.body.max_tokens).toBeGreaterThan(0);
  });

  it("модель и адрес настраиваются", async () => {
    const { polisher, calls } = polisherWith({ model: "vendor/other-model", baseUrl: "https://proxy.test/v1/" });

    await polisher(dirty);

    expect(calls[0]!.url).toBe("https://proxy.test/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("vendor/other-model");
  });

  it("через прокси: свои заголовки идут вместе с ключом", async () => {
    const { polisher, calls } = polisherWith({
      baseUrl: "https://proxy.example.com/together/v1",
      headers: { "X-Proxy-Token": "proxy-token-0123456789" },
    });

    await polisher(dirty);

    expect(calls[0]!.url).toBe("https://proxy.example.com/together/v1/chat/completions");
    expect(calls[0]!.headers["X-Proxy-Token"]).toBe("proxy-token-0123456789");
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${TOGETHER_KEY}`);
  });

  it("Authorization в своих заголовках (в любом регистре) — ошибка настройки: ключ задаётся отдельно", () => {
    for (const name of ["Authorization", "authorization"]) {
      expect(() => polisherWith({ headers: { [name]: "Bearer чужой" } })).toThrow(/Authorization/);
    }
  });

  it("значения своих заголовков вычищаются из журнала, как ключ", async () => {
    const proxyToken = "proxy-token-0123456789";
    const { polisher, logged } = polisherWith({ headers: { "X-Proxy-Token": proxyToken } }, async () => Promise.reject(new Error(`прокси отклонил токен ${proxyToken}`)));

    expect(await polisher(dirty)).toBeNull();

    expect(logged.join("\n")).toContain("прокси отклонил");
    expect(logged.join("\n")).not.toContain(proxyToken);
  });

  it("постоянная инструкция первой, надиктованный текст последним; инструкция не зависит от текста (кэш модели)", async () => {
    const { polisher, calls } = polisherWith();

    await polisher(dirty);
    await polisher("совсем другой текст");

    const [first, second] = calls.map((call) => call.body.messages);
    expect(first!.map((message) => message.role)).toEqual(["system", "user"]);
    expect(first![0]).toEqual(second![0]);
    expect(first![1]!.content).toContain(dirty);
    expect(first![1]!.content.endsWith("</dictation>")).toBe(true);
    expect(second![1]!.content).toContain("совсем другой текст");
  });

  it("инструкция запрещает отвечать, пересказывать, менять смысл и язык", async () => {
    const { polisher, calls } = polisherWith();

    await polisher("как тебя зовут");

    const instruction = calls[0]!.body.messages[0]!.content;
    expect(instruction).toMatch(/не отвечай/i);
    expect(instruction).toMatch(/не пересказывай/i);
    expect(instruction).toMatch(/язык/i);
    expect(instruction).toMatch(/знаки препинания/i);
  });
});

describe("чистка текста: ответ модели", () => {
  it("возвращает исправленный текст без пробелов по краям", async () => {
    const { polisher } = polisherWith({}, async () => togetherReply(`  ${clean}\n`));

    expect(await polisher(dirty)).toBe(clean);
  });

  it("если модель вернула текст вместе с нашими тегами, теги снимаются", async () => {
    const { polisher } = polisherWith({}, async () => togetherReply(`<dictation>\n${clean}\n</dictation>`));

    expect(await polisher(dirty)).toBe(clean);
  });

  it.each([
    ["пустой ответ", async () => togetherReply("   ")],
    ["нет текста", async () => togetherReply(undefined)],
    ["HTTP 500", async () => togetherReply("ошибка", 500)],
    ["HTTP 429", async () => togetherReply("лимит", 429)],
    ["сеть упала", async () => Promise.reject(new TypeError("fetch failed"))],
    ["не JSON", async () => ({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError("bad")) }) as unknown as Response],
  ])("%s — текст остаётся как есть (null), причина в журнале без ключа", async (_name, answer) => {
    const { polisher, logged } = polisherWith({}, answer);

    expect(await polisher(dirty)).toBeNull();

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain(TOGETHER_KEY);
  });

  it("модель «ответила на вопрос» и раздула текст — берём текст Soniox", async () => {
    const answer = "Меня зовут Ассистент, и я с радостью помогу вам с любым вопросом, который у вас появится. ".repeat(3);
    const { polisher } = polisherWith({}, async () => togetherReply(answer));

    expect(await polisher("как тебя зовут")).toBeNull();
  });

  it("модель ответила коротко вместо чистки («как тебя зовут» → «Меня зовут Ассистент.») — берём текст Soniox", async () => {
    const { polisher, logged } = polisherWith({}, async () => togetherReply("Меня зовут Ассистент."));

    expect(await polisher("как тебя зовут")).toBeNull();
    expect(logged.length).toBeGreaterThan(0);
  });

  it("модель отказалась выполнять просьбу из текста — берём текст Soniox", async () => {
    const { polisher } = polisherWith({}, async () => togetherReply("Извините, я не могу рассказать анекдот."));

    expect(await polisher("расскажи анекдот про кота и собаку")).toBeNull();
  });

  it("ответ намного короче исходника (модель пересказала или обрезала) — берём текст Soniox", async () => {
    const { polisher } = polisherWith({}, async () => togetherReply("Привет."));

    expect(await polisher(dirty)).toBeNull();
  });

  it.each([
    ["вопрос остаётся вопросом", "как тебя зовут", "Как тебя зовут?"],
    ["регистр и знаки препинания не мешают", "привет как дела что нового", "Привет! Как дела? Что нового?"],
    ["«ё» и «е» — одно и то же слово", "все ещё не пришёл", "Все еще не пришел."],
    ["слова-паразиты убраны, остальное на месте", dirty, clean],
    ["короткая фраза", "привет", "Привет."],
  ])("нормальная чистка проходит: %s", async (_name, original, answer) => {
    const { polisher } = polisherWith({}, async () => togetherReply(answer));

    expect(await polisher(original)).toBe(answer);
  });

  it("большая часть слов ответа должна быть в исходнике: новые слова — признак ответа, а не чистки", async () => {
    const { polisher } = polisherWith({}, async () => togetherReply("Сегодня хорошая погода, но вечером обещают сильный дождь и ветер."));

    expect(await polisher("сегодня хорошая погода но вечером что-то будет")).toBeNull();
  });

  it("слишком длинный текст в модель не отправляется", async () => {
    const { polisher, calls } = polisherWith();

    expect(await polisher("слово ".repeat(3000))).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("чистка текста: сроки", () => {
  it("модель молчит дольше 5 секунд — запрос отменён, текст остаётся как есть", async () => {
    vi.useFakeTimers();
    const { polisher, calls, logged } = polisherWith({}, (call) => new Promise<Response>((_resolve, reject) => call.signal?.addEventListener("abort", () => reject(new Error("aborted")))));

    const result = polisher(dirty);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls[0]!.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(await result).toBeNull();
    expect(calls[0]!.signal?.aborted).toBe(true);
    expect(logged.join("\n")).toContain("5");
  });

  it("срок настраивается", async () => {
    vi.useFakeTimers();
    const { polisher } = polisherWith({ timeoutMs: 1_000 }, (call) => new Promise<Response>((_resolve, reject) => call.signal?.addEventListener("abort", () => reject(new Error("aborted")))));

    const result = polisher(dirty);
    await vi.advanceTimersByTimeAsync(1_001);

    expect(await result).toBeNull();
  });

  it("быстрый ответ не оставляет таймер", async () => {
    vi.useFakeTimers();
    const { polisher } = polisherWith();

    expect(await polisher(dirty)).toBe(clean);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("чистка текста: ключ и своя функция", () => {
  it("ключ из окружения сервера", async () => {
    const { polisher, calls } = polisherWith({ apiKey: undefined, env: { TOGETHER_API_KEY: "env-key" } });

    await polisher(dirty);

    expect(calls[0]!.headers.Authorization).toBe("Bearer env-key");
  });

  it("нет ключа — чистки нет (не падаем), причина в журнале", () => {
    const logged: string[] = [];

    const polisher = createTextPolisher({ provider: "together", env: {} }, (message) => logged.push(message));

    expect(polisher).toBeNull();
    expect(logged.join("\n")).toContain("TOGETHER_API_KEY");
  });

  it("своя функция чистки: те же сроки и те же защиты", async () => {
    vi.useFakeTimers();
    const logged: string[] = [];
    const polisher = createTextPolisher({ clean: async (text) => text.toUpperCase(), timeoutMs: 1_000 }, (message) => logged.push(message))!;
    expect(await polisher("привет")).toBe("ПРИВЕТ");

    const slow = createTextPolisher({ clean: () => new Promise(() => undefined), timeoutMs: 1_000 }, (message) => logged.push(message))!;
    const result = slow("привет");
    await vi.advanceTimersByTimeAsync(1_001);
    expect(await result).toBeNull();

    const broken = createTextPolisher({ clean: async () => Promise.reject(new Error("сломалось")) }, (message) => logged.push(message))!;
    expect(await broken("привет")).toBeNull();
    expect(logged.join("\n")).toContain("сломалось");
  });
});
