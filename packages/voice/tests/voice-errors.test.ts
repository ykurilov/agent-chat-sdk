import { describe, expect, it } from "vitest";
import { classifyMicrophoneError } from "../src/voice-errors";

const named = (name: string) => Object.assign(new Error(name), { name });

describe("вид ошибки микрофона", () => {
  it.each([
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "no_microphone"],
    ["OverconstrainedError", "no_microphone"],
    ["NotReadableError", "other"],
    ["AbortError", "other"],
  ] as const)("%s → %s", (name, kind) => {
    expect(classifyMicrophoneError(named(name))).toBe(kind);
  });

  it("не ошибка вовсе — other", () => {
    expect(classifyMicrophoneError("что-то")).toBe("other");
    expect(classifyMicrophoneError(undefined)).toBe("other");
  });
});
