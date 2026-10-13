import type { LanguageModelV4Prompt, LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AUTO_CONTINUE_NOTE } from "../../../src/agent-run/auto-continue";
import { LAST_STEP_NOTE } from "../../../src/agent-run/last-step";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import type { StepContextInput } from "../../../src/agent-run/step-context";
import { extendCatalog } from "../../../src/models/catalog-changes";
import type { ModelProfile, ProviderDescription } from "../../../src/models/model-catalog";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { onFakeClock } from "../support/fake-clock";
import { finishPart, mockCatalog, readAll, reasoningAndTextParts, streamOf, streamStart, textParts } from "../support/mock-model";
import { runTurn, savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

const callTool = (name: string, input: object, id: string): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) },
  finishPart("tool-calls"),
];

/** Шаги модели по порядку: запись почты, запись телефона, ответ. */
function threeStepModel(): MockLanguageModelV4 {
  const steps = [
    callTool("write", { field: "email", value: "a@x.ru" }, "c1"),
    callTool("write", { field: "phone", value: "+7" }, "c2"),
    reasoningAndTextParts(["готово"]),
  ];
  let step = 0;
  return new MockLanguageModelV4({
    doStream: async () => {
      const next = steps[step++];
      if (!next) throw new Error(`шаг ${step} не заготовлен`);
      return { stream: streamOf(next) };
    },
  });
}

const stateTools = (model: AgentToolsModel): ToolSet => ({
  write: tool({
    description: "Записать поле",
    inputSchema: z.object({ field: z.string(), value: z.string() }),
    execute: async ({ field, value }) => {
      model.state!.set(`fields.${field}`, value);
      return "записано";
    },
  }),
});

const snapshotText = (input: StepContextInput) => `Снимок шага ${input.stepNumber}: ${JSON.stringify(input.state)}`;

/** Текст последнего сообщения запроса, если это сообщение человека. */
const lastUserText = (prompt: LanguageModelV4Prompt): string | null => {
  const last = prompt.at(-1)!;
  return last.role === "user" ? last.content.map((part) => (part.type === "text" ? part.text : "")).join("") : null;
};

describe("runAgentTurn: stepContext — снимок перед каждым шагом", () => {
  it("снимок — последним сообщением каждого запроса, со свежим состоянием и номером шага", async () => {
    const model = threeStepModel();
    const seen: StepContextInput[] = [];
    await runTurn(model, {
      ownerId: "anna",
      tools: stateTools,
      appState: { $closed: { code: "x" } },
      stepContext: (input) => {
        seen.push(input);
        return snapshotText(input);
      },
    });

    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls.map((call) => lastUserText(call.prompt))).toEqual([
      "Снимок шага 0: {}",
      'Снимок шага 1: {"fields":{"email":"a@x.ru"}}',
      'Снимок шага 2: {"fields":{"email":"a@x.ru","phone":"+7"}}',
    ]);
    // Снимок у шага один: прошлый из запроса убран.
    for (const call of model.doStreamCalls) {
      expect(JSON.stringify(call.prompt).match(/Снимок шага/g)).toHaveLength(1);
    }
    expect(seen.map((input) => input.stepNumber)).toEqual([0, 1, 2]);
    expect(seen[0]).toMatchObject({ chatId: "chat-1", ownerId: "anna", messageId: "a1", modelId: "mock-model", providerId: "mock" });
    expect(seen[0]!.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("функция видит данные и объект чата", async () => {
    const stepContext = vi.fn(() => null);
    await runTurn(threeStepModel(), {
      tools: stateTools,
      chatData: { formId: "f1" },
      subject: { key: "lesson-1" },
      stepContext,
    });
    expect(stepContext).toHaveBeenCalledWith(expect.objectContaining({ chat: { data: { formId: "f1" } }, subject: { key: "lesson-1" } }));
  });

  it("снимок не пишется в ответ и хранилище", async () => {
    const { answer, storage, chunks } = await runTurn(threeStepModel(), { tools: stateTools, stepContext: snapshotText });
    expect(textOf(answer.parts)).toBe("готово");
    expect(JSON.stringify(await storage.listMessages("chat-1"))).not.toContain("Снимок шага");
    expect(JSON.stringify(chunks)).not.toContain("Снимок шага");
  });

  it("stepContext вернул null или пустую строку — запросы побайтно те же, что без него", async () => {
    const prompts: string[][] = [];
    for (const stepContext of [undefined, () => null, async () => ""]) {
      const model = threeStepModel();
      await runTurn(model, { tools: stateTools, ...(stepContext && { stepContext }) });
      prompts.push(model.doStreamCalls.map((call) => JSON.stringify(call.prompt)));
    }
    expect(prompts[1]).toEqual(prompts[0]);
    expect(prompts[2]).toEqual(prompts[0]);
  });

  it("последний шаг хода: снимок, затем пометка «шаги кончились» последней", async () => {
    const model = threeStepModel();
    await runTurn(model, { tools: stateTools, maxSteps: 3, stepContext: snapshotText });
    const last = model.doStreamCalls[2]!.prompt;
    expect(lastUserText(last)).toBe(LAST_STEP_NOTE);
    expect(lastUserText(last.slice(0, -1))).toBe('Снимок шага 2: {"fields":{"email":"a@x.ru","phone":"+7"}}');
  });

  it("функция бросила — шаг без снимка, строка в журнал, ход идёт дальше", async () => {
    const logError = vi.fn();
    const model = threeStepModel();
    const { answer } = await runTurn(model, {
      tools: stateTools,
      logError,
      stepContext: (input) => {
        if (input.stepNumber === 1) throw new Error("база недоступна");
        return snapshotText(input);
      },
    });
    expect(answer.status).toBe("complete");
    expect(model.doStreamCalls.map((call) => lastUserText(call.prompt)?.startsWith("Снимок шага") ?? false)).toEqual([true, false, true]);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).not.toContain("Снимок шага");
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/\[снимок шага\].*чат=chat-1.*шаг=1.*база недоступна/));
  });
});

