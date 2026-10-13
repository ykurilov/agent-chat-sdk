import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { MessageAttachments } from "../../../src/attachments/message-attachments";
import { CompactionFailedError, runCompaction } from "../../../src/compaction/run-compaction";
import { resolveCompactionSettings } from "../../../src/compaction/compaction-settings";
import { compactionTask, shrinkRequest } from "../../../src/compaction/compaction-task";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { extendCatalog } from "../../../src/models/catalog-changes";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { generateResult, mockCatalog, mockEnv, mockModelId } from "../support/mock-model";

const settings = resolveCompactionSettings({ thresholdTokens: 1000, tailTokens: 300, summaryCeilingTokens: 100 })!;
const history: AgentChatMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] },
  { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте" }] },
];
const lookup = tool({
  description: "Поиск.",
  inputSchema: z.object({ query: z.string() }),
  execute: vi.fn(async () => "результат"),
});

function compact(model: MockLanguageModelV4, extra: Partial<Parameters<typeof runCompaction>[0]> = {}) {
  return runCompaction({
    catalog: mockCatalog({ mock: model }),
    env: mockEnv,
    chatId: "chat-1",
    model: { modelId: mockModelId, providerId: "mock" },
    instructions: "Ты помощник.",
    tools: { lookup },
    history,
    settings,
    logError: () => {},
    ...extra,
  });
}

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : (content as Array<{ type: string; text?: string }>).map((part) => part.text ?? "").join("");

