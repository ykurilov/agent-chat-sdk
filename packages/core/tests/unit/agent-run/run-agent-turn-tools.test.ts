import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentChatMessage } from "../../../src/conversation/types";
import {
  finishPart,
  mockCatalog,
  mockModelId,
  mockUsage,
  reasoningAndTextParts,
  reasoningParts,
  streamOf,
  streamStart,
  withoutFrozenContext,
} from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const tools = {
  current_time: tool({
    description: "Текущее время в часовом поясе.",
    inputSchema: z.object({ timeZone: z.string() }),
    execute: async ({ timeZone }) => `время в ${timeZone}`,
  }),
  broken_lookup: tool({
    description: "Всегда падает.",
    inputSchema: z.object({ query: z.string() }),
    execute: async (): Promise<string> => {
      throw new Error("сервис недоступен");
    },
  }),
} satisfies ToolSet;

/** Шаг модели: рассуждение (id как у провайдеров — одинаковый на каждом шаге) и вызов инструмента. */
function reasoningAndCall(
  thought: string,
  call: { id: string; toolName: string; input: object },
): LanguageModelV4StreamPart[] {
  return [
    streamStart,
    ...reasoningParts(thought),
    { type: "tool-call", toolCallId: call.id, toolName: call.toolName, input: JSON.stringify(call.input) },
    finishPart("tool-calls"),
  ];
}

const finalText = (text: string) => reasoningAndTextParts([text], "пишу ответ");

/** Модель, которая на каждом шаге отдаёт следующий заготовленный поток. */
function steppedModel(steps: LanguageModelV4StreamPart[][]): MockLanguageModelV4 {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = steps[step++];
      if (!next) throw new Error(`шаг ${step} не заготовлен`);
      return { stream: streamOf(next) };
    },
  });
}

const runWith = (model: MockLanguageModelV4) => runTurn(model, { tools });

/** Части без служебных `step-start`, в виде «тип:подробность» для сравнения порядка. */
function outline(parts: AgentChatMessage["parts"]): string[] {
  return parts.flatMap((part) => {
    if (part.type === "step-start") return [];
    if (part.type === "reasoning") return [`reasoning:${part.text}`];
    if (part.type === "text") return [`text:${part.text}`];
    if (part.type.startsWith("tool-") && "state" in part) return [`${part.type}:${part.state}`];
    return [part.type];
  });
}

describe("runAgentTurn с инструментами", () => {
  it("три шага: части в порядке прихода, у каждого шага свои рассуждения, вызовы в output-available", async () => {
    const model = steppedModel([
      reasoningAndCall("нужно время в Токио", { id: "call-1", toolName: "current_time", input: { timeZone: "Asia/Tokyo" } }),
      reasoningAndCall("теперь Москва", { id: "call-2", toolName: "current_time", input: { timeZone: "Europe/Moscow" } }),
      finalText("В Токио на 6 часов больше."),
    ]);
    const { answer, chunks } = await runWith(model);

    expect(answer.status).toBe("complete");
    expect(outline(withoutFrozenContext(answer.parts))).toEqual([
      "reasoning:нужно время в Токио",
      "tool-current_time:output-available",
      "reasoning:теперь Москва",
      "tool-current_time:output-available",
      "reasoning:пишу ответ",
      "text:В Токио на 6 часов больше.",
    ]);
    const calls = answer.parts.filter((part) => part.type === "tool-current_time");
    expect(calls).toMatchObject([
      { toolCallId: "call-1", input: { timeZone: "Asia/Tokyo" }, output: "время в Asia/Tokyo" },
      { toolCallId: "call-2", input: { timeZone: "Europe/Moscow" }, output: "время в Europe/Moscow" },
    ]);
    expect(Object.keys(answer.reasoningDurationsMs).sort()).toEqual(["0", "1", "2"]);
    // Итог хода — сумма по шагам.
    expect(answer.usage).toMatchObject({
      inputTokens: 3 * mockUsage.inputTokens.total,
      outputTokens: 3 * mockUsage.outputTokens.total,
    });
    expect(chunks.at(-1)?.type).toBe("finish");

    // Во второй шаг модель получила рассуждение и вызов первого шага и результат инструмента.
    const secondPrompt = model.doStreamCalls[1]?.prompt ?? [];
    const assistantTurn = secondPrompt.find((message) => message.role === "assistant");
    expect(assistantTurn?.content).toMatchObject([
      { type: "reasoning", text: "нужно время в Токио" },
      { type: "tool-call", toolCallId: "call-1", toolName: "current_time" },
    ]);
    expect(secondPrompt.some((message) => message.role === "tool")).toBe(true);
  });

  it("инструмент бросил ошибку — часть output-error с текстом ошибки, ход доходит до текста", async () => {
    const model = steppedModel([
      reasoningAndCall("поищу", { id: "call-1", toolName: "broken_lookup", input: { query: "курс" } }),
      finalText("Сервис недоступен, отвечаю без него."),
    ]);
    const { answer } = await runWith(model);

    expect(answer.status).toBe("complete");
    expect(outline(withoutFrozenContext(answer.parts))).toEqual([
      "reasoning:поищу",
      "tool-broken_lookup:output-error",
      "reasoning:пишу ответ",
      "text:Сервис недоступен, отвечаю без него.",
    ]);
    const failed = answer.parts.find((part) => part.type === "tool-broken_lookup");
    expect(failed).toMatchObject({ state: "output-error", input: { query: "курс" } });
    expect(failed && "errorText" in failed ? failed.errorText : "").toContain("сервис недоступен");
  });

  it("ошибка провайдера при подключённых инструментах — наружу только `other`", async () => {
    const model = steppedModel([
      [streamStart, { type: "error", error: new Error("секретный текст провайдера") }],
    ]);
    const { answer, chunks } = await runWith(model);

    expect(answer.status).toBe("error");
    const errors = chunks.filter((chunk) => chunk.type === "error");
    expect(errors).not.toHaveLength(0);
    expect(errors.every((chunk) => chunk.type === "error" && chunk.errorText === "other")).toBe(true);
  });

  it("рассуждение без текста перед вызовом — порядок «рассуждение → вызов» сохраняется", async () => {
    const model = steppedModel([
      reasoningAndCall("сразу вызову", { id: "call-1", toolName: "current_time", input: { timeZone: "UTC" } }),
      finalText("Готово."),
    ]);
    const { answer } = await runWith(model);

    const outlined = outline(withoutFrozenContext(answer.parts));
    expect(outlined.indexOf("reasoning:сразу вызову")).toBeLessThan(outlined.indexOf("tool-current_time:output-available"));
    expect(outlined[0]).toBe("reasoning:сразу вызову");
    expect(answer.parts.filter((part) => part.type === "text")).toHaveLength(1);
  });
});

