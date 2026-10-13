import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import { estimateTokens, extractText, truncateToTokens } from "../src/extract-text";
import { makeBlankPdf, makeInflatingPdf, makeManyPagesPdf, makePdf, utf8 } from "./support/sample-files";

describe("текст из файлов", () => {
  it("PDF: достаёт текст всех строк", async () => {
    const text = await extractText("pdf", makePdf(["Invoice ZEBRA-4471", "Total 15 USD"]));
    expect(text).toContain("ZEBRA-4471");
    expect(text).toContain("Total 15 USD");
  });

  it("PDF без текста (скан) — отказ no_text", async () => {
    await expect(extractText("pdf", makeBlankPdf())).rejects.toMatchObject({ kind: "no_text" });
  });

  it("битый PDF — отказ unreadable, не падение", async () => {
    const error = await extractText("pdf", utf8("%PDF-1.4\nмусор")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttachmentRejectedError);
    expect((error as AttachmentRejectedError).kind).toBe("unreadable");
  });

  it("текстовый файл: UTF-8 без BOM, переводы строк приведены к \\n", async () => {
    expect(await extractText("text", Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("а\r\nб\rв")]))).toBe("а\nб\nв");
  });

  it("текстовый файл: управляющие последовательности терминала (цвет, заголовок окна) убираются", async () => {
    const colored = utf8("\u001b[31mERROR\u001b[0m сборка упала\n\u001b[1;32mOK\u001b[0m\n\u001b]0;заголовок\u0007готово");
    expect(await extractText("text", colored)).toBe("ERROR сборка упала\nOK\nготово");
  });

  it("текстовый файл из одних пробелов — no_text", async () => {
    await expect(extractText("text", utf8("  \n \t"))).rejects.toMatchObject({ kind: "no_text" });
  });

  it("повторный разбор тех же байтов даёт тот же текст", async () => {
    const bytes = makePdf(["one", "two"]);
    expect(await extractText("pdf", bytes)).toBe(await extractText("pdf", bytes));
  });
});

describe("потолок по токенам", () => {
  it("оценка: один токен на три символа с округлением вверх", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("абв")).toBe(1);
    expect(estimateTokens("абвг")).toBe(2);
  });

  it("короткий текст остаётся как есть, длинный обрезается с началом на месте", () => {
    expect(truncateToTokens("коротко", 10)).toEqual({ text: "коротко", truncated: false });
    const cut = truncateToTokens("а".repeat(100), 10);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe("а".repeat(30));
  });
});

describe("разбор PDF в отдельном потоке", () => {
  afterEach(() => vi.restoreAllMocks());

  it("сбор текста останавливается по потолку символов: остальные страницы не читаются", async () => {
    const pdf = makeManyPagesPdf(1500, 400);
    const text = await extractText("pdf", pdf, { maxChars: 2000 });
    expect(text.length).toBeGreaterThan(2000);
    expect(text.length).toBeLessThan(4000);
  });

  it("без потолка текст берётся целиком", async () => {
    const text = await extractText("pdf", makeManyPagesPdf(20, 50));
    expect(text.replaceAll("\n", "")).toHaveLength(20 * 50);
  });

  it("таймаут по-настоящему останавливает разбор: поток убит, человек получает unreadable", async () => {
    const terminate = vi.spyOn(Worker.prototype, "terminate");
    const started = Date.now();
    await expect(extractText("pdf", makeManyPagesPdf(3000, 200), { timeoutMs: 20 })).rejects.toMatchObject({ kind: "unreadable" });
    expect(terminate).toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("раздутый поток («бомба») упирается в потолок памяти потока: отказ unreadable, а не падение процесса", async () => {
    const bomb = makeInflatingPdf(6_000_000);
    const error = await extractText("pdf", bomb, { timeoutMs: 20_000, maxMemoryMb: 96 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AttachmentRejectedError);
    expect((error as AttachmentRejectedError).kind).toBe("unreadable");
  }, 30_000);

  it("после отказа следующий разбор работает: один плохой файл поток не ломает", async () => {
    await extractText("pdf", makeManyPagesPdf(3000, 200), { timeoutMs: 20 }).catch(() => undefined);
    expect(await extractText("pdf", makePdf(["still fine"]))).toContain("still fine");
  });
});
