import { describe, expect, it } from "vitest";
import { russianFlowLabels } from "../../src/labels";

// Подписи кнопок-значков доски понятны человеку не из программирования.
describe("подписи кнопок-значков", () => {
  it("кнопка с кодом сценария названа по смыслу, а не одним словом JSON", () => {
    expect(russianFlowLabels.editor.header.json).toMatch(/сценари/i);
    expect(russianFlowLabels.editor.header.json).not.toBe("JSON");
  });
});
