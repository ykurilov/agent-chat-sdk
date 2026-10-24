import { describe, expect, it } from "vitest";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { deepseekProvider } from "../../../src/models/providers/deepseek";
import { fireworksProvider } from "../../../src/models/providers/fireworks";
import { openrouterProvider } from "../../../src/models/providers/openrouter";
import { togetherProvider } from "../../../src/models/providers/together";

const profile = (encrypted = false): ModelProfile => ({
  id: "any",
  displayName: "Any",
  contextWindowTokens: 1000,
  acceptsImages: false,
  reasoning: { replayPastTurns: true, encrypted },
  providerModelIds: {},
});

const request = (provider: ProviderDescription, level: Parameters<NonNullable<ProviderDescription["reasoningRequest"]>>[0], encrypted = false) =>
  provider.reasoningRequest!(level, { profile: profile(encrypted), providerModelId: "provider-model" });

describe("DeepSeek: рассуждения полем thinking", () => {
  it("«Выкл» отключает, «Вкл» включает", () => {
    expect(request(deepseekProvider, "off")).toEqual({ providerOptions: { deepseek: { thinking: { type: "disabled" } } } });
    expect(request(deepseekProvider, "on")).toEqual({ providerOptions: { deepseek: { thinking: { type: "enabled" } } } });
  });

  it.each([["minimal", "low"], ["low", "low"], ["medium", "high"], ["high", "high"], ["max", "max"]] as const)("уровень %s — direct effort %s", (level, effort) => {
    expect(request(deepseekProvider, level)).toEqual({ providerOptions: { deepseek: { thinking: { type: "enabled" }, reasoningEffort: effort } } });
  });

  it.each(["off", "low", "high", "max"] as const)("wire body direct DeepSeek %s, not OpenRouter reasoning", async (level) => {
    const bodies: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 500 });
    };
    const model = deepseekProvider.createLanguageModel("deepseek-flash", "test-key", { fetch }) as unknown as { doGenerate(options: unknown): Promise<unknown> };
    await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }], ...request(deepseekProvider, level) }).catch(() => {});
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.thinking).toEqual({ type: level === "off" ? "disabled" : "enabled" });
    if (level === "off") expect(bodies[0]).not.toHaveProperty("reasoning_effort");
    else expect(bodies[0]!.reasoning_effort).toBe(level);
    expect(bodies[0]).not.toHaveProperty("reasoning");
  });
});

describe.each([
  ["fireworks", fireworksProvider],
  ["together", togetherProvider],
])("%s: общий параметр SDK reasoning", (_name, provider) => {
  it("«Выкл» — none, «Вкл» — по умолчанию провайдера", () => {
    expect(request(provider, "off")).toEqual({ reasoning: "none" });
    expect(request(provider, "on")).toEqual({ reasoning: "provider-default" });
  });

  it.each(["minimal", "low", "medium", "high"] as const)("уровень %s передаётся как есть", (level) => {
    expect(request(provider, level)).toEqual({ reasoning: level });
  });

  it("«Максимум» — xhigh", () => {
    expect(request(provider, "max")).toEqual({ reasoning: "xhigh" });
  });
});

describe("OpenRouter: рассуждения в providerOptions.openrouter", () => {
  it("«Выкл» и «Вкл»", () => {
    expect(request(openrouterProvider, "off").providerOptions).toEqual({ openrouter: { reasoning: { enabled: false } } });
    expect(request(openrouterProvider, "on").providerOptions).toEqual({ openrouter: { reasoning: { enabled: true } } });
  });

  it.each(["minimal", "low", "medium", "high"] as const)("уровень %s — effort", (level) => {
    expect(request(openrouterProvider, level).providerOptions).toEqual({ openrouter: { reasoning: { effort: level } } });
  });

  it("«Максимум» — xhigh", () => {
    expect(request(openrouterProvider, "max").providerOptions).toEqual({ openrouter: { reasoning: { effort: "xhigh" } } });
  });

  it("у модели с зашифрованными рассуждениями просит пересказ", () => {
    expect(request(openrouterProvider, "high", true).providerOptions).toEqual({
      openrouter: { reasoning: { effort: "high", summary: "concise" } },
    });
  });

  it("параметр SDK reasoning не задаёт: OpenRouter его игнорирует", () => {
    expect(request(openrouterProvider, "high").reasoning).toBeUndefined();
  });
});

describe("OpenRouter: описание провайдера", () => {
  it("ключ в OPENROUTER_API_KEY, id модели из профиля", () => {
    expect(openrouterProvider.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    const model = openrouterProvider.createLanguageModel("z-ai/glm-5.3-flash", "test-key") as unknown as { modelId: string };
    expect(model.modelId).toBe("z-ai/glm-5.3-flash");
  });

  it("в запросе сортировка по скорости уходит одинаковой в каждом ходе", async () => {
    const bodies: unknown[] = [];
    const recordingFetch: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 500 });
    };
    const model = openrouterProvider.createLanguageModel("z-ai/glm-5.3-flash", "test-key", { fetch: recordingFetch });
    for (let turn = 0; turn < 2; turn++) {
      await (model as unknown as { doGenerate(options: unknown): Promise<unknown> })
        .doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "привет" }] }] })
        .catch(() => undefined);
    }
    expect(bodies).toHaveLength(2);
    for (const body of bodies) expect(body).toMatchObject({ provider: { sort: "throughput" } });
    expect(JSON.stringify(bodies[0])).toBe(JSON.stringify(bodies[1]));
  });

  it("кончившиеся деньги распознаются по телу ответа", () => {
    const hint = openrouterProvider.errorHints?.find((candidate) => candidate.match.test("Insufficient credits"));
    expect(hint?.kind).toBe("insufficient_funds");
  });
});

describe("OpenRouter: точка кэша на инструкции", () => {
  it("инструкция уходит сообщением с меткой кэша: без неё Gemini через OpenRouter кэша не читает", () => {
    expect(openrouterProvider.requestOptions({ chatId: "chat-1" }).instructionsProviderOptions).toEqual({
      openrouter: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("последнее сообщение истории тоже метится: кэшируется и переписка, не только инструкция", () => {
    expect(openrouterProvider.requestOptions({ chatId: "chat-1" }).lastMessageProviderOptions).toEqual({
      openrouter: { cacheControl: { type: "ephemeral" } },
    });
  });

  it("метка не зависит от чата: начало запроса одно и то же между ходами", () => {
    const { instructionsProviderOptions, lastMessageProviderOptions } = openrouterProvider.requestOptions({ chatId: "a" });
    const other = openrouterProvider.requestOptions({ chatId: "b" });
    expect(other.instructionsProviderOptions).toEqual(instructionsProviderOptions);
    expect(other.lastMessageProviderOptions).toEqual(lastMessageProviderOptions);
  });
});
