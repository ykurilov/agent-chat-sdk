import { tool } from "ai";
import type { ToolSet } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  ToolTimeoutError,
  declareToolTimeout,
  resolveToolTimeout,
  toolTimeoutMessage,
  withToolTimeout,
} from "../../../src/agent-run/tool-timeout";

type CallOptions = Parameters<NonNullable<ToolSet[string]["execute"]>>[1];
const options = (abortSignal?: AbortSignal): CallOptions =>
  ({ toolCallId: "c1", messages: [], context: {}, ...(abortSignal && { abortSignal }) }) as unknown as CallOptions;

/** Инструмент, который не отвечает, пока его не отменят; сигнал вызова — в `signals`. */
function hangingTool(signals: AbortSignal[]) {
  return tool({
    description: "Долго думает",
    inputSchema: z.object({}),
    execute: (_input, { abortSignal }) => {
      if (abortSignal) signals.push(abortSignal);
      return new Promise<string>(() => {});
    },
  });
}

function execute(tools: ToolSet | undefined, name: string, abortSignal?: AbortSignal): Promise<unknown> {
  const run = tools![name]!.execute!({}, options(abortSignal)) as Promise<unknown>;
  // Отказ подписан сразу: подменённые часы не должны давать «необработанный отказ».
  run.catch(() => {});
  return run;
}

