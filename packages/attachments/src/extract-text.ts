import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import { Worker } from "node:worker_threads";
import { stripTerminalCodes } from "./terminal-codes";

const PDF_TIMEOUT_MS = 30_000;
const PDF_MEMORY_MB = 256;
/** Предел распакованного размера одного сжатого потока PDF: страница, шрифт, набор объектов. */
const PDF_STREAM_BYTES = 64 * 1024 * 1024;
/** Оценка токенов без счётчика модели: один токен на три символа. С запасом в сторону «больше». */
const CHARACTERS_PER_TOKEN = 3;

/** Сколько символов текста укладывается в `tokens` токенов по той же оценке. */
export function charactersForTokens(tokens: number): number {
  return tokens * CHARACTERS_PER_TOKEN;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

export function truncateToTokens(text: string, maxTokens: number): { text: string; truncated: boolean } {
  const limit = charactersForTokens(maxTokens);
  return text.length <= limit ? { text, truncated: false } : { text: text.slice(0, limit), truncated: true };
}

function normalize(text: string): string {
  return stripTerminalCodes(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
}

/**
 * Разбор PDF идёт в отдельном потоке: по таймауту поток убивается (разбор действительно останавливается).
 * «Бомба» — маленький сжатый поток, который распаковывается в сотни мегабайт. Первая линия защиты — до разбора каждый
 * сжатый (FlateDecode) поток, кроме картинок, распаковывается с жёстким пределом `maxStreamBytes`: больше — отказ,
 * всегда одинаково. Вторая линия — потолок памяти потока разбора: он держит то, что первая не видит (зашифрованный
 * PDF, другие фильтры сжатия), но срабатывает не всегда одинаково — зависит от сборки мусора.
 * Код потока встроен строкой, чтобы пакет не зависел от того, как приложение собирает файлы. `unpdf` он берёт по
 * адресу, найденному в основном потоке.
 */
const PDF_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const zlib = require("node:zlib");
const TOO_LARGE = "too_large";
// Каждый сжатый поток, который разбор текста будет распаковывать (не картинку), — не больше предела после распаковки.
// Зашифрованный или битый поток не распакуется — его пропускаем: дальше его держит потолок памяти потока.
const checkStreamSizes = (bytes, maxBytes) => {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
  const streamKeyword = /\\bstream\\r?\\n/g;
  for (let match; (match = streamKeyword.exec(text)); ) {
    const dataStart = match.index + match[0].length;
    const endAt = text.indexOf("endstream", dataStart);
    const dataEnd = endAt === -1 ? text.length : endAt;
    streamKeyword.lastIndex = dataEnd;
    const objectAt = text.lastIndexOf("obj", match.index);
    const dictionary = text.slice(Math.max(objectAt, match.index - 4096, 0), match.index);
    if (/\\/Subtype\\s*\\/Image\\b/.test(dictionary)) continue;
    const filter = /\\/Filter\\s*(\\[[^\\]]*\\]|\\/[A-Za-z0-9]+)/.exec(dictionary);
    const filters = filter ? filter[1].match(/\\/[A-Za-z0-9]+/g) || [] : [];
    if (filters.length === 0 || !filters.every((name) => name === "/FlateDecode" || name === "/Fl")) continue;
    let data = bytes.subarray(dataStart, dataEnd);
    for (let layer = 0; layer < filters.length; layer++) {
      try {
        data = zlib.inflateSync(data, { maxOutputLength: maxBytes, finishFlush: zlib.constants.Z_SYNC_FLUSH });
      } catch (error) {
        if (error && error.code === "ERR_BUFFER_TOO_LARGE") throw new Error(TOO_LARGE);
        break;
      }
    }
  }
};
const squeeze = (texts) => texts.join("\\n").replace(/[^\\S\\n]+/g, " ").replace(/ ?\\n ?/g, "\\n").replace(/\\n{3,}/g, "\\n\\n");
(async () => {
  checkStreamSizes(workerData.bytes, workerData.maxStreamBytes);
  const { getDocumentProxy } = await import(workerData.unpdfUrl);
  const pdf = await getDocumentProxy(workerData.bytes);
  try {
    const pages = [];
    let length = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (await pdf.getPage(number)).getTextContent();
      const page = squeeze([content.items.filter((item) => item.str != null).map((item) => item.str + (item.hasEOL ? "\\n" : "")).join("")]);
      pages.push(page);
      length += page.length + 1;
      // Запас на слипающиеся при склейке пустые строки: без него обрезанный текст мог бы не получить пометку об обрезке.
      if (length > workerData.maxChars + 2 * number) break;
    }
    parentPort.postMessage({ text: squeeze(pages) });
  } finally {
    await pdf.destroy();
  }
})().catch((error) => parentPort.postMessage({ failure: String(error && error.message || error) }));
`;

export interface PdfReadOptions {
  /** Сколько символов текста собрать; остальные страницы не читаются. По умолчанию не ограничено. */
  maxChars?: number;
  /** Срок разбора; по истечении поток убивается. */
  timeoutMs?: number;
  /** Потолок памяти потока разбора: вторая линия защиты от «бомбы». */
  maxMemoryMb?: number;
  /** Предел распакованного размера одного сжатого потока PDF, байт; больше — отказ `unreadable`. По умолчанию 64 МБ. */
  maxStreamBytes?: number;
}

const unreadable = () => new AttachmentRejectedError("unreadable", "Не удалось прочитать файл: он повреждён, защищён паролем или слишком сложный");

function pdfText(bytes: Uint8Array, options: PdfReadOptions): Promise<string> {
  const unpdfUrl = import.meta.resolve("unpdf");
  return new Promise((resolve, reject) => {
    // Поток забирает буфер себе (transfer): копия одна, исходные байты остаются у вызывающего.
    const copy = bytes.slice();
    const worker = new Worker(PDF_WORKER_SOURCE, {
      eval: true,
      workerData: { unpdfUrl, bytes: copy, maxChars: options.maxChars ?? Infinity, maxStreamBytes: options.maxStreamBytes ?? PDF_STREAM_BYTES },
      transferList: [copy.buffer],
      resourceLimits: { maxOldGenerationSizeMb: options.maxMemoryMb ?? PDF_MEMORY_MB, maxYoungGenerationSizeMb: 32 },
    });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      settle();
    };
    const timer = setTimeout(() => finish(() => reject(unreadable())), options.timeoutMs ?? PDF_TIMEOUT_MS);
    worker.on("message", (message: { text?: string; failure?: string }) =>
      finish(() => (typeof message.text === "string" ? resolve(message.text) : reject(unreadable()))),
    );
    worker.on("error", () => finish(() => reject(unreadable())));
    worker.on("exit", () => finish(() => reject(unreadable())));
  });
}

/** Текст PDF или текстового файла. Пустой текст (скан, пустой файл) — отказ. Результат зависит только от байтов. */
export async function extractText(kind: "pdf" | "text", bytes: Uint8Array, pdf: PdfReadOptions = {}): Promise<string> {
  const text = normalize(kind === "pdf" ? await pdfText(bytes, pdf) : new TextDecoder("utf-8").decode(bytes));
  if (text.length === 0) throw new AttachmentRejectedError("no_text", "В файле нет текста");
  return text;
}
