import { randomUUID } from "node:crypto";
import { ActionForbiddenError, ChatBusyError, ChatNotFoundError, DuplicateMessageError, InvalidMessageError, InvalidModelChoiceError, NothingToRetryError, accessRefusedResponse, allowedUser, getTransientChatHistory, createChatService, createRequestOriginCheck, createTransientChatStorage, CURRENT_FORMAT_VERSION, loadCurrentBranch, type BrowserChatSnapshot, type ChatService, type AgentToolsSource, type ModelChoice, type TransientChatStorage } from "@ykurilov/agent-chat-core";
import type { ToolSet, UIMessageChunk } from "ai";
import { createBrowserChatCodec } from "./codec";
import { identifier, readBrowserRequest } from "./input";
import type { BrowserChatHandler, BrowserChatHandlerOptions, BrowserChatOperation, BrowserChatUsage } from "./types";
export type * from "./types";

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const errorResponse = (status: number, kind = "other") => Response.json({ error: { kind } }, { status, headers });
const abortable = <T>(value: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const abort = () => reject(new DOMException("Aborted", "AbortError"));
  if (signal.aborted) { value.catch(() => {}); abort(); return; }
  signal.addEventListener("abort", abort, { once: true });
  value.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort)).catch(() => {});
});
/**
 * Сколько байт снимка в секунду поток может себе позволить: следующий снимок ждёт, пока прошлый «уйдёт» на такой скорости.
 * Короткий чат получает снимок каждые `checkpointIntervalMs`, длинный — реже: 1 МБ снимка — раз в 2 с.
 */
const SNAPSHOT_BYTES_PER_SECOND = 512 * 1024;
/** Пауза перед новой попыткой снимка, пока браузер не дочитал прежние записи. */
const DRAIN_WAIT_MS = 50;
const bounded = (value: number | undefined, fallback: number, min: number, max: number): number => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new TypeError("Invalid browser chat resource limit");
  return result;
};

