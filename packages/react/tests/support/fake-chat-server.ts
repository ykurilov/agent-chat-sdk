import { vi } from "vitest";

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}

/** Куда идёт запрос: история, отправка, повтор, переделка, правка, подключение к идущему ответу, стоп, список моделей, смена модели, записи сжатия, развилки, переключение ветки и ответ на подтверждение. */
export type Endpoint =
  | "history"
  | "messages"
  | "retry"
  | "regenerate"
  | "edit"
  | "stream"
  | "stop"
  | "models"
  | "model"
  | "compactions"
  | "branches"
  | "branch"
  | "approval"
  | "widget"
  | "spending"
  | "browserCall"
  | "watch"
  | "tasks"
  | "taskCancel"
  | "taskApproval"
  | "steer";

/** Развилка текущей ветки, как её отдаёт сервер. */
export interface ForkRecord {
  messageId: string;
  siblingIds: string[];
}

/** Запись сжатия, как её отдаёт сервер. */
export interface CompactionRecord {
  id: string;
  fromMessageId: string;
  throughMessageId: string;
  summary: string;
  summaryTokens: number;
  createdAt: string;
}

/** Список для меню, как его отдаёт сервер: DeepSeek с уровнями «Выкл/Вкл» и GLM без «Выкл». */
export const defaultModelMenu = {
  providers: [
    {
      id: "deepseek",
      displayName: "DeepSeek",
      models: [{ id: "deepseek-4.1-flash", displayName: "DeepSeek 4.1 Flash", reasoning: { levels: ["off", "on"], defaultLevel: "on" } }],
    },
    {
      id: "fireworks",
      displayName: "Fireworks",
      models: [
        { id: "deepseek-4.1-flash", displayName: "DeepSeek 4.1 Flash", reasoning: { levels: ["off", "on"], defaultLevel: "on" } },
        { id: "glm-5.3-flash", displayName: "GLM 5.3 Flash", reasoning: { levels: ["low", "medium", "high"], defaultLevel: "medium" } },
      ],
    },
  ],
  defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "on" },
};

const HEARTBEAT_HEADER = "x-agent-chat-heartbeat-ms";

/**
 * SSE-поток UI-кусков: `push` добавляет кусок, `end` закрывает поток, `ping` шлёт признак жизни,
 * `finish` дописывает начатый ответ до конца, `answer` отдаёт целый ответ с начала хода.
 * `heartbeatMs` — как у настоящего сервера: заголовок и первый пинг сразу. Отмена запроса
 * (`signal`) обрывает тело так же, как настоящий `fetch`.
 */
export function sseStream(options: { heartbeatMs?: number; signal?: AbortSignal | null } = {}) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      closed = true;
    },
  });
  const heartbeatMs = options.heartbeatMs ?? 0;
  if (heartbeatMs > 0) controller.enqueue(encoder.encode(": ping\n\n"));
  options.signal?.addEventListener("abort", () => {
    if (closed) return;
    closed = true;
    controller.error(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
  });
  const write = (text: string) => {
    if (!closed) controller.enqueue(encoder.encode(text));
  };
  const push = (chunk: Record<string, unknown>) => write(`data: ${JSON.stringify(chunk)}\n\n`);
  const end = () => {
    if (closed) return;
    write("data: [DONE]\n\n");
    closed = true;
    controller.close();
  };
  /** Итог начатого ответа: конец текста `textId`, статус «готов», конец потока. */
  const finish = (textId = "t") => {
    push({ type: "text-end", id: textId });
    push({ type: "message-metadata", messageMetadata: { status: "complete" } });
    push({ type: "finish" });
    end();
  };
  return {
    response: () =>
      new Response(body, {
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
          ...(heartbeatMs > 0 && { [HEARTBEAT_HEADER]: String(heartbeatMs) }),
        },
      }),
    push,
    /** Признак жизни сервера: SSE-комментарий, SDK его не видит. */
    ping: () => write(": ping\n\n"),
    end,
    finish,
    answer: (text: string, messageId = "a1") => {
      push({ type: "start", messageId });
      push({ type: "text-start", id: "t" });
      push({ type: "text-delta", id: "t", delta: text });
      finish();
    },
    /** Обрыв соединения посреди потока — как при падении сервера. */
    break: () => {
      if (closed) return;
      closed = true;
      controller.error(new TypeError("network error"));
    },
  };
}

