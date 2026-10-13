import { describe, expect, it } from "vitest";
import { backgroundStepPhrases, englishBackgroundStepPhrases } from "../src/labels";

describe("фразы фоновых задач для простого вида", () => {
  it("проверка и отмена задач по-русски и по-английски", () => {
    expect(backgroundStepPhrases).toEqual({
      check_tasks: { running: "Проверяю фоновые задачи", done: "Проверил фоновые задачи" },
      cancel_task: { running: "Отменяю задачу", done: "Отменил задачу" },
    });
    expect(Object.keys(englishBackgroundStepPhrases)).toEqual(["check_tasks", "cancel_task"]);
    expect(JSON.stringify(englishBackgroundStepPhrases)).not.toMatch(/[А-Яа-яЁё]/);
  });
});