describe("runAgentTurn: набор инструментов функцией от модели", () => {
  const oneTextStep = () => steppedModel([finalText("Готово.")]);
  const toolNamesOf = (model: MockLanguageModelV4) => (model.doStreamCalls[0]?.tools ?? []).map((item) => item.name);

  it("функция получает профиль и провайдера выбранной модели, а её набор уходит в запрос", async () => {
    const seen: Array<{ modelId: string; acceptsImages: boolean; providerId: string }> = [];
    const model = oneTextStep();
    await runTurn(model, {
      tools: ({ profile, providerId }) => {
        seen.push({ modelId: profile.id, acceptsImages: profile.acceptsImages, providerId });
        return { current_time: tools.current_time };
      },
    });

    expect(seen).toEqual([{ modelId: mockModelId, acceptsImages: false, providerId: "mock" }]);
    expect(toolNamesOf(model)).toEqual(["current_time"]);
  });

  it("набор меняется вместе с провайдером: у другого провайдера другие инструменты", async () => {
    const model = oneTextStep();
    await runTurn(model, {
      providerId: "mock-backup",
      catalog: mockCatalog({ "mock-backup": model }),
      tools: ({ providerId }): ToolSet => (providerId === "mock-backup" ? { broken_lookup: tools.broken_lookup } : {}),
    });

    expect(toolNamesOf(model)).toEqual(["broken_lookup"]);
  });

  it("ошибка инструмента из набора-функции идёт в строку вызова так же, как у статичного набора", async () => {
    const model = steppedModel([
      reasoningAndCall("поищу", { id: "call-1", toolName: "broken_lookup", input: { query: "курс" } }),
      finalText("Не вышло."),
    ]);
    const { answer } = await runTurn(model, { tools: () => ({ broken_lookup: tools.broken_lookup }) });

    const failed = answer.parts.find((part) => part.type === "tool-broken_lookup");
    expect(failed && "errorText" in failed ? failed.errorText : "").toContain("сервис недоступен");
  });

  it("секреты из текста ошибки инструмента не доходят ни до человека, ни до базы, ни до модели", async () => {
    const providerKey = "fw_ключ-провайдера-из-окружения-77";
    const leaky = {
      db_lookup: tool({
        description: "Падает с паролем в тексте.",
        inputSchema: z.object({}),
        execute: async (): Promise<string> => {
          throw new Error(`connect failed: postgres://app:S3cretPass@10.0.0.5:5432/shop, ключ ${providerKey}`);
        },
      }),
    } satisfies ToolSet;
    const model = steppedModel([
      reasoningAndCall("загляну в базу", { id: "call-1", toolName: "db_lookup", input: {} }),
      finalText("База недоступна."),
    ]);
    const { answer, chunks } = await runTurn(model, { tools: leaky, env: { MOCK_API_KEY: "не-настоящий-ключ", FIREWORKS_API_KEY: providerKey } });

    const failed = answer.parts.find((part) => part.type === "tool-db_lookup");
    const stored = failed && "errorText" in failed ? failed.errorText : "";
    expect(stored).toContain("postgres://app:[скрыто]@10.0.0.5:5432/shop");
    const toModel = JSON.stringify(model.doStreamCalls[1]!.prompt);
    expect(toModel).toContain("[скрыто]");
    for (const seen of [JSON.stringify(chunks), stored, toModel]) {
      expect(seen).not.toContain("S3cretPass");
      expect(seen).not.toContain(providerKey);
    }
  });
});
