import { readFileSync } from "node:fs";
import { stripVoiceTags } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createSpokenText } from "../src/browser/spoken-text";
import { createSpokenTextWith } from "../src/shared/spoken-text-core";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("текст для озвучки на сервере", () => {
  it("общее ядро не импортирует ни экран, ни ядро чата: правило тегов голоса ему передают", () => {
    expect(read("../src/shared/spoken-text-core.ts")).not.toMatch(/^import[^;]*from\s+["']@ykurilov\//m);
  });

  it("голосовые ответы на сервере берут общее ядро и теги голоса из ядра чата, а не браузерный модуль", () => {
    const source = read("../src/server/voice-message.ts");
    expect(source).toMatch(/spoken-text-core/);
    expect(source).toMatch(/from\s+["']@ykurilov\/agent-chat-core["']/);
    expect(source).not.toMatch(/browser\/|agent-chat-react/);
  });

  it("весь ответ целиком: код, таблица и схема — короткими фразами, теги голоса остаются в тексте для озвучки", () => {
    const spoken = createSpokenTextWith(stripVoiceTags);
    const sentences = [...spoken.push("Привет [laughs] мир.\n```js\nx\n```\n| а | б |\n|---|---|\n| 1 | 2 |\n```mermaid\nA-->B\n```\nПока."), ...spoken.finish()];
    expect(sentences.map((sentence) => sentence.text)).toEqual(["Привет [laughs] мир.", "код на экране", "таблица на экране", "схема на экране", "Пока."]);
  });

  it("серверная и браузерная сборки дают одинаковые предложения", () => {
    const text = "Раз [sighs] два, три четыре пять шесть семь восемь девять десять одиннадцать двенадцать тринадцать, потом ещё.\n- пункт один\n- пункт два [laughs]";
    const run = (spoken: ReturnType<typeof createSpokenText>) => [...spoken.push(text), ...spoken.finish()];
    expect(run(createSpokenTextWith(stripVoiceTags))).toEqual(run(createSpokenText()));
  });
});
