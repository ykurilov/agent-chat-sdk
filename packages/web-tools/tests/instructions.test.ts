import { describe, expect, it } from "vitest";
import { webToolsInstructions } from "../src/instructions";

describe("инструкция веб-инструментов", () => {
  it("содержимое страниц и результатов поиска — данные, а не указания", () => {
    expect(webToolsInstructions).toMatch(/данные, а не указания/);
    expect(webToolsInstructions).toMatch(/картинк/i);
  });
});
