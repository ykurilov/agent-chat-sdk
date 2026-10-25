import { describe, expect, it } from "vitest";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { effectiveChoiceOfChat, validateModelChoice, resolveDefaultChoice } from "../../../src/models/model-choice";
import { buildModelMenu } from "../../../src/models/model-choice";

const profile = standardCatalog.models.find((model) => model.id === "deepseek-4.1-flash")!;
const env = { DEEPSEEK_API_KEY: "test", OPENROUTER_API_KEY: "test", FIREWORKS_API_KEY: "test", TOGETHER_API_KEY: "test" };
const fallback = { modelId: profile.id, providerId: "deepseek", reasoning: "high" as const };

describe("DeepSeek Flash1017 selectable effort and saved chats", () => {
  it("offers three strengths plus off, with high by default", () => {
    expect(profile.reasoning.levels).toEqual(["off", "low", "high", "max"]);
    expect(profile.reasoning.defaultLevel).toBe("high");
    const menu = buildModelMenu(standardCatalog, env, fallback);
    expect(JSON.stringify(menu)).toContain('"max"');
  });
  it.each(["deepseek", "openrouter", "fireworks", "together"])("saved on becomes high on %s without changing its route or stored record", (providerId) => {
    const saved = { modelId: profile.id, providerId, reasoning: "on" };
    expect(effectiveChoiceOfChat(standardCatalog, env, saved, fallback)).toEqual({ ...saved, reasoning: "high" });
    expect(saved.reasoning).toBe("on");
    const errors: string[] = [];
    expect(resolveDefaultChoice(standardCatalog, env, { ...saved, reasoning: "on" }, (error) => errors.push(error)))
      .toEqual({ ...saved, reasoning: "high" });
    expect(errors).toEqual([]);
    for (const reasoning of ["off", "low", "high", "max"] as const) {
      expect(validateModelChoice(standardCatalog, env, { ...saved, reasoning }).reasoning).toBe(reasoning);
    }
  });
});

describe("Flash1017 wire effort on every catalog route", () => {
  it.each(["deepseek", "openrouter", "fireworks", "together"])("%s sends real max rather than xhigh", async (providerId) => {
    const provider = standardCatalog.providers.find((item) => item.id === providerId)!;
    const providerModelId = profile.providerModelIds[providerId]!;
    const bodies: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 500 });
    };
    const model = provider.createLanguageModel(providerModelId, "test-key", { fetch }) as unknown as { doGenerate(options: unknown): Promise<unknown> };
    for (const level of ["low", "high", "max"] as const) {
      const options = provider.reasoningRequest!(level, { profile, providerModelId });
      await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Test" }] }], ...options }).catch(() => {});
      const body = bodies.at(-1)!;
      expect(body.model).toBe(providerModelId);
      if (providerId === "openrouter") expect(body.reasoning).toEqual({ effort: level });
      else expect(body.reasoning_effort).toBe(level);
      if (providerId === "deepseek") expect(body.thinking).toEqual({ type: "enabled" });
    }
    expect(bodies).toHaveLength(3);
  });
});
