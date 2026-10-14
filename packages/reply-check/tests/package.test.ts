import { describe, expect, it } from "vitest";
import { foreignWords, unknownLinks } from "@ykurilov/agent-chat-reply-check";

describe("пакет проверок ответа", () => {
  it("подключается по имени пакета: обе проверки — функции для replyChecks", () => {
    expect(foreignWords({ script: "cyrillic" })).toBeTypeOf("function");
    expect(unknownLinks()).toBeTypeOf("function");
  });
});
