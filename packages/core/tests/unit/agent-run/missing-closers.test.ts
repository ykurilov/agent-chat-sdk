import { describe, expect, it } from "vitest";
import { addMissingClosers } from "../../../src/agent-run/missing-closers";

describe("addMissingClosers: чинится", () => {
  it.each([
    ['{"facts": ["a", "b"', '{"facts": ["a", "b"]}', 2],
    ['{"facts": ["a", "b"]', '{"facts": ["a", "b"]}', 1],
    ['{"a": {"b": 1}', '{"a": {"b": 1}}', 1],
    ['{"fields": [{"id": "f", "value": "x"}', '{"fields": [{"id": "f", "value": "x"}]}', 2],
    ['{"a": [[1, 2], [3]', '{"a": [[1, 2], [3]]}', 2],
    ['{"a": {"b": {"c": [true]}', '{"a": {"b": {"c": [true]}}}', 2],
    ['{"facts": ["a", "b"}', '{"facts": ["a", "b"]}', 1],
    ['{"changes": [{"op": "set", "value": "x"}}', '{"changes": [{"op": "set", "value": "x"}]}', 1],
    ['{"a": [{"b": [1, 2}}', '{"a": [{"b": [1, 2]}]}', 2],
    ['{"facts": ["a"]  \n', '{"facts": ["a"]}', 1],
  ])("%s", (broken, fixed, added) => {
    const repair = addMissingClosers(broken);
    expect(repair).toBeDefined();
    expect(JSON.parse(repair!.text)).toEqual(JSON.parse(fixed));
    expect(repair!.added).toBe(added);
  });

  it("скобки и кавычки в строках счёт не путают", () => {
    const repair = addMissingClosers('{"a": ["]}", "\\"[", "x\\\\"');
    expect(JSON.parse(repair!.text)).toEqual({ a: ["]}", '"[', "x\\"] });
  });
});

describe("addMissingClosers: не чинится", () => {
  it.each([
    ["обрыв внутри строки", '{"a": ["abc'],
    ["обрыв после обратной косой", '{"a": "abc\\'],
    ["обрыв после запятой", '{"a": [1, 2,'],
    ["обрыв после запятой с пробелом", '{"a": ["x", '],
    ["обрыв после двоеточия", '{"a": '],
    ["обрыв посреди ключа", '{"a'],
    ["обрыв после ключа", '{"a"'],
    ["обрыв после открывающей", '{"a": ['],
    ["обрыв посреди числа", '{"a": [1, 12'],
    ["число в конце объекта", '{"a": 12'],
    ["обрыв посреди литерала", '{"a": tr'],
    ["целый литерал в конце", '{"a": true'],
    ["пустая строка", ""],
    ["верный JSON", '{"a": [1]}'],
    ["лишняя скобка без пары", '{"a": 1}}'],
    ["после запятой идёт закрывающая", '{"a": [1,}'],
    ["после двоеточия идёт закрывающая", '{"a": }'],
    ["после открывающей другая закрывающая", '{"a": [}'],
    ["больше трёх недостающих", '{"a": [[[[[1]]'],
  ])("%s", (_name, broken) => {
    expect(addMissingClosers(broken)).toBeUndefined();
  });
});
