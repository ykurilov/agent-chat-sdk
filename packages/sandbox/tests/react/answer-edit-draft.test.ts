import { describe, expect, it } from "vitest";
import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import { answerEditDraft, answerEditRequest, checkAnswerEditDraft, MAX_TOOL_OUTPUT_BYTES } from "../../src/react/answer-edit-draft";

const message = {
  id: "a1",
  role: "assistant",
  parts: [
    { type: "reasoning", text: "думаю", state: "done" },
    { type: "text", text: "Первая часть. ", state: "done" },
    { type: "tool-search", toolCallId: "s1", state: "output-available", input: { q: "x" }, output: { found: 1 }, title: "Поиск" },
    { type: "tool-broken", toolCallId: "b1", state: "output-error", input: {}, errorText: "упал" },
    { type: "tool-generate_images", toolCallId: "g1", state: "output-available", input: {}, output: {} },
    { type: "tool-show_video", toolCallId: "v1", state: "output-available", input: {}, output: {} },
    { type: "tool-ask_choice", toolCallId: "w1", state: "output-available", input: {}, output: {} },
    { type: "tool-pending", toolCallId: "p1", state: "input-available", input: {} },
    { type: "text", text: "Вторая.", state: "done" },
  ],
  metadata: { status: "complete" },
} as unknown as AgentChatMessage;

describe("черновик правки ответа", () => {
  it("текст целиком и JSON результата у обычных вызовов с результатом", () => {
    const draft = answerEditDraft(message);
    expect(draft.text).toBe("Первая часть. \n\nВторая.");
    expect(draft.toolOutputs.map((output) => output.toolCallId)).toEqual(["s1", "b1"]);
    expect(draft.toolOutputs[0]).toMatchObject({ toolName: "search", title: "Поиск", value: JSON.stringify({ found: 1 }, null, 2) });
    expect(draft.toolOutputs[1]).toMatchObject({ toolName: "broken", value: "" });
  });

  it("без изменений сохранять нечего; пустой текст — ошибка", () => {
    const draft = answerEditDraft(message);
    expect(checkAnswerEditDraft(draft)).toMatchObject({ canSave: false, textError: undefined });
    expect(checkAnswerEditDraft({ ...draft, text: "  " })).toMatchObject({ canSave: false, textError: "empty" });
    expect(checkAnswerEditDraft({ ...draft, text: "Новый" }).canSave).toBe(true);
  });

  it("неверный JSON и больше 64 КБ — ошибка у поля, сохранение недоступно", () => {
    const draft = answerEditDraft(message);
    const withValue = (value: string) => ({ ...draft, toolOutputs: draft.toolOutputs.map((output, index) => (index === 0 ? { ...output, value } : output)) });
    expect(checkAnswerEditDraft(withValue("{ нет")).outputErrors).toEqual({ s1: "invalid" });
    expect(checkAnswerEditDraft(withValue("{ нет")).canSave).toBe(false);
    const huge = JSON.stringify("x".repeat(MAX_TOOL_OUTPUT_BYTES));
    expect(checkAnswerEditDraft(withValue(huge)).outputErrors).toEqual({ s1: "too_large" });
    expect(checkAnswerEditDraft(withValue('{"found":2}')).canSave).toBe(true);
  });

  it("в запрос уходят только изменённые результаты", () => {
    const draft = answerEditDraft(message);
    const changed = { ...draft, toolOutputs: draft.toolOutputs.map((output) => (output.toolCallId === "b1" ? { ...output, value: '{"ok":true}' } : output)) };
    expect(answerEditRequest(changed)).toEqual({ text: "Первая часть. \n\nВторая.", toolOutputs: { b1: { ok: true } } });
    expect(answerEditRequest({ ...draft, text: "Новый" })).toEqual({ text: "Новый" });
  });
});
