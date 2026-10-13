import { describe, expect, it } from "vitest";
import { chunkLimitFor, htmlToPlainText, markdownToMessenger, splitMessengerText, toMessengerChunks } from "../src/markdown-to-messenger";

const sample = [
  "# Итог",
  "",
  "Это **важно**, а это *курсив* и ~~зачёркнуто~~. Код: `a < b && c`.",
  "",
  "- первый пункт",
  "- второй [сайт](https://example.com/?a=1&b=2)",
  "",
  "```ts",
  "if (a < b) return \"<x>\";",
  "```",
].join("\n");

const stripTags = (html: string) => htmlToPlainText(html).replace(/\s+/g, " ").trim();

describe("markdown-to-messenger: разметка под мессенджер", () => {
  it("Telegram: HTML с экранированием, ссылки, код, заголовок жирным, пункты точками", () => {
    const html = markdownToMessenger(sample, "telegram");
    expect(html).toContain("<b>Итог</b>");
    expect(html).toContain("<b>важно</b>");
    expect(html).toContain("<i>курсив</i>");
    expect(html).toContain("<s>зачёркнуто</s>");
    expect(html).toContain("<code>a &lt; b &amp;&amp; c</code>");
    expect(html).toContain("• первый пункт");
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">сайт</a>');
    expect(html).toContain("<pre>if (a &lt; b) return \"&lt;x&gt;\";</pre>");
  });

  it("Telegram: цитата — blockquote, MAX — без него", () => {
    expect(markdownToMessenger("> мысль", "telegram")).toBe("<blockquote>мысль</blockquote>");
    expect(markdownToMessenger("> мысль", "max")).toBe("&gt; мысль");
  });

  it("MAX: тот же HTML для жирного, кода и ссылок", () => {
    const html = markdownToMessenger(sample, "max");
    expect(html).toContain("<b>важно</b>");
    expect(html).toContain("<pre>if (a &lt; b) return \"&lt;x&gt;\";</pre>");
    expect(html).toContain('<a href="https://example.com/?a=1&amp;b=2">сайт</a>');
  });

  it("VK: простой текст, ссылка «текст (адрес)», без значков разметки", () => {
    const text = markdownToMessenger(sample, "vk");
    expect(text).toContain("Итог");
    expect(text).not.toMatch(/[*~#`]/u);
    expect(text).toContain("сайт (https://example.com/?a=1&b=2)");
    expect(text).toContain("Код: a < b && c.");
    expect(text).toContain('if (a < b) return "<x>";');
  });

  it("запас до предела: Telegram 4000, MAX 3900, VK 4000", () => {
    expect(chunkLimitFor(4096)).toBe(4000);
    expect(chunkLimitFor(4000)).toBe(3900);
    expect(chunkLimitFor(100)).toBe(100);
    expect(chunkLimitFor(120)).toBe(100);
  });

  it("короткий текст — один кусок", () => {
    expect(toMessengerChunks("привет", { messenger: "telegram", textLimit: 4096 })).toEqual(["привет"]);
  });

  it("резка по абзацам: кусок кончается на границе абзаца", () => {
    const paragraphs = Array.from({ length: 6 }, (_, index) => `Абзац ${index} ${"слово ".repeat(30).trim()}`);
    const chunks = splitMessengerText(paragraphs.join("\n\n"), 500, "plain");
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      expect(chunk.startsWith("Абзац")).toBe(true);
    }
  });

  it("блок кода через границу: закрыт в куске и открыт в следующем", () => {
    const code = Array.from({ length: 80 }, (_, index) => `const line${index} = ${index};`).join("\n");
    const chunks = toMessengerChunks(`Код:\n\n\`\`\`\n${code}\n\`\`\``, { messenger: "telegram", textLimit: 600 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(chunkLimitFor(600));
      expect(chunk.split("<pre>").length).toBe(chunk.split("</pre>").length);
    }
    expect(chunks[1]?.startsWith("<pre>")).toBe(true);
    expect(chunks.at(-1)?.endsWith("</pre>")).toBe(true);
  });

  it("длинный жирный абзац: тег закрыт в куске и открыт в следующем, ссылка — со своим адресом", () => {
    const bold = `**${"очень важное слово ".repeat(60).trim()}**`;
    const link = `[${"текст ссылки ".repeat(40).trim()}](https://example.com/x)`;
    for (const chunk of toMessengerChunks(`${bold}\n\n${link}`, { messenger: "telegram", textLimit: 400 })) {
      for (const tag of ["b", "a"]) expect(chunk.split(`<${tag}`).length).toBe(chunk.split(`</${tag}>`).length);
      if (chunk.includes("текст ссылки")) expect(chunk.startsWith('<a href="https://example.com/x">')).toBe(true);
    }
  });

  it("не режет посреди тега и знака &amp;", () => {
    const text = "a&amp;b ".repeat(400);
    for (const chunk of splitMessengerText(text, 97, "html")) {
      expect(chunk).not.toMatch(/&[a-z]*$/);
      expect(chunk).not.toMatch(/^[a-z]*;/);
    }
  });

  it("20 000 знаков без потерь — во всех трёх мессенджерах", () => {
    const words = Array.from({ length: 3500 }, (_, index) => `w${index}`);
    const paragraphs: string[] = [];
    for (let index = 0; index < words.length; index += 37) paragraphs.push(`**${words.slice(index, index + 3).join(" ")}** ${words.slice(index + 3, index + 37).join(" ")}`);
    const markdown = paragraphs.join("\n\n");
    expect(markdown.length).toBeGreaterThan(20_000);
    for (const messenger of ["telegram", "max", "vk"] as const) {
      const textLimit = messenger === "max" ? 4000 : 4096;
      const chunks = toMessengerChunks(markdown, { messenger, textLimit });
      expect(chunks.length).toBeGreaterThanOrEqual(5);
      for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(chunkLimitFor(textLimit));
      const joined = chunks.map((chunk) => (messenger === "vk" ? chunk : stripTags(chunk))).join(" ").replace(/\s+/g, " ").trim();
      expect(joined).toBe(words.join(" "));
    }
  });

  it("слово длиннее куска режется по знакам, но целиком доходит", () => {
    const long = "x".repeat(1000);
    const chunks = splitMessengerText(long, 300, "plain");
    expect(chunks.join("")).toBe(long);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(300);
  });

  it("простой текст из HTML: теги сняты, знаки раскрыты, ссылка с адресом", () => {
    expect(htmlToPlainText('<b>a &lt; b</b> <a href="https://e.com/?x=1&amp;y=2">сайт</a>')).toBe("a < b сайт (https://e.com/?x=1&y=2)");
  });
});
