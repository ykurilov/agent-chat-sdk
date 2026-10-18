import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockEnv, mockModelId, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn, withoutErrorDetails } from "../support/turn-fixtures";

function apiError(statusCode: number, responseBody: string): APICallError {
  return new APICallError({
    message: `ответ ${statusCode}`,
    url: "https://provider.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode,
    responseBody,
    responseHeaders: { "retry-after-ms": "1" },
  });
}

async function turnWithLog(model: MockLanguageModelV4) {
  const logged: string[] = [];
  // Запасные выключены: здесь проверяется журнал одного провайдера.
  const result = await runTurn(model, { providerFallback: false, logError: (line) => logged.push(line) });
  return { ...result, logged };
}

describe("runAgentTurn: журнал сбоев провайдера (US5)", () => {
  it("ход упал — одна строка с чатом, моделью, провайдером, видом, кодом, именем и телом (сц. 1)", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw apiError(400, '{"error":"bad request"}');
      },
    });

    const { logged } = await turnWithLog(model);

    expect(logged).toEqual([
      `[сбой провайдера] чат=chat-1 модель=${mockModelId} провайдер=mock вид=other код=400 имя=AI_APICallError тело={"error":"bad request"}`,
    ]);
  });

  it("тело в 10 000 знаков с ключом провайдера — обрезано, ключа нет (сц. 2)", async () => {
    const body = `${mockEnv.MOCK_API_KEY} ${"x".repeat(10_000)}`;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw apiError(400, body);
      },
    });

    const { logged } = await turnWithLog(model);

    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(mockEnv.MOCK_API_KEY);
    expect(logged[0]).toContain("тело=[скрыто] xxx");
    expect(logged[0]!.length).toBeLessThan(4_300);
  });

  it("тихий повтор — строка на каждую попытку, без строки о сбое (сц. 3)", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => {
        calls++;
        if (calls <= 2) throw apiError(503, "занято");
        return { stream: streamOf([streamStart, ...textParts(["Ответ"]), finishPart()]) };
      },
    });

    const { answer, logged } = await turnWithLog(model);

    expect(answer.status).toBe("complete");
    expect(logged).toEqual([
      `[повтор] чат=chat-1 модель=${mockModelId} провайдер=mock попытка=2 код=503 пауза=1мс`,
      `[повтор] чат=chat-1 модель=${mockModelId} провайдер=mock попытка=3 код=503 пауза=1мс`,
    ]);
  });

  it("сбой после первого куска — тоже одна строка; в потоке текст провайдера только в подробностях сбоя (сц. 4)", async () => {
    const secret = "сырой-текст-провайдера";
    const parts: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "text-start", id: "t" },
      { type: "text-delta", id: "t", delta: "Начало" },
      { type: "error", error: apiError(503, secret) },
    ];
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(parts) }) });

    // Паузы автопродолжений — на подменённых часах.
    const { chunks, logged } = await onFakeClock(() => turnWithLog(model));

    // Строка о сбое — одна, после двух автопродолжений (US7).
    const failures = logged.filter((line) => line.startsWith("[сбой провайдера]"));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`вид=overloaded код=503`);
    expect(failures[0]).toContain(secret);
    expect(chunks.filter((chunk) => chunk.type === "error")).toEqual([{ type: "error", errorText: "overloaded" }]);
    // Текст провайдера — только в `error.details` итога: браузеру их отдаёт лишь право `errorDetails`.
    const final = chunks.filter((chunk) => chunk.type === "message-metadata").at(-1) as { messageMetadata: { error?: { details?: { reason?: string } } } };
    expect(final.messageMetadata.error?.details?.reason).toBe(secret);
    expect(JSON.stringify(withoutErrorDetails(chunks))).not.toContain(secret);
  });
});
