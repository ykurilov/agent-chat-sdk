import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as root from "../src/index";
import { englishMemoryToolTitles, memoryToolTitles, withMemoryToolTitles } from "../src/tool-titles";

const labels = {
  toolRunning: (name: string) => `Работает: ${name}`,
  toolDone: (name: string) => `Готово: ${name}`,
  toolError: (name: string) => `Сбой: ${name}`,
  other: "не тронуто",
};

describe("подписи инструмента памяти в ленте", () => {
  it("manage_memory называется «Работа с памятью» во всех трёх состояниях, остальное не меняется", () => {
    const titled = withMemoryToolTitles(labels);
    expect(titled.toolRunning("manage_memory")).toBe("Работает: Работа с памятью");
    expect(titled.toolDone("manage_memory")).toBe("Готово: Работа с памятью");
    expect(titled.toolError("manage_memory")).toBe("Сбой: Работа с памятью");
    expect(titled.toolDone("web_search")).toBe("Готово: web_search");
    expect(titled.other).toBe("не тронуто");
  });

  it("свой словарь названий, например английский", () => {
    expect(withMemoryToolTitles(labels, englishMemoryToolTitles).toolDone("manage_memory")).toBe("Готово: Working with memory");
  });

  it("оба словаря есть и в корне пакета, как в `./labels`", () => {
    expect(root.memoryToolTitles).toBe(memoryToolTitles);
    expect(root.englishMemoryToolTitles).toBe(englishMemoryToolTitles);
  });

  it("служебные имена объекта не становятся названиями", () => {
    expect(withMemoryToolTitles(labels).toolDone("constructor")).toBe("Готово: constructor");
    expect(memoryToolTitles.manage_memory).toBe("Работа с памятью");
  });

  it("подписи доступны отдельной точкой входа `./labels`: без кода пакета, безопасно для браузерной сборки", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(manifest.exports["./labels"]).toEqual({
      "@ykurilov/agent-chat-source": "./src/tool-titles.ts",
      types: "./dist/types/tool-titles.d.ts",
      import: "./dist/labels.js",
    });
    const source = readFileSync(new URL("../src/tool-titles.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^import /m);
  });
});
