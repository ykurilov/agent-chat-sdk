import type { AskModelInput, RecordExternalUsageInput } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import type { FlowJudgeEntry, JudgeMessage, JudgeSettings } from "../src/runtime/flow-types";
import { JUDGE_INPUT_CHARS } from "../src/runtime/judge-context";
import { createFlowJudge, DEFAULT_JUDGE_MODEL } from "../src/runtime/judge";

const FALLBACK = { providerId: "openrouter", modelId: "google/gemini-3-flash" };
const OWNER = "owner-1";
const CHAT = "chat-1";

interface Call {
  url: string;
  body: any;
  headers: Record<string, string>;
}

type FetchBehavior = (call: Call, signal: AbortSignal | undefined) => Promise<Response>;

const decision = (answers: Record<string, number>, usage: Record<string, unknown> = { cost: 0.00002, input_tokens: 480, output_tokens: 9 }) =>
  new Response(
    JSON.stringify({
      id: "gen-dec-1",
      model: "microsoft/microsoft-decision-1-20261009",
      answers: Object.fromEntries(Object.entries(answers).map(([id, noul]) => [id, { type: "noul", noul }])),
      usage,
    }),
    { status: 200 },
  );

interface Setup {
  settings?: Partial<JudgeSettings>;
  fetch?: FetchBehavior;
  /** Ответ запасной модели; функция, чтобы бросить ошибку. */
  ask?: (input: AskModelInput) => { met: string[] } | Error;
  recordUsage?: (input: RecordExternalUsageInput) => Promise<void>;
  env?: Record<string, string | undefined>;
  /** Лимит расходов: бросает, когда исчерпан. */
  limit?: () => Promise<void>;
  /** Журнал судьи бросает. */
  journalFails?: boolean;
}

function setup(options: Setup = {}) {
  const calls: Call[] = [];
  const asked: AskModelInput[] = [];
  const usage: RecordExternalUsageInput[] = [];
  const errors: string[] = [];
  const journal: FlowJudgeEntry[] = [];
  const behavior: FetchBehavior = options.fetch ?? (async () => decision({}));
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), body: JSON.parse(String(init?.body)), headers: init?.headers as Record<string, string> };
    calls.push(call);
    return behavior(call, init?.signal ?? undefined);
  }) as typeof globalThis.fetch;
  const port = () => ({
    askModel: async (input: AskModelInput) => {
      asked.push(input);
      const answer = options.ask?.(input) ?? { met: [] };
      if (answer instanceof Error) throw answer;
      return { text: JSON.stringify(answer), object: answer, usage: { inputTokens: 300, outputTokens: 20, costUsd: 0.001 } };
    },
    recordUsage: async (input: RecordExternalUsageInput) => {
      usage.push(input);
      await options.recordUsage?.(input);
    },
    assertWithinLimit: async () => {
      await options.limit?.();
    },
  });
  const judge = createFlowJudge(
    { fallback: FALLBACK, ...options.settings },
    port,
    {
      fetch,
      env: options.env ?? { OPENROUTER_API_KEY: "sk-or-тест" },
      logError: (message) => errors.push(message),
      logJudge: (entry) => {
        if (options.journalFails) throw new Error("журнал недоступен");
        journal.push(entry);
      },
    },
  );
  return { judge, calls, asked, usage, errors, journal };
}

const talk = (count: number): JudgeMessage[] => Array.from({ length: count }, (_, index) => ({ role: index % 2 === 0 ? "human" : "agent", text: `реплика ${index}` }));

const claim = (overrides: Record<string, unknown> = {}) => ({
  ownerId: OWNER,
  chatId: CHAT,
  exitId: "intro_clear",
  condition: "Понятны тема курса и продажи",
  goal: "Понять тему курса",
  why: "Человек назвал тему и продажи",
  messages: talk(2),
  ...overrides,
});

const all = (overrides: Record<string, unknown> = {}) => ({
  ownerId: OWNER,
  chatId: CHAT,
  goal: "Понять тему курса",
  conditions: [
    { exitId: "own_1", text: "Понятна тема" },
    { exitId: "own_2", text: "Человек отказался" },
    { exitId: "common_1", text: "Просит оператора" },
  ],
  messages: talk(4),
  ...overrides,
});

