import { describe, expect, it } from "vitest";
import type { StoredMessage } from "@ykurilov/agent-chat-core";
import { searchableText } from "../src/message-text";
import { assistantMessage } from "./support";

describe("поиск по истории и служебная часть с блоками контекста (R3)", () => {
  it("часть data-frozen-context в искомый текст ответа не попадает", () => {
    const parts = [
      { type: "data-frozen-context", data: { blocks: [{ key: "memory:1", text: "Личная запись: любит кофе", private: true }], sent: "all", base: null } },
      { type: "step-start" },
      { type: "text", text: "Привет" },
    ];
    expect(searchableText(assistantMessage("a1", "u1", parts as unknown as StoredMessage["parts"], 1))).toBe("Привет");
  });
});
