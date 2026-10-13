import { describe, expect, it } from "vitest";
import { selectReasoningForModel } from "../../../src/conversation/select-reasoning";
import type { AgentChatMessage } from "../../../src/conversation/types";

function agentAnswer(id: string, modelId: string, providerId: string): AgentChatMessage {
  return {
    id,
    role: "assistant",
    metadata: { modelId, providerId, status: "complete" },
    parts: [
      { type: "step-start" },
      {
        type: "reasoning",
        text: `рассуждение ${id}`,
        state: "done",
        providerMetadata: { [providerId]: { signature: `stamp-${id}` } },
      },
      { type: "text", text: `ответ ${id}`, state: "done" },
    ],
  };
}

function userQuestion(id: string): AgentChatMessage {
  return { id, role: "user", parts: [{ type: "text", text: `вопрос ${id}` }] };
}

const target = { modelId: "deepseek-4.1-flash", providerId: "deepseek", replayPastTurns: true };

function reasoningTexts(messages: AgentChatMessage[]): string[] {
  return messages.flatMap((message) =>
    message.parts.flatMap((part) => (part.type === "reasoning" ? [part.text] : [])),
  );
}

describe("selectReasoningForModel", () => {
  it("оставляет рассуждения той же модели и того же провайдера", () => {
    const history = [userQuestion("u1"), agentAnswer("a1", "deepseek-4.1-flash", "deepseek"), userQuestion("u2")];
    const selected = selectReasoningForModel(history, target);
    expect(reasoningTexts(selected)).toEqual(["рассуждение a1"]);
    expect(selected[1]!.parts[1]).toEqual(history[1]!.parts[1]);
  });

  it("вырезает рассуждения другой модели", () => {
    const history = [userQuestion("u1"), agentAnswer("a1", "other-model", "deepseek"), userQuestion("u2")];
    const selected = selectReasoningForModel(history, target);
    expect(reasoningTexts(selected)).toEqual([]);
    expect(selected[1]!.parts.map((part) => part.type)).toEqual(["step-start", "text"]);
  });

  it("вырезает рассуждения другого провайдера той же модели", () => {
    const history = [userQuestion("u1"), agentAnswer("a1", "deepseek-4.1-flash", "fireworks"), userQuestion("u2")];
    expect(reasoningTexts(selectReasoningForModel(history, target))).toEqual([]);
  });

  it("при replayPastTurns: false вырезает рассуждения всех прошлых ходов", () => {
    const history = [
      userQuestion("u1"),
      agentAnswer("a1", "deepseek-4.1-flash", "deepseek"),
      userQuestion("u2"),
      agentAnswer("a2", "deepseek-4.1-flash", "deepseek"),
      userQuestion("u3"),
    ];
    const selected = selectReasoningForModel(history, { ...target, replayPastTurns: false });
    expect(reasoningTexts(selected)).toEqual([]);
    expect(selected.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2", "u3"]);
  });

  it("не меняет исходный массив", () => {
    const history = [
      userQuestion("u1"),
      agentAnswer("a1", "other-model", "deepseek"),
      userQuestion("u2"),
      agentAnswer("a2", "deepseek-4.1-flash", "deepseek"),
    ];
    const before = structuredClone(history);
    selectReasoningForModel(history, target);
    selectReasoningForModel(history, { ...target, replayPastTurns: false });
    expect(history).toEqual(before);
  });

  it("чат A→B→A: каждой модели уходят только её рассуждения", () => {
    const history = [
      userQuestion("u1"),
      agentAnswer("a1", "deepseek-4.1-flash", "deepseek"),
      userQuestion("u2"),
      agentAnswer("a2", "gpt-6-luna", "openrouter"),
      userQuestion("u3"),
      agentAnswer("a3", "deepseek-4.1-flash", "deepseek"),
      userQuestion("u4"),
    ];
    expect(reasoningTexts(selectReasoningForModel(history, target))).toEqual(["рассуждение a1", "рассуждение a3"]);
    const luna = { modelId: "gpt-6-luna", providerId: "openrouter", replayPastTurns: true };
    expect(reasoningTexts(selectReasoningForModel(history, luna))).toEqual(["рассуждение a2"]);
  });

  describe("метаданные провайдера на частях чужого ответа (шифр рассуждений GPT)", () => {
    const cipher = { openrouter: { reasoning_details: [{ type: "reasoning.encrypted", data: "шифр" }] } };

    function answerWithCipherEverywhere(modelId: string, providerId: string): AgentChatMessage {
      return {
        id: "a1",
        role: "assistant",
        metadata: { modelId, providerId, status: "complete" },
        parts: [
          { type: "step-start" },
          {
            type: "tool-current_time",
            toolCallId: "call-1",
            state: "output-available",
            input: { timeZone: "UTC" },
            output: "12:00",
            callProviderMetadata: cipher,
            resultProviderMetadata: cipher,
          },
          { type: "step-start" },
          { type: "text", text: "Двенадцать", state: "done", providerMetadata: cipher },
        ],
      } as AgentChatMessage;
    }

    const partMetadataKeys = (message: AgentChatMessage) =>
      message.parts.flatMap((part) =>
        ["providerMetadata", "callProviderMetadata", "resultProviderMetadata"].filter((key) => key in part),
      );

    it("у другой модели того же провайдера шифр вырезается из вызова инструмента и из текста, остальное на месте", () => {
      const history = [userQuestion("u1"), answerWithCipherEverywhere("gpt-6-luna", "openrouter"), userQuestion("u2")];
      const selected = selectReasoningForModel(history, {
        modelId: "gemini-3.8-flash",
        providerId: "openrouter",
        replayPastTurns: true,
      });
      expect(partMetadataKeys(selected[1]!)).toEqual([]);
      expect(selected[1]!.parts).toContainEqual(
        expect.objectContaining({ type: "tool-current_time", output: "12:00", input: { timeZone: "UTC" } }),
      );
      expect(selected[1]!.parts).toContainEqual(expect.objectContaining({ type: "text", text: "Двенадцать" }));
    });

    it("у другого провайдера шифр тоже вырезается", () => {
      const history = [userQuestion("u1"), answerWithCipherEverywhere("gpt-6-luna", "openrouter"), userQuestion("u2")];
      const selected = selectReasoningForModel(history, {
        modelId: "gpt-6-luna",
        providerId: "other-gateway",
        replayPastTurns: true,
      });
      expect(partMetadataKeys(selected[1]!)).toEqual([]);
    });

    it("самой модели шифр возвращается целиком: и в вызове инструмента, и в тексте", () => {
      const history = [userQuestion("u1"), answerWithCipherEverywhere("gpt-6-luna", "openrouter"), userQuestion("u2")];
      const selected = selectReasoningForModel(history, {
        modelId: "gpt-6-luna",
        providerId: "openrouter",
        replayPastTurns: true,
      });
      expect(selected[1]).toEqual(history[1]);
    });

    it("вырезание не портит исходную историю: в базе и на экране шифр остаётся", () => {
      const history = [userQuestion("u1"), answerWithCipherEverywhere("gpt-6-luna", "openrouter"), userQuestion("u2")];
      const before = structuredClone(history);
      selectReasoningForModel(history, { modelId: "gemini-3.8-flash", providerId: "openrouter", replayPastTurns: true });
      expect(history).toEqual(before);
    });
  });
});