describe("runAgentTurn: stepContext не трогает уже отправленное (кэш модели)", () => {
  const provider: ProviderDescription = {
    id: "sliding",
    displayName: "Sliding",
    apiKeyEnv: "SLIDING_KEY",
    createLanguageModel: () => slidingModel,
    requestOptions: () => ({ instructionsProviderOptions: { sliding: { cache: "on" } }, lastMessageProviderOptions: { sliding: { cache: "on" } } }),
  };
  const profile: ModelProfile = {
    id: "sliding-model",
    displayName: "Sliding",
    contextWindowTokens: 100_000,
    acceptsImages: false,
    reasoning: { replayPastTurns: true },
    providerModelIds: { sliding: "m" },
  };
  let slidingModel = threeStepModel();
  const catalog = extendCatalog(standardCatalog, { addModels: [profile], addProviders: [provider] });
  const history = [
    { id: "u0", role: "user" as const, parts: [{ type: "text" as const, text: "Заявка" }] },
    { id: "a0", role: "assistant" as const, parts: [{ type: "text" as const, text: "Слушаю" }] },
    { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "Почта a@x.ru, телефон +7" }] },
  ];

  it("запрос шага N+1 побайтно начинается с запроса шага N без снимка; метки — на истории и на конце шага, у снимка их нет", async () => {
    slidingModel = threeStepModel();
    await runTurn(slidingModel, {
      catalog,
      env: { SLIDING_KEY: "k" },
      modelId: "sliding-model",
      providerId: "sliding",
      history,
      tools: stateTools,
      stepContext: snapshotText,
    });
    const prompts = slidingModel.doStreamCalls.map((call) => call.prompt);
    expect(prompts).toHaveLength(3);
    // Метка конца шага переезжает от шага к шагу (FR-012): сообщения сравниваются без неё, метки — отдельно.
    const unmarked = (messages: typeof prompts[number]) => JSON.stringify(messages).replaceAll(',"providerOptions":{"sliding":{"cache":"on"}}', "");
    for (let step = 0; step + 1 < prompts.length; step++) {
      const sent = prompts[step]!.slice(0, -1);
      expect(unmarked(prompts[step + 1]!.slice(0, sent.length))).toBe(unmarked(sent));
    }
    for (const prompt of prompts) {
      const snapshot = prompt.at(-1)!;
      expect(lastUserText(prompt)).toMatch(/^Снимок шага/);
      expect(snapshot.providerOptions).toBeUndefined();
      if (snapshot.role !== "user") throw new Error("последним должен быть снимок");
      expect(snapshot.content.every((part) => part.providerOptions === undefined)).toBe(true);
    }
    // Метка конца истории — на вопросе человека, как без снимка; на нулевом шаге это сообщение перед снимком. Метка конца
    // шага — на последнем сообщении перед снимком.
    const marked = prompts[2]!.flatMap((message, index) => (JSON.stringify(message).includes('"cache":"on"') ? [index] : []));
    expect(marked).toEqual([0, prompts[0]!.length - 2, prompts[2]!.length - 2]);
  });
});

