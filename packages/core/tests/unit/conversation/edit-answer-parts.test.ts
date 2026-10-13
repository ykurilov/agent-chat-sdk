import { describe, expect, it } from "vitest";
import { editAnswerParts } from "../../../src/conversation/edit-answer-parts";
import type { StoredMessage } from "../../../src/conversation/types";

type Parts = StoredMessage["parts"];

const frozen = new Set(["generate_images", "show_video", "ask_choice"]);

const answer: Parts = [
  { type: "step-start" },
  { type: "reasoning", text: "думаю", state: "done" },
  { type: "text", text: "Ищу файл.", state: "done" },
  { type: "tool-find", toolCallId: "c1", state: "output-available", input: { name: "отчёт" }, output: "нашёл: отчёт.pdf" },
  { type: "tool-remove", toolCallId: "c2", state: "output-error", input: { path: "/tmp" }, errorText: "нет прав" },
  { type: "file", mediaType: "image/png", url: "https://example.com/a.png" },
  { type: "step-start" },
  { type: "text", text: "Готово.", state: "done" },
  { type: "tool-generate_images", toolCallId: "c3", state: "output-available", input: {}, output: { images: [] } },
  { type: "tool-ask_choice", toolCallId: "c4", state: "output-available", input: {}, output: { выбрано: "Про" } },
  { type: "tool-find", toolCallId: "c5", state: "input-available", input: { name: "x" } },
  { type: "dynamic-tool", toolName: "lookup", toolCallId: "c6", state: "output-available", input: {}, output: 1 },
] as Parts;

describe("editAnswerParts: правило частей правленого ответа", () => {
  it("текст — одной частью на месте первой текстовой, рассуждения убраны, остальное на месте и в порядке", () => {
    expect(editAnswerParts(answer, { text: "Новый ответ." }, frozen)).toEqual({
      ok: true,
      parts: [
        { type: "step-start" },
        { type: "text", text: "Новый ответ.", state: "done" },
        answer[3],
        answer[4],
        answer[5],
        { type: "step-start" },
        answer[8],
        answer[9],
        answer[10],
        answer[11],
      ],
    });
  });

  it("результат вызова заменён; прежняя ошибка тоже становится результатом; dynamic-tool правится", () => {
    const edited = editAnswerParts(answer, { text: "Ищу файл.Готово.", toolOutputs: { c1: { найдено: 0 }, c2: "удалено", c6: 2 } }, frozen);
    expect(edited.ok).toBe(true);
    const parts = edited.ok ? edited.parts : [];
    expect(parts.find((part) => (part as { toolCallId?: string }).toolCallId === "c1")).toEqual({
      type: "tool-find",
      toolCallId: "c1",
      state: "output-available",
      input: { name: "отчёт" },
      output: { найдено: 0 },
    });
    expect(parts.find((part) => (part as { toolCallId?: string }).toolCallId === "c2")).toEqual({
      type: "tool-remove",
      toolCallId: "c2",
      state: "output-available",
      input: { path: "/tmp" },
      output: "удалено",
    });
    expect(parts.find((part) => (part as { toolCallId?: string }).toolCallId === "c6")).toMatchObject({ state: "output-available", output: 2 });
  });

  it("нет текстовой части — текст в конце", () => {
    const parts = [{ type: "tool-find", toolCallId: "c1", state: "output-available", input: {}, output: "ок" }] as Parts;
    expect(editAnswerParts(parts, { text: "Итог." }, frozen)).toEqual({ ok: true, parts: [parts[0], { type: "text", text: "Итог.", state: "done" }] });
  });

  it("пустой текст — empty_text", () => {
    expect(editAnswerParts(answer, { text: "  \n " }, frozen)).toEqual({ ok: false, kind: "empty_text" });
  });

  it.each([
    ["картинки", "c3"],
    ["виджет", "c4"],
    ["без результата", "c5"],
    ["чужой вызов", "нет-такого"],
  ])("вызов %s — invalid_tool_output", (_name, id) => {
    expect(editAnswerParts(answer, { text: "Новый.", toolOutputs: { [id]: "x" } }, frozen)).toEqual({ ok: false, kind: "invalid_tool_output" });
  });

  it("результат больше 64 КБ или не JSON — invalid_tool_output; ровно 64 КБ — можно", () => {
    const big = "я".repeat(40_000);
    expect(editAnswerParts(answer, { text: "Новый.", toolOutputs: { c1: big } }, frozen)).toEqual({ ok: false, kind: "invalid_tool_output" });
    expect(editAnswerParts(answer, { text: "Новый.", toolOutputs: { c1: undefined } }, frozen)).toEqual({ ok: false, kind: "invalid_tool_output" });
    expect(editAnswerParts(answer, { text: "Новый.", toolOutputs: { c1: "a".repeat(64 * 1024 - 2) } }, frozen).ok).toBe(true);
  });

  it("тот же текст и те же результаты — nothing_changed; текст ответа — части через пустую строку", () => {
    expect(editAnswerParts(answer, { text: "Ищу файл.\n\nГотово." }, frozen)).toEqual({ ok: false, kind: "nothing_changed" });
    expect(editAnswerParts(answer, { text: "Ищу файл.\n\nГотово.", toolOutputs: { c1: "нашёл: отчёт.pdf" } }, frozen)).toEqual({
      ok: false,
      kind: "nothing_changed",
    });
    expect(editAnswerParts(answer, { text: "Ищу файл.\n\nГотово.", toolOutputs: { c2: "нет прав" } }, frozen).ok).toBe(true);
  });
});
