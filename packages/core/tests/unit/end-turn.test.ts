import { tool } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEndTurnRequests, endTurn } from "../../src/agent-run/end-turn";

const options = (toolCallId: string) => ({ toolCallId, messages: [], abortSignal: new AbortController().signal }) as never;
const saved = (toolCallId: string) => ({ type: "tool-submit", toolCallId, state: "output-available" });

function submitTool(gate?: Promise<void>) {
  return {
    submit: tool({
      description: "Отправить",
      inputSchema: z.object({}),
      execute: async () => {
        await gate;
        return endTurn("ok", { text: "Готово." });
      },
    }),
  };
}

async function run(tools: ToolSet | undefined, toolCallId: string) {
  return tools!.submit!.execute!({}, options(toolCallId));
}

describe("createEndTurnRequests: новая попытка хода", () => {
  it("просьба вызова без сохранённого результата снимается (упавшая попытка, стёртый шаг)", async () => {
    const requests = createEndTurnRequests();
    await run(requests.tools(submitTool()), "c1");
    expect(requests.requested()).toBe(true);
    requests.nextAttempt([]);
    expect(requests.requested()).toBe(false);
  });

  it("результат сохранён — просьба остаётся, новая попытка её исполняет", async () => {
    const requests = createEndTurnRequests();
    await run(requests.tools(submitTool()), "c1");
    requests.nextAttempt([saved("c1")]);
    expect(requests.take()).toBe("Готово.");
  });

  it("инструмент упавшей попытки досчитался после перехода — его просьба не принимается", async () => {
    const requests = createEndTurnRequests();
    let release!: () => void;
    const late = run(requests.tools(submitTool(new Promise((resolve) => (release = resolve)))), "c1");
    requests.nextAttempt([]);
    release();
    await late;
    expect(requests.requested()).toBe(false);
  });

  it("инструмент запущен заново после падения попытки — текст один раз", async () => {
    const requests = createEndTurnRequests();
    await run(requests.tools(submitTool()), "c1");
    requests.nextAttempt([]);
    await run(requests.tools(submitTool()), "c2");
    expect(requests.take()).toBe("Готово.");
  });
});

const textPart = (text: string) => ({ type: "text", text });
const guardedTool = (extra: { text?: string; requireText?: boolean } = {}) => ({ submit: tool({ description: "Save", inputSchema: z.object({}), execute: () => endTurn("ok", { requireText: true, ...extra }) }) });

describe("requireText guard: retained in-memory answer", () => {
  it.each([[], [textPart(" \n\t\u00a0\u200b\u2060\ufe0f")], [{ type: "reasoning", text: "private" }], [{ type: "tool-lookup", output: "visible tool result" }], [{ type: "error", text: "error" }], [{ type: "data-end-turn", text: "internal note" }]].map((parts) => ({ parts })))("ignores non-user text %#", async ({ parts }) => {
    const requests = createEndTurnRequests(async () => parts);
    expect(await run(requests.tools(guardedTool()), "c1")).toBe("ok");
    expect(requests.requested()).toBe(false);
  });

  it.each(["Сохранено.", "🙂", "**", "<br>"])("counts text without guessing Markdown/HTML semantics: %s", async (text) => {
    const requests = createEndTurnRequests(async () => [textPart(text)]);
    await run(requests.tools(guardedTool()), "c1");
    expect(requests.requested()).toBe(true);
  });

  it.each([false, true])("retry keeps a guarded request only with retained text, kept=%s", async (kept) => {
    const requests = createEndTurnRequests(async () => [textPart("Ответ")]);
    await run(requests.tools(guardedTool()), "c1");
    requests.nextAttempt([saved("c1"), ...(kept ? [textPart("Ответ")] : [])]);
    expect(requests.requested()).toBe(kept);
  });

  it("retry drops an erased tool result even if text remains", async () => {
    const requests = createEndTurnRequests(async () => [textPart("Ответ")]);
    await run(requests.tools(guardedTool()), "c1");
    requests.nextAttempt([textPart("Ответ")]);
    expect(requests.requested()).toBe(false);
  });

  it("a late snapshot from an older attempt cannot end its successor", async () => {
    let release!: (parts: Array<{ type: string; text?: string }>) => void;
    const requests = createEndTurnRequests(() => new Promise((resolve) => { release = resolve; }));
    const pending = run(requests.tools(guardedTool()), "c1");
    requests.nextAttempt([saved("c1"), textPart("Ответ")]);
    release([textPart("Ответ")]);
    expect(await pending).toBe("ok");
    expect(requests.requested()).toBe(false);
  });

  it("explicit text takes precedence; an invisible supplied text cannot bypass the guard", async () => {
    const requests = createEndTurnRequests(async () => []);
    await run(requests.tools(guardedTool({ text: "Явный текст приложения." })), "c1");
    expect(requests.take()).toBe("Явный текст приложения.");
    await run(requests.tools(guardedTool({ text: "\u200b" })), "c2");
    expect(requests.requested()).toBe(false);
  });

  it("legacy requireText false stays silent, including beside a rejected guarded request", async () => {
    const requests = createEndTurnRequests(async () => []);
    await Promise.all([run(requests.tools(guardedTool()), "guarded"), run(requests.tools(guardedTool({ requireText: false })), "legacy")]);
    expect(requests.requested()).toBe(true);
    expect(requests.take()).toBeUndefined();
  });

  it("unwraps an async iterable guarded result without exposing the mark", async () => {
    const requests = createEndTurnRequests(async () => [textPart("Ответ")]);
    const tools = requests.tools({ submit: tool({ description: "Save", inputSchema: z.object({}), execute: async function* () { yield endTurn("ok", { requireText: true }); } }) });
    const output: unknown[] = [];
    for await (const value of tools!.submit!.execute!({}, options("c1")) as AsyncIterable<unknown>) output.push(value);
    expect(output).toEqual(["ok"]);
    expect(requests.requested()).toBe(true);
  });

  it("validates the optional boolean", () => {
    expect(() => endTurn("ok", { requireText: "yes" as unknown as boolean })).toThrow(TypeError);
  });
});
