import { asSchema } from "ai";
import { describe, expect, it } from "vitest";
import { BASIC_WIDGET_NAMES, basicWidgetTool, checkBasicWidgetAnswer } from "../../../src/widgets/basic-widgets";
import type { BasicWidgetName } from "../../../src/widgets/widget-types";

async function inputIsValid(name: BasicWidgetName, input: unknown): Promise<boolean> {
  const result = await asSchema(basicWidgetTool(name).inputSchema).validate!(input);
  return result.success;
}

const text = (length: number) => "я".repeat(length);
const options = (count: number) => Array.from({ length: count }, (_, index) => `вариант ${index + 1}`);

describe("базовые виджеты: входы", () => {
  it("пять имён, по алфавиту", () => {
    expect(BASIC_WIDGET_NAMES).toEqual(["ask_choice", "ask_form", "ask_multi_choice", "ask_rating", "suggest_replies"]);
  });

  it("ask_choice: вопрос 1–300 знаков; 2–8 вариантов по 1–80, без повторов", async () => {
    expect(await inputIsValid("ask_choice", { question: "Какой тариф?", options: ["Базовый", "Про"] })).toBe(true);
    expect(await inputIsValid("ask_choice", { question: text(300), options: options(8).map(() => text(80)).map((value, index) => value.slice(index)) })).toBe(true);
    expect(await inputIsValid("ask_choice", { question: "", options: ["а", "б"] })).toBe(false);
    expect(await inputIsValid("ask_choice", { question: text(301), options: ["а", "б"] })).toBe(false);
    expect(await inputIsValid("ask_choice", { question: "?", options: ["а"] })).toBe(false);
    expect(await inputIsValid("ask_choice", { question: "?", options: options(9) })).toBe(false);
    expect(await inputIsValid("ask_choice", { question: "?", options: ["а", ""] })).toBe(false);
    expect(await inputIsValid("ask_choice", { question: "?", options: ["а", text(81)] })).toBe(false);
    expect(await inputIsValid("ask_choice", { question: "?", options: ["а", "а"] })).toBe(false);
  });

  it("ask_multi_choice: 1 ≤ min ≤ max ≤ число вариантов", async () => {
    const base = { question: "Что взять?", options: options(4) };
    expect(await inputIsValid("ask_multi_choice", base)).toBe(true);
    expect(await inputIsValid("ask_multi_choice", { ...base, min: 1, max: 4 })).toBe(true);
    expect(await inputIsValid("ask_multi_choice", { ...base, min: 2, max: 2 })).toBe(true);
    expect(await inputIsValid("ask_multi_choice", { ...base, min: 0 })).toBe(false);
    expect(await inputIsValid("ask_multi_choice", { ...base, max: 5 })).toBe(false);
    expect(await inputIsValid("ask_multi_choice", { ...base, min: 3, max: 2 })).toBe(false);
    expect(await inputIsValid("ask_multi_choice", { ...base, min: 1.5 })).toBe(false);
    expect(await inputIsValid("ask_multi_choice", { ...base, options: ["а", "а"] })).toBe(false);
  });

  it("ask_rating: stars или range с from 0|1, to 2..10, подписи до 40 знаков", async () => {
    expect(await inputIsValid("ask_rating", { question: "Как вам?", scale: "stars" })).toBe(true);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", from: 0, to: 10, fromLabel: text(40), toLabel: "отлично" })).toBe(true);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", from: 1, to: 2 })).toBe(true);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", from: 2, to: 5 })).toBe(false);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", from: 0, to: 11 })).toBe(false);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", from: 0, to: 1 })).toBe(false);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", to: 5 })).toBe(false);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "range", from: 0, to: 5, fromLabel: text(41) })).toBe(false);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "stars", from: 0, to: 5 })).toBe(false);
    expect(await inputIsValid("ask_rating", { question: "?", scale: "percent" })).toBe(false);
  });

  it("ask_form: 1–5 полей; name латиница/цифры/_, без повторов; select 2–8; number min ≤ max; date YYYY-MM-DD", async () => {
    const field = (extra: object) => ({ name: "f", label: "Поле", kind: "text", ...extra });
    const form = (...fields: object[]) => ({ title: "Заявка", fields });
    expect(await inputIsValid("ask_form", form(field({ required: true, multiline: true })))).toBe(true);
    expect(
      await inputIsValid(
        "ask_form",
        form(
          field({ name: "name" }),
          field({ name: "age", kind: "number", min: 18, max: 99 }),
          field({ name: "day", kind: "date", min: "2026-01-01", max: "2026-12-31" }),
          field({ name: "plan", kind: "select", options: ["a", "b"] }),
          field({ name: "note_2" }),
        ),
      ),
    ).toBe(true);
    expect(await inputIsValid("ask_form", form())).toBe(false);
    expect(await inputIsValid("ask_form", form(...["a", "b", "c", "d", "e", "f"].map((name) => field({ name }))))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ name: "имя" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ name: "my-field" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ name: "a" }), field({ name: "a" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "select" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "select", options: ["a"] })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "select", options: options(9) })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "number", min: 5, max: 1 })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "number", min: "1" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "date", min: "01.02.2026" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "date", min: "2026-02-30" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "date", min: "2026-05-01", max: "2026-04-01" })))).toBe(false);
    expect(await inputIsValid("ask_form", form(field({ kind: "checkbox" })))).toBe(false);
  });

  it("suggest_replies: 1–4 подсказки по 1–60 знаков", async () => {
    expect(await inputIsValid("suggest_replies", { replies: ["Да", text(60)] })).toBe(true);
    expect(await inputIsValid("suggest_replies", { replies: [] })).toBe(false);
    expect(await inputIsValid("suggest_replies", { replies: ["1", "2", "3", "4", "5"] })).toBe(false);
    expect(await inputIsValid("suggest_replies", { replies: [text(61)] })).toBe(false);
  });

  it("описания для модели — постоянные непустые строки; у ждущих нет execute, у подсказок — «показано»", async () => {
    for (const name of BASIC_WIDGET_NAMES) {
      const description = basicWidgetTool(name).description;
      expect(description).toBeTruthy();
      expect(basicWidgetTool(name).description).toBe(description);
    }
    for (const name of ["ask_choice", "ask_multi_choice", "ask_rating", "ask_form"] as const) expect(basicWidgetTool(name).execute).toBeUndefined();
    const suggest = basicWidgetTool("suggest_replies");
    expect(await suggest.execute!({ replies: ["Да"] }, { toolCallId: "s1", messages: [] } as never)).toBe("показано");
  });

  it("схема входа для провайдера — объект на верхнем уровне (OpenAI не принимает anyOf сверху)", async () => {
    for (const name of BASIC_WIDGET_NAMES) {
      const schema = await asSchema(basicWidgetTool(name).inputSchema).jsonSchema;
      expect(schema).toMatchObject({ type: "object" });
    }
  });
});

