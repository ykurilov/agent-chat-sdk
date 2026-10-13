import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { finishPart, mockModelId, streamOf, streamStart, textParts, withoutFrozenContext } from "../support/mock-model";
import { onFakeClock } from "../support/fake-clock";
import { runTurn } from "../support/turn-fixtures";

const rawProviderText = "секретная-подробность-провайдера";

function apiError(statusCode: number, responseHeaders?: Record<string, string>): APICallError {
  return new APICallError({
    ...(responseHeaders && { responseHeaders }),
    message: `${rawProviderText} ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({ error: { message: rawProviderText } }),
    isRetryable: statusCode === 429 || statusCode >= 500,
  });
}

const failingWith = (statusCode: number) =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw apiError(statusCode);
    },
  });

describe("runAgentTurn: ошибки провайдера", () => {
  it("ошибка на середине ответа и после двух автопродолжений — status error с видом ошибки, написанная часть сохранена", async () => {
    const parts: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Первая часть ответа" },
      { type: "error", error: apiError(503) },
    ];
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(parts) }) });

    // Паузы автопродолжений (2 с и 5 с) — на подменённых часах.
    const { chunks, answer } = await onFakeClock(() => runTurn(model));

    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "overloaded" });
    expect(answer.parts).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: "Первая часть ответа" })]));
    // После первого куска тихих повторов нет, только два автопродолжения (US7).
    expect(model.doStreamCalls).toHaveLength(3);

    const errorChunks = chunks.filter((chunk) => chunk.type === "error");
    expect(errorChunks).toEqual([{ type: "error", errorText: "overloaded" }]);
    // Итог раньше куска error: на нём клиент перестаёт читать поток.
    expect(chunks.slice(-3).map((chunk) => chunk.type)).toEqual(["message-metadata", "error", "finish"]);
    expect(chunks.at(-3)).toEqual({
      type: "message-metadata",
      messageMetadata: expect.objectContaining({ status: "error", error: { kind: "overloaded" } }),
    });
    expect(JSON.stringify(chunks)).not.toContain(rawProviderText);
  });

  it.each([
    [401, "invalid_key"],
    [402, "insufficient_funds"],
  ] as const)("статус %i — ошибка сразу, вид %s, сырого текста нет", async (status, kind) => {
    const model = failingWith(status);

    const { chunks, answer } = await runTurn(model);

    expect(model.doStreamCalls).toHaveLength(1);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind });
    expect(withoutFrozenContext(answer.parts)).toEqual([]);
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: kind }]);
    expect(JSON.stringify(chunks)).not.toContain(rawProviderText);
  });

  it("нет ключа провайдера — вид invalid_key, поток по договору, в журнале имя переменной без значений", async () => {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([]) }) });
    const logged: string[] = [];

    const { chunks, answer } = await runTurn(model, {
      env: { OTHER_PROVIDER_KEY: "значение-чужого-ключа" },
      logError: (message) => logged.push(message),
    });

    expect(model.doStreamCalls).toHaveLength(0);
    // Первый кусок — start с id ответа, как у любого хода: клиент знает, чей это ответ.
    expect(chunks[0]).toEqual({ type: "start", messageId: "a1", messageMetadata: { modelId: mockModelId, providerId: "mock" } });
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "invalid_key" }]);
    expect(answer.status).toBe("error");
    expect(answer.error).toEqual({ kind: "invalid_key" });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("MOCK_API_KEY");
    expect(logged[0]).toContain("mock");
    expect(logged.join("\n")).not.toContain("значение-чужого-ключа");
  });

  it("временная ошибка до первого куска повторяется тихо: собеседник видит обычный ответ", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls++;
        if (calls === 1) throw apiError(429, { "retry-after-ms": "10" });
        return { stream: streamOf([streamStart, ...textParts(["Ответ"], "t"), finishPart()]) };
      },
    });

    const { chunks, answer } = await runTurn(model);

    expect(calls).toBe(2);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(answer.status).toBe("complete");
    expect(answer.error).toBeNull();
  });
});
