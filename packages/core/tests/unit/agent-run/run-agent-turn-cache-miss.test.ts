import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LAST_STEP_NOTE } from "../../../src/agent-run/last-step";
import { estimateTextTokens } from "../../../src/agent-run/turn-usage";
import { createCacheMissWatch } from "../../../src/usage/cache-miss-watch";
import { chatId, startTurn, storageWithQuestion, TODAY } from "../support/turn-fixtures";
import { finishPart, mockModel, readAll, streamOf, streamStart, textParts } from "../support/mock-model";

function usageFinish(input: number, cacheRead: number, reason: "stop" | "tool-calls" = "stop") {
  return {
    ...finishPart(reason),
    usage: {
      inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
  };
}

describe("runAgentTurn: журнал промахов кэша", () => {
  it("второй ход с пустым кэшем пишет строку в журнал сервера; сообщение собеседника и ответа в строке нет", async () => {
    const lines: string[] = [];
    const cacheMissWatch = createCacheMissWatch({ logError: (line) => lines.push(line) });
    const storage = await storageWithQuestion();
    const answers = [usageFinish(20_000, 15_000), usageFinish(21_000, 0)];
    const model = mockModel(() => streamOf([streamStart, ...textParts(["секретный ответ"]), answers.shift()!]));
    await readAll(startTurn(storage, model, { cacheMissWatch, logError: (line) => lines.push(line) }));
    expect(lines).toEqual([]);
    const history = [
      { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "Привет" }] },
      { id: "a1", role: "assistant" as const, parts: [{ type: "text" as const, text: "секретный ответ", state: "done" as const }] },
      { id: "u2", role: "user" as const, parts: [{ type: "text" as const, text: "секретный вопрос" }] },
    ];
    await readAll(startTurn(storage, model, { cacheMissWatch, logError: (line) => lines.push(line), messageId: "a2", parentId: "u2", history }));
    expect(lines).toHaveLength(1);
    // Дата застыла в вопросе прошлого хода: из промаха ничего не вычитается.
    expect(lines[0]).toMatch(new RegExp(`^\\[промах кэша\\] чат=${chatId} модель=mock-model провайдер=mock токенов=${20_000} `));
    expect(lines[0]).not.toContain("секретн");
  });

  it("без следилки ход идёт как раньше", async () => {
    const lines: string[] = [];
    const storage = await storageWithQuestion();
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), usageFinish(20_000, 0)]));
    await readAll(startTurn(storage, model, { logError: (line) => lines.push(line) }));
    expect(lines).toEqual([]);
  });

  it("большой блок памяти застыл в вопросе: несколько ходов подряд, и ни одной ложной строки", async () => {
    const lines: string[] = [];
    const cacheMissWatch = createCacheMissWatch({ logError: (line) => lines.push(line) });
    const storage = await storageWithQuestion();
    // Блок ≈ 3000 токенов (9000 знаков / 3) застыл в первом вопросе: провайдер читает из кэша весь прошлый вход.
    const memory = { snapshot: async () => "п".repeat(9_000) };
    const usages = [usageFinish(20_000, 15_000), usageFinish(24_000, 20_000), usageFinish(28_000, 24_000)];
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), usages.shift()!]));
    const text = (id: string, role: "user" | "assistant", value: string) => ({ id, role, parts: [{ type: "text" as const, text: value }] });
    const turns = [
      { messageId: "a1", parentId: "u1", history: [text("u1", "user", "Привет")] },
      { messageId: "a2", parentId: "u2", history: [text("u1", "user", "Привет"), text("a1", "assistant", "О"), text("u2", "user", "Как дела?")] },
      {
        messageId: "a3",
        parentId: "u3",
        history: [text("u1", "user", "Привет"), text("a1", "assistant", "О"), text("u2", "user", "Как дела?"), text("a2", "assistant", "О"), text("u3", "user", "А ты?")],
      },
    ];
    for (const turn of turns) {
      await readAll(startTurn(storage, model, { cacheMissWatch, memory, ownerId: "anna", logError: (line) => lines.push(line), ...turn }));
    }
    expect(lines.filter((line) => line.startsWith("[промах кэша]"))).toEqual([]);
  });

  it("снимок шага (stepContext) меняется от шага к шагу: на втором шаге ложного промаха нет", async () => {
    const lines: string[] = [];
    const cacheMissWatch = createCacheMissWatch({ logError: (line) => lines.push(line) });
    const storage = await storageWithQuestion();
    // Снимок ≈ 3000 токенов в конце запроса. На втором шаге провайдер берёт из кэша всё, что было до него.
    const snapshot = "с".repeat(9_000);
    const snapshotTokens = estimateTextTokens(snapshot);
    const steps = [
      [streamStart, { type: "tool-call" as const, toolCallId: "c1", toolName: "lookup", input: "{}" }, usageFinish(20_000, 15_000, "tool-calls")],
      [streamStart, ...textParts(["Ответ"]), usageFinish(24_000, 20_000 - snapshotTokens)],
    ];
    const model = mockModel(() => streamOf(steps.shift()!));
    const tools = { lookup: tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "найдено" }) };
    await readAll(startTurn(storage, model, { cacheMissWatch, tools, stepContext: () => snapshot, logError: (line) => lines.push(line) }));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith("[промах кэша]"))).toEqual([]);
  });

  /** Ход из двух шагов (инструмент, потом текст), затем следующий ход с одним шагом; `extra` — поля первого хода. */
  async function twoTurns(usages: ReturnType<typeof usageFinish>[], extra: Partial<Parameters<typeof startTurn>[2]> = {}) {
    const lines: string[] = [];
    const cacheMissWatch = createCacheMissWatch({ logError: (line) => lines.push(line) });
    const storage = await storageWithQuestion();
    const steps = [
      [streamStart, { type: "tool-call" as const, toolCallId: "c1", toolName: "lookup", input: "{}" }, usages[0]!],
      [streamStart, ...textParts(["Ответ"]), usages[1]!],
      [streamStart, ...textParts(["Второй ответ"]), usages[2]!],
    ];
    const model = mockModel(() => streamOf(steps.shift()!));
    const tools = { lookup: tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "найдено" }) };
    await readAll(startTurn(storage, model, { cacheMissWatch, tools, logError: (line) => lines.push(line), ...extra }));
    const text = (id: string, role: "user" | "assistant", value: string) => ({ id, role, parts: [{ type: "text" as const, text: value }] });
    const history = [text("u1", "user", "Привет"), text("a1", "assistant", "Ответ"), text("u2", "user", "Ещё")];
    await readAll(startTurn(storage, model, { cacheMissWatch, tools, logError: (line) => lines.push(line), messageId: "a2", parentId: "u2", history }));
    expect(model.doStreamCalls).toHaveLength(3);
    return lines.filter((line) => line.startsWith("[промах кэша]"));
  }

  it("следующий ход сравнивается с последним шагом прошлого хода: прочитано только до первого шага — строка", async () => {
    const lines = await twoTurns([usageFinish(20_000, 15_000, "tool-calls"), usageFinish(24_000, 20_000), usageFinish(25_000, 20_000)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=4000 ");
  });

  it("следующий ход прочитал весь последний шаг прошлого хода: строки нет", async () => {
    const lines = await twoTurns([usageFinish(20_000, 15_000, "tool-calls"), usageFinish(24_000, 20_000), usageFinish(25_000, 24_000)]);
    expect(lines).toEqual([]);
  });

  it("из ожидания следующего хода вычитаются снимок и пометка «подведи итог» последнего шага прошлого хода", async () => {
    const snapshot = "с".repeat(9_000);
    const tail = estimateTextTokens(snapshot) + estimateTextTokens(LAST_STEP_NOTE);
    const first = [usageFinish(20_000, 15_000, "tool-calls"), usageFinish(24_000, 20_000 - estimateTextTokens(snapshot))];
    const extra = { stepContext: () => snapshot, maxSteps: 2 };
    expect(await twoTurns([...first, usageFinish(25_000, 24_000 - tail)], extra)).toEqual([]);
    const missed = await twoTurns([...first, usageFinish(25_000, 24_000 - tail - 1_025)], extra);
    expect(missed).toHaveLength(1);
    expect(missed[0]).toContain("токенов=1025 ");
  });
});