describe("судья: заявка агента (checkClaim)", () => {
  it("один вопрос noul по id условия; в state — цель, последние сообщения и слова агента", async () => {
    const { judge, calls } = setup({ fetch: async () => decision({ intro_clear: 0.97 }) });
    await judge.checkClaim(claim({ messages: talk(10) }));
    expect(calls).toHaveLength(1);
    const { body, url, headers } = calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(headers.authorization).toBe("Bearer sk-or-тест");
    expect(body.model).toBe(DEFAULT_JUDGE_MODEL);
    expect(Object.keys(body.questions)).toEqual(["intro_clear"]);
    expect(body.questions.intro_clear.type).toBe("noul");
    expect(body.questions.intro_clear.instructions).toContain("Понятны тема курса и продажи");
    expect(body.state.goal).toBe("Понять тему курса");
    expect(body.state.agent_words).toBe("Человек назвал тему и продажи");
    expect(body.state.conversation).toHaveLength(6);
    expect(body.state.conversation.at(-1)).toEqual({ role: "agent", text: "реплика 9" });
  });

  it("реплика длиннее 600 знаков уходит обрезанной", async () => {
    const { judge, calls } = setup({ fetch: async () => decision({ intro_clear: 0.9 }) });
    await judge.checkClaim(claim({ messages: [{ role: "human", text: "б".repeat(3000) }] }));
    for (const message of calls[0]!.body.state.conversation) expect(message.text.length).toBeLessThanOrEqual(600);
  });

  it("порог 0,7: 0,7 и выше — подтверждено, ниже — нет, вероятность сохраняется", async () => {
    for (const [probability, confirmed] of [[0.97, true], [0.7, true], [0.69, false], [0.02, false]] as const) {
      const { judge } = setup({ fetch: async () => decision({ intro_clear: probability }) });
      expect(await judge.checkClaim(claim())).toEqual({ exitId: "intro_clear", probability, confirmed, source: "decision" });
    }
  });

  it("порог настраивается", async () => {
    const { judge } = setup({ settings: { threshold: 0.9 }, fetch: async () => decision({ intro_clear: 0.85 }) });
    expect(await judge.checkClaim(claim())).toMatchObject({ probability: 0.85, confirmed: false });
  });

  it("модель судьи настраивается", async () => {
    const { judge, calls, usage } = setup({ settings: { model: "microsoft/microsoft-decision-2" }, fetch: async () => decision({ intro_clear: 0.9 }) });
    await judge.checkClaim(claim());
    expect(calls[0]!.body.model).toBe("microsoft/microsoft-decision-2");
    expect(usage[0]!.modelId).toBe("microsoft/microsoft-decision-2");
  });

  it("расход из usage.cost пишется в журнал с source judge", async () => {
    const { judge, usage } = setup({ fetch: async () => decision({ intro_clear: 0.9 }, { cost: 0.0000204, input_tokens: 486, output_tokens: 7 }) });
    await judge.checkClaim(claim());
    expect(usage).toEqual([
      { ownerId: OWNER, chatId: CHAT, source: "judge", cost: 0.0000204, inputTokens: 486, outputTokens: 7, modelId: DEFAULT_JUDGE_MODEL, providerId: "openrouter" },
    ]);
  });

  it("не удалось записать расход — решение судьи всё равно возвращается", async () => {
    const { judge, errors } = setup({ fetch: async () => decision({ intro_clear: 0.9 }), recordUsage: async () => { throw new Error("база недоступна"); } });
    expect(await judge.checkClaim(claim())).toMatchObject({ confirmed: true, source: "decision" });
    expect(errors.join("\n")).toContain("база недоступна");
  });

  it("ошибка основного судьи → запасная модель через askModel со схемой met и source judge", async () => {
    const { judge, asked, usage } = setup({
      fetch: async () => new Response("{}", { status: 503 }),
      ask: () => ({ met: ["intro_clear"] }),
    });
    const verdict = await judge.checkClaim(claim());
    expect(verdict).toEqual({ exitId: "intro_clear", probability: 1, confirmed: true, source: "fallback" });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ ownerId: OWNER, chatId: CHAT, model: FALLBACK, source: "judge" });
    expect(asked[0]!.schema).toMatchObject({ type: "object", required: ["met"], properties: { met: { type: "array" } } });
    expect(asked[0]!.prompt).toContain("Понятны тема курса и продажи");
    expect(asked[0]!.prompt).toContain("реплика 1");
    // Расход запасной модели пишет askModel сам; второй раз его не пишем.
    expect(usage).toEqual([]);
  });

  it("запасная модель: условие не названо выполненным → не подтверждено", async () => {
    const { judge } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => ({ met: [] }) });
    expect(await judge.checkClaim(claim())).toEqual({ exitId: "intro_clear", probability: 0, confirmed: false, source: "fallback" });
  });

  it("основной не уложился в срок → запасная", async () => {
    const hang: FetchBehavior = (_call, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("прервано"))));
    const { judge, asked } = setup({ settings: { timeoutMs: 20 }, fetch: hang, ask: () => ({ met: ["intro_clear"] }) });
    expect(await judge.checkClaim(claim())).toMatchObject({ source: "fallback", confirmed: true });
    expect(asked).toHaveLength(1);
  });

  it("основной ответил, но не на этот вопрос → запасная; расход основного записан", async () => {
    const { judge, asked, usage } = setup({ fetch: async () => decision({ другой: 0.9 }), ask: () => ({ met: ["intro_clear"] }) });
    expect(await judge.checkClaim(claim())).toMatchObject({ source: "fallback" });
    expect(asked).toHaveLength(1);
    expect(usage).toHaveLength(1);
  });

  it("ключа OpenRouter нет → сразу запасная, без запроса", async () => {
    const { judge, calls, asked } = setup({ env: {}, ask: () => ({ met: ["intro_clear"] }) });
    expect(await judge.checkClaim(claim())).toMatchObject({ source: "fallback" });
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(1);
  });

  it("обе модели не ответили → null («не проверено»)", async () => {
    const { judge, errors } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => new Error("лимит расхода") });
    expect(await judge.checkClaim(claim())).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("запасная вернула мусор → null", async () => {
    const { judge } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => ({ met: "всё" }) as never });
    expect(await judge.checkClaim(claim())).toBeNull();
  });

  it("человек отменил ход → запасную не зовём", async () => {
    const controller = new AbortController();
    const { judge, asked } = setup({
      fetch: async () => {
        controller.abort();
        throw new Error("прервано");
      },
    });
    expect(await judge.checkClaim(claim({ signal: controller.signal }))).toBeNull();
    expect(asked).toHaveLength(0);
  });

  it("адрес и ключ — из окружения приложения; settings.openrouter главнее", async () => {
    const fromEnv = setup({ env: { OPENROUTER_API_KEY: "env-key", OPENROUTER_BASE_URL: "https://proxy.example.com/openrouter/api/v1" }, fetch: async () => decision({ intro_clear: 0.9 }) });
    await fromEnv.judge.checkClaim(claim());
    expect(fromEnv.calls[0]!.url).toBe("https://proxy.example.com/openrouter/api/alpha/decisions");
    expect(fromEnv.calls[0]!.headers.authorization).toBe("Bearer env-key");

    const own = setup({
      env: { OPENROUTER_API_KEY: "env-key" },
      settings: { openrouter: { apiKey: "own-key", baseUrl: "https://own.example.com/api/v1" } },
      fetch: async () => decision({ intro_clear: 0.9 }),
    });
    await own.judge.checkClaim(claim());
    expect(own.calls[0]!.url).toBe("https://own.example.com/api/alpha/decisions");
    expect(own.calls[0]!.headers.authorization).toBe("Bearer own-key");
  });
});

