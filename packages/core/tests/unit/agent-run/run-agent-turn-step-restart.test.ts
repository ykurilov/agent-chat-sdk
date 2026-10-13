import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import type { UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { STEP_RESET_PART_TYPE, STEPS_MAY_RESET_PART_TYPE } from "../../../src/agent-run/step-reset";
import type { AgentTurnInput } from "../../../src/agent-run/run-agent-turn";
import { finishPart, mockCatalog, readAll, reasoningParts, streamOf, streamStart, textParts, withoutFrozenContext } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion, textOf } from "../support/turn-fixtures";

/** Сроки молчания теста: секунда до первого куска и между кусками. */
const silence = { firstChunkMs: 1_000, betweenChunksMs: 1_000 };
const restart = { onSilence: "restart-step-on-next" } as const;

type Call = LanguageModelV4StreamPart[] | "silent";

/**
 * Модель, у которой каждый вызов — свой сценарий: куски и конец потока или куски и молчание до отмены («silent» — молчит
 * сразу). Дальше — последний сценарий.
 */
function scripted(calls: Array<{ parts: LanguageModelV4StreamPart[]; thenSilent?: boolean } | Call>): MockLanguageModelV4 {
  let index = 0;
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      const raw = calls[Math.min(index++, calls.length - 1)]!;
      const call = raw === "silent" ? { parts: [streamStart], thenSilent: true } : Array.isArray(raw) ? { parts: raw } : raw;
      if (!call.thenSilent) return { stream: streamOf(call.parts) };
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of call.parts) controller.enqueue(part);
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      };
    },
  });
}

const textThenSilent = (text: string) => ({ parts: [streamStart, { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: text }] as LanguageModelV4StreamPart[], thenSilent: true });
const answer = (text: string) => [streamStart, ...textParts([text]), finishPart()];
const toolStep = (id: string) => [streamStart, { type: "tool-call", toolCallId: id, toolName: "lookup", input: JSON.stringify({ query: id }) }, finishPart("tool-calls")] as LanguageModelV4StreamPart[];

/** Провайдер перегружен (503) на каждом запросе; пауза повтора 1 мс. */
const overloaded = () =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw new APICallError({ message: "ответ 503", url: "https://provider.test", requestBodyValues: {}, statusCode: 503, responseHeaders: { "retry-after-ms": "1" } });
    },
  });

/** Конец шага без чисел провайдера: расход шага — оценкой. */
const finishWithoutUsage: LanguageModelV4StreamPart = {
  type: "finish",
  finishReason: { unified: "stop", raw: "stop" },
  usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } },
};

function lookupTool() {
  const execute = vi.fn(async ({ query }: { query: string }) => `найдено: ${query}`);
  return { tools: { lookup: tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute }) }, execute };
}

/** Ход с основным `mock` и запасным `mock-backup`, пока подменённые часы идут вперёд на `advanceMs`. */
async function turnWithClock(primary: MockLanguageModelV4, backup: MockLanguageModelV4, advanceMs: number, extra: Partial<AgentTurnInput> = {}) {
  const storage = await storageWithQuestion();
  const logged: string[] = [];
  const reading = readAll(
    startTurn(storage, primary, {
      catalog: mockCatalog({ mock: primary, "mock-backup": backup }),
      modelSilence: silence,
      providerFallback: restart,
      logError: (line) => logged.push(line),
      ...extra,
    }),
  );
  await vi.advanceTimersByTimeAsync(advanceMs);
  const chunks = await reading;
  const saved = await savedAnswer(storage);
  if (!saved) throw new Error("ответ не сохранён");
  return { chunks, answer: saved, logged };
}

const resets = (chunks: UIMessageChunk[]) => chunks.filter((chunk) => chunk.type === STEP_RESET_PART_TYPE);
const promptText = (model: MockLanguageModelV4, call: number) => JSON.stringify(model.doStreamCalls[call]?.prompt);

