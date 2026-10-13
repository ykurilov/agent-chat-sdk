import { describe, expect, it } from "vitest";
import { repairJson } from "../../../src/agent-run/json-repair";

describe("repairJson", () => {
  it("правильный JSON не меняется", () => {
    const json = '{"text":"строка\\nс переводом","path":"C:\\\\dir","emoji":"\\u00e9","a":[1,true,null]}';
    expect(repairJson(json)).toBe(json);
  });

  it("сырой перевод строки и табуляция внутри строки становятся \\n и \\t", () => {
    const broken = '{"text":"первая\nвторая\tтретья"}';
    expect(() => JSON.parse(broken)).toThrow();
    expect(JSON.parse(repairJson(broken))).toEqual({ text: "первая\nвторая\tтретья" });
  });

  it("прочие управляющие знаки получают \\u-запись", () => {
    expect(JSON.parse(repairJson('{"a":"x\u0001y"}'))).toEqual({ a: "x\u0001y" });
  });

  it("неверная \\ удваивается: \\d остаётся двумя знаками", () => {
    const broken = '{"pattern":"\\d+\\.txt"}';
    expect(() => JSON.parse(broken)).toThrow();
    expect(JSON.parse(repairJson(broken))).toEqual({ pattern: "\\d+\\.txt" });
  });

  it("\\u без четырёх шестнадцатеричных цифр — неверная, \\ удваивается", () => {
    expect(JSON.parse(repairJson('{"a":"\\u12"}'))).toEqual({ a: "\\u12" });
  });

  it("одинокая \\ в конце текста удваивается", () => {
    expect(repairJson('{"a":"b\\')).toBe('{"a":"b\\\\');
  });

  it("управляющие знаки вне строк (пробелы между полями) не трогаются", () => {
    const json = '{\n  "a": 1,\n\t"b": 2\n}';
    expect(repairJson(json)).toBe(json);
  });
});
