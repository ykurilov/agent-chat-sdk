import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};

describe("версии AI SDK", () => {
  // Продолжение хода после подтверждения держится на внутреннем поведении `@ai-sdk/react` (см. `withApprovalDecision` в use-agent-chat.ts):
  // другая версия SDK может его сломать без единой ошибки в типах. Обновлять только вместе с прогоном agent-chat-approval.test.tsx.
  it.each(["ai", "@ai-sdk/react"])("%s закреплён точной версией", (name) => {
    expect(manifest.dependencies[name]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
