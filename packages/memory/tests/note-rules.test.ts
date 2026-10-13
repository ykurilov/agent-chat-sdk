import { describe, expect, it } from "vitest";
import {
  checkCanCreate,
  checkCanUpdate,
  defaultMemoryLimits,
  duplicateKey,
  noteSize,
  parseNoteBatch,
  parseNoteInput,
} from "../src/note-rules";
import { manyNotes, note } from "./support";

describe("parseNoteInput: форма записи", () => {
  it("схлопывает пробелы в разделах и тексте", () => {
    const parsed = parseNoteInput({ categories: [" О  себе ", "Работа"], content: "  Пишет   на\nTypeScript " });
    expect(parsed).toEqual({ ok: true, value: { categories: ["О себе", "Работа"], content: "Пишет на TypeScript" } });
  });

  it("выбрасывает символ с кодом ноль: Postgres не принимает его в тексте", () => {
    const parsed = parseNoteInput({ categories: ["О\u0000 себе"], content: "лог:\u0000конец" });
    expect(parsed).toEqual({ ok: true, value: { categories: ["О себе"], content: "лог:конец" } });
    expect(parseNoteInput({ categories: ["а"], content: "\u0000" }).ok).toBe(false);
  });

  it("принимает пределы: 3 раздела по 60 знаков и текст 500 знаков", () => {
    const category = "р".repeat(60);
    const parsed = parseNoteInput({ categories: [category, category, category], content: "я".repeat(500) });
    expect(parsed.ok).toBe(true);
  });

  it.each([
    ["нет разделов", { categories: [], content: "текст" }],
    ["четыре раздела", { categories: ["а", "б", "в", "г"], content: "текст" }],
    ["раздел из пробелов", { categories: ["   "], content: "текст" }],
    ["раздел длиннее 60", { categories: ["р".repeat(61)], content: "текст" }],
    ["текст из пробелов", { categories: ["а"], content: " \n " }],
    ["текст длиннее 500", { categories: ["а"], content: "я".repeat(501) }],
    ["разделы — не список", { categories: "О себе", content: "текст" }],
    ["раздел — не строка", { categories: [1], content: "текст" }],
    ["текст — не строка", { categories: ["а"], content: 5 }],
    ["не объект", "запомни это"],
    ["пустое значение", null],
  ])("отказ по форме (invalid): %s", (_name, input) => {
    const parsed = parseNoteInput(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe("invalid");
      expect(parsed.error.message.length).toBeGreaterThan(0);
    }
  });

  it("«/» в названии раздела недопустим: слэш разделяет уровни на экране", () => {
    const parsed = parseNoteInput({ categories: ["Работа/Проекты"], content: "текст" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.message).toContain("/");
  });

  it("«/» в тексте записи допустим", () => {
    expect(parseNoteInput({ categories: ["Правила"], content: "Пиши и/или" }).ok).toBe(true);
  });
});

describe("parseNoteBatch: пакет 1–5", () => {
  const one = { categories: ["а"], content: "текст" };

  it("принимает от 1 до 5 записей", () => {
    expect(parseNoteBatch([one], { maxBatch: 5 }).ok).toBe(true);
    expect(parseNoteBatch([one, one, one, one, one], { maxBatch: 5 }).ok).toBe(true);
  });

  it.each([
    ["пустой пакет", []],
    ["шесть записей", [one, one, one, one, one, one]],
    ["не список", one],
    ["одна негодная запись", [one, { categories: [], content: "текст" }]],
  ])("отказ (invalid): %s", (_name, input) => {
    const parsed = parseNoteBatch(input, { maxBatch: 5 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe("invalid");
  });

  it("предел пакета — настройка", () => {
    expect(parseNoteBatch([one, one, one], { maxBatch: 2 }).ok).toBe(false);
  });
});

describe("duplicateKey: ключ дубля", () => {
  it("не зависит от регистра и лишних пробелов", () => {
    const first = duplicateKey({ categories: ["О себе"], content: "Живёт на Бали" });
    const second = duplicateKey({ categories: ["о  себе"], content: "живёт   на бали" });
    expect(second).toBe(first);
  });

  it("разные разделы или текст — разные ключи; порядок разделов важен", () => {
    const base = duplicateKey({ categories: ["а", "б"], content: "текст" });
    expect(duplicateKey({ categories: ["а"], content: "текст" })).not.toBe(base);
    expect(duplicateKey({ categories: ["б", "а"], content: "текст" })).not.toBe(base);
    expect(duplicateKey({ categories: ["а", "б"], content: "другой" })).not.toBe(base);
  });

  it("раздел «а/б» из двух уровней не совпадает с текстом, начинающимся так же", () => {
    expect(duplicateKey({ categories: ["а"], content: "б текст" })).not.toBe(duplicateKey({ categories: ["а", "б"], content: "текст" }));
  });
});

describe("noteSize", () => {
  it("сумма длин разделов и текста", () => {
    expect(noteSize({ categories: ["ааа", "бб"], content: "ссссс" })).toBe(10);
  });
});

describe("пределы по умолчанию", () => {
  it("200 записей, 48 000 знаков, пакет 5, блок 12 000, поиск 10", () => {
    expect(defaultMemoryLimits).toEqual({ maxNotes: 200, maxTotalChars: 48_000, maxBatch: 5, maxBlockChars: 12_000, searchLimit: 10 });
  });
});

describe("checkCanCreate", () => {
  const input = (content: string) => ({ categories: ["а"], content });

  it("в пустую память можно", () => {
    expect(checkCanCreate([], [input("один")], defaultMemoryLimits)).toBeNull();
  });

  it("199 записей + 1 — можно, 200 + 1 — limit_reached", () => {
    expect(checkCanCreate(manyNotes(199, 20), [input("новая")], defaultMemoryLimits)).toBeNull();
    expect(checkCanCreate(manyNotes(200, 20), [input("новая")], defaultMemoryLimits)?.kind).toBe("limit_reached");
  });

  it("пакет не помещается по числу записей — отказ всему пакету", () => {
    const error = checkCanCreate(manyNotes(198, 20), [input("а1"), input("а2"), input("а3")], defaultMemoryLimits);
    expect(error?.kind).toBe("limit_reached");
  });

  it("предел объёма считает разделы и тексты", () => {
    const limits = { ...defaultMemoryLimits, maxTotalChars: 30 };
    const existing = [note({ categories: ["ааааа"], content: "б".repeat(20) })]; // 25 знаков
    expect(checkCanCreate(existing, [input("ввв")], limits)).toBeNull(); // +4 = 29
    expect(checkCanCreate(existing, [input("вввв")], limits)).toBeNull(); // +5 = 30
    expect(checkCanCreate(existing, [input("ввввв")], limits)?.kind).toBe("limit_reached"); // 31
  });

  it("дубль среди существующих — duplicate", () => {
    const existing = [note({ categories: ["О себе"], content: "Живёт на Бали" })];
    const error = checkCanCreate(existing, [{ categories: ["о себе"], content: "живёт на  бали" }], defaultMemoryLimits);
    expect(error?.kind).toBe("duplicate");
  });

  it("дубль внутри пакета — duplicate", () => {
    expect(checkCanCreate([], [input("Тот же"), input("тот  же")], defaultMemoryLimits)?.kind).toBe("duplicate");
  });

  it("сообщения подсказывают, что делать", () => {
    const limit = checkCanCreate(manyNotes(200, 20), [input("новая")], defaultMemoryLimits);
    expect(limit?.message).toMatch(/удал/i);
    const duplicate = checkCanCreate([note()], [{ categories: note().categories, content: note().content }], defaultMemoryLimits);
    expect(duplicate?.message).toMatch(/уже/i);
  });
});

describe("checkCanUpdate", () => {
  const existing = [note({ id: "a", content: "Первая" }), note({ id: "b", content: "Вторая" })];

  it("правка без изменения ключа — можно (запись не дубль самой себе)", () => {
    expect(checkCanUpdate(existing, "a", { categories: ["О себе"], content: "первая" }, defaultMemoryLimits)).toBeNull();
  });

  it("текст другой записи — duplicate", () => {
    expect(checkCanUpdate(existing, "a", { categories: ["О себе"], content: "Вторая" }, defaultMemoryLimits)?.kind).toBe("duplicate");
  });

  it("запись выросла за предел объёма — limit_reached; уменьшилась — можно", () => {
    const limits = { ...defaultMemoryLimits, maxTotalChars: 40 };
    const stored = [note({ id: "a", categories: ["а"], content: "б".repeat(30) })]; // 31
    expect(checkCanUpdate(stored, "a", { categories: ["а"], content: "б".repeat(39) }, limits)).toBeNull(); // 40
    expect(checkCanUpdate(stored, "a", { categories: ["а"], content: "б".repeat(40) }, limits)?.kind).toBe("limit_reached");
  });

  it("записи нет — not_found", () => {
    expect(checkCanUpdate(existing, "нет", { categories: ["а"], content: "текст" }, defaultMemoryLimits)?.kind).toBe("not_found");
  });
});
