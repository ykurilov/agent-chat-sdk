import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const callTool = (id: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "ping", input: "{}" },
  finishPart("tool-calls"),
];

describe("метка конца шага — со сроком кэша модели", () => {
  it("провайдер получает профиль модели: метки истории и конца шага одинаковые, с её сроком", async () => {
    const steps = [callTool("c1"), callTool("c2"), reasoningAndTextParts(["готово"])];
    let step = 0;
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(steps[step++]!) }) });
    const provider: ProviderDescription = {
      id: "marks",
      displayName: "Marks",
      apiKeyEnv: "MARKS_KEY",
      createLanguageModel: () => model,
      requestOptions: ({ profile }) => {
        const mark = { marks: { ttl: profile?.cacheTtl ?? "none" } };
        return { instructionsProviderOptions: mark, lastMessageProviderOptions: mark };
      },
    };
    const profile: ModelProfile = {
      id: "hour-model",
      displayName: "Hour",
      contextWindowTokens: 100_000,
      acceptsImages: false,
      cacheTtl: "1h",
      reasoning: { replayPastTurns: true },
      providerModelIds: { marks: "m" },
    };
    await runTurn(model, {
      catalog: extendCatalog(standardCatalog, { addModels: [profile], addProviders: [provider] }),
      env: { MARKS_KEY: "k" },
      modelId: "hour-model",
      providerId: "marks",
      history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Пингани дважды" }] }],
      tools: () => ({ ping: tool({ description: "Пинг", inputSchema: z.object({}), execute: async () => "понг" }) }),
    });
    const last = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
    expect(last.match(/"marks":\{"ttl":"1h"\}/g)).toHaveLength(3);
    expect(last).not.toContain('"none"');
  });
});
