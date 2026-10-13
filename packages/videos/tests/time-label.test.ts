import { describe, expect, it } from "vitest";
import { timeLabel } from "../src/index";

describe("timeLabel: секунды словами часов", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [200, "3:20"],
    [1120, "18:40"],
    [3600, "1:00:00"],
    [3725, "1:02:05"],
  ])("%i → %s", (seconds, label) => {
    expect(timeLabel(seconds)).toBe(label);
  });
});
