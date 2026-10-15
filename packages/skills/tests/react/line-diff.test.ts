import { describe, expect, it } from "vitest";
import { lineDiff } from "../../src/react/line-diff";

/** Из разницы собираются оба текста: старый — из общих и убранных строк, новый — из общих и добавленных. */
function rebuilt(lines: ReturnType<typeof lineDiff>) {
  return {
    before: lines.filter((line) => line.kind !== "added").map((line) => line.text).join("\n"),
    after: lines.filter((line) => line.kind !== "removed").map((line) => line.text).join("\n"),
  };
}

describe("разница строк", () => {
  it("огромные тексты (25 000 коротких строк) — быстро, упрощённо: общее начало и конец, середина убрана и добавлена", () => {
    const before = Array.from({ length: 25_000 }, (_, index) => `s${index}`).join("\n");
    const after = before.replace("s10\n", "x10\n").replace("s24990\n", "x24990\n");
    const started = performance.now();
    const lines = lineDiff(before, after);
    expect(performance.now() - started).toBeLessThan(500);
    expect(rebuilt(lines)).toEqual({ before, after });
    expect(lines.slice(0, 10).every((line) => line.kind === "same")).toBe(true);
    expect(lines.at(-1)).toEqual({ kind: "same", text: "s24999" });
    expect(lines.filter((line) => line.kind === "removed").length).toBeLessThan(25_000);
  });

  it("общие строки остаются, остальное — убрано и добавлено", () => {
    expect(lineDiff("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("с пустого текста — всё добавлено; одинаковые — без изменений", () => {
    expect(lineDiff("", "a\nb")).toEqual([
      { kind: "added", text: "a" },
      { kind: "added", text: "b" },
    ]);
    expect(lineDiff("a", "a")).toEqual([{ kind: "same", text: "a" }]);
  });
});