describe("настройка agent.toolTimeoutMs", () => {
  it("по умолчанию 120 с; 0 и Infinity — без предела; меньше 1 с, больше 2³¹−1 мс и не число — ошибка настройки", () => {
    const forAll = (setting: number | undefined) => resolveToolTimeout(setting).forTool("any");
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBe(120_000);
    expect(forAll(undefined)).toBe(120_000);
    expect(forAll(5_000)).toBe(5_000);
    expect(forAll(0)).toBe(Number.POSITIVE_INFINITY);
    expect(forAll(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(forAll(2 ** 31 - 1)).toBe(2 ** 31 - 1);
    for (const wrong of [999, -1, Number.NaN, 2 ** 31, "120000" as unknown as number]) {
      expect(() => resolveToolTimeout(wrong)).toThrow(/agent\.toolTimeoutMs/);
    }
  });

  it("свой срок по имени инструмента: byTool главнее default; 0 и Infinity — без предела (инструмент, который сам ждёт человека)", () => {
    const timeout = resolveToolTimeout({ default: 30_000, byTool: { ask_user: 0, slow_report: 600_000, forever: Number.POSITIVE_INFINITY } });
    expect(timeout.forTool("ask_user")).toBe(Number.POSITIVE_INFINITY);
    expect(timeout.forTool("forever")).toBe(Number.POSITIVE_INFINITY);
    expect(timeout.forTool("slow_report")).toBe(600_000);
    expect(timeout.forTool("list_tasks")).toBe(30_000);
    expect(resolveToolTimeout({ byTool: { ask_user: 0 } }).forTool("list_tasks")).toBe(120_000);
    // Имена, совпадающие со свойствами объекта, — не настройка.
    expect(resolveToolTimeout({ byTool: {} }).forTool("toString")).toBe(120_000);
  });

  it("срок, объявленный самим инструментом: не короче его — общий срок длиннее берётся, byTool приложения главнее", () => {
    expect(resolveToolTimeout(undefined).forTool("generate_images", 180_000)).toBe(180_000);
    expect(resolveToolTimeout(60_000).forTool("generate_images", 180_000)).toBe(180_000);
    expect(resolveToolTimeout({ default: 300_000 }).forTool("generate_images", 180_000)).toBe(300_000);
    expect(resolveToolTimeout(0).forTool("generate_images", 180_000)).toBe(Number.POSITIVE_INFINITY);
    expect(resolveToolTimeout({ byTool: { generate_images: 60_000 } }).forTool("generate_images", 180_000)).toBe(60_000);
    expect(resolveToolTimeout(undefined).forTool("list_tasks", undefined)).toBe(120_000);
  });

  it("неверный срок в default или byTool, неверная форма — ошибка с путём настройки", () => {
    expect(() => resolveToolTimeout({ default: 10 })).toThrow(/agent\.toolTimeoutMs\.default/);
    expect(() => resolveToolTimeout({ byTool: { ask_user: -5 } })).toThrow(/agent\.toolTimeoutMs\.byTool\["ask_user"\]/);
    expect(() => resolveToolTimeout({ byTool: [] as unknown as Record<string, number> })).toThrow(/agent\.toolTimeoutMs\.byTool/);
    expect(() => resolveToolTimeout(null as unknown as number)).toThrow(/agent\.toolTimeoutMs/);
  });

  it("текст для модели называет срок в секундах и предупреждает, что действие могло выполниться", () => {
    expect(toolTimeoutMessage(120_000)).toBe(
      "Инструмент не ответил за 120 с и отменён. Выполнено ли действие, неизвестно; не повторяй его, не проверив",
    );
    expect(toolTimeoutMessage(1_500)).toMatch(/^Инструмент не ответил за 2 с/);
  });
});

describe("withToolTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("инструмент молчит дольше срока — вызов закрывается ToolTimeoutError, сам инструмент получает отмену, журнал узнаёт имя", async () => {
    const signals: AbortSignal[] = [];
    const timedOut: string[] = [];
    const tools = withToolTimeout({ slow: hangingTool(signals) }, { timeoutFor: () => 120_000, onTimeout: (name, ms) => timedOut.push(`${name} ${ms}`) });
    const run = execute(tools, "slow");

    await vi.advanceTimersByTimeAsync(119_999);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const error = await run.catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ToolTimeoutError);
    expect((error as Error).message).toBe(toolTimeoutMessage(120_000));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[0]!.reason).toBe(error);
    expect(timedOut).toEqual(["slow 120000"]);
  });

  it("ответ раньше срока — результат как есть, отмены нет, таймер снят", async () => {
    const signals: AbortSignal[] = [];
    const tools = withToolTimeout(
      {
        quick: tool({
          description: "Отвечает за 5 с",
          inputSchema: z.object({}),
          execute: (_input, { abortSignal }) => {
            if (abortSignal) signals.push(abortSignal);
            return new Promise<string>((resolve) => setTimeout(() => resolve("готово"), 5_000));
          },
        }),
      },
      { timeoutFor: () => 10_000 },
    );
    const run = execute(tools, "quick");
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(run).resolves.toBe("готово");
    expect(vi.getTimerCount()).toBe(0);
    expect(signals[0]!.aborted).toBe(false);
  });

  it("ошибка инструмента раньше срока — та же ошибка", async () => {
    const failure = new Error("база недоступна");
    const tools = withToolTimeout(
      { broken: tool({ description: "Падает", inputSchema: z.object({}), execute: async (): Promise<string> => Promise.reject(failure) }) },
      { timeoutFor: () => 10_000 },
    );
    await expect(execute(tools, "broken")).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("«Стоп» хода доходит до инструмента как раньше: его сигнал отменён, срок больше не ждётся", async () => {
    const signals: AbortSignal[] = [];
    const timedOut: string[] = [];
    const stop = new AbortController();
    const tools = withToolTimeout({ slow: hangingTool(signals) }, { timeoutFor: () => 120_000, onTimeout: (name, ms) => timedOut.push(`${name} ${ms}`) });
    void execute(tools, "slow", stop.signal);

    stop.abort(new Error("стоп"));
    expect(signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(timedOut).toEqual([]);
  });

  it("без предела (Infinity) — те же инструменты, без обёртки", () => {
    const tools: ToolSet = { slow: hangingTool([]) };
    expect(withToolTimeout(tools, { timeoutFor: () => Number.POSITIVE_INFINITY })).toBe(tools);
    expect(withToolTimeout(undefined, { timeoutFor: () => 1_000 })).toBeUndefined();
  });

  it("инструмент без execute и синхронный execute не трогаются", async () => {
    const description = tool({ description: "Без execute", inputSchema: z.object({}) });
    const sync = tool({ description: "Сразу", inputSchema: z.object({}), execute: () => "сразу" });
    const tools = withToolTimeout({ description, sync }, { timeoutFor: () => 1_000 });
    expect(tools!.description).toBe(description);
    expect(tools!.sync!.execute!({}, options())).toBe("сразу");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("поток промежуточных результатов: срок считается до каждого следующего значения", async () => {
    const signals: AbortSignal[] = [];
    const tools = withToolTimeout(
      {
        progress: tool({
          description: "Шлёт ход работы",
          inputSchema: z.object({}),
          execute: async function* (_input, { abortSignal }) {
            if (abortSignal) signals.push(abortSignal);
            for (const step of ["1", "2"]) {
              await new Promise((resolve) => setTimeout(resolve, 8_000));
              yield step;
            }
            await new Promise(() => {});
          },
        }),
      },
      { timeoutFor: () => 10_000 },
    );
    const values: unknown[] = [];
    const reading = (async () => {
      for await (const value of tools!.progress!.execute!({}, options()) as AsyncIterable<unknown>) values.push(value);
    })().catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(16_000);
    expect(values).toEqual(["1", "2"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await reading).toBeInstanceOf(ToolTimeoutError);
    expect(signals[0]!.aborted).toBe(true);
  });
  it("свой срок у отдельного инструмента: без предела ждёт ответа человека сколько угодно, остальные — по общему сроку", async () => {
    const signals: AbortSignal[] = [];
    const timedOut: string[] = [];
    let answerHuman!: (text: string) => void;
    const askUser = tool({
      description: "Спросить человека",
      inputSchema: z.object({}),
      execute: (_input, { abortSignal }) => {
        if (abortSignal) signals.push(abortSignal);
        return new Promise<string>((resolve) => (answerHuman = resolve));
      },
    });
    const tools = withToolTimeout(
      { ask_user: askUser, slow: hangingTool(signals) },
      { timeoutFor: (name) => (name === "ask_user" ? Number.POSITIVE_INFINITY : 10_000), onTimeout: (name, ms) => timedOut.push(`${name} ${ms}`) },
    );
    expect(tools!.ask_user).toBe(askUser);
    const asking = execute(tools, "ask_user");
    const slow = execute(tools, "slow");

    await vi.advanceTimersByTimeAsync(600_000);
    expect(await slow.catch((error: unknown) => error)).toBeInstanceOf(ToolTimeoutError);
    answerHuman("Да, удаляй");
    await expect(asking).resolves.toBe("Да, удаляй");
    // ask_user без обёртки (проверено выше), сигнал отмены получил только зависший slow.
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    expect(timedOut).toEqual(["slow 10000"]);
  });

  it("инструмент объявил свой срок длиннее общего — ядро ждёт его, а не обрывает по общему сроку", async () => {
    const signals: AbortSignal[] = [];
    const timedOut: string[] = [];
    const declared = declareToolTimeout(hangingTool(signals), 180_000);
    // Объявление переживает копию объекта: приложение может переписать описание инструмента.
    const copy = Object.assign({}, declareToolTimeout(hangingTool(signals), 180_000), { description: "Своё описание" });
    const timeout = resolveToolTimeout(undefined);
    const tools = withToolTimeout(
      { generate_images: declared, copied: copy, plain: hangingTool(signals) },
      { timeoutFor: (name, declaredMs) => timeout.forTool(name, declaredMs), onTimeout: (name, ms) => timedOut.push(`${name} ${ms}`) },
    );
    const images = execute(tools, "generate_images");
    const copied = execute(tools, "copied");
    const plain = execute(tools, "plain");

    await vi.advanceTimersByTimeAsync(150_000);
    expect(await plain.catch((error: unknown) => error)).toBeInstanceOf(ToolTimeoutError);
    expect(timedOut).toEqual(["plain 120000"]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await images.catch((error: unknown) => error)).toBeInstanceOf(ToolTimeoutError);
    expect(await copied.catch((error: unknown) => error)).toBeInstanceOf(ToolTimeoutError);
    expect(timedOut).toEqual(["plain 120000", "generate_images 180000", "copied 180000"]);
  });

  it("у всех инструментов без предела — те же инструменты", () => {
    const tools: ToolSet = { slow: hangingTool([]) };
    expect(withToolTimeout(tools, { timeoutFor: () => Number.POSITIVE_INFINITY })).toBe(tools);
  });

  it("несколько вызовов сразу: каждый со своим таймером, после всех исходов таймеров не остаётся", async () => {
    const after = (ms: number, outcome: "ok" | "fail") =>
      tool({
        description: `${outcome} через ${ms} мс`,
        inputSchema: z.object({}),
        execute: () =>
          new Promise<string>((resolve, reject) => setTimeout(() => (outcome === "ok" ? resolve("ok") : reject(new Error("сбой"))), ms)),
      });
    const tools = withToolTimeout(
      { fast: after(1_000, "ok"), failing: after(2_000, "fail"), slow: hangingTool([]), late: after(3_000, "ok") },
      { timeoutFor: () => 5_000 },
    );
    const runs = ["fast", "failing", "slow", "late", "fast"].map((name) => execute(tools, name).then(
      (value) => value,
      (error: unknown) => (error instanceof ToolTimeoutError ? "срок" : (error as Error).message),
    ));
    await vi.advanceTimersByTimeAsync(3_000);
    // Остался только срок зависшего вызова.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await Promise.all(runs)).toEqual(["ok", "сбой", "срок", "ok", "ok"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("читатель сам закрыл поток промежуточных результатов — источник закрыт, таймеров нет", async () => {
    let sourceClosed = false;
    const tools = withToolTimeout(
      {
        progress: tool({
          description: "Шлёт ход работы",
          inputSchema: z.object({}),
          execute: async function* () {
            try {
              yield "1";
              yield "2";
              await new Promise(() => {});
            } finally {
              sourceClosed = true;
            }
          },
        }),
      },
      { timeoutFor: () => 10_000 },
    );
    const values: unknown[] = [];
    for await (const value of tools!.progress!.execute!({}, options()) as AsyncIterable<unknown>) {
      values.push(value);
      break;
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(values).toEqual(["1"]);
    expect(sourceClosed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
