import { describe, expect, it } from "vitest";
import { searchNotes } from "../src/search-notes";
import { manyNotes, note } from "./support";

const found = (result: ReturnType<typeof searchNotes>) => {
  if (!result.ok) throw new Error(`ожидался успех, а не ${result.error.kind}`);
  return result.value;
};

describe("searchNotes", () => {
  const notes = [
    note({ id: "a", categories: ["Работа"], content: "Верстает на Tailwind CSS" }),
    note({ id: "b", categories: ["Правила"], content: "Не предлагать npm, только pnpm" }),
    note({ id: "c", categories: ["Tailwind"], content: "Любит тёмную тему" }),
  ];

  it("слова ищутся без учёта регистра в тексте и в разделах", () => {
    expect(found(searchNotes(notes, "tailwind", 10)).notes.map((item) => item.id).sort()).toEqual(["a", "c"]);
    expect(found(searchNotes(notes, "PNPM", 10)).notes.map((item) => item.id)).toEqual(["b"]);
  });

  it("ничего не нашлось — успех с пустым списком", () => {
    expect(found(searchNotes(notes, "kubernetes", 10))).toEqual({ notes: [], total: 0 });
  });

  it("больше совпавших слов — выше; при равенстве недавние первыми", () => {
    const ranked = [
      note({ id: "old", content: "pnpm и tailwind", updatedAt: "2026-01-01T00:00:00.000Z" }),
      note({ id: "one", content: "только pnpm", updatedAt: "2026-03-01T00:00:00.000Z" }),
      note({ id: "new", content: "pnpm и tailwind", updatedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(found(searchNotes(ranked, "pnpm tailwind", 10)).notes.map((item) => item.id)).toEqual(["new", "old", "one"]);
  });

  it("отдаёт не больше предела, а total — сколько подошло всего", () => {
    const many = manyNotes(25, 30).map((item) => ({ ...item, content: `${item.content} tailwind` }));
    const result = found(searchNotes(many, "tailwind", 10));
    expect(result.notes).toHaveLength(10);
    expect(result.total).toBe(25);
  });

  it("отдаёт записи целиком, с id и версией", () => {
    expect(found(searchNotes(notes, "npm", 10)).notes[0]).toEqual(notes[1]);
  });

  it.each([["пустой", ""], ["пробелы", "   "], ["знаки", "?! .,"], ["одни короткие слова", "я а"]])(
    "запрос %s — ошибка формы (invalid)",
    (_name, query) => {
      const result = searchNotes(notes, query, 10);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid");
    },
  );

  it("не строка — invalid", () => {
    expect(searchNotes(notes, undefined as unknown as string, 10).ok).toBe(false);
  });
});
