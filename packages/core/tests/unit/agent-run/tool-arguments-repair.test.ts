import { describe, expect, it } from "vitest";
import { repairToolArguments } from "../../../src/agent-run/tool-arguments-repair";
import {
  fieldsExtraBraceAtEndChangesText,
  flowMissingArrayCloserChangesText,
  instructionExtraBraceBeforeArrayCloserChangesText,
  instructionExtraBraceBeforeArrayCloserSecondChangesText,
} from "../support/broken-tool-inputs";

const parsed = (text: string | undefined) => (text === undefined ? undefined : JSON.parse(text));

describe("repairToolArguments: чинится", () => {
  it.each([
    ["лишняя `}` после вложенного объекта посреди объекта", '{"a": {"b": 1}}, "c": 2}', { a: { b: 1 }, c: 2 }],
    ["лишняя `]` после вложенного массива посреди объекта", '{"a": [1, 2]], "c": [3]}', { a: [1, 2], c: [3] }],
    ["лишняя `}` в конце", '{"a": [1]}}', { a: [1] }],
    ["лишняя `}` внутри массива", '{"c": [{"x": 1}}, {"x": 2}]}', { c: [{ x: 1 }, { x: 2 }] }],
    ["забытая `]`", '{"c": ["a", "b"}', { c: ["a", "b"] }],
    ["забытые `]}` в конце", '{"c": [{"x": 1}', { c: [{ x: 1 }] }],
    ["сырой перевод строки в строке", '{"t": "а\nб"}', { t: "а\nб" }],
    ["верный JSON остаётся как есть", '{"a": 1}', { a: 1 }],
  ])("%s", (_name, text, expected) => {
    expect(parsed(repairToolArguments(text))).toEqual(expected);
  });

  it("строки внутри не путают подсчёт скобок: `}}` и `\\\"]` в тексте остаются", () => {
    const text = '{"a": {"t": "}} \\"] {"}}, "b": 1}';
    expect(parsed(repairToolArguments(text))).toEqual({ a: { t: '}} "] {' }, b: 1 });
  });

  it("реальные вызовы: JSON внутри строки `changes` чинится тем же правилом", () => {
    for (const text of [
      flowMissingArrayCloserChangesText,
      instructionExtraBraceBeforeArrayCloserChangesText,
      fieldsExtraBraceAtEndChangesText,
      instructionExtraBraceBeforeArrayCloserSecondChangesText,
    ]) {
      expect(Array.isArray(parsed(repairToolArguments(text)))).toBe(true);
    }
  });
});

describe("repairToolArguments: не чинится", () => {
  it.each([
    ["пустой текст", ""],
    ["не JSON", "привет"],
    ["обрыв внутри строки", '{"a": "abc'],
    ["обрыв после запятой", '{"a": [1,'],
    ["обрыв после двоеточия", '{"a":'],
    ["обрыв посреди числа", '{"a": 12'],
    ["две лишние скобки подряд и ещё одна", '{"a": 1}}}}'],
    ["мусор после конца JSON", '{"a": 1} и ещё слова'],
    ["лишняя скобка, а дальше не пара ключ-значение", '{"a": {"b": 1}} "c"}'],
    ["закрывающая в начале", '}{"a": 1}'],
    ["два объекта подряд", '{"a": 1}{"b": 2}'],
  ])("%s", (_name, text) => {
    expect(repairToolArguments(text)).toBeUndefined();
  });
});