describe("судья: после ответа агента (checkAll)", () => {
  it("один запрос на все условия, вопросы noul по id; цель и последние сообщения", async () => {
    const { judge, calls } = setup({ fetch: async () => decision({ own_1: 0.1, own_2: 0.1, common_1: 0.1 }) });
    await judge.checkAll(all());
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]!.body.questions)).toEqual(["own_1", "own_2", "common_1"]);
    expect(calls[0]!.body.questions.own_2.instructions).toContain("Человек отказался");
    expect(calls[0]!.body.state.goal).toBe("Понять тему курса");
    expect(calls[0]!.body.state.agent_words).toBeUndefined();
    expect(calls[0]!.body.state.conversation).toHaveLength(4);
  });

  it("возвращает только выполненные, в порядке условий: своё раньше общего, раньше по порядку — раньше", async () => {
    const { judge } = setup({ fetch: async () => decision({ own_1: 0.75, own_2: 0.3, common_1: 0.99 }) });
    const verdicts = await judge.checkAll(all());
    expect(verdicts.map((verdict) => verdict.exitId)).toEqual(["own_1", "common_1"]);
    expect(verdicts[0]).toEqual({ exitId: "own_1", probability: 0.75, confirmed: true, source: "decision" });
  });

  it("несколько выше порога — первое по порядку, даже если у следующего вероятность выше", async () => {
    const { judge } = setup({ fetch: async () => decision({ own_1: 0.71, own_2: 0.95, common_1: 0.99 }) });
    const verdicts = await judge.checkAll(all());
    expect(verdicts[0]!.exitId).toBe("own_1");
    expect(verdicts).toHaveLength(3);
  });

  it("ни одно не выше порога → пусто; расход записан", async () => {
    const { judge, usage } = setup({ fetch: async () => decision({ own_1: 0.2, own_2: 0.69, common_1: 0 }) });
    expect(await judge.checkAll(all())).toEqual([]);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ source: "judge", cost: 0.00002, inputTokens: 480, outputTokens: 9 });
  });

  it("нет условий → пусто, ни одного вызова", async () => {
    const { judge, calls, asked } = setup();
    expect(await judge.checkAll(all({ conditions: [] }))).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });

  it("ошибка основного → запасная: met по id, порядок условий, чужие id отброшены", async () => {
    const { judge, asked } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => ({ met: ["common_1", "own_2", "выдуманное", "own_2"] }) });
    const verdicts = await judge.checkAll(all());
    expect(verdicts).toEqual([
      { exitId: "own_2", probability: 1, confirmed: true, source: "fallback" },
      { exitId: "common_1", probability: 1, confirmed: true, source: "fallback" },
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ model: FALLBACK, source: "judge" });
    for (const text of ["Понятна тема", "Человек отказался", "Просит оператора", "реплика 3"]) expect(asked[0]!.prompt).toContain(text);
  });

  it("основной не уложился в срок → запасная", async () => {
    const hang: FetchBehavior = (_call, signal) =>
      new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("прервано"))));
    const { judge, asked } = setup({ settings: { timeoutMs: 20 }, fetch: hang, ask: () => ({ met: [] }) });
    expect(await judge.checkAll(all())).toEqual([]);
    expect(asked).toHaveLength(1);
  });

  it("обе не ответили → пусто, ошибки в журнал", async () => {
    const { judge, errors } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => new Error("недоступна") });
    expect(await judge.checkAll(all())).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("судья: лимит расходов", () => {
  const spent = async () => {
    throw new Error("лимит расходов исчерпан");
  };

  it("checkClaim: лимит исчерпан — ни decision-1, ни запасной; «не проверено»", async () => {
    const { judge, calls, asked, errors } = setup({ limit: spent });
    expect(await judge.checkClaim(claim())).toBeNull();
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(0);
    expect(errors.join("\n")).toContain("лимит");
  });

  it("checkAll (фон после ответа): лимит исчерпан — запросов нет, пусто", async () => {
    const { judge, calls, asked } = setup({ limit: spent });
    expect(await judge.checkAll(all())).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(asked).toHaveLength(0);
  });
});

