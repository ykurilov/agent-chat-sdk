import { isAttachmentId } from "./attachment-storage";
import type { AttachmentStorage, StoredAttachment } from "./attachment-storage";
import { acceptedFileTypes, acceptFieldFor, detectFileKind } from "./detect-file-kind";
import { charactersForTokens, estimateTokens, extractText, truncateToTokens } from "./extract-text";
import { fitImageForModel } from "./fit-image";
import type { AttachmentLimits } from "./limits";
import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";

/** Запас на служебные части multipart-тела сверх размера файла. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 200;

/** HTTP-адреса вложений; `createChatHandler` вызывает их после проверки, что чат принадлежит человеку. */
export interface AttachmentRoutes {
  /** `GET /attachments/settings`: лимиты и допустимые типы для клиента. */
  settings(): Response;
  /** Всё под `/:chatId/attachments`: `segments` — то, что после `attachments`. */
  handle(input: { request: Request; userId: string; chatId: string; segments: string[] }): Promise<Response>;
  /**
   * Файл, пришедший не через браузер (мессенджер), — тем же конвейером, что адрес загрузки: вид по содержимому,
   * ужатие картинки, текст, лимиты. Запись не прикреплена, пока сообщение с ней не отправлено.
   */
  ingestFile(input: { userId: string; chatId: string; bytes: Uint8Array; name: string }): Promise<IngestFileResult>;
}

/** Внутреннее для `createAttachments`: наружу не отдаётся, снаружи импорт идёт через `MessageAttachments.importFile`. */
export interface AttachmentRoutesInternals {
  /**
   * Картинка импорта переписки тем же конвейером, но сразу прикреплённая и без лимита неотправленных файлов: она уже
   * часть сообщения. Не картинка — отказ `unsupported_type`, ничего не записано.
   */
  ingestImportedImage(input: { userId: string; chatId: string; bytes: Uint8Array; name: string }): Promise<IngestFileResult>;
}

/** Принятый файл; `textTokens` и `textTruncated` — у файлов с текстом. */
export interface IngestedFile {
  id: string;
  name: string;
  mediaType: string;
  kind: StoredAttachment["kind"];
  size: number;
  textTokens?: number;
  textTruncated?: boolean;
}

/** `reason` — вид отказа, как `error.kind` у адреса загрузки: `empty`, `too_large`, `unsupported_type`, `busy`… */
export type IngestFileResult = { ok: true; attachment: IngestedFile } | { ok: false; reason: string };

const errorStatus: Record<string, number> = {
  unsupported_type: 415,
  too_large: 413,
  empty: 400,
  bad_request: 400,
  no_text: 422,
  unreadable: 422,
  not_found: 404,
  attached: 409,
  too_many_unsent: 429,
  busy: 429,
};

function failure(kind: string, status = errorStatus[kind] ?? 400): Response {
  return Response.json({ error: { kind } }, { status });
}

/** Имя для показа: без пути, без управляющих символов, не длиннее 200 знаков. */
function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : "файл";
}