describe("runAgentTurn: модель молчит — шаг заново у следующего провайдера (onSilence: restart-step-on-next)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("замолчала посреди текста: показанное стирается (кусок data-step-reset), шаг заново у запасного, в записи и запросе стёртого нет", async () => {
    const primary = scripted([textThenSilent("Начало, которое сотрётся")]);
    const backup = scripted([answer("Ответ запасного")]);

    const { chunks, answer: saved, logged } = await turnWithClock(primary, backup, 1_000);

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(saved.status).toBe("complete");
    expect(saved.providerId).toBe("mock-backup");
    expect(textOf(saved.parts)).toBe("Ответ запасного");
    expect(saved.parts.filter((part) => part.type === "step-start")).toHaveLength(1);
    expect(promptText(backup, 0)).not.toContain("Начало");
    // Клиент видел начало, затем — отмену шага, затем — шаг запасного.
    const types = chunks.map((chunk) => chunk.type);
    const resetAt = types.indexOf(STEP_RESET_PART_TYPE);
    expect(resets(chunks)).toHaveLength(1);
    expect(chunks.findIndex((chunk) => chunk.type === "text-delta" && chunk.delta === "Начало, которое сотрётся")).toBeLessThan(resetAt);
    expect(chunks.findIndex((chunk) => chunk.type === "text-delta" && chunk.delta === "Ответ запасного")).toBeGreaterThan(resetAt);
    expect(types.indexOf("start-step", resetAt)).toBeGreaterThan(resetAt);
    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(logged.some((line) => line.startsWith("[переход при молчании] чат=chat-1") && line.includes("с=mock на=mock-backup") && line.includes("шаг стёрт"))).toBe(true);
  });

  it("молчит до первого куска: повтора у того же нет, сразу запасной; стирать нечего", async () => {
    const primary = scripted(["silent"]);
    const backup = scripted([answer("Ответ запасного")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000);

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(saved.status).toBe("complete");
    expect(textOf(saved.parts)).toBe("Ответ запасного");
    expect(resets(chunks)).toHaveLength(0);
  });

  it("стирается только оборванный шаг: законченный шаг с инструментом остаётся, инструмент не запускается второй раз", async () => {
    const { tools, execute } = lookupTool();
    const primary = scripted([toolStep("c1"), textThenSilent("Итак, ")]);
    const backup = scripted([answer("Итог запасного")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000, { tools });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(saved.status).toBe("complete");
    expect(withoutFrozenContext(saved.parts).map((part) => part.type)).toEqual(["step-start", "tool-lookup", "step-start", "text"]);
    expect(textOf(saved.parts)).toBe("Итог запасного");
    expect(promptText(backup, 0)).toContain("найдено: c1");
    expect(promptText(backup, 0)).not.toContain("Итак");
    expect(resets(chunks)).toHaveLength(1);
  });

  it("в оборванном шаге есть вызов с полным входом: шаг не стирается, ответ продолжается у запасного", async () => {
    const { tools, execute } = lookupTool();
    const primary = scripted([
      {
        parts: [
          streamStart,
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "Ищу. " },
          { type: "text-end", id: "t" },
          { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ query: "c1" }) },
        ],
        thenSilent: true,
      },
    ]);
    const backup = scripted([answer("Нашёл.")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000, { tools });

    // SDK запускает инструменты только после конца шага модели (finish), а шаг оборван молчанием: вызова не было.
    expect(execute).not.toHaveBeenCalled();
    expect(resets(chunks)).toHaveLength(0);
    expect(saved.status).toBe("complete");
    expect(textOf(saved.parts)).toBe("Ищу. Нашёл.");
    // Вызов закрыт: модель знает, что он мог выполниться, и не повторит его вслепую.
    expect(saved.parts.find((part) => part.type === "tool-lookup")).toMatchObject({ toolCallId: "c1", state: "output-error" });
    expect(backup.doStreamCalls).toHaveLength(1);
  });

  it("рассуждение стёртого шага уходит и из длительностей: у ответа одна длительность — рассуждения запасного", async () => {
    const primary = scripted([{ parts: [streamStart, ...reasoningParts("думаю долго"), { type: "text-start", id: "t" }, { type: "text-delta", id: "t", delta: "Нач" }], thenSilent: true }]);
    const backup = scripted([[streamStart, ...reasoningParts("думаю"), ...textParts(["Ответ"]), finishPart()]]);

    const { answer: saved } = await turnWithClock(primary, backup, 1_000);

    expect(saved.parts.filter((part) => part.type === "reasoning")).toHaveLength(1);
    expect(Object.keys(saved.reasoningDurationsMs ?? {})).toEqual(["0"]);
  });

  it("запасной тоже замолчал, а провайдеров дальше нет — прежний путь: автопродолжение у запасного", async () => {
    const primary = scripted([textThenSilent("Стёртое. ")]);
    const backup = scripted([textThenSilent("Начало запасного, "), answer("конец.")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000 + 1_000 + 2_500);

    expect(resets(chunks)).toHaveLength(1);
    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(2);
    expect(saved.status).toBe("complete");
    expect(textOf(saved.parts)).toBe("Начало запасного, конец.");
  });

  it("onSilence не задан — прежнее поведение: повтор молчания у того же, без стирания", async () => {
    const primary = scripted(["silent", answer("Со второй попытки")]);
    const backup = scripted([answer("Запасной")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000 + 1_250, { providerFallback: {} });

    expect(primary.doStreamCalls).toHaveLength(2);
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(textOf(saved.parts)).toBe("Со второй попытки");
    expect(resets(chunks)).toHaveLength(0);
  });

  it("scope: turn (по умолчанию) — запасной до конца хода", async () => {
    const { tools } = lookupTool();
    const primary = scripted([textThenSilent("Стёртое")]);
    const backup = scripted([toolStep("c1"), answer("Итог")]);

    const { answer: saved } = await turnWithClock(primary, backup, 1_000, { tools });

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(2);
    expect(saved.providerId).toBe("mock-backup");
    expect(textOf(saved.parts)).toBe("Итог");
  });

  it("scope: step — следующий шаг снова у основного; конец попытки запасного клиенту не идёт", async () => {
    const { tools, execute } = lookupTool();
    const primary = scripted([textThenSilent("Стёртое"), answer("Итог основного")]);
    const backup = scripted([toolStep("c1"), answer("не должен")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000, { tools, providerFallback: { ...restart, scope: "step" } });

    expect(backup.doStreamCalls).toHaveLength(1);
    expect(primary.doStreamCalls).toHaveLength(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(promptText(primary, 1)).toContain("найдено: c1");
    expect(saved.status).toBe("complete");
    expect(saved.providerId).toBe("mock");
    expect(textOf(saved.parts)).toBe("Итог основного");
    expect(chunks.filter((chunk) => chunk.type === "finish")).toHaveLength(1);
    expect(chunks.at(-1)?.type).toBe("finish");
  });

  it("maxSwitches: предел переходов за ход; дальше — прежний путь (автопродолжение у того же)", async () => {
    const { tools } = lookupTool();
    // Основной молчит на каждом шаге; запасной делает шаг с инструментом; scope: step возвращает к основному.
    const make = () => ({
      primary: scripted([textThenSilent("Стёртое 1"), textThenSilent("Второй шаг, "), answer("дописано.")]),
      backup: scripted([toolStep("c1"), toolStep("c2"), answer("Итог запасного")]),
    });

    const one = make();
    const single = await turnWithClock(one.primary, one.backup, 1_000 + 1_000 + 2_500, { tools, providerFallback: { ...restart, scope: "step", maxSwitches: 1 } });
    expect(resets(single.chunks)).toHaveLength(1);
    expect(one.backup.doStreamCalls).toHaveLength(1);
    expect(one.primary.doStreamCalls).toHaveLength(3);
    expect(textOf(single.answer.parts)).toBe("Второй шаг, дописано.");

    const two = make();
    const double = await turnWithClock(two.primary, two.backup, 1_000 + 1_000, { tools, providerFallback: { ...restart, scope: "step", maxSwitches: 2 } });
    expect(resets(double.chunks)).toHaveLength(2);
    expect(two.backup.doStreamCalls).toHaveLength(2);
  });

  it("каждый переход съедает шаг хода: шагов на запасного не осталось — прежний путь", async () => {
    const primary = scripted([textThenSilent("Начало, "), answer("конец.")]);
    const backup = scripted([answer("Запасной")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000 + 2_500, { maxSteps: 1 });

    expect(backup.doStreamCalls).toHaveLength(0);
    expect(resets(chunks)).toHaveLength(0);
    expect(textOf(saved.parts)).toBe("Начало, конец.");
  });

  it("«Стоп» во время перехода: запроса к запасному нет, ход остановлен", async () => {
    const stop = new AbortController();
    const primary = scripted([textThenSilent("Начало")]);
    const backup = scripted([answer("Запасной")]);

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000, {
      abortSignal: stop.signal,
      logError: (line) => {
        if (line.startsWith("[переход при молчании]")) stop.abort();
      },
    });

    expect(backup.doStreamCalls).toHaveLength(0);
    expect(saved.status).toBe("stopped");
    expect(chunks.at(-1)?.type).toBe("abort");
  });

  it("служба останавливается (newAttemptAllowed — нет): нового захода нет, ход кончается остановкой", async () => {
    const stop = new AbortController();
    const primary = scripted([textThenSilent("Начало")]);
    const backup = scripted([answer("Запасной")]);
    const newAttemptAllowed = vi.fn(() => {
      stop.abort();
      return false;
    });

    const { answer: saved } = await turnWithClock(primary, backup, 1_000, { abortSignal: stop.signal, newAttemptAllowed });

    expect(newAttemptAllowed).toHaveBeenCalledTimes(1);
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(saved.status).toBe("stopped");
  });

  it("ход с переходом при молчании сразу после start помечен data-steps-may-reset (только клиенту); без перехода пометки нет", async () => {
    for (const [providerFallback, marked] of [[restart, true], [{ onSilence: "continue" as const }, false], [{ ...restart, maxSwitches: 0 }, false]] as const) {
      const { chunks, answer: saved } = await turnWithClock(scripted([answer("Ответ")]), scripted([answer("Запасной")]), 0, { providerFallback });
      const marker = chunks.findIndex((chunk) => chunk.type === STEPS_MAY_RESET_PART_TYPE);
      expect(marker !== -1, JSON.stringify(providerFallback)).toBe(marked);
      if (marked) {
        expect(chunks[marker - 1]?.type).toBe("start");
        expect(chunks[marker]).toMatchObject({ transient: true });
      }
      expect(saved.parts.some((part) => part.type === STEPS_MAY_RESET_PART_TYPE)).toBe(false);
    }
  });

  it("остановка пришла до перехода: показанное не стирается — перехода нет, текст остаётся", async () => {
    const stop = new AbortController();
    const primary = scripted([textThenSilent("Начало")]);
    const backup = scripted([answer("Запасной")]);
    const newAttemptAllowed = () => {
      stop.abort();
      return false;
    };

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000, { abortSignal: stop.signal, newAttemptAllowed });

    expect(resets(chunks)).toHaveLength(0);
    expect(textOf(saved.parts)).toBe("Начало");
    expect(saved.status).toBe("stopped");
  });

  it("«Стоп» пришёл, когда шаг ещё виден: показанное не стирается, запроса к запасному нет", async () => {
    const stop = new AbortController();
    const primary = scripted([textThenSilent("Начало")]);
    const backup = scripted([answer("Запасной")]);
    // «Стоп» нажат в тот миг, когда ход решает, идти ли к запасному.
    const newAttemptAllowed = () => {
      stop.abort();
      return true;
    };

    const { chunks, answer: saved } = await turnWithClock(primary, backup, 1_000, { abortSignal: stop.signal, newAttemptAllowed });

    expect(resets(chunks)).toHaveLength(0);
    expect(backup.doStreamCalls).toHaveLength(0);
    expect(textOf(saved.parts)).toBe("Начало");
    expect(saved.status).toBe("stopped");
  });

  it("scope: step возвращает к основному только после перехода при молчании: запасной по перегрузке остаётся до конца хода", async () => {
    for (const onSilence of ["restart-step-on-next", "continue"] as const) {
      const { tools } = lookupTool();
      const primary = overloaded();
      const backup = scripted([toolStep("c1"), answer("Итог запасного")]);

      const { answer: saved } = await turnWithClock(primary, backup, 1_000, { tools, providerFallback: { onSilence, scope: "step" } });

      expect(saved.status, onSilence).toBe("complete");
      expect(textOf(saved.parts), onSilence).toBe("Итог запасного");
      expect(primary.doStreamCalls, onSilence).toHaveLength(4);
      expect(backup.doStreamCalls, onSilence).toHaveLength(2);
    }
  });

  it("цепочка при молчании: основной → первый запасной замолчал → второй запасной (maxSwitches: 2)", async () => {
    const primary = scripted([textThenSilent("Стёртое основного")]);
    const backup = scripted([textThenSilent("Стёртое запасного")]);
    const third = scripted([answer("Ответ третьего")]);

    const { chunks, answer: saved, logged } = await turnWithClock(primary, backup, 2_000, {
      catalog: mockCatalog({ mock: primary, "mock-backup": backup, "mock-third": third }),
      providerFallback: { ...restart, maxSwitches: 2 },
    });

    expect(resets(chunks)).toHaveLength(2);
    expect([primary, backup, third].map((model) => model.doStreamCalls.length)).toEqual([1, 1, 1]);
    expect(textOf(saved.parts)).toBe("Ответ третьего");
    expect(logged.some((line) => line.startsWith("[переход при молчании]") && line.includes("с=mock-backup на=mock-third") && line.includes("переход=2 из 2"))).toBe(true);
  });

  it("цепочка: основной замолчал → первый запасной перегружен до первого куска → второй запасной, а не повтор у первого", async () => {
    const primary = scripted([textThenSilent("Стёртое")]);
    const backup = overloaded();
    const third = scripted([answer("Ответ третьего")]);

    const { chunks, answer: saved, logged } = await turnWithClock(primary, backup, 60_000, {
      catalog: mockCatalog({ mock: primary, "mock-backup": backup, "mock-third": third }),
      providerFallback: { ...restart, maxSwitches: 2 },
    });

    expect(resets(chunks)).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(4);
    expect(third.doStreamCalls).toHaveLength(1);
    expect(saved.status).toBe("complete");
    expect(textOf(saved.parts)).toBe("Ответ третьего");
    expect(logged.some((line) => line.startsWith("[запасной провайдер]") && line.includes("с=mock-backup на=mock-third"))).toBe(true);
  });

  it("медленный инструмент в оборванном шаге не запускается: SDK запускает инструменты после конца шага модели", async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      return `найдено: ${query}`;
    });
    const tools = { lookup: tool({ description: "Поиск.", inputSchema: z.object({ query: z.string() }), execute }) };
    const primary = scripted([{ parts: [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: JSON.stringify({ query: "c1" }) }], thenSilent: true }]);
    const backup = scripted([answer("Нашёл.")]);

    const { answer: saved } = await turnWithClock(primary, backup, 10_000, { tools });

    expect(execute).not.toHaveBeenCalled();
    expect(backup.doStreamCalls).toHaveLength(1);
    expect(saved.parts.find((part) => part.type === "tool-lookup")).toMatchObject({ toolCallId: "c1", state: "output-error" });
    expect(textOf(saved.parts)).toBe("Нашёл.");
  });

  it("расход стёртого шага: оплачен (в итоге хода), но в оценку входа следующего шага не идёт — его нет в запросе", async () => {
    const erased = "а".repeat(3_000);
    const primary = scripted([textThenSilent(erased)]);
    const backup = scripted([[streamStart, ...textParts(["Ответ"]), finishWithoutUsage]]);

    const { answer: saved } = await turnWithClock(primary, backup, 1_000);

    // Стёртые 3000 знаков кириллицы — около 1500 токенов выхода основного.
    expect(saved.usage?.outputTokens).toBeGreaterThanOrEqual(1_500);
    // Вход запасного оценивается по его запросу (вопрос и инструкция), а не «вход + выход стёртого шага».
    expect(saved.usage?.inputTokens).toBeLessThan(500);
  });

  it("maxOutputTokens — в каждом заходе: и у основного, и у запасного", async () => {
    const primary = scripted([textThenSilent("Начало")]);
    const backup = scripted([answer("Запасной")]);

    await turnWithClock(primary, backup, 1_000, { maxOutputTokens: 321 });

    expect(primary.doStreamCalls[0]?.maxOutputTokens).toBe(321);
    expect(backup.doStreamCalls[0]?.maxOutputTokens).toBe(321);
  });
});
