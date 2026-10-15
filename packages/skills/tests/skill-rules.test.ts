import { describe, expect, it } from "vitest";
import { checkSkillName, checkSkillStatus, checkSkillText, InvalidSkillError } from "../src/skill-rules";

const reason = (check: () => unknown) => {
  try {
    check();
  } catch (error) {
    if (error instanceof InvalidSkillError) return `${error.field}:${error.reason}`;
    throw error;
  }
  return "ok";
};

describe("правила навыка", () => {
  it("имя: строчные латиница и кириллица, цифры, дефис, 2–48 знаков", () => {
    for (const good of ["game-dev", "договоры", "seo2", "ab", "a".repeat(48)]) expect(reason(() => checkSkillName(good))).toBe("ok");
    for (const bad of ["a", "a".repeat(49), "Game", "-dev", "game dev", "game_dev", "игры!", ""]) {
      expect(reason(() => checkSkillName(bad))).toBe("name:name_format");
    }
  });

  it("whenToUse: не пустое, одна строка, до 300 знаков; края обрезаются", () => {
    expect(checkSkillText({ whenToUse: "  Игры.  ", body: "b" }, 10).whenToUse).toBe("Игры.");
    expect(reason(() => checkSkillText({ whenToUse: "  ", body: "b" }, 10))).toBe("whenToUse:when_to_use_empty");
    for (const breakChar of ["\n", "\r", "\v", "\f", "\u0085", "\u2028", "\u2029"]) {
      expect(reason(() => checkSkillText({ whenToUse: `раз${breakChar}два`, body: "b" }, 10)), JSON.stringify(breakChar)).toBe("whenToUse:when_to_use_multiline");
    }
    expect(reason(() => checkSkillText({ whenToUse: "я".repeat(301), body: "b" }, 10))).toBe("whenToUse:when_to_use_too_long");
  });

  it("тело: не пустое и в пределе", () => {
    expect(reason(() => checkSkillText({ whenToUse: "w", body: "\n " }, 10))).toBe("body:body_empty");
    expect(reason(() => checkSkillText({ whenToUse: "w", body: "x".repeat(11) }, 10))).toBe("body:body_too_long");
    expect(checkSkillText({ whenToUse: "w", body: "x".repeat(10) }, 10).body).toHaveLength(10);
  });

  it("символ NUL убирается до проверок: тело из одних NUL — пустое", () => {
    expect(checkSkillText({ whenToUse: "Иг\u0000ры.", body: "a\u0000b" }, 10)).toEqual({ whenToUse: "Игры.", body: "ab" });
    expect(reason(() => checkSkillText({ whenToUse: "w", body: "\u0000\u0000" }, 10))).toBe("body:body_empty");
    expect(reason(() => checkSkillText({ whenToUse: "\u0000", body: "b" }, 10))).toBe("whenToUse:when_to_use_empty");
    expect(checkSkillText({ whenToUse: "w", body: `${"x".repeat(10)}\u0000` }, 10).body).toHaveLength(10);
  });

  it("статус — один из трёх", () => {
    expect(checkSkillStatus("admins")).toBe("admins");
    expect(reason(() => checkSkillStatus("all"))).toBe("status:status_unknown");
  });
});
