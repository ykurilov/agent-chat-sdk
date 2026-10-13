import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceDir = join(import.meta.dirname, "../src");

describe("Markdown в скине", () => {
  it("текст модели рисуется только через SafeMarkdown: голый Markdown из @tandem/ui — лишь внутри него", () => {
    const usingRawMarkdown = readdirSync(sourceDir, { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file) && file !== "safe-markdown.tsx")
      .filter((file) => /import\s*\{[^}]*\bMarkdown\b[^}]*\}\s*from\s*"@tandem\/ui"/.test(readFileSync(join(sourceDir, file), "utf8")));
    expect(usingRawMarkdown).toEqual([]);
  });
});
