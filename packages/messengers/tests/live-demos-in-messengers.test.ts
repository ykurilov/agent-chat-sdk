import { describe, expect, it } from "vitest";
import { markdownToMessenger, toMessengerChunks } from "../src/markdown-to-messenger";
import { defaultMessengerTexts } from "../src/messenger-texts";

const fence = "\x60\x60\x60";
const answer = `Подвигайте ползунок:\n\n${fence}html-demo\n<input type="range"><script>alert(1)</script>\n${fence}\n\nГотово.`;

describe("живая демонстрация в мессенджере (043 FR-009)", () => {
  it("вместо кода — фраза «Демонстрация доступна на сайте.»; остальной текст на месте", () => {
    expect(defaultMessengerTexts.liveDemoOnSite).toBe("Демонстрация доступна на сайте.");
    for (const messenger of ["telegram", "max", "vk"] as const) {
      const text = markdownToMessenger(answer, messenger, { liveDemoNote: defaultMessengerTexts.liveDemoOnSite });
      expect(text).toContain("Демонстрация доступна на сайте.");
      expect(text).not.toContain("alert(1)");
      expect(text).not.toContain("range");
      expect(text).toContain("Готово.");
    }
  });

  it("незакрытый блок в черновике — тоже фраза; пустая фраза — блок убран", () => {
    expect(markdownToMessenger(`Сейчас:\n${fence}html-demo\n<p>`, "telegram", { liveDemoNote: "На сайте" })).toBe("Сейчас:\n\nНа сайте");
    expect(markdownToMessenger(answer, "vk", { liveDemoNote: "" })).toBe("Подвигайте ползунок:\n\nГотово.");
  });

  it("без фразы (прежние вызовы) — как раньше, обычный код; другой язык блока не трогается", () => {
    expect(markdownToMessenger(answer, "telegram")).toContain("&lt;input");
    expect(markdownToMessenger(`${fence}html\n<b>x</b>\n${fence}`, "telegram", { liveDemoNote: "На сайте" })).toBe("<pre>&lt;b&gt;x&lt;/b&gt;</pre>");
  });

  it("куски для отправки берут фразу из цели", () => {
    expect(toMessengerChunks(answer, { messenger: "telegram", textLimit: 4096, liveDemoNote: "На сайте" }).join("")).toContain("На сайте");
  });
});