/**
 * Подменённый `fetch` сервера чата: история, отправка, повтор, подключение к идущему ответу и стоп.
 * `state` меняется по ходу теста:
 * - `down` — сервер не отвечает (`fetch` бросает `TypeError`), `notFound` — чат чужой или его нет;
 * - `history` и `running` — что отдаёт `GET`; `detachedAnswer` — ответ в истории идёт, а потока у сервера нет;
 * - `hang` — запросы к этим адресам не отвечают, пока их не отменят; `gate` — отвечают, когда промис адреса выполнится;
 * - `fail` — эти адреса отвечают 500; `drop` — связь с этими адресами рвётся (`fetch` бросает `TypeError`);
 * - `refuse` — эти адреса отвечают отказом с нужным кодом и видом ошибки (например, 409 «busy» на правку во время ответа);
 *   `body` — своё тело отказа вместо `{ error: { kind } }` (например, `{ error: "Разговор завершён" }` обёртки приложения);
 * - `compactions` и `compacting` — записи сжатия и признак «идёт», их несут история и `GET …/compactions`;
 * - `approval` и `widget` — что отвечают `POST …/approvals/:id` и `POST …/widgets/:toolCallId`: по умолчанию 200 `{ resumed: true }`;
 * - `forks` — развилки текущей ветки: их несут история и `GET …/branches`; `branchTo[messageId]` — что станет
 *   историей после `POST …/branch` с этим сообщением (сообщения и развилки);
 * - `capabilities` — права в истории; `closed` — закрытие в `chat` истории; `modelAcceptsImages` — видит ли модель чата картинки;
 * - `menu` — что отдаёт `GET …/models`; `chatChoice` — выбор, который история несёт в `chat`.
 *   `PUT …/model` записывает выбор в `chatChoice` и отвечает им.
 * `heartbeatMs > 0` — потоки несут заголовок и пинги, как у сервера 002.
 */
