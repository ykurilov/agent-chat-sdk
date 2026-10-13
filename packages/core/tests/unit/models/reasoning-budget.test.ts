import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../../src/chat-service";
import { createModelCatalog, type ModelProfile, type ReasoningLevelId } from "../../../src/models/model-catalog";
import { openrouterProvider } from "../../../src/models/providers/openrouter";
import { answerReserveTokens, effortWithAnswerReserve, reasoningBudgetTokens } from "../../../src/models/reasoning-budget";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { readAll } from "../support/mock-model";

// Бюджет рассуждений (056): модель, которая держит жёсткий бюджет, получает его служебным полем запроса, и ответу
// всегда остаётся запас. Модель, у которой сила рассуждений — доля потолка вывода, получает уровень с тем же запасом.
// Модель только с силой рассуждений получает потолок вывода, чтобы ответ не обрывался раньше него.

const LEVELS = ["minimal", "low", "medium", "high", "max"] as const;

describe("бюджет рассуждений: числа", () => {
  it.each([
    // потолок, max, high, medium, low, minimal
    [128_000, [102_400, 81_920, 51_200, 20_480, 10_240]],
    [64_000, [48_000, 38_400, 24_000, 9_600, 4_800]],
    [16_000, [8_000, 6_400, 4_000, 1_600, 1_024]],
  ] as const)("потолок %i", (ceiling, [max, high, medium, low, minimal]) => {
    expect(LEVELS.map((level) => reasoningBudgetTokens(level, ceiling))).toEqual([minimal, low, medium, high, max]);
  });

  it("ответу всегда остаётся не меньше пятой части потолка и не меньше 16 тысяч, если потолок позволяет", () => {
    expect([4_000, 16_000, 32_000, 64_000, 128_000, 200_000].map(answerReserveTokens)).toEqual([2_000, 8_000, 16_000, 16_000, 25_600, 40_000]);
    for (const ceiling of [4_000, 16_000, 32_000, 64_000, 128_000, 200_000]) {
      const budget = reasoningBudgetTokens("max", ceiling)!;
      expect(ceiling - budget).toBeGreaterThanOrEqual(Math.max(ceiling / 5, Math.min(16_000, ceiling / 2)));
    }
  });

  it("бюджет не больше 128 тысяч: больше Anthropic не принимает", () => {
    expect(reasoningBudgetTokens("max", 1_000_000)).toBe(128_000);
  });

  it("потолок слишком мал для бюджета от 1024 с запасом — бюджета нет", () => {
    expect(reasoningBudgetTokens("max", 2_000)).toBeUndefined();
    expect(reasoningBudgetTokens("low", 2_047)).toBeUndefined();
    expect(reasoningBudgetTokens("low", 2_048)).toBe(1_024);
  });
});

describe("уровень с запасом на ответ: числа", () => {
  it.each([
    // потолок, max, high, medium, low, minimal
    [128_000, ["high", "high", "medium", "low", "minimal"]],
    [64_000, ["medium", "medium", "medium", "low", "minimal"]], // high оставил бы 12 800 — меньше 16 тысяч
    [32_000, ["medium", "medium", "medium", "low", "minimal"]],
    [16_000, ["medium", "medium", "medium", "low", "minimal"]],
    [1_000_000, ["high", "high", "medium", "low", "minimal"]],
  ] as const)("потолок %i", (ceiling, efforts) => {
    expect((["max", "high", "medium", "low", "minimal"] as const).map((level) => effortWithAnswerReserve(level, ceiling))).toEqual(efforts);
  });

  it("после доли выбранного уровня ответу остаётся запас; «Максимум» никогда не xhigh при потолке до 512 тысяч", () => {
    for (const ceiling of [2_000, 8_000, 16_000, 32_000, 64_000, 128_000, 200_000, 512_000]) {
      const effort = effortWithAnswerReserve("max", ceiling)!;
      const share = { xhigh: 0.95, high: 0.8, medium: 0.5, low: 0.2, minimal: 0.1 }[effort];
      expect(ceiling - Math.floor(ceiling * share)).toBeGreaterThanOrEqual(answerReserveTokens(ceiling));
      expect(effort).not.toBe("xhigh");
    }
  });

  it("«Выкл» и «Вкл» силы не имеют", () => {
    expect(effortWithAnswerReserve("off", 128_000)).toBeUndefined();
    expect(effortWithAnswerReserve("on", 128_000)).toBeUndefined();
  });
});

