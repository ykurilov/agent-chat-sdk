import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttachmentsController, AttachmentsPlugin, ComposerAttachmentItem, ServerFileDraft } from "@ykurilov/agent-chat-react";
import { russianAttachmentsLabels } from "./labels";
import type { AttachmentErrorKind, AttachmentsLabels } from "./labels";

/** Пока сервер не ответил на запрос настроек, действуют его же значения по умолчанию. */
const fallbackSettings = {
  maxFiles: 10,
  maxFileBytes: 20 * 1024 * 1024,
  maxMessageTextTokens: 100_000,
  accept: "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,.txt,.md,.csv,.json",
};
type Settings = typeof fallbackSettings & {
  /** Приложение сузило типы файлов: файл другого типа отклоняется до загрузки. */
  acceptedMediaTypes?: string[];
  /** Модель без зрения смотрит картинки инструментом приложения: предупреждать не о чем. */
  imagesForBlindModels?: boolean;
};

/** Другие имена тех же типов, которые встречаются у браузеров. */
const MEDIA_TYPE_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "image/x-png": "image/png" };

/**
 * Подходит ли файл под типы, которые приложение разрешило: по типу от браузера (с его другими именами) или по расширению
 * из поля выбора. Ни типа, ни расширения — решит сервер по содержимому; он же проверяет всё остальное.
 */
function fitsAcceptedTypes(file: File, settings: Settings): boolean {
  if (!settings.acceptedMediaTypes) return true;
  const type = file.type.toLowerCase();
  if (settings.acceptedMediaTypes.includes(MEDIA_TYPE_ALIASES[type] ?? type)) return true;
  const extension = /(\.[^./\\]+)$/.exec(file.name)?.[1]?.toLowerCase();
  if (extension && settings.accept.toLowerCase().split(",").includes(extension)) return true;
  return !type && !extension;
}

interface FieldItem extends ComposerAttachmentItem {
  fileName: string;
  uploadUrl: string;
  fetchFile: typeof globalThis.fetch;
  ownedPreview?: string;
  size: number;
  abort: AbortController;
  serverId?: string;
  mediaType?: string;
  textTokens?: number;
  errorKind?: AttachmentErrorKind;
}

const errorKinds: readonly AttachmentErrorKind[] = ["unsupported_type", "too_large", "empty", "no_text", "unreadable", "too_many_unsent", "busy"];
/** Отказы сервера, после которых файла на сервере уже нет: его нужно загрузить снова. */
const goneKinds = new Set(["attachment_expired", "attachment_not_found"]);

/** Сервер пускает человека не больше чем на 3 загрузки сразу: с запасом грузим по две, остальные ждут в очереди. */
const parallelUploads = 2;
const busyRetries = 4;

export interface AttachmentsControllerInput {
  api: string;
  chatId: string;
  modelSeesImages: boolean | undefined;
  fetch?: typeof globalThis.fetch;
  /** Пауза перед повтором, если сервер занят загрузками (растёт с каждой попыткой). */
  busyRetryDelayMs?: number;
}