describe("судья: обрезка входа под 32 тыс. токенов", () => {
  it("огромные цель, слова агента, реплики и условия: тело запроса укладывается в потолок", async () => {
    const huge = "ж".repeat(200_000);
    const { judge, calls } = setup({ fetch: async () => decision({}) });
    await judge.checkAll(all({
      goal: huge,
      messages: Array.from({ length: 30 }, () => ({ role: "human", text: huge })),
      conditions: Array.from({ length: 50 }, (_, index) => ({ exitId: `c${index}`, text: huge })),
    }));
    const sent = JSON.stringify({ state: calls[0]!.body.state, questions: calls[0]!.body.questions });
    expect(sent.length).toBeLessThanOrEqual(JUDGE_INPUT_CHARS);
    expect(Object.keys(calls[0]!.body.questions)).toHaveLength(50);
  });

  it("запасной модели уходит тот же обрезанный вход", async () => {
    const huge = "ж".repeat(200_000);
    const { judge, asked } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => ({ met: [] }) });
    await judge.checkClaim(claim({ goal: huge, why: huge, messages: [{ role: "human", text: huge }] }));
    expect(asked[0]!.prompt.length).toBeLessThanOrEqual(JUDGE_INPUT_CHARS + 2000);
  });
});

describe("судья: журнал входа (092)", () => {
  it("по умолчанию боевой переход — без текстов реплик: выход, вероятность, число и длины реплик", async () => {
    const { judge, journal } = setup({ fetch: async () => decision({ own_1: 0.92, own_2: 0.1, common_1: 0.02 }) });
    await judge.checkAll(all({ messages: [{ role: "human", text: "мой телефон +7 900 000-00-00" }, ...talk(2)] }));

    expect(journal).toHaveLength(1);
    const [entry] = journal;
    expect(entry).toMatchObject({
      ownerId: OWNER,
      chatId: CHAT,
      kind: "after_turn",
      model: DEFAULT_JUDGE_MODEL,
      threshold: 0.7,
      source: "decision",
      replies: [
        { role: "human", length: "мой телефон +7 900 000-00-00".length },
        { role: "human", length: talk(2)[0]!.text.length },
        { role: "agent", length: talk(2)[1]!.text.length },
      ],
      conditions: [
        { exitId: "own_1", text: "Понятна тема", probability: 0.92, confirmed: true },
        { exitId: "own_2", text: "Человек отказался", probability: 0.1, confirmed: false },
        { exitId: "common_1", text: "Просит оператора", probability: 0.02, confirmed: false },
      ],
    });
    expect(entry!.conversation).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain("телефон");
  });

  it("journal: «transitions» — боевой переход с текстами (усечённо, без ключа); без подтверждения — молчит", async () => {
    const { judge, journal } = setup({ settings: { journal: "transitions" }, fetch: async () => decision({ own_1: 0.92, own_2: 0.1, common_1: 0.02 }) });
    await judge.checkAll(all({ messages: [{ role: "human", text: "а адрес обязательно латиницей? " + "ж".repeat(1000) }, ...talk(2)] }));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({ goal: "Понять тему курса", conditions: [expect.objectContaining({ exitId: "own_1", confirmed: true }), expect.anything(), expect.anything()] });
    expect(journal[0]!.conversation).toHaveLength(3);
    expect(journal[0]!.conversation![0]!.text.startsWith("а адрес обязательно латиницей?")).toBe(true);
    expect(journal[0]!.conversation![0]!.text.length).toBeLessThanOrEqual(300);
    expect(JSON.stringify(journal[0])).not.toContain("sk-or-тест");

    const quiet = setup({ settings: { journal: "transitions" }, fetch: async () => decision({ own_1: 0.1, own_2: 0.1, common_1: 0.1 }) });
    await quiet.judge.checkAll(all());
    expect(quiet.journal).toHaveLength(0);
  });

  it("по умолчанию: ничего не подтверждено — журнал молчит; тестовый чат — пишется всегда и с текстами", async () => {
    const quiet = setup({ fetch: async () => decision({ own_1: 0.1, own_2: 0.1, common_1: 0.1 }) });
    await quiet.judge.checkAll(all());
    expect(quiet.journal).toHaveLength(0);

    const test = setup({ fetch: async () => decision({ intro_clear: 0.1 }) });
    await test.judge.checkClaim(claim({ testChat: true }));
    expect(test.journal).toEqual([
      expect.objectContaining({ kind: "claim", agentWords: "Человек назвал тему и продажи", conversation: expect.any(Array), conditions: [expect.objectContaining({ probability: 0.1, confirmed: false })] }),
    ]);
  });

  it("journal: «always» — каждый вопрос; «off» — никогда, даже в тестовом чате", async () => {
    const always = setup({ settings: { journal: "always" }, fetch: async () => decision({ own_1: 0.1, own_2: 0.1, common_1: 0.1 }) });
    await always.judge.checkAll(all());
    expect(always.journal).toHaveLength(1);

    const off = setup({ settings: { journal: "off" }, fetch: async () => decision({ intro_clear: 0.99 }) });
    await off.judge.checkClaim(claim({ testChat: true }));
    expect(off.journal).toHaveLength(0);
  });

  it("ответила запасная модель — в журнале её решение; журнал упал — решение судьи не теряется", async () => {
    const { judge, journal } = setup({ fetch: async () => new Response("{}", { status: 500 }), ask: () => ({ met: ["intro_clear"] }) });
    await judge.checkClaim(claim());
    expect(journal).toEqual([expect.objectContaining({ source: "fallback", conditions: [expect.objectContaining({ probability: 1, confirmed: true })] })]);
    expect(journal[0]).not.toHaveProperty("agentWords");

    const broken = setup({ journalFails: true, fetch: async () => decision({ intro_clear: 0.9 }) });
    expect(await broken.judge.checkClaim(claim())).toMatchObject({ confirmed: true });
    expect(broken.errors).toEqual([expect.stringContaining("журнал недоступен")]);
  });
});
