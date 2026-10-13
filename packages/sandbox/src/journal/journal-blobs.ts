import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip as gunzipCallback, gzip as gzipCallback } from "node:zlib";
import type { ModelCallEvent, ToolCallEvent } from "@ykurilov/agent-chat-core";
import type { JournalBlob } from "../types";
import type { Hider } from "./hide-secrets";
import type { BlobRow, ModelCallRow, ToolCallRow } from "./journal-store";

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

/** Кусок длиннее этого (в байтах JSON-текста) хранится обрезанным. */
export const BLOB_LIMIT_BYTES = 256 * 1024;

/** Строка base64 без пробелов от этой длины считается двоичными данными, даже без указанного типа. */
const MIN_BARE_BASE64_LENGTH = 1024;
const BARE_BASE64 = /^[A-Za-z0-9+/_-]+={0,2}$/;
const DATA_URL = /^data:([^;,]*)(;[^,]*)?,/;

/** «500 Б», «2 КБ», «1,2 МБ»: размер для описания двоичных данных и пометки об обрезке. */
export function describeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} МБ`;
}

/**
 * Кусок для базы: двоичное и странное заменено описаниями, секреты вычищены, хеш от результата, gzip.
 * Хеш считается от полного текста, обрезается только то, что хранится.
 */
export async function prepareBlob(value: unknown, hider: Hider): Promise<BlobRow> {
  if (value === null || typeof value !== "object") return packText(hider.text(JSON.stringify(hider.value(toPlain(value))) ?? "null"));
  // История чата почти целиком повторяется от обращения к обращению: кусок для того же объекта (и того же набора
  // секретов) берётся из кэша по ссылке, а не разбирается, хешируется и жмётся заново. Объекты запроса после
  // отправки не меняются.
  const byObject = preparedBlobs.get(hider) ?? new WeakMap<object, Promise<BlobRow>>();
  preparedBlobs.set(hider, byObject);
  const cached = byObject.get(value);
  if (cached) return cached;
  const prepared = packText(hider.text(JSON.stringify(hider.value(toPlain(value))) ?? "null"));
  byObject.set(value, prepared);
  prepared.catch(() => byObject.delete(value));
  return prepared;
}

const preparedBlobs = new WeakMap<Hider, WeakMap<object, Promise<BlobRow>>>();

async function packText(text: string): Promise<BlobRow> {
  const hash = createHash("sha256").update(text).digest("hex");
  const bytes = Buffer.byteLength(text);
  const truncated = bytes > BLOB_LIMIT_BYTES;
  const stored = truncated ? JSON.stringify(cut(text, bytes)) : text;
  return { hash, data: await gzip(Buffer.from(stored)), bytes, truncated };
}

function cut(text: string, bytes: number): string {
  const head = Buffer.from(text).subarray(0, BLOB_LIMIT_BYTES).toString("utf8").replace(/�+$/, "");
  return `${head}\n…[обрезано: показано ${describeSize(Buffer.byteLength(head))} из ${describeSize(bytes)}]`;
}

/** Кусок из базы: разжатое содержимое. Обрезанный кусок отдаётся строкой: обрезанный JSON не разобрать. */
export async function unpackBlob(row: BlobRow): Promise<JournalBlob> {
  const text = (await gunzip(row.data)).toString("utf8");
  return { hash: row.hash, content: JSON.parse(text) as unknown, bytes: row.bytes, truncated: row.truncated };
}

/** Обращение к модели: строка и куски (инструкция, сообщения, инструменты, настройки, ответ). Куски без повторов. */
export async function splitModelCall(event: ModelCallEvent, hider: Hider): Promise<{ row: ModelCallRow; blobs: BlobRow[] }> {
  const { request, response } = event;
  const eventHider = hider;
  const settings = await packText(eventHider.text(JSON.stringify(eventHider.settings(toPlain(request.settings))) ?? "null"));
  const instructions = await prepareBlob(request.instructions, eventHider);
  const messages = await Promise.all(request.messages.map((message) => prepareBlob(message, eventHider)));
  const tools = await prepareBlob(request.tools, eventHider);
  const answer = await prepareBlob(response, eventHider);
  const row: ModelCallRow = {
    id: event.callId,
    chatId: event.chatId,
    ownerId: event.ownerId,
    messageId: event.messageId,
    purpose: event.purpose,
    attempt: event.attempt,
    modelId: event.modelId,
    providerId: event.providerId,
    usage: event.usage,
    costUsd: event.costUsd,
    startedAt: event.startedAt,
    firstChunkMs: event.firstChunkMs,
    durationMs: event.durationMs,
    status: event.status,
    error: hideText(event.error, eventHider),
    instructionsHash: instructions.hash,
    messageHashes: messages.map((blob) => blob.hash),
    toolsHash: tools.hash,
    settingsHash: settings.hash,
    responseHash: answer.hash,
    toolCallIds: response.toolCalls.map((call) => call.toolCallId),
  };
  return { row, blobs: uniqueBlobs([instructions, ...messages, tools, settings, answer]) };
}

/** Вызов инструмента: строка и куски входа и выхода; при сбое без результата выхода нет. */
export async function splitToolCall(event: ToolCallEvent, hider: Hider): Promise<{ row: ToolCallRow; blobs: BlobRow[] }> {
  const input = await prepareBlob(event.input, hider);
  const output = event.output === undefined ? null : await prepareBlob(event.output, hider);
  const row: ToolCallRow = {
    id: crypto.randomUUID(),
    chatId: event.chatId,
    ownerId: event.ownerId,
    messageId: event.messageId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    inputHash: input.hash,
    outputHash: output?.hash ?? null,
    error: hideText(event.error, hider),
    startedAt: event.startedAt,
    durationMs: event.durationMs,
  };
  return { row, blobs: uniqueBlobs(output ? [input, output] : [input]) };
}

function hideText(text: string | null, hider: Hider): string | null {
  return text === null ? null : hider.text(String(hider.value(text)));
}

function uniqueBlobs(blobs: BlobRow[]): BlobRow[] {
  return [...new Map(blobs.map((blob) => [blob.hash, blob])).values()];
}

const BINARY_KINDS: Array<[string, string]> = [
  ["image/", "картинка"],
  ["audio/", "звук"],
  ["video/", "видео"],
];

function describeBinary(mediaType: string | null, bytes: number): string {
  const kind = BINARY_KINDS.find(([prefix]) => mediaType?.startsWith(prefix))?.[1] ?? (mediaType ? "файл" : "двоичные данные");
  return [kind, mediaType, describeSize(bytes)].filter((part) => part !== null).join(", ");
}

function binaryLength(value: unknown): number | null {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return null;
}

function base64Bytes(text: string): number {
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((text.length * 3) / 4) - padding);
}

/**
 * Значение в простой JSON-вид: двоичное — описанием («картинка, image/png, 1,2 МБ»), `data:`-адреса и длинный
 * base64 — тоже, циклы — «[цикл]», bigint и даты — строкой, ошибки — сообщением. Исходное значение не меняется.
 */
function toPlain(value: unknown, seen: WeakSet<object> = new WeakSet(), mediaType: string | null = null): unknown {
  if (typeof value === "string") return plainString(value, mediaType);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  const length = binaryLength(value);
  if (length !== null) return describeBinary(mediaType, length);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof URL) return value.href;
  if (value instanceof Error) return { name: value.name, message: value.message };
  const object = value as object;
  if (seen.has(object)) return "[цикл]";
  seen.add(object);
  try {
    if (Array.isArray(object)) return object.map((item) => toPlain(item, seen, mediaType) ?? null);
    const record = object as Record<string, unknown>;
    const ownType = typeof record.mediaType === "string" ? record.mediaType : typeof record.mimeType === "string" ? record.mimeType : null;
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) {
      const plain = toPlain(child, seen, key === "data" || key === "image" ? ownType : null);
      if (plain !== undefined) copy[key] = plain;
    }
    return copy;
  } finally {
    seen.delete(object);
  }
}

function plainString(text: string, mediaType: string | null): string {
  const dataUrl = DATA_URL.exec(text);
  if (dataUrl) return describeBinary(dataUrl[1] || null, dataUrl[2]?.includes("base64") ? base64Bytes(text.slice(dataUrl[0].length)) : Buffer.byteLength(text) - dataUrl[0].length);
  if (text.length >= MIN_BARE_BASE64_LENGTH && BARE_BASE64.test(text)) return describeBinary(mediaType, base64Bytes(text));
  if (mediaType && text.length >= 64 && BARE_BASE64.test(text)) return describeBinary(mediaType, base64Bytes(text));
  return text;
}