/** Модель по сценарию: каждый вызов — свой поток; «silent» — поток начат и молчит до отмены. */
function scriptedModel(script: Array<LanguageModelV4StreamPart[] | "silent">): MockLanguageModelV4 {
  const queue = [...script];
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const next = queue.shift();
      if (!next) throw new Error("лишний запрос");
      if (next !== "silent") return { stream: streamOf(next) };
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            controller.enqueue(streamStart);
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      };
    },
  });
}
const answerText = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];
const snapshotCount = (prompt: LanguageModelV4Prompt) => JSON.stringify(prompt).match(/Снимок шага/g)?.length ?? 0;

describe("runAgentTurn: stepContext — кто и где говорит", () => {
  it("групповой ход мессенджера: функция видит канал, группу и сотрудника — как инструменты", async () => {
    const seen: StepContextInput[] = [];
    await runTurn(threeStepModel(), {
      tools: stateTools,
      channel: "telegram",
      group: { author: "Петя", allowedTools: ["write"] },
      staff: { id: "staff-1" },
      stepContext: (input) => void seen.push(input),
    });
    expect(seen).toHaveLength(3);
    for (const input of seen) expect(input).toMatchObject({ channel: "telegram", audience: "group", staff: { id: "staff-1" } });
  });

  it("личный веб-чат: канал web, разговор один на один, сотрудника нет", async () => {
    const seen: StepContextInput[] = [];
    await runTurn(threeStepModel(), { tools: stateTools, stepContext: (input) => void seen.push(input) });
    expect(seen[0]).toMatchObject({ channel: "web", audience: "private" });
    expect(seen[0]).not.toHaveProperty("staff");
  });

  it("данные и объект чата — копии: правка функции не меняет ни ход, ни следующий шаг", async () => {
    const chatData = { formId: "f1", nested: { step: 1 } };
    const subject = { key: "lesson-1", data: { title: "Урок" } };
    const seen: Array<{ formId: unknown; step: unknown; title: unknown }> = [];
    await runTurn(threeStepModel(), {
      tools: stateTools,
      chatData,
      subject,
      stepContext: ({ chat, subject: seenSubject }) => {
        const data = chat.data as { formId: unknown; nested: { step: unknown } };
        seen.push({ formId: data.formId, step: data.nested.step, title: seenSubject!.data!.title });
        try {
          data.formId = "испорчено";
          data.nested.step = 99;
          seenSubject!.data!.title = "испорчено";
        } catch {
          // замороженный объект — тоже годится
        }
        return null;
      },
    });
    expect(chatData).toEqual({ formId: "f1", nested: { step: 1 } });
    expect(subject).toEqual({ key: "lesson-1", data: { title: "Урок" } });
    expect(seen).toEqual(Array.from({ length: 3 }, () => ({ formId: "f1", step: 1, title: "Урок" })));
  });
});