const budgetModel: ModelProfile = {
  id: "budget-thinker",
  displayName: "Budget thinker",
  contextWindowTokens: 200_000,
  maxOutputTokens: 64_000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true, levels: ["off", "on", ...LEVELS], defaultLevel: "medium", tokenBudget: true },
  providerModelIds: { openrouter: "anthropic/claude-sonnet-4.5" },
};

const request = (level: ReasoningLevelId, profile: ModelProfile, maxOutputTokens?: number) =>
  openrouterProvider.reasoningRequest!(level, { profile, providerModelId: "m", ...(maxOutputTokens !== undefined && { maxOutputTokens }) });

describe("OpenRouter: модель с жёстким бюджетом (reasoning.tokenBudget)", () => {
  it.each([
    ["max", 48_000],
    ["high", 38_400],
    ["medium", 24_000],
    ["low", 9_600],
    ["minimal", 4_800],
  ] as const)("уровень %s — reasoning.max_tokens %i вместо effort", (level, budget) => {
    expect(request(level, budgetModel, 64_000).providerOptions).toEqual({ openrouter: { reasoning: { max_tokens: budget } } });
  });

  it("предел приложения меньше потолка модели — бюджет от него: budget_tokens < max_tokens", () => {
    expect(request("max", budgetModel, 16_000).providerOptions).toEqual({ openrouter: { reasoning: { max_tokens: 8_000 } } });
  });

  it("«Выкл» и «Вкл» — как раньше", () => {
    expect(request("off", budgetModel, 64_000).providerOptions).toEqual({ openrouter: { reasoning: { enabled: false } } });
    expect(request("on", budgetModel, 64_000).providerOptions).toEqual({ openrouter: { reasoning: { enabled: true } } });
  });

  it("предела вывода нет совсем — effort, как раньше", () => {
    expect(request("max", { ...budgetModel, maxOutputTokens: undefined }).providerOptions).toEqual({ openrouter: { reasoning: { effort: "xhigh" } } });
  });

  it("предел слишком мал для бюджета — effort", () => {
    expect(request("high", budgetModel, 1_500).providerOptions).toEqual({ openrouter: { reasoning: { effort: "high" } } });
  });

  it("у зашифрованных рассуждений пересказ остаётся", () => {
    expect(request("max", { ...budgetModel, reasoning: { ...budgetModel.reasoning, encrypted: true } }, 64_000).providerOptions).toEqual({
      openrouter: { reasoning: { max_tokens: 48_000, summary: "concise" } },
    });
  });
});

describe("OpenRouter: сила — доля потолка вывода (reasoning.effortShareOfOutput)", () => {
  const shareModel: ModelProfile = { ...budgetModel, maxOutputTokens: 128_000, reasoning: { ...budgetModel.reasoning, tokenBudget: undefined, effortShareOfOutput: true } };

  it.each([
    ["max", "high"],
    ["high", "high"],
    ["medium", "medium"],
    ["low", "low"],
    ["minimal", "minimal"],
  ] as const)("уровень %s при потолке 128 000 — effort %s", (level, effort) => {
    expect(request(level, shareModel, 128_000).providerOptions).toEqual({ openrouter: { reasoning: { effort } } });
  });

  it("предел приложения 32 000 — «Максимум» уходит как medium", () => {
    expect(request("max", shareModel, 32_000).providerOptions).toEqual({ openrouter: { reasoning: { effort: "medium" } } });
  });

  it("предела вывода нет — xhigh, как раньше", () => {
    expect(request("max", shareModel).providerOptions).toEqual({ openrouter: { reasoning: { effort: "xhigh" } } });
  });

  it("«Выкл» и «Вкл» — как раньше", () => {
    expect(request("off", shareModel, 128_000).providerOptions).toEqual({ openrouter: { reasoning: { enabled: false } } });
    expect(request("on", shareModel, 128_000).providerOptions).toEqual({ openrouter: { reasoning: { enabled: true } } });
  });

  it("жёсткий бюджет главнее доли", () => {
    const both = { ...shareModel, reasoning: { ...shareModel.reasoning, tokenBudget: true } };
    expect(request("max", both, 128_000).providerOptions).toEqual({ openrouter: { reasoning: { max_tokens: 102_400 } } });
  });
});

describe("OpenRouter: модель только с силой рассуждений", () => {
  const effortModel: ModelProfile = { ...budgetModel, reasoning: { ...budgetModel.reasoning, tokenBudget: undefined } };

  it.each(LEVELS)("уровень %s — effort, бюджета нет при любом пределе", (level) => {
    const effort = level === "max" ? "xhigh" : level;
    expect(request(level, effortModel, 64_000).providerOptions).toEqual({ openrouter: { reasoning: { effort } } });
  });
});

