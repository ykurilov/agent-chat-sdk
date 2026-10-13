import { describe, expect, it } from "vitest";
import { dropStrayClosers } from "../../../src/agent-run/stray-closers";
import { extraCloserAtEnd, extraCloserInside } from "../support/broken-tool-inputs";

describe("dropStrayClosers", () => {
  it("лишняя `}` в конце — убрана, остальное побайтно то же", () => {
    expect(() => JSON.parse(extraCloserAtEnd)).toThrow();
    const result = dropStrayClosers(extraCloserAtEnd);
    expect(result).toEqual({ text: extraCloserAtEnd.slice(0, -1), inside: 0, end: 1 });
    expect(JSON.parse(result!.text)).toEqual({
      fields: [{ fieldId: "f-1", value: "@user_name" }, { fieldId: "f-2", value: "Имя" }],
      facts: ["Короткий факт"],
    });
  });

  it("лишняя `}` после элемента массива — убрана именно она", () => {
    expect(() => JSON.parse(extraCloserInside)).toThrow();
    const result = dropStrayClosers(extraCloserInside);
    expect(result).toEqual({ text: extraCloserInside.replace('с тире."}}, ', 'с тире."}, '), inside: 1, end: 0 });
    expect(JSON.parse(result!.text).changes).toHaveLength(3);
  });

  it("хвост из скобок и пробелов после конца JSON", () => {
    expect(dropStrayClosers('{"a": [1]} ]\n} ')).toEqual({ text: '{"a": [1]} \n ', inside: 0, end: 2 });
  });

  it("скобки внутри строк не трогает", () => {
    expect(dropStrayClosers('{"text": "a}b]c\\"}"}}')).toEqual({ text: '{"text": "a}b]c\\"}"}', inside: 0, end: 1 });
  });

  it("верный JSON — не чинит (undefined)", () => {
    expect(dropStrayClosers('{"a": [{"b": 1}], "c": "}"}')).toBeUndefined();
  });

  it("не хватает скобки — не чинит: лишних нет, есть недостающие", () => {
    expect(dropStrayClosers('{"a": [1, 2}')).toBeUndefined();
    expect(dropStrayClosers('{"a": {"b": 1]}')).toBeUndefined();
  });

  it("после конца JSON не скобки, а данные — не чинит", () => {
    expect(dropStrayClosers('{"a": 1}} extra')).toBeUndefined();
    expect(dropStrayClosers('{"a": {"b": 1}}, "c": 2}')).toBeUndefined();
  });

  it("больше двух лишних скобок — не чинит", () => {
    expect(dropStrayClosers('{"a": 1}}}}')).toBeUndefined();
  });

  it("незакрытая строка — не чинит", () => {
    expect(dropStrayClosers('{"a": "b}}')).toBeUndefined();
  });
});