describe("runAgentTurn: stepContext — срок и «Стоп»", () => {
  it("функция зависла на шаге: по сроку шаг без снимка, строка в журнал, ход идёт дальше", async () => {
    const logError = vi.fn();
    const model = threeStepModel();
    const signals: AbortSignal[] = [];
    const { answer } = await runTurn(model, {
      tools: stateTools,
      logError,
      stepContextTimeoutMs: 30,
      stepContext: (input) => {
        signals.push(input.abortSignal);
        return input.stepNumber === 1 ? new Promise<string>(() => {}) : snapshotText(input);
      },
    });
    expect(answer.status).toBe("complete");
    expect(model.doStreamCalls.map((call) => snapshotCount(call.prompt))).toEqual([1, 0, 1]);
    expect(signals[1]!.aborted).toBe(true);
    expect(logError).toHaveBeenCalledWith("[снимок шага] чат=chat-1 шаг=1 не ответил за 30 мс");
  });

  it("«Стоп», пока функция думает: ход останавливается сразу, сигнал функции отменён, запроса к модели нет", async () => {
    const stop = new AbortController();
    const model = threeStepModel();
    const signals: AbortSignal[] = [];
    const { answer } = await runTurn(model, {
      tools: stateTools,
      abortSignal: stop.signal,
      stepContextTimeoutMs: Number.POSITIVE_INFINITY,
      stepContext: ({ abortSignal }) => {
        signals.push(abortSignal);
        stop.abort(new Error("стоп"));
        return new Promise<string>(() => {});
      },
    });
    expect(answer.status).toBe("stopped");
    expect(signals[0]!.aborted).toBe(true);
    expect(model.doStreamCalls).toHaveLength(0);
  });
});

describe("runAgentTurn: stepContext — новые попытки хода", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("автопродолжение после обрыва: снимок перед пометкой продолжения, пометка последней, номер шага идёт дальше", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const overloaded = new APICallError({ message: "ответ 503", url: "https://provider.test", requestBodyValues: {}, statusCode: 503, responseBody: "", responseHeaders: {} });
    const model = scriptedModel([
      callTool("write", { field: "email", value: "a@x.ru" }, "c1"),
      [streamStart, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Начало " }, { type: "error", error: overloaded }],
      answerText("и конец."),
    ]);
    const seen: number[] = [];
    const storage = await storageWithQuestion();
    await onFakeClock(() =>
      readAll(
        startTurn(storage, model, {
          tools: stateTools,
          stepContext: (input) => {
            seen.push(input.stepNumber);
            return snapshotText(input);
          },
        }),
      ),
    );
    expect((await savedAnswer(storage))?.status).toBe("complete");
    const continuation = model.doStreamCalls[2]!.prompt;
    expect(lastUserText(continuation)?.startsWith(AUTO_CONTINUE_NOTE)).toBe(true);
    expect(lastUserText(continuation.slice(0, -1))).toBe('Снимок шага 2: {"fields":{"email":"a@x.ru"}}');
    expect(model.doStreamCalls.map((call) => snapshotCount(call.prompt))).toEqual([1, 1, 1]);
    expect(seen).toEqual([0, 1, 2]);
  });

  it("модель замолчала, шаг заново у запасного провайдера: номер шага не сбрасывается, снимок в запросе один", async () => {
    vi.useFakeTimers();
    const primary = scriptedModel([callTool("write", { field: "email", value: "a@x.ru" }, "c1"), "silent"]);
    const backup = scriptedModel([answerText("Итог запасного")]);
    const seen: Array<[string, number]> = [];
    const storage = await storageWithQuestion();
    const reading = readAll(
      startTurn(storage, primary, {
        catalog: mockCatalog({ mock: primary, "mock-backup": backup }),
        modelSilence: { firstChunkMs: 1_000, betweenChunksMs: 1_000 },
        providerFallback: { onSilence: "restart-step-on-next" },
        tools: stateTools,
        stepContext: (input) => {
          seen.push([input.providerId, input.stepNumber]);
          return snapshotText(input);
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await reading;
    expect((await savedAnswer(storage))?.providerId).toBe("mock-backup");
    expect(seen.slice(0, 2)).toEqual([
      ["mock", 0],
      ["mock", 1],
    ]);
    const [backupProvider, backupStep] = seen.at(-1)!;
    expect(backupProvider).toBe("mock-backup");
    // Стёртый шаг основного съел шаг хода: запасной идёт шагом 2, а не снова 0 или 1.
    expect(backupStep).toBe(2);
    const backupPrompt = backup.doStreamCalls[0]!.prompt;
    expect(snapshotCount(backupPrompt)).toBe(1);
    expect(lastUserText(backupPrompt)).toBe(`Снимок шага ${backupStep}: {"fields":{"email":"a@x.ru"}}`);
  });
});
