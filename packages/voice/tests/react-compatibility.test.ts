import type { AgentChatProps } from "@ykurilov/agent-chat-react";
import { describe, expect, it } from "vitest";
import { createVoiceInput } from "../src";

describe("совместимость с AgentChat", () => {
  it("createVoiceInput подходит в свойство voice без переделок", () => {
    const voice: AgentChatProps["voice"] = createVoiceInput({ api: "/api/voice" });

    expect(typeof voice?.start).toBe("function");
  });
});