describe("базовые виджеты: ответы", () => {
  const choice = { question: "Тариф?", options: ["Базовый", "Про"] };

  it("ask_choice: {выбрано: вариант из списка}", () => {
    expect(checkBasicWidgetAnswer("ask_choice", choice, { выбрано: "Про" })).toEqual({ ok: true, output: { выбрано: "Про" } });
    expect(checkBasicWidgetAnswer("ask_choice", choice, { выбрано: "Другой" }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_choice", choice, { выбрано: ["Про"] }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_choice", choice, { выбрано: "Про", лишнее: 1 }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_choice", choice, "Про").ok).toBe(false);
  });

  it("ask_multi_choice: варианты из списка без повторов, в пределах min..max, в порядке вариантов", () => {
    const multi = { question: "?", options: ["А", "Б", "В", "Г"], min: 2, max: 3 };
    expect(checkBasicWidgetAnswer("ask_multi_choice", multi, { выбрано: ["В", "А"] })).toEqual({ ok: true, output: { выбрано: ["А", "В"] } });
    expect(checkBasicWidgetAnswer("ask_multi_choice", multi, { выбрано: ["А"] }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_multi_choice", multi, { выбрано: ["А", "Б", "В", "Г"] }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_multi_choice", multi, { выбрано: ["А", "А"] }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_multi_choice", multi, { выбрано: ["А", "Д"] }).ok).toBe(false);
    const defaults = { question: "?", options: ["А", "Б"] };
    expect(checkBasicWidgetAnswer("ask_multi_choice", defaults, { выбрано: [] }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_multi_choice", defaults, { выбрано: ["Б", "А"] })).toEqual({ ok: true, output: { выбрано: ["А", "Б"] } });
  });

  it("ask_rating: целое в пределах шкалы (звёзды 1–5)", () => {
    const stars = { question: "?", scale: "stars" };
    expect(checkBasicWidgetAnswer("ask_rating", stars, { оценка: 5 })).toEqual({ ok: true, output: { оценка: 5 } });
    expect(checkBasicWidgetAnswer("ask_rating", stars, { оценка: 0 }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_rating", stars, { оценка: 6 }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_rating", stars, { оценка: 3.5 }).ok).toBe(false);
    const range = { question: "?", scale: "range", from: 0, to: 10 };
    expect(checkBasicWidgetAnswer("ask_rating", range, { оценка: 0 })).toEqual({ ok: true, output: { оценка: 0 } });
    expect(checkBasicWidgetAnswer("ask_rating", range, { оценка: 11 }).ok).toBe(false);
    expect(checkBasicWidgetAnswer("ask_rating", range, { оценка: "7" }).ok).toBe(false);
  });

  describe("ask_form", () => {
    const form = {
      title: "Заявка",
      fields: [
        { name: "name", label: "Имя", kind: "text", required: true },
        { name: "age", label: "Возраст", kind: "number", min: 18, max: 99 },
        { name: "day", label: "День", kind: "date", min: "2026-01-01", max: "2026-12-31" },
        { name: "plan", label: "Тариф", kind: "select", options: ["Базовый", "Про"] },
        { name: "note", label: "Заметка", kind: "text", multiline: true },
      ],
    };

    it("годные поля — в порядке формы, пустые необязательные опускаются", () => {
      expect(checkBasicWidgetAnswer("ask_form", form, { поля: { plan: "Про", name: "Аня", note: "", age: 30, day: "2026-05-01" } })).toEqual({
        ok: true,
        output: { поля: { name: "Аня", age: 30, day: "2026-05-01", plan: "Про" } },
      });
      expect(checkBasicWidgetAnswer("ask_form", form, { поля: { name: "Аня" } })).toEqual({ ok: true, output: { поля: { name: "Аня" } } });
    });

    it.each([
      ["нет обязательного", { age: 30 }],
      ["пустое обязательное", { name: "  " }],
      ["чужое поле", { name: "Аня", extra: "x" }],
      ["число вне пределов", { name: "Аня", age: 17 }],
      ["число строкой", { name: "Аня", age: "30" }],
      ["дата вне пределов", { name: "Аня", day: "2027-01-01" }],
      ["дата не в формате", { name: "Аня", day: "01.05.2026" }],
      ["несуществующая дата", { name: "Аня", day: "2026-02-30" }],
      ["вариант не из списка", { name: "Аня", plan: "Макс" }],
      ["текст длиннее 2000", { name: "я".repeat(2001) }],
      ["текст не строкой", { name: 5 }],
    ])("отказ: %s", (_, fields) => {
      expect(checkBasicWidgetAnswer("ask_form", form, { поля: fields }).ok).toBe(false);
    });

    it("ответ без «поля» — отказ", () => {
      expect(checkBasicWidgetAnswer("ask_form", form, { name: "Аня" }).ok).toBe(false);
    });
  });

  it("на подсказки не отвечают", () => {
    expect(checkBasicWidgetAnswer("suggest_replies", { replies: ["Да"] }, "Да").ok).toBe(false);
  });
});
