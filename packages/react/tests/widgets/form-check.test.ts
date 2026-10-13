import { describe, expect, it } from "vitest";
import { russianLabels } from "../../src/labels";
import { checkChoices, checkForm, formCheckMessages } from "../../src/widgets/form-check";
import type { FormFieldView } from "../../src/skin-contract";

const messages = formCheckMessages(russianLabels.widgets);
const field = (fields: Partial<FormFieldView> & Pick<FormFieldView, "name" | "kind">): FormFieldView => ({ label: fields.name, required: false, ...fields });

describe("checkForm: проверка формы до отправки", () => {
  it("обязательное пустое поле — ошибка; пробелы — тоже пусто", () => {
    expect(checkForm([field({ name: "name", kind: "text", required: true })], { name: "  " }, messages)).toEqual({
      ok: false,
      errors: { name: "Обязательное поле" },
    });
    expect(checkForm([field({ name: "name", kind: "text", required: true })], {}, messages)).toMatchObject({ ok: false });
  });

  it("необязательные пустые поля опускаются, текст обрезается по краям", () => {
    expect(
      checkForm([field({ name: "a", kind: "text" }), field({ name: "b", kind: "number" }), field({ name: "c", kind: "text" })], { a: " x ", b: "" }, messages),
    ).toEqual({ ok: true, answer: { a: "x" } });
  });

  it("число: только число, в пределах; уходит числом", () => {
    const age = [field({ name: "age", kind: "number", min: 18, max: 99 })];
    expect(checkForm(age, { age: "abc" }, messages)).toEqual({ ok: false, errors: { age: messages.notNumber } });
    expect(checkForm(age, { age: "17" }, messages)).toEqual({ ok: false, errors: { age: messages.outOfRange("18", "99") } });
    expect(checkForm(age, { age: "100" }, messages)).toMatchObject({ ok: false });
    expect(checkForm(age, { age: "18" }, messages)).toEqual({ ok: true, answer: { age: 18 } });
    expect(checkForm(age, { age: 42 }, messages)).toEqual({ ok: true, answer: { age: 42 } });
    expect(checkForm([field({ name: "x", kind: "number" })], { x: "2,5" }, messages)).toEqual({ ok: true, answer: { x: 2.5 } });
    expect(checkForm([field({ name: "x", kind: "number", min: 0 })], { x: "-1" }, messages)).toEqual({
      ok: false,
      errors: { x: messages.outOfRange("0", undefined) },
    });
  });

  it("дата: YYYY-MM-DD, настоящая и в пределах", () => {
    const day = [field({ name: "day", kind: "date", min: "2026-10-01", max: "2026-12-31" })];
    expect(checkForm(day, { day: "01.11.2026" }, messages)).toEqual({ ok: false, errors: { day: messages.notDate } });
    expect(checkForm(day, { day: "2026-02-30" }, messages)).toEqual({ ok: false, errors: { day: messages.notDate } });
    expect(checkForm(day, { day: "2026-09-30" }, messages)).toEqual({ ok: false, errors: { day: messages.outOfRange("2026-10-01", "2026-12-31") } });
    expect(checkForm(day, { day: "2026-11-01" }, messages)).toEqual({ ok: true, answer: { day: "2026-11-01" } });
  });

  it("выбор из списка: только вариант из списка", () => {
    const plan = [field({ name: "plan", kind: "select", options: ["Старт", "Про"], required: true })];
    expect(checkForm(plan, { plan: "Ультра" }, messages)).toMatchObject({ ok: false });
    expect(checkForm(plan, { plan: "Про" }, messages)).toEqual({ ok: true, answer: { plan: "Про" } });
  });

  it("текст не длиннее 2000 знаков", () => {
    const note = [field({ name: "note", kind: "text", multiline: true })];
    expect(checkForm(note, { note: "я".repeat(2001) }, messages)).toEqual({ ok: false, errors: { note: messages.tooLong(2000) } });
    expect(checkForm(note, { note: "я".repeat(2000) }, messages)).toMatchObject({ ok: true });
  });

  it("поля не из формы не уходят", () => {
    expect(checkForm([field({ name: "a", kind: "text" })], { a: "1", evil: "2" }, messages)).toEqual({ ok: true, answer: { a: "1" } });
  });
});

describe("checkChoices: несколько вариантов", () => {
  const options = ["А", "Б", "В"];
  it("в пределах min..max — выбор в порядке вариантов без повторов", () => {
    expect(checkChoices(options, ["В", "А", "А"], 1, 3)).toEqual(["А", "В"]);
  });
  it("меньше min, больше max или чужой вариант — null", () => {
    expect(checkChoices(options, [], 1, 3)).toBeNull();
    expect(checkChoices(options, ["А", "Б", "В"], 1, 2)).toBeNull();
    expect(checkChoices(options, ["Г"], 1, 3)).toBeNull();
  });
});
