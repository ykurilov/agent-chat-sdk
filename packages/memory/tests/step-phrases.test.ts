import { describe, expect, it } from "vitest";
import { englishMemoryStepPhrases, memoryStepPhrases } from "../src/tool-titles";

const call = (input?: unknown) => ({ toolName: "manage_memory", state: "running" as const, ...(input !== undefined && { input }) });

describe("фразы памяти для простого вида", () => {
  it("фраза по действию: запомнить, обновить, забыть, вспомнить", () => {
    const phrase = memoryStepPhrases.manage_memory!;
    expect(phrase(call({ action: "create" }))).toEqual({ running: "Запоминаю", done: "Запомнил" });
    expect(phrase(call({ action: "search" }))).toEqual({ running: "Вспоминаю", done: "Вспомнил" });
    expect(phrase(call({ action: "update" })).done).toBe("Обновил память");
    expect(phrase(call({ action: "delete" })).done).toBe("Забыл лишнее");
  });

  it("без входа (права, вход ещё пишется) — общая фраза памяти", () => {
    expect(memoryStepPhrases.manage_memory!(call())).toEqual({ running: "Работаю с памятью", done: "Поработал с памятью" });
    expect(memoryStepPhrases.manage_memory!(call("мусор"))).toEqual({ running: "Работаю с памятью", done: "Поработал с памятью" });
  });

  it("английские фразы — без кириллицы на всех действиях", () => {
    for (const action of ["create", "update", "delete", "search", undefined]) {
      const phrase = englishMemoryStepPhrases.manage_memory!(call(action && { action }));
      expect(`${phrase.running} ${phrase.done}`).not.toMatch(/[А-Яа-яЁё]/);
    }
  });
});