/** Тело запроса, которое обрывается с ошибкой, как только переходит предел: файл не копится в памяти дальше него. */
function bodyWithin(request: Request, maxBytes: number, exceeded: { value: boolean }): ReadableStream<Uint8Array> {
  let total = 0;
  const limit = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length;
      if (total > maxBytes) {
        exceeded.value = true;
        controller.error(new Error("Файл больше допустимого"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return request.body ? request.body.pipeThrough(limit) : new Blob([]).stream();
}

/** Очередь по ключу: действия с одним ключом идут друг за другом, с разными — вместе. */
function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return async function inTurn<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(action, action);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/** Очередь с ограничением: одновременно идут не больше `maxRunning` действий, остальные ждут по порядку. */
function createLimitedQueue(maxRunning: number) {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async function limited<T>(action: () => Promise<T>): Promise<T> {
    // Место либо свободно, либо его передаёт закончившее действие: счётчик тогда не меняется.
    if (running < maxRunning) running++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await action();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

export function createAttachmentRoutes(options: {
  storage: AttachmentStorage;
  limits: AttachmentLimits;
  now: () => Date;
  onUpload: () => void;
  /** Разрешённые типы (по содержимому); нет — все, что SDK умеет. */
  acceptedMediaTypes?: readonly string[];
  /** Сказать клиенту, что модели без зрения видят картинки плашкой: предупреждение «не видит» не нужно. */
  imagesForBlindModels?: boolean;
}): { routes: AttachmentRoutes; internals: AttachmentRoutesInternals } {
  const { storage, limits, acceptedMediaTypes } = options;
  const inTurn = createKeyedQueue();
  // Ужатие картинки загружает процессор целиком: разом идут не больше `maxParallelImageFits`, сервер отвечает остальным.
  const fitting = createLimitedQueue(Math.max(1, limits.maxParallelImageFits));
  let uploading = 0;
  const uploadingByUser = new Map<string, number>();

  /** Занимает место среди параллельных загрузок; `null` — мест нет. Освободить нужно ровно один раз. */
  function takeUploadSlot(userId: string): (() => void) | null {
    const mine = uploadingByUser.get(userId) ?? 0;
    if (uploading >= limits.maxParallelUploads || mine >= limits.maxParallelUploadsPerUser) return null;
    uploading++;
    uploadingByUser.set(userId, mine + 1);
    return () => {
      uploading--;
      const left = (uploadingByUser.get(userId) ?? 1) - 1;
      if (left <= 0) uploadingByUser.delete(userId);
      else uploadingByUser.set(userId, left);
    };
  }

  /** Неотправленное у человека уже на пределе (с учётом `extraBytes` нового файла). */
  async function unsentOverLimit(userId: string, extraBytes: number): Promise<boolean> {
    const totals = await storage.unattachedTotals(userId);
    return totals.files + 1 > limits.maxUnsentFiles || totals.bytes + extraBytes > limits.maxUnsentBytes;
  }

  async function upload(request: Request, userId: string, chatId: string): Promise<Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) return failure("bad_request");
    const release = takeUploadSlot(userId);
    if (!release) return failure("busy");
    try {
      return await receive(request, userId, chatId);
    } finally {
      release();
    }
  }

  async function receive(request: Request, userId: string, chatId: string): Promise<Response> {
    const maxBody = limits.maxFileBytes + MULTIPART_OVERHEAD_BYTES;
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBody) return failure("too_large");
    // Быстрый отказ до чтения тела; окончательная проверка — под очередью человека, перед записью.
    if (await unsentOverLimit(userId, Number.isFinite(declared) ? declared : 0)) return failure("too_many_unsent");
    const exceeded = { value: false };
    let file: FormDataEntryValue | null;
    try {
      file = (
        await new Response(bodyWithin(request, maxBody, exceeded), { headers: { "content-type": request.headers.get("content-type")! } }).formData()
      ).get("file");
    } catch {
      return failure(exceeded.value ? "too_large" : "bad_request");
    }
    if (!(file instanceof Blob)) return failure("bad_request");
    if (file.size > limits.maxFileBytes) return failure("too_large");
    const result = await ingest(userId, chatId, new Uint8Array(await file.arrayBuffer()), file instanceof File ? file.name : "");
    if (!result.ok) return failure(result.reason);
    return Response.json(result.attachment, { status: 201 });
  }

  /**
   * Конвейер файла: вид по содержимому, ужатие картинки, текст, лимит неотправленного, запись. `imported` — картинка
   * импорта: только картинки, запись сразу прикреплена, лимит неотправленного не действует.
   */
  async function ingest(userId: string, chatId: string, received: Uint8Array, rawName: string, imported = false): Promise<IngestFileResult> {
    const refuse = (reason: string): IngestFileResult => ({ ok: false, reason });
    if (received.length > limits.maxFileBytes) return refuse("too_large");
    if (received.length === 0) return refuse("empty");
    const name = cleanName(rawName);
    const detected = detectFileKind(received, name);
    if (!detected || (imported && detected.kind !== "image")) return refuse("unsupported_type");
    // Тип вне разрешённых — отказ до ужатия, разбора текста и записи.
    if (acceptedMediaTypes && !acceptedMediaTypes.includes(detected.mediaType)) return refuse("unsupported_type");
    let bytes: Uint8Array = received;
    let mediaType = detected.mediaType;
    if (detected.kind === "image") {
      // Хранится копия, которую можно отправить модели: фото с телефона на 12 МБ иначе уходило бы целиком на каждом шаге.
      const fitted = await fitting(() => fitImageForModel(received, detected.mediaType));
      if (!fitted) return refuse("unreadable");
      bytes = fitted.bytes;
      mediaType = fitted.mediaType;
    }

    let extractedText: string | undefined;
    let textTruncated: boolean | undefined;
    if (detected.kind !== "image") {
      try {
        const text = await extractText(detected.kind, bytes, { maxChars: charactersForTokens(limits.maxFileTextTokens) });
        const cut = truncateToTokens(text, limits.maxFileTextTokens);
        extractedText = cut.text;
        textTruncated = cut.truncated;
      } catch (error) {
        if (error instanceof AttachmentRejectedError) return refuse(error.kind);
        throw error;
      }
    }
    const record: StoredAttachment = {
      id: crypto.randomUUID(),
      chatId,
      ownerId: userId,
      name,
      mediaType,
      sourceMediaType: detected.mediaType,
      kind: detected.kind,
      size: bytes.length,
      createdAt: options.now().toISOString(),
      attached: imported,
      ...(extractedText !== undefined && { extractedText, textTruncated }),
    };
    // Проверка и запись под очередью человека: параллельные загрузки не проскакивают мимо лимита.
    const saved = await inTurn(userId, async () => {
      if (!imported && (await unsentOverLimit(userId, bytes.length))) return false;
      await storage.save(record, bytes);
      return true;
    });
    if (!saved) return refuse("too_many_unsent");
    options.onUpload();
    return {
      ok: true,
      attachment: {
        id: record.id,
        name,
        mediaType: record.mediaType,
        kind: record.kind,
        size: record.size,
        ...(extractedText !== undefined && { textTokens: estimateTokens(extractedText), textTruncated }),
      },
    };
  }

  /** Запись, доступная этому человеку в этом чате; иначе `undefined` (для снаружи — 404). */
  async function ownRecord(id: string, userId: string, chatId: string): Promise<StoredAttachment | undefined> {
    if (!isAttachmentId(id)) return undefined;
    const record = await storage.get(id);
    return record && record.chatId === chatId && record.ownerId === userId ? record : undefined;
  }

  async function download(record: StoredAttachment): Promise<Response> {
    const bytes = await storage.readBytes(record.id);
    if (!bytes) return failure("not_found");
    const contentType = record.kind === "text" ? "text/plain; charset=utf-8" : record.mediaType;
    const disposition = record.kind === "image" ? "inline" : "attachment";
    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.length),
        "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(record.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
        "cache-control": "private, max-age=86400",
      },
    });
  }

  const internals: AttachmentRoutesInternals = {
    ingestImportedImage({ userId, chatId, bytes, name }) {
      return ingest(userId, chatId, bytes, name, true);
    },
  };

  const routes: AttachmentRoutes = {
    async ingestFile({ userId, chatId, bytes, name }) {
      // Место среди параллельных загрузок — как у адреса загрузки: ужатие картинок и разбор PDF грузят процессор.
      const release = takeUploadSlot(userId);
      if (!release) return { ok: false, reason: "busy" };
      try {
        return await ingest(userId, chatId, bytes, name);
      } finally {
        release();
      }
    },

    settings() {
      return Response.json({
        maxFiles: limits.maxFiles,
        maxFileBytes: limits.maxFileBytes,
        maxMessageTextTokens: limits.maxMessageTextTokens,
        accept: acceptedMediaTypes ? acceptFieldFor(acceptedMediaTypes) : acceptedFileTypes,
        ...(acceptedMediaTypes && { acceptedMediaTypes }),
        ...(options.imagesForBlindModels && { imagesForBlindModels: true }),
      });
    },

    async handle({ request, userId, chatId, segments }) {
      const method = request.method.toUpperCase();
      if (segments.length === 0) return method === "POST" ? upload(request, userId, chatId) : failure("bad_request", 405);
      if (segments.length > 1) return failure("not_found");
      if (method !== "GET" && method !== "DELETE") return failure("bad_request", 405);
      const record = await ownRecord(decodeURIComponentSafe(segments[0]!), userId, chatId);
      if (!record) return failure("not_found");
      if (method === "GET") return download(record);
      if (record.attached) return failure("attached");
      await storage.remove(record.id);
      return new Response(null, { status: 204 });
    },
  };

  return { routes, internals };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}