type Body = Record<string, unknown> & { reasoning?: unknown; max_tokens?: unknown };

function textStream(): Response {
  const chunk = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: "Ответ." } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Тела запросов двух ходов чата на выбранном уровне: настоящий провайдер OpenRouter, подменён только `fetch`. */
async function turnBodies(options: {
  catalog: Parameters<typeof createChatService>[0]["catalog"];
  modelId: string;
  level?: string;
  maxOutputTokens?: number;
}): Promise<Body[]> {
  const bodies: Body[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
      bodies.push(JSON.parse(String(init?.body)) as Body);
      return textStream();
    }),
  );
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: options.catalog,
    defaultChoice: { modelId: options.modelId, providerId: "openrouter", ...(options.level && { reasoning: options.level }) },
    agent: { instructions: "Ты помощник.", ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }) },
    env: { OPENROUTER_API_KEY: "test-key" },
    logError: vi.fn(),
  });
  const chat = await service.createChat("anna");
  for (const [index, text] of ["привет", "ещё"].entries()) {
    await readAll(await service.sendMessage("anna", chat.id, { id: `u${index}`, role: "user", parts: [{ type: "text", text }] }));
  }
  return bodies;
}

describe("итоговое тело запроса к OpenRouter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["off", { enabled: false }],
    ["low", { effort: "low" }],
    ["medium", { effort: "medium" }],
    ["high", { effort: "high" }],
    ["max", { effort: "high" }],
  ] as const)("Claude Haiku 5.5, уровень %s: reasoning %j и max_tokens — потолок модели 128 000", async (level, reasoning) => {
    const bodies = await turnBodies({ catalog: standardCatalog, modelId: "claude-haiku-5.5", level });
    for (const body of bodies) {
      expect(body.reasoning).toEqual(reasoning);
      expect(body.max_tokens).toBe(128_000);
    }
    expect(JSON.stringify(bodies[1]!.reasoning) + bodies[1]!.max_tokens).toBe(JSON.stringify(bodies[0]!.reasoning) + bodies[0]!.max_tokens);
  });

  it("Claude Haiku 5.5: предел приложения главнее потолка модели, уровень — с запасом от него", async () => {
    const [body] = await turnBodies({ catalog: standardCatalog, modelId: "claude-haiku-5.5", level: "max", maxOutputTokens: 32_000 });
    expect(body!.max_tokens).toBe(32_000);
    expect(body!.reasoning).toEqual({ effort: "medium" });
  });

  it.each([
    ["gpt-6-luna", "max"],
    ["gemini-3.8-flash", "high"],
    ["glm-5.3-flash", "high"],
    ["deepseek-4.1-flash", "on"],
  ] as const)("%s без потолка в профиле: max_tokens в запросе нет, как раньше", async (modelId, level) => {
    const bodies = await turnBodies({ catalog: standardCatalog, modelId, level });
    for (const body of bodies) expect(body).not.toHaveProperty("max_tokens");
  });

  const budgetCatalog = createModelCatalog({ providers: [openrouterProvider], models: [budgetModel] });

  it.each([
    ["max", 48_000],
    ["high", 38_400],
    ["medium", 24_000],
    ["low", 9_600],
    ["minimal", 4_800],
  ] as const)("модель с бюджетом, уровень %s: reasoning.max_tokens %i и max_tokens 64 000, побайтно одинаково в каждом ходе", async (level, budget) => {
    const bodies = await turnBodies({ catalog: budgetCatalog, modelId: budgetModel.id, level });
    for (const body of bodies) {
      expect(body.reasoning).toEqual({ max_tokens: budget });
      expect(body.max_tokens).toBe(64_000);
      expect(budget).toBeLessThan(body.max_tokens as number);
    }
    expect(JSON.stringify(bodies[1]!.reasoning) + bodies[1]!.max_tokens).toBe(JSON.stringify(bodies[0]!.reasoning) + bodies[0]!.max_tokens);
  });

  it("модель с бюджетом и пределом приложения: бюджет от предела приложения", async () => {
    const [body] = await turnBodies({ catalog: budgetCatalog, modelId: budgetModel.id, level: "max", maxOutputTokens: 16_000 });
    expect(body).toMatchObject({ max_tokens: 16_000, reasoning: { max_tokens: 8_000 } });
  });
});
