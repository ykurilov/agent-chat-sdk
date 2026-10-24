import { describe, expect, it } from "vitest";
import { activeCompaction } from "../../../src/compaction/compaction-plan";
import { applyCompaction } from "../../../src/compaction/compacted-history";
import { summaryFrame } from "../../../src/compaction/compaction-task";
import { toAgentChatMessage } from "../../../src/conversation/to-agent-chat-message";
import { compactionRecord, conversation } from "../support/compaction-fixtures";

const branch = conversation([100, 200, 300, 400]);

describe("история модели с применённой сводкой", () => {
  it("без активной записи — вся ветка как есть", () => {
    expect(applyCompaction(branch, null)).toEqual(branch.map(toAgentChatMessage));
  });

  it("сообщения диапазона уходят, первым сообщением хвоста идёт вопрос со сводкой в первой текстовой части", () => {
    const record = compactionRecord({ id: "c1", throughMessageId: "a2", summary: "## Цель\nдоделать отчёт" });
    const history = applyCompaction(branch, activeCompaction(branch, [record]));
    expect(history.map((message) => message.id)).toEqual(["u3", "a3", "u4", "a4"]);
    const [first] = history;
    expect(first?.role).toBe("user");
    expect(JSON.parse(JSON.stringify(first?.parts))).toEqual([
      { type: "text", text: summaryFrame("## Цель\nдоделать отчёт") },
      { type: "text", text: "вопрос 3" },
    ]);
    expect(history.slice(1)).toEqual(branch.slice(5).map(toAgentChatMessage));
  });

  it("обрамление постоянное и говорит, что это пересказ прежней переписки", () => {
    expect(summaryFrame("X")).toBe(summaryFrame("X"));
    expect(summaryFrame("X")).toContain("X");
    expect(summaryFrame("X")).toMatch(/пересказ/i);
  });

  it("если после границы идёт не вопрос человека, сводка становится отдельным сообщением человека", () => {
    const odd = conversation([100, 200, 300]);
    odd[2] = { ...odd[2]!, role: "assistant" }; // после a1 сразу ответ
    const record = compactionRecord({ id: "c1", throughMessageId: "a1" });
    const history = applyCompaction(odd, activeCompaction(odd, [record]));
    expect(history[0]).toMatchObject({ role: "user", parts: [{ type: "text", text: summaryFrame("сводка c1") }] });
    expect(history[1]?.id).toBe("u2");
  });

  it("исходные сообщения не меняются", () => {
    const before = structuredClone(branch);
    applyCompaction(branch, activeCompaction(branch, [compactionRecord({ id: "c1", throughMessageId: "a2" })]));
    expect(branch).toEqual(before);
  });
});