/** An isolated service/storage per operation. No ordinary ChatStorage can be supplied. */
export function createBrowserChatHandler(options: BrowserChatHandlerOptions): BrowserChatHandler {
  const maxRequest = bounded(options.maxRequestBytes, 8 * 1024 * 1024, 4096, 64 * 1024 * 1024);
  const maxSnapshot = bounded(options.maxSnapshotBytes, 32 * 1024 * 1024, 4096, 128 * 1024 * 1024);
  const maxTurn = bounded(options.maxTurnMs, 180_000, 100, 900_000);
  const interval = bounded(options.checkpointIntervalMs, 100, 10, 1000);
  const concurrency = bounded(options.maxConcurrentTurnsPerUser, 3, 1, 20);
  const codec = createBrowserChatCodec(options.snapshotKey, options.namespace, maxSnapshot);
  const allowsOrigin = createRequestOriginCheck({ allowedOrigins: options.allowedOrigins });
  const active = new Set<{ abort: () => void; done: Promise<void> }>();
  const owners = new Map<string, number>(); let closing = false;
  const report = (code: Parameters<NonNullable<BrowserChatHandlerOptions["onError"]>>[0]) => { try { options.onError?.(code); } catch {} };
  return {
    get activeRequests() { return active.size; },
    async close() { closing = true; for (const item of active) item.abort(); await Promise.allSettled([...active].map(item => item.done)); },
    async fetch(request) {
      if (closing) return errorResponse(503);
      if (request.method !== "POST") return errorResponse(405, "invalid");
      if (!allowsOrigin(request)) return errorResponse(403, "forbidden_origin");
      const control = new AbortController(); let service: ChatService | undefined, reader: ReadableStreamDefaultReader<UIMessageChunk> | undefined;
      let ownerId: string | undefined, counted = false, handedOff = false;
      let disposal: Promise<void> | undefined;
      let stopping: Promise<void> | undefined;
      const stopService = () => { if (service) stopping ??= service.flush().catch(() => {}); return stopping; };
      let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
      const abort = () => { control.abort(); void stopService(); };
      const entry = { abort, done }; active.add(entry);
      const timer = setTimeout(abort, maxTurn); request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      const dispose = (): Promise<void> => disposal ??= (async () => {
        control.abort(); clearTimeout(timer); request.signal.removeEventListener("abort", abort);
        try { await reader?.cancel().catch(() => {}); await stopService(); }
        finally { if (counted && ownerId) { const next = (owners.get(ownerId) ?? 1) - 1; if (next) owners.set(ownerId, next); else owners.delete(ownerId); } active.delete(entry); finish(); }
      })();
      let stage: Parameters<typeof report>[0] = "configuration";
      try {
        const resolved = await abortable(options.resolveUser(request), control.signal);
        const refusal = accessRefusedResponse(resolved, headers); if (refusal) return refusal;
        const user = allowedUser(resolved); if (!user) return errorResponse(401, "invalid"); ownerId = user.id;
        const input = await readBrowserRequest(request, maxRequest, control.signal);
        if (input.operation.type === "models" && input.snapshot !== null) return errorResponse(400, "invalid");
        const settings = await abortable(Promise.resolve(options.configure(ownerId)), control.signal);
        for (const key of ["helpers", "browserTools", "widgets", "voices"]) if (key in settings.agent) throw new TypeError("Unsupported browser chat agent extension");
        const turn = !["bootstrap", "models", "selectBranch"].includes(input.operation.type);
        if (turn) {
          if ((owners.get(ownerId) ?? 0) >= concurrency) return errorResponse(429, "too_many_turns");
          owners.set(ownerId, (owners.get(ownerId) ?? 0) + 1); counted = true;
          try { await abortable(settings.assertWithinLimit?.(ownerId, control.signal) ?? Promise.resolve(), control.signal); }
          catch { report("limit"); return errorResponse(429, "spending_limit_reached"); }
        }
        stage = "snapshot";
        const payload = input.snapshot === null ? null : codec.decode(input.snapshot, ownerId, input.chatId);
        const storage = createTransientChatStorage(payload?.storage);
        const insertUsage = storage.insertUsageRecord.bind(storage);
        /** Расход, который `onUsage` ещё не принял: уходит в снимок и повторяется следующим запросом. */
        const unbilled: BrowserChatUsage[] = [...(payload?.unbilled ?? [])];
        const bill = async (usage: BrowserChatUsage) => {
          if (!settings.onUsage) return;
          // Billing contains numbers only and must include Stop, even after the HTTP signal was cancelled.
          const billing = new AbortController();
          const deadline = setTimeout(() => billing.abort(), 5000);
          try { await abortable(settings.onUsage(usage, billing.signal), billing.signal); }
          finally { clearTimeout(deadline); }
        };
        let liveUsage = false;
        storage.insertUsageRecord = async record => {
          if (await storage.hasUsageRecord?.(record.id)) return;
          // Recovery reconstructs historical journal entries, not newly consumed provider calls: «Стоп» уже учёл их,
          // а снимок в браузере мог остаться прежним.
          if (!liveUsage) { await insertUsage(record); return; }
          const { chatId: _chat, messageId: _message, ...usage } = record;
          // Сначала запись, потом учёт: отказ `onUsage` не теряет расход — он уходит в снимок и повторяется следующим запросом.
          await insertUsage(record);
          try { await bill(usage); }
          catch { report("usage"); unbilled.push(usage); }
        };
        // Delayed provider usage reconciliation retains storage for minutes in ordinary chats.
        // This endpoint must release conversation memory at the end of the request.
        const catalog = { ...settings.catalog, providers: settings.catalog.providers.map(({ generationUsage: _later, ...provider }) => provider) };
        service = createChatService({ storage, catalog, agent: { ...settings.agent, tools: checkedTools(settings.agent.tools), cacheMissLog: false },
          ...(settings.defaultChoice && { defaultChoice: settings.defaultChoice }), ...(settings.env && { env: settings.env }),
          ...(settings.compaction !== undefined && { compaction: settings.compaction }), logError: () => {},
          chatCapabilities: () => ({ ...settings.capabilities, attachments: false, voice: false, steer: false, chatList: false, compact: false, answerEditing: false, errorDetails: false, appNotices: false }),
        });
        const current = service;
        if (input.operation.type === "models") {
          if (input.snapshot !== null) return errorResponse(400, "invalid");
          const menu = await abortable(current.getModelMenu(ownerId), control.signal);
          return Response.json({ type: "models", data: menu }, { headers });
        }
        const internalId = payload?.internalChatId ?? (await current.createChat(ownerId)).id;
        // Прошлые сбои учёта: повтор по порядку, до первого нового отказа.
        while (unbilled.length) {
          try { await bill(unbilled[0]!); unbilled.shift(); }
          catch { report("usage"); break; }
        }
        await current.recoverInterruptedAnswers({ soleServer: true });
        liveUsage = true;
        if (control.signal.aborted) throw new DOMException("Aborted", "AbortError");
        /** Размер последнего снимка в байтах: по нему поток решает, когда слать следующий. */
        let snapshotBytes = 0;
        const snapshot = async (): Promise<{ snapshot: BrowserChatSnapshot; acknowledged: string[] }> => {
          const history = await getTransientChatHistory(current, ownerId!, internalId);
          const state = storage.exportSnapshot();
          const value = codec.encode(ownerId!, input.chatId, { version: 1, internalChatId: internalId, storage: state, ...(unbilled.length && { unbilled: [...unbilled] }) }, history);
          snapshotBytes = JSON.stringify(value).length;
          // Снимок браузер пришлёт обратно следующим запросом: больше предела запроса — следующий запрос не примут.
          if (snapshotBytes > maxRequest - 1024) throw new RangeError("browser chat snapshot request limit");
          const pendingIds = new Set(input.snapshot?.pending?.map(row => row.id) ?? []);
          return { snapshot: value, acknowledged: state.messages.filter(row => row.role === "user" && pendingIds.has(row.id)).map(row => row.id) };
        };
        stage = "turn";
        if (input.snapshot?.choice) await current.setModel(ownerId, internalId, checkedChoice(input.snapshot.choice));
        await recoverPending(storage, internalId, input.snapshot, input.operation);
        let stream: ReadableStream<UIMessageChunk> | undefined;
        switch (input.operation.type) {
          case "bootstrap": break;
          case "message": stream = await current.sendMessage(ownerId, internalId, input.operation.message); break;
          case "retry": stream = await current.retry(ownerId, internalId); break;
          case "regenerate": stream = await current.regenerate(ownerId, internalId, input.operation.messageId); break;
          case "edit": stream = await current.editMessage(ownerId, internalId, input.operation.messageId, input.operation.message); break;
          case "selectBranch": await current.selectBranch(ownerId, internalId, input.operation.messageId); break;
        }
        if (!stream) return Response.json({ type: "result", ...await snapshot() }, { headers });
        reader = stream.getReader(); handedOff = true;
        const encoder = new TextEncoder();
        const queueLimit = maxRequest * 2;
        const body = new ReadableStream<Uint8Array>({
          async start(out) {
            const emit = (value: unknown) => {
              if (control.signal.aborted) return;
              out.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
            };
            /** Браузер дочитал всё отправленное: только тогда идёт промежуточный снимок или пинг. */
            const drained = () => (out.desiredSize ?? 0) >= queueLimit;
            let pending: Promise<ReadableStreamReadResult<UIMessageChunk>> | undefined;
            try {
              emit({ type: "ready", ...await snapshot() });
              // Части показываются только вместе со снимком, где они уже есть. Медленная связь или длинный чат — снимки
              // реже: части копятся и уходят следующим снимком, ход не обрывается.
              let chunks: UIMessageChunk[] = [], ended = false, checkpointAt = Date.now();
              let gap = Math.max(interval, snapshotBytes * 1000 / SNAPSHOT_BYTES_PER_SECOND);
              while (!ended && !control.signal.aborted) {
                pending ??= reader!.read();
                let tick!: ReturnType<typeof setTimeout>;
                const wait = chunks.length ? Math.max(drained() ? 1 : DRAIN_WAIT_MS, checkpointAt + gap - Date.now()) : 1000;
                const next = await Promise.race([pending, new Promise<null>(resolve => { tick = setTimeout(() => resolve(null), wait); })]);
                clearTimeout(tick);
                if (next !== null) { pending = undefined; if (next.done) ended = true; else chunks.push(next.value); }
                if (ended) break;
                if (chunks.length && Date.now() - checkpointAt >= gap && drained()) {
                  emit({ type: "data", chunks, ...await snapshot() }); chunks = []; checkpointAt = Date.now();
                  gap = Math.max(interval, snapshotBytes * 1000 / SNAPSHOT_BYTES_PER_SECOND);
                } else if (next === null && !chunks.length && drained()) emit({ type: "ping" });
              }
              if (chunks.length && !control.signal.aborted) emit({ type: "data", chunks, ...await snapshot() });
              if (control.signal.aborted) throw new DOMException("Aborted", "AbortError");
              await current.flush({ waitForAnswersMs: 5000 });
              emit({ type: "end", ...await snapshot() }); await dispose(); out.close();
            } catch { report("turn"); await dispose(); try { out.error(new Error("Browser chat interrupted")); } catch {} }
            finally { pending?.catch(() => {}); await dispose(); }
          },
          async cancel() { await dispose(); },
        }, { highWaterMark: queueLimit, size: chunk => chunk.byteLength });
        return new Response(body, { headers: { ...headers, "content-type": "application/x-ndjson", "x-accel-buffering": "no" } });
      } catch (error) {
        report(stage);
        if (error instanceof ActionForbiddenError) return errorResponse(403, "action_forbidden");
        if (error instanceof ChatNotFoundError) return errorResponse(404, "not_found");
        if (error instanceof ChatBusyError) return errorResponse(409, "busy");
        if (error instanceof DuplicateMessageError || error instanceof NothingToRetryError) return errorResponse(409, "invalid");
        if (error instanceof InvalidMessageError || error instanceof InvalidModelChoiceError || error instanceof SyntaxError) return errorResponse(400, "invalid");
        return errorResponse(error instanceof RangeError ? 413 : stage === "snapshot" || error instanceof TypeError ? 400 : 500, error instanceof RangeError ? "too_large" : "other");
      } finally { if (!handedOff) await dispose(); }
    },
  };
}

