import type { AttachmentKind } from "./attachment-storage";
import { stripTerminalCodes } from "./terminal-codes";

export interface DetectedFile {
  kind: AttachmentKind;
  mediaType: string;
}

const TEXT_MEDIA_TYPES: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  jsonl: "application/x-ndjson",
  xml: "application/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  yaml: "application/yaml",
  yml: "application/yaml",
};

/** Расширения текстовых файлов, которые принимаются как текст. Прочие текстовые расширения (например `.svg`) — отказ. */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml", "html", "htm", "css", "ini", "cfg",
  "conf", "log", "sql", "js", "mjs", "cjs", "ts", "tsx", "jsx", "vue", "svelte", "py", "rb", "go", "rs", "java", "kt",
  "swift", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash", "zsh", "lua", "r", "scala", "dart", "tex",
]);

const BINARY_EXTENSIONS: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

const ascii = (bytes: Uint8Array, from: number, length: number) => String.fromCharCode(...bytes.subarray(from, from + length));

/** Формат по сигнатуре в начале файла. */
function detectBinary(bytes: Uint8Array): DetectedFile | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { kind: "image", mediaType: "image/png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "image", mediaType: "image/jpeg" };
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return { kind: "image", mediaType: "image/gif" };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return { kind: "image", mediaType: "image/webp" };
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return { kind: "pdf", mediaType: "application/pdf" };
  return null;
}

/**
 * Корректный UTF-8 без нулевых байтов и управляющих символов (кроме табуляции, переводов строки и страницы).
 * Цвета и прочие последовательности терминала в логах не мешают: при разборе они убираются.
 */
function isPlainText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return false;
  }
  text = stripTerminalCodes(text);
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d && code !== 0x0c) return false;
    if (code === 0x7f) return false;
  }
  return true;
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Тип файла по содержимому. Тип, который назвал браузер, сюда не приходит. Имя нужно только для проверки на
 * подделку: расширение картинки или PDF у файла с другим содержимым — отказ; текст принимается с расширением
 * из белого списка или вовсе без расширения. `null` — файл не принимается.
 */
export function detectFileKind(bytes: Uint8Array, name: string): DetectedFile | null {
  const extension = extensionOf(name);
  const binary = detectBinary(bytes);
  const declaredBinary = BINARY_EXTENSIONS[extension];
  if (binary) {
    if (declaredBinary && declaredBinary !== binary.mediaType) return null;
    if (TEXT_EXTENSIONS.has(extension)) return null;
    return binary;
  }
  if (declaredBinary) return null;
  if (extension !== "" && !TEXT_EXTENSIONS.has(extension)) return null;
  if (!isPlainText(bytes)) return null;
  return { kind: "text", mediaType: TEXT_MEDIA_TYPES[extension] ?? "text/plain" };
}

/** Типы, которые может дать `detectFileKind`: только из них приложение выбирает `acceptedMediaTypes`. */
export const detectableMediaTypes: readonly string[] = [
  ...new Set([...Object.values(BINARY_EXTENSIONS), "text/plain", ...Object.values(TEXT_MEDIA_TYPES)]),
];

/** Расширения, с которыми файл получает этот тип: для поля выбора файла. */
function extensionsOf(mediaType: string): string[] {
  if (mediaType === "text/plain") return [...TEXT_EXTENSIONS].filter((extension) => !(extension in TEXT_MEDIA_TYPES));
  const byExtension = { ...BINARY_EXTENSIONS, ...TEXT_MEDIA_TYPES };
  return Object.keys(byExtension).filter((extension) => byExtension[extension] === mediaType);
}

/** Значение поля выбора файла для разрешённых типов: сами типы и их расширения. */
export function acceptFieldFor(mediaTypes: readonly string[]): string {
  return [...mediaTypes, ...new Set(mediaTypes.flatMap(extensionsOf).map((extension) => `.${extension}`))].join(",");
}

/** Значение для поля выбора файла: и типы, и расширения. */
export const acceptedFileTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  ".pdf",
  ...[...TEXT_EXTENSIONS].map((extension) => `.${extension}`),
].join(",");
