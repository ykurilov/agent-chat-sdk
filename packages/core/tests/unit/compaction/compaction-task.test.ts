import { describe, expect, it } from "vitest";
import { compactionTask, shrinkRequest } from "../../../src/compaction/compaction-task";

describe("задание сжатия", () => {
  it("называет постоянные разделы сводки", () => {
    const task = compactionTask({ summaryCeilingTokens: 20_000 });
    for (const section of ["Цель", "Решения", "Факты", "Файлы и результаты", "Незакрытые задачи", "Где остановились"]) {
      expect(task).toContain(section);
    }
  });

  it("просит переписать прошлую сводку целиком вместе с новым, а не дописывать", () => {
    expect(compactionTask({ summaryCeilingTokens: 20_000 })).toMatch(/целиком/);
  });

  it("называет потолок и не зависит ни от чего, кроме него", () => {
    const first = compactionTask({ summaryCeilingTokens: 20_000 });
    expect(first).toContain("20 000");
    expect(compactionTask({ summaryCeilingTokens: 20_000 })).toBe(first);
    expect(compactionTask({ summaryCeilingTokens: 500 })).toContain("500");
  });

  it("своё задание приложения заменяет текст ядра", () => {
    expect(compactionTask({ summaryCeilingTokens: 500, instruction: "Сожми по-своему." })).toBe("Сожми по-своему.");
  });

  it("просьба ужать называет размер и потолок", () => {
    const text = shrinkRequest({ summaryTokens: 30_000, summaryCeilingTokens: 20_000 });
    expect(text).toContain("30 000");
    expect(text).toContain("20 000");
  });

  it("просит назвать прикреплённые файлы по имени", () => {
    const task = compactionTask({ summaryCeilingTokens: 20_000 });
    expect(task).toContain("<attachment");
    expect(task).toContain("Прикреплённые файлы");
  });
});
