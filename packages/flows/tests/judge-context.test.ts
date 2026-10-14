import { describe, expect, it } from "vitest";
import { buildJudgeContext, JUDGE_INPUT_CHARS, JUDGE_MESSAGE_CHARS, JUDGE_MESSAGES } from "../src/runtime/judge-context";

const conversation = (count: number, text = "слово"): Array<{ role: "human" | "agent"; text: string }> =>
  Array.from({ length: count }, (_, index) => ({ role: index % 2 === 0 ? "human" : "agent", text: `${text} ${index}` }));

const size = (value: unknown) => JSON.stringify(value).length;

describe("вход судьи", () => {
  it("берёт 6 последних реплик по порядку", () => {
    const context = buildJudgeContext({ goal: "Цель", messages: conversation(10), conditions: [{ exitId: "a", text: "Условие" }] });
    expect(context.state.conversation).toHaveLength(JUDGE_MESSAGES);
    expect(context.state.conversation.map((message) => message.text)).toEqual(["слово 4", "слово 5", "слово 6", "слово 7", "слово 8", "слово 9"]);
    expect(context.state.goal).toBe("Цель");
    expect(context.state.agent_words).toBeUndefined();
  });

  it("реплика длиннее 600 знаков обрезается с многоточием", () => {
    const context = buildJudgeContext({ messages: [{ role: "human", text: "а".repeat(5000) }], conditions: [{ exitId: "a", text: "Условие" }] });
    const text = context.state.conversation[0]!.text;
    expect(text.length).toBeLessThanOrEqual(JUDGE_MESSAGE_CHARS);
    expect(text.endsWith("…")).toBe(true);
  });

  it("слова агента при заявке идут в agent_words", () => {
    const context = buildJudgeContext({ why: "Человек назвал тему и продажи", messages: conversation(2), conditions: [{ exitId: "a", text: "Условие" }] });
    expect(context.state.agent_words).toBe("Человек назвал тему и продажи");
  });

  it("огромные цель, слова, реплики и условия укладываются в потолок под 32 тыс. токенов", () => {
    const huge = "я".repeat(100_000);
    const context = buildJudgeContext({
      goal: huge,
      why: huge,
      messages: Array.from({ length: 20 }, () => ({ role: "human" as const, text: huge })),
      conditions: Array.from({ length: 60 }, (_, index) => ({ exitId: `c${index}`, text: huge })),
    });
    expect(size(context)).toBeLessThanOrEqual(JUDGE_INPUT_CHARS);
    // Условия не пропадают и не меняют порядок: судья должен ответить на каждое.
    expect(context.conditions.map((condition) => condition.exitId)).toEqual(Array.from({ length: 60 }, (_, index) => `c${index}`));
    // Самая свежая реплика остаётся.
    expect(context.state.conversation.length).toBeGreaterThanOrEqual(1);
  });

  it("при нехватке места раньше уходят старые реплики, свежая остаётся", () => {
    const context = buildJudgeContext({
      goal: "Цель",
      messages: [...conversation(5, "старая"), { role: "human", text: "самая свежая" }],
      conditions: Array.from({ length: 40 }, (_, index) => ({ exitId: `c${index}`, text: "у".repeat(560) })),
    });
    expect(size(context)).toBeLessThanOrEqual(JUDGE_INPUT_CHARS);
    expect(context.state.conversation.at(-1)!.text).toBe("самая свежая");
    expect(context.state.conversation.length).toBeLessThan(6);
  });

  it("короткий вход не трогает", () => {
    const input = { goal: "Цель", messages: conversation(3), conditions: [{ exitId: "a", text: "Условие" }] };
    const context = buildJudgeContext(input);
    expect(context.state.conversation).toEqual(input.messages);
    expect(context.conditions).toEqual(input.conditions);
  });
});
