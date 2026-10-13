import { describe, expect, it } from "vitest";
import { detectFileKind } from "../src/detect-file-kind";
import { gifBytes, jpegBytes, makePdf, makePng, utf8, webpBytes } from "./support/sample-files";

const png = makePng(2, [255, 0, 0]);

describe("определение типа по содержимому", () => {
  it.each([
    ["cat.png", png, "image", "image/png"],
    ["cat.jpg", jpegBytes, "image", "image/jpeg"],
    ["cat.JPEG", jpegBytes, "image", "image/jpeg"],
    ["cat.gif", gifBytes, "image", "image/gif"],
    ["cat.webp", webpBytes, "image", "image/webp"],
    ["doc.pdf", makePdf(["hello"]), "pdf", "application/pdf"],
  ])("%s — по сигнатуре", (name, bytes, kind, mediaType) => {
    expect(detectFileKind(bytes, name)).toEqual({ kind, mediaType });
  });

  it("картинка без расширения или с чужим расширением распознаётся по содержимому", () => {
    expect(detectFileKind(png, "screenshot")).toEqual({ kind: "image", mediaType: "image/png" });
    expect(detectFileKind(png, "image.dat")).toEqual({ kind: "image", mediaType: "image/png" });
  });

  it("текст: расширение из белого списка или без расширения", () => {
    expect(detectFileKind(utf8("# Заголовок\nтекст"), "notes.md")).toEqual({ kind: "text", mediaType: "text/markdown" });
    expect(detectFileKind(utf8("a,b\n1,2"), "table.csv")).toEqual({ kind: "text", mediaType: "text/csv" });
    expect(detectFileKind(utf8('{"a":1}'), "data.json")).toEqual({ kind: "text", mediaType: "application/json" });
    expect(detectFileKind(utf8("print(1)"), "main.py")).toEqual({ kind: "text", mediaType: "text/plain" });
    expect(detectFileKind(utf8("привет"), "README")).toEqual({ kind: "text", mediaType: "text/plain" });
  });

  it("текст с BOM и переводами строк принимается", () => {
    expect(detectFileKind(Uint8Array.from([0xef, 0xbb, 0xbf, ...utf8("привет\r\n\tмир")]), "a.txt")?.kind).toBe("text");
  });

  it("подделка: расширение говорит одно, содержимое другое — отказ", () => {
    expect(detectFileKind(utf8("это не картинка"), "cat.png")).toBeNull();
    expect(detectFileKind(utf8("это не pdf"), "doc.pdf")).toBeNull();
    expect(detectFileKind(png, "cat.jpg")).toBeNull();
    expect(detectFileKind(png, "notes.txt")).toBeNull();
    expect(detectFileKind(makePdf(["x"]), "cat.png")).toBeNull();
  });

  it("текст с неизвестным расширением (например .exe, .svg, .sh.png) — отказ", () => {
    expect(detectFileKind(utf8("MZ текст"), "run.exe")).toBeNull();
    expect(detectFileKind(utf8("<svg onload=alert(1)></svg>"), "pic.svg")).toBeNull();
    expect(detectFileKind(utf8("echo 1"), "evil.sh.png")).toBeNull();
  });

  it("бинарные данные — отказ: архив, исполняемый файл, нулевые байты, невалидный UTF-8", () => {
    expect(detectFileKind(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), "a.zip")).toBeNull();
    expect(detectFileKind(Uint8Array.from([0x4d, 0x5a, 0x90, 0]), "a.exe")).toBeNull();
    expect(detectFileKind(Uint8Array.from([0x61, 0x00, 0x62]), "a.txt")).toBeNull();
    expect(detectFileKind(Uint8Array.from([0xff, 0xfe, 0xfd, 0x80]), "a.txt")).toBeNull();
    expect(detectFileKind(Uint8Array.from([0x41, 0x07, 0x42]), "a.txt")).toBeNull();
  });

  it("имя не влияет на путь: расширение берётся только с последней точки", () => {
    expect(detectFileKind(utf8("текст"), "../../etc/passwd.txt")?.kind).toBe("text");
    expect(detectFileKind(utf8("текст"), "archive.tar.gz")).toBeNull();
  });
});

describe("логи с цветом (управляющие последовательности терминала)", () => {
  const colored = utf8("\u001b[31mERROR\u001b[0m сборка упала\n\u001b[1;32mOK\u001b[0m\n\u001b]0;заголовок\u0007готово\n");

  it("лог с ANSI принимается как текст", () => {
    expect(detectFileKind(colored, "build.log")).toEqual({ kind: "text", mediaType: "text/plain" });
    expect(detectFileKind(colored, "output")).toEqual({ kind: "text", mediaType: "text/plain" });
  });

  it("одинокий ESC без последовательности, нулевой байт и звонок по-прежнему не текст", () => {
    expect(detectFileKind(utf8("текст\u001b и всё"), "a.log")).toBeNull();
    expect(detectFileKind(utf8("текст\u0000"), "a.log")).toBeNull();
    expect(detectFileKind(utf8("текст\u0007"), "a.log")).toBeNull();
  });
});

