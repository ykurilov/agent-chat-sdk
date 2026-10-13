import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createToolQueue, resolveSequentialTools, withSequentialTools } from "../../../src/agent-run/sequential-tools";
import { withToolTimeout } from "../../../src/agent-run/tool-timeout";
import { HANGING_TOOL_CALL_REASON, NOT_STARTED_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import { createChatService } from "../../../src/chat-service";
import type { AgentSettings } from "../../../src/chat-service";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModelId, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn, savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";

/** Инструмент, который ждёт команды теста: `log` — когда начал и кончил, `finish(name)` — отпустить. */
function gatedTools(names: string[]) {
  const log: string[] = [];
  const releases = new Map<string, () => void>();
  const tools: ToolSet = Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        description: name,
        inputSchema: z.object({}),
        execute: () =>
          new Promise<string>((resolve) => {
            log.push(`начал ${name}`);
            releases.set(name, () => {
              log.push(`кончил ${name}`);
              resolve(`готово ${name}`);
            });
          }),
      }),
    ]),
  );
  return { tools, log, finish: (name: string) => releases.get(name)!() };
}

type CallOptions = Parameters<NonNullable<ToolSet[string]["execute"]>>[1];
const options = (signal = new AbortController().signal): CallOptions =>
  ({ toolCallId: "c", messages: [], context: {}, abortSignal: signal }) as unknown as CallOptions;