/** Файлы в поле ввода: загрузка на сервер, превью, отказы, потолки и вложения сообщений в ленте. */
export function useAttachmentsController(
  { api, chatId, modelSeesImages, fetch: fetchImpl, busyRetryDelayMs = 500 }: AttachmentsControllerInput,
  labels: AttachmentsLabels,
): AttachmentsController {
  const [items, setItems] = useState<FieldItem[]>([]);
  const [settings, setSettings] = useState<Settings>(fallbackSettings);
  const [problem, setProblem] = useState<string | undefined>();
  const itemsRef = useRef<FieldItem[]>([]);
  /** Файлы последней отправки: их можно вернуть в поле, если сервер не примет сообщение. */
  const sentRef = useRef<FieldItem[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const latest = useRef({ api, chatId, fetchImpl, labels, busyRetryDelayMs });
  latest.current = { api, chatId, fetchImpl, labels, busyRetryDelayMs };
  /** Очередь загрузок: одновременно идут не больше `parallelUploads`. */
  const uploadQueue = useMemo<{ waiting: Array<() => Promise<void>>; running: number }>(() => ({ waiting: [], running: 0 }), [api, chatId]);
  const scope = useMemo(() => ({}), [api, chatId]);
  const currentScope = useRef<object | null>(scope);
  currentScope.current = scope;

  const commit = useCallback((next: FieldItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const send = useCallback((url: string, init?: RequestInit) => (latest.current.fetchImpl ?? globalThis.fetch)(url, init), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await send(`${api}/attachments/settings`);
        if (!response.ok) return;
        const loaded = (await response.json()) as Partial<Settings>;
        if (!cancelled) setSettings({ ...fallbackSettings, ...loaded });
      } catch {
        // Без настроек работаем на значениях по умолчанию: сервер всё равно проверит каждый файл.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, send]);

  // Файлы принадлежат чату: при смене чата и уходе со страницы недозагруженное отменяется, превью освобождаются.
  useEffect(
    () => {
      currentScope.current = scope;
      return () => {
        if (currentScope.current === scope) currentScope.current = null;
        for (const item of [...itemsRef.current, ...sentRef.current]) {
          item.abort.abort();
          if (item.ownedPreview) URL.revokeObjectURL(item.ownedPreview);
        }
        itemsRef.current = [];
        sentRef.current = [];
        setItems([]);
        setProblem(undefined);
      };
    },
    [api, chatId, scope],
  );

  const update = useCallback(
    (id: string, changes: Partial<FieldItem>) => {
      if (!itemsRef.current.some((item) => item.id === id)) return;
      commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    },
    [commit],
  );

  /** Одна попытка загрузки; `busy` — сервер просит подождать. */
  const uploadOnce = useCallback(
    async (item: FieldItem, file: File): Promise<"busy" | "done"> => {
      const body = new FormData();
      body.append("file", file);
      try {
        const response = await item.fetchFile(item.uploadUrl, {
          method: "POST",
          body,
          signal: item.abort.signal,
        });
        const payload = (await response.json().catch(() => undefined)) as
          | { id?: string; mediaType?: string; kind?: string; textTokens?: number; error?: { kind?: string } }
          | undefined;
        if (response.ok && payload?.id) {
          if (item.abort.signal.aborted || !itemsRef.current.some((candidate) => candidate.id === item.id)) {
            void item.fetchFile(`${item.uploadUrl}/${encodeURIComponent(payload.id)}`, { method: "DELETE" }).catch(() => undefined);
            return "done";
          }
          update(item.id, {
            status: "ready",
            serverId: payload.id,
            ...(payload.mediaType && { mediaType: payload.mediaType }),
            ...(payload.textTokens !== undefined && { textTokens: payload.textTokens }),
          });
          return "done";
        }
        if (payload?.error?.kind === "busy") return "busy";
        const kind = errorKinds.find((known) => known === payload?.error?.kind) ?? "other";
        update(item.id, { status: "error", errorKind: kind });
      } catch {
        if (!item.abort.signal.aborted) update(item.id, { status: "error", errorKind: "other" });
      }
      return "done";
    },
    [send, update],
  );

  const uploadWithRetries = useCallback(
    async (item: FieldItem, file: File) => {
      for (let attempt = 1; !item.abort.signal.aborted; attempt++) {
        if ((await uploadOnce(item, file)) === "done") return;
        if (attempt > busyRetries) {
          update(item.id, { status: "error", errorKind: "busy" });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, latest.current.busyRetryDelayMs * attempt));
      }
    },
    [update, uploadOnce],
  );

  const upload = useCallback(
    (job: () => Promise<void>) => {
      const queue = uploadQueue;
      const next = () => {
        while (queue.running < parallelUploads && queue.waiting.length > 0) {
          const job = queue.waiting.shift()!;
          queue.running++;
          void job().finally(() => {
            queue.running--;
            next();
          });
        }
      };
      queue.waiting.push(job);
      next();
    },
    [uploadQueue],
  );

  const onAddFiles = useCallback(
    (files: File[]) => {
      if (currentScope.current !== scope) return;
      const { labels: text } = latest.current;
      const { maxFiles, maxFileBytes } = settingsRef.current;
      let notice: string | undefined;
      const added: Array<{ item: FieldItem; file: File }> = [];
      for (const file of files) {
        // Файлы с ошибкой не занимают места: на сервере их нет, а убрать их человек может и потом.
        if (itemsRef.current.filter((item) => item.status !== "error").length + added.length >= maxFiles) {
          notice = text.tooManyFiles(maxFiles);
          break;
        }
        if (file.size > maxFileBytes) {
          notice = text.fileTooLarge(file.name, maxFileBytes);
          continue;
        }
        const isImage = file.type.startsWith("image/");
        const refused = !fitsAcceptedTypes(file, settingsRef.current);
        added.push({
          file,
          item: {
            id: crypto.randomUUID(),
            name: file.name,
            fileName: file.name,
            uploadUrl: `${api}/${encodeURIComponent(chatId)}/attachments`,
            fetchFile: latest.current.fetchImpl ?? globalThis.fetch,
            size: file.size,
            kind: isImage ? "image" : "file",
            status: refused ? "error" : "uploading",
            ...(refused && { errorKind: "unsupported_type" as const }),
            abort: new AbortController(),
            ...(isImage && (() => { const previewUrl = URL.createObjectURL(file); return { previewUrl, ownedPreview: previewUrl }; })()),
          },
        });
      }
      setProblem(notice);
      if (added.length === 0) return;
      commit([...itemsRef.current, ...added.map(({ item }) => item)]);
      for (const { item, file } of added) if (item.status === "uploading") upload(() => item.abort.signal.aborted ? Promise.resolve() : uploadWithRetries(item, file));
    },
    [api, chatId, scope, commit, upload, uploadWithRetries],
  );

  const addServerFiles = useCallback((drafts: ServerFileDraft[]) => {
    if (currentScope.current !== scope) return;
    const added: Array<{ item: FieldItem; draft: ServerFileDraft }> = [];
    let notice: string | undefined;
    for (const draft of drafts) {
      if (itemsRef.current.filter((item) => item.status !== "error").length + added.length >= settingsRef.current.maxFiles) {
        notice = latest.current.labels.tooManyFiles(settingsRef.current.maxFiles);
        break;
      }
      const item: FieldItem = {
        id: crypto.randomUUID(), name: draft.name, fileName: draft.name, size: 0,
        kind: "image", status: "uploading", abort: new AbortController(),
        uploadUrl: `${api}/${encodeURIComponent(chatId)}/attachments`,
        fetchFile: latest.current.fetchImpl ?? globalThis.fetch,
        ...(draft.previewUrl && { previewUrl: draft.previewUrl }),
      };
      added.push({ item, draft });
    }
    setProblem(notice);
    if (!added.length) return;
    commit([...itemsRef.current, ...added.map(({ item }) => item)]);
    for (const { item, draft } of added) upload(async () => {
      if (item.abort.signal.aborted) return;
      try {
        const result = await draft.ingest(item.abort.signal);
        const retired = item.abort.signal.aborted || currentScope.current !== scope || !itemsRef.current.some((candidate) => candidate.id === item.id);
        if (retired) {
          if (result.ok) void item.fetchFile(`${item.uploadUrl}/${encodeURIComponent(result.attachment.id)}`, { method: "DELETE" }).catch(() => undefined);
          return;
        }
        if (!result.ok) {
          update(item.id, { status: "error", errorKind: errorKinds.find((kind) => kind === result.reason) ?? "other" });
          return;
        }
        const file = result.attachment;
        // The ingest endpoint is authoritative; keep client-side limits and notices consistent with ordinary uploads.
        if (file.size > settingsRef.current.maxFileBytes) {
          update(item.id, { status: "error", errorKind: "too_large", serverId: file.id });
          return;
        }
        const refused = !fitsAcceptedTypes({ name: file.name, type: file.mediaType } as File, settingsRef.current);
        update(item.id, {
          status: refused ? "error" : "ready", ...(refused && { errorKind: "unsupported_type" }),
          serverId: file.id, name: file.name, fileName: file.name, size: file.size,
          mediaType: file.mediaType, textTokens: file.textTokens,
          kind: file.kind === "image" ? "image" : "file",
        });
      } catch {
        if (!item.abort.signal.aborted && currentScope.current === scope) update(item.id, { status: "error", errorKind: "other" });
      }
    });
  }, [api, chatId, scope, commit, update, upload]);

  const onRemove = useCallback(
    (id: string) => {
      const item = itemsRef.current.find((candidate) => candidate.id === id);
      if (!item) return;
      item.abort.abort();
      if (item.ownedPreview) URL.revokeObjectURL(item.ownedPreview);
      commit(itemsRef.current.filter((candidate) => candidate.id !== id));
      setProblem(undefined);
      // Уже загруженный файл, который не отправили, сервер убирает сразу; сбой не страшен — брошенное он чистит сам.
      if (item.serverId) {
        void item.fetchFile(`${item.uploadUrl}/${encodeURIComponent(item.serverId)}`, { method: "DELETE" }).catch(() => undefined);
      }
    },
    [commit, send],
  );

  const readFiles = useCallback(
    () =>
      itemsRef.current.flatMap((item) =>
        item.status === "ready" && item.serverId
          ? [{ type: "file" as const, url: `attachment:${item.serverId}`, mediaType: item.mediaType ?? "application/octet-stream", filename: item.fileName }]
          : [],
      ),
    [],
  );

  const markSent = useCallback(() => {
    for (const item of sentRef.current) if (item.ownedPreview) URL.revokeObjectURL(item.ownedPreview);
    sentRef.current = itemsRef.current;
    commit([]);
    setProblem(undefined);
  }, [commit]);

  const restoreFiles = useCallback(
    (kind: string | undefined) => {
      const restored = sentRef.current;
      if (restored.length === 0) return;
      sentRef.current = [];
      const gone = kind !== undefined && goneKinds.has(kind);
      commit([
        ...restored.map((item) => (gone ? { ...item, status: "error" as const, errorKind: "expired" as const } : item)),
        ...itemsRef.current,
      ]);
      setProblem(gone ? undefined : latest.current.labels.sendRejected);
    },
    [commit],
  );

  const describe = useMemo(
    () => (message: { parts: ReadonlyArray<{ type: string; [key: string]: unknown }> }) => {
      const files = message.parts.flatMap((part) => {
        if (part.type !== "file" || typeof part.url !== "string" || !part.url.startsWith("attachment:")) return [];
        const id = part.url.slice("attachment:".length);
        const mediaType = typeof part.mediaType === "string" ? part.mediaType : "application/octet-stream";
        return [
          {
            id,
            partUrl: part.url,
            name: typeof part.filename === "string" ? part.filename : labels.unnamedFile,
            kind: mediaType.startsWith("image/") ? ("image" as const) : ("file" as const),
            url: `${api}/${encodeURIComponent(chatId)}/attachments/${id}`,
            mediaType,
            ...(mediaType === "application/pdf" && { caption: "PDF" }),
          },
        ];
      });
      return files.length > 0 ? { label: labels.messageAttachments, items: files } : undefined;
    },
    [api, chatId, labels],
  );

  const failed = items.find((item) => item.status === "error");
  const totalTextTokens = items.reduce((sum, item) => sum + (item.textTokens ?? 0), 0);
  const tooMuchText = totalTextTokens > settings.maxMessageTextTokens;
  const modelBlind = modelSeesImages === false && !settings.imagesForBlindModels && items.some((item) => item.kind === "image");
  const notice =
    (failed && labels.fileProblem(failed.fileName, labels.errors[failed.errorKind ?? "other"])) ||
    problem ||
    (tooMuchText ? labels.tooMuchText : undefined) ||
    (modelBlind ? labels.modelBlind : undefined);

  return {
    addServerFiles,
    composer: {
      items: items.map(({ id, name, kind, previewUrl, status }) => ({ id, name, kind, status, ...(previewUrl && { previewUrl }) })),
      onAddFiles,
      onRemove,
      accept: settings.accept,
      ...(notice && { notice }),
    },
    ready: items.every((item) => item.status === "ready") && !tooMuchText,
    hasFiles: items.length > 0,
    readFiles,
    markSent,
    restoreFiles,
    describe: describe as AttachmentsController["describe"],
  };
}

/** Плагин для `AgentChat`: `attachments={attachmentsClient}`. */
export function createAttachmentsClient(labels: AttachmentsLabels = russianAttachmentsLabels): AttachmentsPlugin {
  return { useController: (input) => useAttachmentsController(input, labels) };
}

export const attachmentsClient: AttachmentsPlugin = createAttachmentsClient();