describe("выполнение сжатия", () => {
  it("вызов выключенного виджета (switchableTools, нет в tools) идёт сводке текстом, а включённого — вызовом", async () => {
    const withCalls: AgentChatMessage[] = [
      history[0]!,
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "tool-ask_choice", toolCallId: "w1", state: "output-available", input: { question: "Тариф?" }, output: { выбрано: "Про" } },
          { type: "tool-lookup", toolCallId: "l1", state: "output-available", input: { query: "x" }, output: "результат" },
        ] as AgentChatMessage["parts"],
      },
    ];
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("сводка") });
    await compact(model, { history: withCalls, switchableTools: new Set(["ask_choice", "lookup"]) });
    const prompt = JSON.stringify(model.doGenerateCalls[0]!.prompt);
    expect(prompt).not.toContain('"toolName":"ask_choice"');
    expect(prompt).toContain("ask_choice");
    expect(prompt).toContain("Про");
    expect(prompt).toContain('"toolName":"lookup"');
  });

  it("возвращает сводку; размер — выход без рассуждений; расход записан", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("## Цель\nX", { output: 60, reasoning: 20 }) });
    const result = await compact(model);
    expect(result.summary).toBe("## Цель\nX");
    expect(result.summaryTokens).toBe(40);
    expect(result.usage).toMatchObject({ inputTokens: 100, cachedInputTokens: 60, outputTokens: 60, reasoningTokens: 20 });
  });

  it("сводка сохраняется как есть: слова в скобках («[docs]», «[error]») не вырезаются, потеря необратима", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("## Цель\nОткрыли [docs], в логе [error] и [done]; [1].") });
    const result = await compact(model);
    expect(result.summary).toBe("## Цель\nОткрыли [docs], в логе [error] и [done]; [1].");
  });

  it("запрос: инструкция и инструменты те же, история на месте, задание сжатия последним, вызывать инструменты нельзя", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("сводка") });
    await compact(model);
    const call = model.doGenerateCalls[0]!;
    expect(call.prompt[0]).toMatchObject({ role: "system", content: "Ты помощник." });
    expect(call.prompt.slice(1).map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(textOf(call.prompt.at(-1)!.content)).toBe(compactionTask({ summaryCeilingTokens: 100 }));
    expect(call.toolChoice).toEqual({ type: "none" });
    expect(call.tools?.map((item) => item.name)).toEqual(["lookup"]);
    // Модель без выбора уровня может рассуждать сколько хочет: к потолку сводки добавлен запас на рассуждения.
    expect(call.maxOutputTokens).toBe(200 + 8_000);
  });

  it("у модели с выбором уровня сжатие идёт на самом малом уровне, что бы ни выбрал чат; запаса на рассуждения нет", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("сводка") });
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [
        {
          id: "leveled",
          displayName: "Leveled",
          apiKeyEnv: "MOCK_API_KEY",
          createLanguageModel: () => model,
          requestOptions: () => ({}),
          reasoningRequest: (level) => ({ providerOptions: { leveled: { effort: level } } }),
        },
      ],
      addModels: [
        {
          id: "leveled-model",
          displayName: "Leveled",
          contextWindowTokens: 1000,
          acceptsImages: false,
          reasoning: { replayPastTurns: true, levels: ["off", "low", "high"], defaultLevel: "high" },
          providerModelIds: { leveled: "leveled-v1" },
        },
      ],
    });
    await compact(model, { catalog, model: { modelId: "leveled-model", providerId: "leveled" }, reasoning: "high" } as never);
    const call = model.doGenerateCalls[0]!;
    expect(call.providerOptions?.leveled?.effort).toBe("off");
    expect(call.maxOutputTokens).toBe(200);
  });

  it("если самый малый уровень — не «выключено», запас на рассуждения остаётся", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("сводка") });
    const catalog = extendCatalog(standardCatalog, {
      addProviders: [
        {
          id: "leveled",
          displayName: "Leveled",
          apiKeyEnv: "MOCK_API_KEY",
          createLanguageModel: () => model,
          requestOptions: () => ({}),
          reasoningRequest: (level) => ({ providerOptions: { leveled: { effort: level } } }),
        },
      ],
      addModels: [
        {
          id: "always-thinking",
          displayName: "Always thinking",
          contextWindowTokens: 1000,
          acceptsImages: false,
          reasoning: { replayPastTurns: true, levels: ["low", "high"], defaultLevel: "high" },
          providerModelIds: { leveled: "always-v1" },
        },
      ],
    });
    await compact(model, { catalog, model: { modelId: "always-thinking", providerId: "leveled" } });
    const call = model.doGenerateCalls[0]!;
    expect(call.providerOptions?.leveled?.effort).toBe("low");
    expect(call.maxOutputTokens).toBe(200 + 8_000);
  });

  it("если модель всё же вызвала инструмент, он не выполняется", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        ...generateResult(""),
        content: [{ type: "tool-call" as const, toolCallId: "t1", toolName: "lookup", input: '{"query":"x"}' }],
        finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
      }),
    });
    await expect(compact(model)).rejects.toBeInstanceOf(CompactionFailedError);
    expect(lookup.execute).not.toHaveBeenCalled();
  });

  it("своё задание приложения уходит вместо задания ядра", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("сводка") });
    await compact(model, { settings: { ...settings, instruction: "Сожми по-своему." } });
    expect(textOf(model.doGenerateCalls[0]!.prompt.at(-1)!.content)).toBe("Сожми по-своему.");
  });

  it("сводка больше потолка ужимается повторно: в запрос добавляются она сама и просьба ужать", async () => {
    const answers = [generateResult("длинная", { output: 150 }), generateResult("покороче", { output: 90 })];
    const model = new MockLanguageModelV4({ doGenerate: async () => answers.shift()! });
    const result = await compact(model);
    expect(result).toMatchObject({ summary: "покороче", summaryTokens: 90 });
    expect(model.doGenerateCalls).toHaveLength(2);
    const second = model.doGenerateCalls[1]!.prompt;
    expect(second.slice(-2).map((message) => message.role)).toEqual(["assistant", "user"]);
    expect(textOf(second.at(-2)!.content)).toBe("длинная");
    expect(textOf(second.at(-1)!.content)).toBe(shrinkRequest({ summaryTokens: 150, summaryCeilingTokens: 100 }));
    expect(result.usage.outputTokens).toBe(240);
  });

  it("до двух повторных ужатий; если всё ещё больше потолка — сводка сохраняется, в журнале предупреждение", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("огромная", { output: 500 }) });
    const logError = vi.fn();
    const result = await compact(model, { logError });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(result).toMatchObject({ summary: "огромная", summaryTokens: 500 });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toMatch(/потолок/i);
    expect(logError.mock.calls[0]![0]).not.toContain("огромная");
  });

  it("ответ, оборванный по длине, — сбой", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("обрыв", { finish: "length" }) });
    await expect(compact(model)).rejects.toBeInstanceOf(CompactionFailedError);
  });

  it("пустая сводка — сбой", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("  \n") });
    await expect(compact(model)).rejects.toBeInstanceOf(CompactionFailedError);
  });

  it("провал после оплаченного запроса несёт расход в поле usage", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("  \n", { input: 100, output: 20 }) });
    const failure = (await compact(model).catch((error: Error) => error)) as CompactionFailedError;
    expect(failure.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  });

  it("ошибка провайдера до ответа расхода не несёт", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("сбой");
      },
    });
    const failure = (await compact(model).catch((error: Error) => error)) as CompactionFailedError;
    expect(failure.usage).toBeUndefined();
  });

  it("ошибка провайдера — сбой с понятным сообщением без текста запроса", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("Привет, секретный текст переписки");
      },
    });
    const failure = await compact(model).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(CompactionFailedError);
    expect((failure as Error).message).not.toContain("секретный");
  });

  it("сигнал остановки прерывает сжатие", async () => {
    const controller = new AbortController();
    const model = new MockLanguageModelV4({
      doGenerate: async (options) =>
        new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal?.reason));
          controller.abort();
        }),
    });
    await expect(compact(model, { abortSignal: controller.signal })).rejects.toBeInstanceOf(CompactionFailedError);
  });
});

describe("вложения при сжатии", () => {
  it("история для сжатия проходит через prepareHistory: сводка видит текст файлов", async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => generateResult("сводка") });
    const prepareHistory = vi.fn(async ({ history }: Parameters<MessageAttachments["prepareHistory"]>[0]) =>
      history.map((message) => ({ ...message, parts: [{ type: "text" as const, text: "ТЕКСТ-ФАЙЛА-ДЛЯ-СВОДКИ" }] })),
    );
    await compact(model, { attachments: { acceptUserParts: async () => [], confirmUserParts: async () => undefined, prepareHistory } });
    expect(prepareHistory).toHaveBeenCalledOnce();
    expect(JSON.stringify(model.doGenerateCalls[0]!.prompt)).toContain("ТЕКСТ-ФАЙЛА-ДЛЯ-СВОДКИ");
  });
});
