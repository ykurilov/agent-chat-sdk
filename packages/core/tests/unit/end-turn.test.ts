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
