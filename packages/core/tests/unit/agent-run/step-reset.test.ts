import { describe, expect, it } from "vitest";
import { erasableStepStart, STEP_RESET_PART_TYPE, withoutResetSteps } from "../../../src/agent-run/step-reset";

const reset = { type: STEP_RESET_PART_TYPE, data: { providerId: "b" } };

describe("withoutResetSteps: стёртые шаги не видны", () => {
  it("убирает всё от последней step-start до части сброса включительно", () => {
    const parts = [
      { type: "step-start" },
      { type: "text", text: "шаг 1" },
      { type: "step-start" },
      { type: "text", text: "стёртое" },
      reset,
      { type: "step-start" },
      { type: "text", text: "заново" },
    ];
    expect(withoutResetSteps(parts)).toEqual([{ type: "step-start" }, { type: "text", text: "шаг 1" }, { type: "step-start" }, { type: "text", text: "заново" }]);
  });

  it("два сброса подряд и без сброса", () => {
    const parts = [{ type: "step-start" }, { type: "text", text: "а" }, reset, { type: "step-start" }, { type: "text", text: "б" }, reset, { type: "step-start" }, { type: "text", text: "в" }];
    expect(withoutResetSteps(parts)).toEqual([{ type: "step-start" }, { type: "text", text: "в" }]);
    const plain = [{ type: "step-start" }, { type: "text", text: "а" }];
    expect(withoutResetSteps(plain)).toBe(plain);
  });
});

describe("erasableStepStart: какой шаг можно стереть", () => {
  it("номер последней step-start; шаг без частей шага — null", () => {
    expect(erasableStepStart([{ type: "step-start" }, { type: "text" }, { type: "step-start" }, { type: "text" }])).toBe(2);
    expect(erasableStepStart([])).toBeNull();
  });

  it("вызов с полным входом в шаге — null; недописанный вход стереть можно", () => {
    expect(erasableStepStart([{ type: "step-start" }, { type: "tool-lookup", state: "input-available" }])).toBeNull();
    expect(erasableStepStart([{ type: "step-start" }, { type: "dynamic-tool", state: "output-available" }])).toBeNull();
    expect(erasableStepStart([{ type: "step-start" }, { type: "tool-lookup", state: "input-streaming" }])).toBe(0);
  });
});
