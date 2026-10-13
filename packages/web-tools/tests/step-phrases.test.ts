import { describe, expect, it } from "vitest";
import { englishWebToolStepPhrases, webToolStepPhrases } from "../src/labels";

const phraseOf = (entry: unknown, input?: unknown) =>
  typeof entry === "function" ? entry({ toolName: "x", state: "running", input }) : entry;

describe("фразы веб-инструментов для простого вида", () => {
  it("у каждого инструмента — «идёт» и «готово» по-русски и по-английски, без входа тоже", () => {
    expect(Object.keys(webToolStepPhrases).sort()).toEqual(["page_screenshot", "read_page", "web_search"]);
    expect(Object.keys(englishWebToolStepPhrases).sort()).toEqual(Object.keys(webToolStepPhrases).sort());
    for (const [name, entry] of Object.entries(webToolStepPhrases)) {
      const phrase = phraseOf(entry);
      expect(phrase.running, name).toMatch(/[а-я]/);
      expect(phrase.done, name).toMatch(/[а-я]/);
    }
    for (const entry of Object.values(englishWebToolStepPhrases)) {
      expect(`${phraseOf(entry).running} ${phraseOf(entry).done}`).not.toMatch(/[А-Яа-яЁё]/);
    }
    expect(webToolStepPhrases.web_search).toEqual({ running: "Ищу в интернете", done: "Поискал в интернете" });
  });
});
