import { describe, expect, it } from "vitest";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { recordWidgetAnswer } from "../../../src/widgets/pending-widgets";

type MessagePart = AgentChatMessage["parts"][number];

const part = (fields: Record<string, unknown>) => ({ type: "tool-ask_choice", toolCallId: "w1", input: { question: "?" }, ...fields }) as unknown as MessagePart;

describe("recordWidgetAnswer", () => {
  it("меняет только ждущую часть: закрытая часть с тем же toolCallId остаётся как была", () => {
    const closed = part({ state: "output-error", errorText: "Задавай один вопрос за раз" });
    const waiting = part({ state: "input-available" });
    const answered = part({ state: "output-available", output: { выбор: "старый" } });
    const parts = recordWidgetAnswer([closed, waiting, answered], "w1", { выбор: "да" });
    expect(parts[0]).toBe(closed);
    expect(parts[1]).toMatchObject({ state: "output-available", output: { выбор: "да" } });
    expect(parts[2]).toBe(answered);
  });

  it("другие вызовы не трогает", () => {
    const other = part({ toolCallId: "w2", state: "input-available" });
    const parts = recordWidgetAnswer([other], "w1", { выбор: "да" });
    expect(parts[0]).toBe(other);
  });
});