function checkedChoice(value: ModelChoice): ModelChoice {
  if (!value || !identifier(value.modelId) || !identifier(value.providerId) || (value.reasoning !== undefined && !identifier(value.reasoning))) throw new TypeError("Invalid browser model choice");
  return { modelId: value.modelId, providerId: value.providerId, ...(value.reasoning !== undefined && { reasoning: value.reasoning }) };
}
async function recoverPending(storage: TransientChatStorage, chatId: string, snapshot: BrowserChatSnapshot | null, operation: BrowserChatOperation): Promise<void> {
  const pending = snapshot?.pending ?? [];
  if (!Array.isArray(pending) || pending.length > 50) throw new TypeError("Invalid recovered messages");
  for (const message of pending) {
    if (!message || !identifier(message.id) || typeof message.text !== "string" || message.text.length > 100_000) throw new TypeError("Invalid recovered message");
    if ((operation.type === "message" || operation.type === "edit") && operation.message.id === message.id) continue;
    if (message.editedMessageId !== undefined) throw new TypeError("Retry the pending edit before another operation");
    const existing = await storage.getMessage(message.id);
    if (existing) { if (existing.role !== "user" || existing.parts.some(part => part.type !== "text") || existing.parts.map(part => part.type === "text" ? part.text : "").join("") !== message.text) throw new TypeError("Recovered message collision"); continue; }
    const branch = await loadCurrentBranch(storage, chatId); const at = new Date(Math.max(Date.now(), ...branch.map(row => Date.parse(row.createdAt) + 1))).toISOString();
    await storage.insertMessage({ id: message.id, chatId, parentId: branch.at(-1)?.id ?? null, role: "user", parts: [{ type: "text", text: message.text }], formatVersion: CURRENT_FORMAT_VERSION,
      status: "complete", modelId: null, providerId: null, usage: null, reasoningDurationsMs: {}, error: null, createdAt: at });
  }
}

function checkedTools(source: AgentToolsSource | undefined): AgentToolsSource | undefined {
  const check = (tools: ToolSet): ToolSet => {
    if (Object.values(tools).some(tool => tool.needsApproval)) throw new TypeError("Approval tools are not supported in browser chat");
    return tools;
  };
  return typeof source === "function" ? model => check(source(model)) : source ? check(source) : undefined;
}
