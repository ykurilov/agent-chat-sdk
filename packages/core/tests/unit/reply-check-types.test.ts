import { describe, expect, it } from "vitest";
import { DEFAULT_REPLY_CHECKS_WEB, resolveReplyChecks, type ReplyCheck } from "../../src/index";

describe("настройка проверок ответа", () => {
  const check: ReplyCheck = async () => {};

  it("по умолчанию веб-чат печатает и заменяет текст при правке", () => {
    expect(DEFAULT_REPLY_CHECKS_WEB).toBe("replace");
    expect(resolveReplyChecks(undefined)).toEqual({ checks: [], web: "replace" });
    expect(resolveReplyChecks([check])).toEqual({ checks: [check], web: "replace" });
  });

  it("приложение может не печатать до проверки", () => {
    expect(resolveReplyChecks({ checks: [check], web: "hold" })).toEqual({ checks: [check], web: "hold" });
    expect(resolveReplyChecks({ checks: [check] })).toEqual({ checks: [check], web: "replace" });
  });
});
