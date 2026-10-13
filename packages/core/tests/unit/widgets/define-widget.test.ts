// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineWidget } from "../../../src/widgets/define-widget";

const description = {
  name: "pick_slot",
  description: "Предложить человеку выбрать время встречи",
  inputSchema: z.object({ slots: z.array(z.string()).min(2).max(6) }),
  answerSchema: z.object({ slot: z.string() }),
  question: (input: { slots: string[] }) => `Выберите время: ${input.slots.join(", ")}`,
};

describe("defineWidget", () => {
  it("возвращает то же описание: его импортируют и сервер, и страница", () => {
    const widget = defineWidget(description);
    expect(widget).toEqual(description);
    expect(widget.question?.({ slots: ["10:00", "11:00"] })).toBe("Выберите время: 10:00, 11:00");
  });

  it.each(["a", "pick_slot", "slot2", "x".repeat(64)])("годное имя «%s»", (name) => {
    expect(defineWidget({ ...description, name }).name).toBe(name);
  });

  it.each(["", "Pick", "2slot", "_slot", "pick-slot", "пик", "x".repeat(65), "ask_slot", "suggest_slot"])("негодное имя «%s» — исключение", (name) => {
    expect(() => defineWidget({ ...description, name })).toThrow(/имя/i);
  });

  it("модуль без серверных зависимостей: работает в браузерной среде и ничего не тянет, кроме типов", () => {
    expect(typeof window).toBe("object");
    // URL из jsdom — чужой для node:fs: путь строкой.
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../src/widgets/define-widget.ts"), "utf8");
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*from\s+"([^"]+)"/gm)];
    expect(imports.every(([, typeOnly]) => typeOnly)).toBe(true);
  });
});