export function fakeChatServer(
  options: { history?: HistoryMessage[]; running?: boolean; resumable?: boolean; heartbeatMs?: number } = {},
) {
  const state = {
    down: false,
    notFound: false,
    history: options.history ?? [],
    compactions: [] as CompactionRecord[],
    compacting: false,
    forks: [] as ForkRecord[],
    branchTo: {} as Record<string, { messages: HistoryMessage[]; forks: ForkRecord[] }>,
    running: options.running ?? false,
    detachedAnswer: false,
    hang: new Set<Endpoint>(),
    gate: {} as Partial<Record<Endpoint, Promise<void>>>,
    fail: new Set<Endpoint>(),
    drop: new Set<Endpoint>(),
    approval: { status: 200, body: { resumed: true } as unknown },
    /** Что отвечает `POST …/widgets/:toolCallId`: по умолчанию 200 `{ resumed: true }`, как ответ на подтверждение. */
    widget: { status: 200, body: { resumed: true } } as { status: number; body: unknown; beforeReply?: () => void },
    /** Что отвечает `POST …/browser-tools/:toolCallId`: по умолчанию 204; `kind` — вид ошибки в теле отказа. */
    browserCall: { status: 204, kind: undefined as string | undefined },
    /** Что отдаёт `GET …/spending`; `null` — у сервера лимитов нет (404). */
    spending: null as null | Record<string, unknown>,
    /** Тело отказа 429 на отправку, повтор, переделку и правку: лимит исчерпан. */
    refuseSpending: null as null | Record<string, unknown>,
    refuse: {} as Partial<Record<Endpoint, { status: number; kind: string; html?: string; body?: unknown }>>,
    menu: defaultModelMenu as unknown,
    chatChoice: undefined as { modelId: string; providerId: string; reasoning?: string } | undefined,
    /** Есть ли у сервера `GET …/watch`; нет — 404, как у сервера до версии 027. */
    watch: false,
    /** Что отдаёт `GET …/tasks`; `null` — фон не подключён (404). */
    tasks: null as null | Array<Record<string, unknown>>,
    /** Что отвечают `POST …/tasks/:id/cancel` и `…/approval`. */
    taskCancel: { status: 200, body: { ok: true } as unknown },
    taskApproval: { status: 200, body: { ok: true } as unknown },
    /** Что отвечает `POST …/steer`: по умолчанию 202 `{ status: "queued" }` с id присланного сообщения. */
    steer: { status: 202, result: "queued" as "queued" | "started" },
    /** Поправки, ждущие ответ, в истории (`pendingMessages`); пусто — поля нет. */
    pendingMessages: [] as HistoryMessage[],
    /** Заявка сервера на фоновые задачи в истории (`backgroundTasks`); `undefined` — сервер до этой заявки, поля нет. */
    backgroundTasks: undefined as undefined | boolean,
    /** Права, которые несёт история; `undefined` — сервер до 0.27, прав в истории нет. */
    capabilities: undefined as undefined | Record<string, boolean>,
    /** Закрытие чата в истории (`chat.closed`); `undefined` — чат открыт. */
    closed: undefined as undefined | { code: string; message: string },
    /** Видит ли модель картинки — история несёт это при скрытой модели (`modelDetails: false`); `undefined` — поля нет. */
    modelAcceptsImages: undefined as undefined | boolean,
    /** В чате чужой текст (`externalContent: true` в истории): живые демонстрации не запускаются. */
    externalContent: false,
  };
  const streamOptions = (signal?: AbortSignal | null) => ({
    ...(options.heartbeatMs !== undefined && { heartbeatMs: options.heartbeatMs }),
    signal,
  });
  /** Потоки, отданные на `POST …/messages`, `…/retry`, `…/regenerate`, `…/edit` и `GET …/stream`. */
  const opened: Record<"messages" | "retry" | "regenerate" | "edit" | "stream", Array<ReturnType<typeof sseStream>>> = {
    messages: [],
    retry: [],
    regenerate: [],
    edit: [],
    stream: [],
  };
  /** Потоки событий чата, отданные на `GET …/watch`. */
  const watches: Array<ReturnType<typeof sseStream> & { signal: AbortSignal | null | undefined }> = [];
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    requests.push({ method, url, body });
    if (state.down) throw new TypeError("Failed to fetch");
    const endpoint = endpointOf(method, url);
    if (state.drop.has(endpoint)) throw new TypeError("Failed to fetch");
    if (state.hang.has(endpoint)) {
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(init?.signal?.reason ?? new DOMException("Aborted", "AbortError"));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort);
      });
    }
    if (state.gate[endpoint]) {
      await state.gate[endpoint];
      init?.signal?.throwIfAborted();
    }
    if (state.fail.has(endpoint)) return Response.json({ error: { kind: "other" } }, { status: 500 });
    const refusal = state.refuse[endpoint];
    if (refusal?.html !== undefined) return new Response(refusal.html, { status: refusal.status, headers: { "content-type": "text/html" } });
    if (refusal?.body !== undefined) return Response.json(refusal.body, { status: refusal.status });
    if (refusal) return Response.json({ error: { kind: refusal.kind } }, { status: refusal.status });
    if (state.notFound) return Response.json({ error: { kind: "not_found" } }, { status: 404 });
    if (endpoint === "history") {
      return Response.json({
        chat: { id: "c1", ...state.chatChoice, ...(state.closed && { closed: state.closed }) },
        messages: state.history,
        running: state.running,
        detachedAnswer: state.detachedAnswer,
        compactions: state.compactions,
        compacting: state.compacting,
        forks: state.forks,
        ...(state.pendingMessages.length > 0 && { pendingMessages: state.pendingMessages }),
        ...(state.capabilities && { capabilities: state.capabilities }),
        ...(state.backgroundTasks !== undefined && { backgroundTasks: state.backgroundTasks }),
        ...(state.modelAcceptsImages !== undefined && { modelAcceptsImages: state.modelAcceptsImages }),
        ...(state.externalContent && { externalContent: true }),
      });
    }
    if (endpoint === "watch") {
      if (!state.watch) return Response.json({ error: { kind: "not_found" } }, { status: 404 });
      const stream = sseStream({ signal: init?.signal });
      watches.push({ ...stream, signal: init?.signal });
      return stream.response();
    }
    if (endpoint === "tasks") {
      return state.tasks ? Response.json(state.tasks) : Response.json({ error: { kind: "not_found" } }, { status: 404 });
    }
    if (endpoint === "taskCancel") return Response.json(state.taskCancel.body, { status: state.taskCancel.status });
    if (endpoint === "taskApproval") return Response.json(state.taskApproval.body, { status: state.taskApproval.status });
    if (endpoint === "spending") {
      return state.spending ? Response.json(state.spending) : Response.json({ error: { kind: "not_found" } }, { status: 404 });
    }
    if (state.refuseSpending && (endpoint === "messages" || endpoint === "retry" || endpoint === "regenerate" || endpoint === "edit")) {
      return Response.json({ error: { kind: "spending_limit_reached", ...state.refuseSpending } }, { status: 429 });
    }
    if (endpoint === "branches") return Response.json({ forks: state.forks });
    if (endpoint === "branch") {
      const target = state.branchTo[(body as { messageId: string }).messageId];
      if (!target) return Response.json({ error: { kind: "invalid" } }, { status: 400 });
      state.history = target.messages;
      state.forks = target.forks;
      return Response.json({
        chat: { id: "c1", ...state.chatChoice },
        messages: state.history,
        running: false,
        compactions: state.compactions,
        compacting: false,
        forks: state.forks,
      });
    }
    if (endpoint === "compactions") return Response.json({ compactions: state.compactions, compacting: state.compacting });
    if (endpoint === "models") return Response.json(state.menu);
    if (endpoint === "model") {
      state.chatChoice = body as typeof state.chatChoice;
      return Response.json(state.chatChoice);
    }
    if (endpoint === "stop") return new Response(null, { status: 202 });
    if (endpoint === "steer") {
      const messageId = (body as { message?: { id?: string } } | undefined)?.message?.id;
      return Response.json({ status: state.steer.result, messageId }, { status: state.steer.status });
    }
    if (endpoint === "approval") return Response.json(state.approval.body, { status: state.approval.status });
    if (endpoint === "widget") {
      state.widget.beforeReply?.();
      return Response.json(state.widget.body, { status: state.widget.status });
    }
    if (endpoint === "browserCall") {
      const { status, kind } = state.browserCall;
      return status === 204 ? new Response(null, { status }) : Response.json({ error: { kind: kind ?? "other" } }, { status });
    }
    if (endpoint === "stream" && !options.resumable) return new Response(null, { status: 204 });
    const stream = sseStream(streamOptions(init?.signal));
    opened[endpoint].push(stream);
    return stream.response();
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
    /** Запросы к одному адресу, в порядке прихода. */
    requestsTo: (endpoint: Endpoint) => requests.filter((request) => endpointOf(request.method, request.url) === endpoint),
    streams: opened.messages,
    retries: opened.retry,
    regenerations: opened.regenerate,
    edits: opened.edit,
    resumed: opened.stream,
    watches,
    /** Шлёт событие в последний открытый поток событий чата. */
    emit: (event: Record<string, unknown>) => watches.at(-1)!.push(event),
    state,
  };
}

function endpointOf(method: string, url: string): Endpoint {
  if (method === "PUT") return "model";
  if (/\/tasks\/[^/]+\/cancel$/.test(url)) return "taskCancel";
  if (/\/tasks\/[^/]+\/approval$/.test(url)) return "taskApproval";
  if (method === "GET") {
    if (url.endsWith("/stream")) return "stream";
    if (url.endsWith("/watch")) return "watch";
    if (url.endsWith("/tasks")) return "tasks";
    if (url.endsWith("/compactions")) return "compactions";
    if (url.endsWith("/branches")) return "branches";
    if (url.endsWith("/spending")) return "spending";
    return url.endsWith("/models") ? "models" : "history";
  }
  if (url.includes("/approvals/")) return "approval";
  if (url.includes("/widgets/")) return "widget";
  if (url.includes("/browser-tools/")) return "browserCall";
  if (url.endsWith("/messages")) return "messages";
  if (url.endsWith("/retry")) return "retry";
  if (url.endsWith("/regenerate")) return "regenerate";
  if (url.endsWith("/edit")) return "edit";
  if (url.endsWith("/branch")) return "branch";
  if (url.endsWith("/steer")) return "steer";
  return "stop";
}