const call = (tools: ToolSet | undefined, name: string, signal?: AbortSignal) =>
  Promise.resolve(tools![name]!.execute!({}, options(signal)));
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("withSequentialTools: инструменты с последствиями — по одному (FR-049)", () => {
  it("два вызова инструмента «по очереди» не идут вместе: второй начинается после конца первого", async () => {
    const { tools, log, finish } = gatedTools(["pay", "search"]);
    const queued = withSequentialTools(tools, { isSequential: (name) => name === "pay", queue: createToolQueue() });

    const first = call(queued, "pay");
    const second = call(queued, "pay");
    await settle();
    expect(log).toEqual(["начал pay"]);
    finish("pay");
    await first;
    await settle();
    expect(log).toEqual(["начал pay", "кончил pay", "начал pay"]);
    finish("pay");
    expect(await second).toBe("готово pay");
  });

  it("обычный вызов не ждёт обычного; вызов «по очереди» ждёт всех начатых раньше, а начатые после ждут его", async () => {
    const { tools, log, finish } = gatedTools(["search", "pay", "read"]);
    const queued = withSequentialTools(tools, { isSequential: (name) => name === "pay", queue: createToolQueue() });

    const search = call(queued, "search");
    const read = call(queued, "read");
    const pay = call(queued, "pay");
    const readAfter = call(queued, "read");
    await settle();
    expect(log).toEqual(["начал search", "начал read"]);
    finish("search");
    finish("read");
    await Promise.all([search, read]);
    await settle();
    expect(log.slice(-1)).toEqual(["начал pay"]);
    finish("pay");
    await pay;
    await settle();
    expect(log.slice(-1)).toEqual(["начал read"]);
    finish("read");
    await readAfter;
  });

  it("«Стоп» во время ожидания: ждущий вызов отменяется и не запускается, очередь не встаёт", async () => {
    const { tools, log, finish } = gatedTools(["pay"]);
    const queue = createToolQueue();
    const queued = withSequentialTools(tools, { isSequential: () => true, queue });
    const stop = new AbortController();

    const first = call(queued, "pay");
    const waiting = call(queued, "pay", stop.signal);
    stop.abort(new Error("стоп"));
    await expect(waiting).rejects.toThrow("стоп");
    const third = call(queued, "pay");
    await settle();
    // Отменённый не запускался, третий ждёт первого.
    expect(log).toEqual(["начал pay"]);
    finish("pay");
    await first;
    await settle();
    expect(log).toEqual(["начал pay", "кончил pay", "начал pay"]);
    finish("pay");
    await third;
  });

  it("оборванная попытка, `charge` не слушает отмену: новый `charge` ждёт конца старого, порядок важнее скорости (FR-057)", async () => {
    const { tools, log, finish } = gatedTools(["charge"]);
    const queued = withSequentialTools(tools, { isSequential: () => true, queue: createToolQueue() });
    const attempt = new AbortController();

    const old = call(queued, "charge", attempt.signal);
    await settle();
    attempt.abort(new Error("попытка оборвалась"));
    const next = call(queued, "charge");
    await settle();
    expect(log).toEqual(["начал charge"]);

    finish("charge");
    await old;
    await settle();
    expect(log).toEqual(["начал charge", "кончил charge", "начал charge"]);
    finish("charge");
    await next;
  });

  it("оборванная попытка, `charge` завис и не слушает отмену: очередь держится не дольше его срока, новый `charge` идёт по сроку", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const { tools, log } = gatedTools(["charge"]);
      // Как в ходе: очередь снаружи срока инструмента.
      const queued = withSequentialTools(withToolTimeout(tools, { timeoutFor: () => 120_000 }), {
        isSequential: () => true,
        queue: createToolQueue(),
        kindsFrom: tools,
      });
      const attempt = new AbortController();

      const old = call(queued, "charge", attempt.signal).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      attempt.abort(new Error("попытка оборвалась"));
      void call(queued, "charge").catch(() => {});
      await vi.advanceTimersByTimeAsync(100_000);
      expect(log).toEqual(["начал charge"]);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(log).toEqual(["начал charge", "начал charge"]);
      expect(await old).toMatchObject({ message: "попытка оборвалась" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("инструмент с промежуточным выводом держит очередь до последнего значения; вывод тот же", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const log: string[] = [];
    const tools: ToolSet = {
      report: tool({
        description: "Отчёт по частям",
        inputSchema: z.object({}),
        async *execute() {
          log.push("начал report");
          yield "половина";
          await gate;
          yield "всё";
          log.push("кончил report");
        },
      }),
      pay: tool({ description: "Оплата", inputSchema: z.object({}), execute: async () => (log.push("начал pay"), "оплачено") }),
    };
    const queued = withSequentialTools(tools, { isSequential: () => true, queue: createToolQueue() });

    const outputs: unknown[] = [];
    const reading = (async () => {
      for await (const value of queued!.report!.execute!({}, options()) as AsyncIterable<unknown>) outputs.push(value);
    })();
    const pay = call(queued, "pay");
    await settle();
    expect(log).toEqual(["начал report"]);
    release();
    await reading;
    await pay;
    expect(outputs).toEqual(["половина", "всё"]);
    expect(log).toEqual(["начал report", "кончил report", "начал pay"]);
  });

  it("ни одного инструмента «по очереди» — тот же набор без обёрток", () => {
    const { tools } = gatedTools(["search"]);
    expect(withSequentialTools(tools, { isSequential: () => false, queue: createToolQueue() })).toBe(tools);
  });
});

describe("agent.sequentialTools: настройка", () => {
  it("true — все серверные инструменты; список — только названные; нет — никто", () => {
    expect(resolveSequentialTools(true).isSequential("любой")).toBe(true);
    expect(resolveSequentialTools(["pay"]).isSequential("pay")).toBe(true);
    expect(resolveSequentialTools(["pay"]).isSequential("search")).toBe(false);
    expect(resolveSequentialTools(undefined).isSequential("pay")).toBe(false);
  });

  it("неверная форма — ошибка при создании службы", () => {
    const create = (sequentialTools: unknown) => () =>
      createChatService({
        storage: createInMemoryChatStorage(),
        catalog: mockCatalog({}),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: { instructions: "Ты помощник.", sequentialTools } as AgentSettings,
        compaction: false,
        env: mockEnv,
      });
    expect(create("pay")).toThrow(/agent\.sequentialTools/);
    expect(create([1])).toThrow(/agent\.sequentialTools/);
    expect(create(false)).toThrow(/agent\.sequentialTools/);
    expect(create(["pay"])).not.toThrow();
    expect(create(true)).not.toThrow();
  });
});

describe("runAgentTurn: два вызова в одном шаге", () => {
  const twoCalls: LanguageModelV4StreamPart[] = [
    streamStart,
    { type: "tool-call", toolCallId: "c1", toolName: "pay", input: "{}" },
    { type: "tool-call", toolCallId: "c2", toolName: "pay", input: "{}" },
    finishPart("tool-calls"),
  ];

  function payingModel() {
    let step = 0;
    return new MockLanguageModelV4({
      doStream: async () => ({ stream: streamOf(step++ === 0 ? twoCalls : reasoningAndTextParts(["Оплачено дважды."])) }),
    });
  }

  function countingPay() {
    const state = { running: 0, most: 0 };
    const tools: ToolSet = {
      pay: tool({
        description: "Оплата",
        inputSchema: z.object({}),
        execute: async () => {
          state.running += 1;
          state.most = Math.max(state.most, state.running);
          await settle();
          state.running -= 1;
          return "оплачено";
        },
      }),
    };
    return { state, tools };
  }

  it("с настройкой — по одному, оба результата в ответе", async () => {
    const { state, tools } = countingPay();
    const { answer } = await runTurn(payingModel(), { tools, sequentialTools: resolveSequentialTools(["pay"]) });

    expect(state.most).toBe(1);
    expect(answer.parts.filter((part) => part.type === "tool-pay")).toMatchObject([
      { state: "output-available", output: "оплачено" },
      { state: "output-available", output: "оплачено" },
    ]);
  });

  it("без настройки — как раньше, вместе", async () => {
    const { state, tools } = countingPay();
    await runTurn(payingModel(), { tools });
    expect(state.most).toBe(2);
  });

  it("«Стоп», пока второй вызов ждёт очереди: он закрыт текстом «не запускался», начатый — «мог выполниться частично»", async () => {
    // Оплата, которая идёт, пока её не отменят.
    const log: string[] = [];
    const tools: ToolSet = {
      pay: tool({
        description: "Оплата",
        inputSchema: z.object({}),
        execute: (_input, { abortSignal }) =>
          new Promise<string>((_resolve, reject) => {
            log.push("начал pay");
            abortSignal?.addEventListener("abort", () => reject(new Error("отменено")), { once: true });
          }),
      }),
    };
    const stop = new AbortController();
    const storage = await storageWithQuestion();
    const reader = startTurn(storage, payingModel(), { tools, sequentialTools: resolveSequentialTools(["pay"]), abortSignal: stop.signal }).getReader();
    for (let seen = 0; seen < 2; ) if ((await reader.read()).value?.type === "tool-input-available") seen += 1;
    await settle();
    expect(log).toEqual(["начал pay"]);

    stop.abort();
    while (!(await reader.read()).done);

    const calls = (await savedAnswer(storage))!.parts.filter((part) => part.type === "tool-pay");
    expect(calls).toMatchObject([
      { toolCallId: "c1", state: "output-error", errorText: HANGING_TOOL_CALL_REASON },
      { toolCallId: "c2", state: "output-error", errorText: NOT_STARTED_TOOL_CALL_REASON },
    ]);
    expect(NOT_STARTED_TOOL_CALL_REASON).toContain("не запускался");
  });
});

describe("служба чата: очередь «по одному» — на чат, а не на ход (FR-057)", () => {
  it("«Стоп» и сразу «Повторить»: второй `charge` не стартует, пока первый, не слушающий отмену, работает — до его срока", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const started: string[] = [];
      let calls = 0;
      const model = new MockLanguageModelV4({
        doStream: async () => {
          calls += 1;
          return {
            stream: streamOf(
              calls <= 2
                ? [streamStart, { type: "tool-call", toolCallId: `c${calls}`, toolName: "charge", input: "{}" }, finishPart("tool-calls")]
                : reasoningAndTextParts(["Готово."]),
            ),
          };
        },
      });
      const service = createChatService({
        storage: createInMemoryChatStorage(),
        catalog: mockCatalog({ mock: model }),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: {
          instructions: "x",
          sequentialTools: ["charge"],
          tools: {
            // Платёжная служба зависла, отмену инструмент не слушает.
            charge: tool({ description: "Списать", inputSchema: z.object({}), execute: (_input, { toolCallId }) => new Promise<string>(() => void started.push(toolCallId)) }),
          },
        } satisfies AgentSettings,
        env: mockEnv,
      });
      const chat = await service.createChat("anna");
      const first = readAllQuietly(await service.sendMessage("anna", chat.id, { id: "q1", role: "user", parts: [{ type: "text", text: "Спиши" }] }));
      while (started.length === 0) await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(1_000);

      await service.stop("anna", chat.id);
      await first;
      void readAllQuietly(await service.retry("anna", chat.id));
      await vi.advanceTimersByTimeAsync(100_000);
      expect(started).toEqual(["c1"]);

      await vi.advanceTimersByTimeAsync(25_000);
      expect(started).toEqual(["c1", "c2"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function readAllQuietly(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (!(await reader.read()).done);
  } catch {
    // Поток хода может кончиться ошибкой — здесь важен только порядок вызовов.
  }
}
