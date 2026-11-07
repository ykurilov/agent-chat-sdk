import type { BrowserChatSnapshot, BrowserChatHistory as ChatHistory } from "./types";
import type { ChatModelChoice as ModelChoice } from "../chat-types";
export type { BrowserChatSnapshot } from "./types";
import type { AgentChatProps } from "../agent-chat";
import { browserChatView } from "./view";

export interface BrowserChatTransportOptions {
  endpoint: string;
  ownerId: string;
  chatId: string;
  loadSnapshot: () => unknown | Promise<unknown>;
  /** Resolve only after the application's local transaction commits; reject stale/deleted records. */
  saveSnapshot: (snapshot: BrowserChatSnapshot) => void | Promise<void>;
  fetch?: typeof globalThis.fetch;
  onError?: (code: "storage" | "snapshot" | "network" | "unsupported") => void;
}
export interface BrowserChatTransport {
  chatProps: Pick<AgentChatProps, "api" | "chatId" | "transport" | "steering">;
  getSnapshot(): BrowserChatSnapshot | null;
  dispose(): void;
}
interface RecordValue { type: string; snapshot?: BrowserChatSnapshot; acknowledged?: string[]; chunks?: unknown[]; data?: unknown }
interface ModelMenu { providers: Array<{ id: string; models: Array<{ id: string; reasoning: { levels: string[]; defaultLevel: string | null }; acceptsImages?: boolean }> }> }
const encoder = new TextEncoder();
const failure = (status = 500, kind = "other") => Response.json({ error: { kind } }, { status });
let transportSequence = 0;

/** Application owns IndexedDB and the chat list. This adapter never calls ordinary chat/file endpoints. */
export function createBrowserChatTransport(options: BrowserChatTransportOptions): BrowserChatTransport {
  const api = `/__agent_chat_browser/${globalThis.crypto?.randomUUID?.() ?? ++transportSequence}`;
  const perform: typeof globalThis.fetch = (input, init) => (options.fetch ?? globalThis.fetch)(input, init);
  let current: BrowserChatSnapshot | null = null, loading: Promise<void> | undefined, bootstrap: Promise<void> | undefined;
  let preparation: AbortController | undefined;
  let disposed = false, saveTail: Promise<void> = Promise.resolve(), menu: ModelMenu | undefined;
  let cachedView: { key: string; value: ChatHistory & { backgroundTasks?: boolean } } | undefined;
  const controllers = new Set<AbortController>();
  let active: { controller: AbortController; done: Promise<void> } | undefined;
  const report = (code: Parameters<NonNullable<BrowserChatTransportOptions["onError"]>>[0]) => { try { options.onError?.(code); } catch {} };
  const abortError = () => new DOMException("Aborted", "AbortError");
  const validate = (value: unknown): BrowserChatSnapshot => {
    const snapshot = value as BrowserChatSnapshot;
    if (!snapshot || snapshot.version !== 1 || snapshot.ownerId !== options.ownerId || snapshot.chatId !== options.chatId
      || typeof snapshot.sealed !== "string" || typeof snapshot.view !== "string" || snapshot.sealed.length + snapshot.view.length > 16 * 1024 * 1024
      || (snapshot.pending !== undefined && (!Array.isArray(snapshot.pending) || snapshot.pending.length > 50 || snapshot.pending.some(row => !row || typeof row.id !== "string" || typeof row.text !== "string" || row.text.length > 100_000)))) {
      report("snapshot"); throw new Error("BROWSER_CHAT_SNAPSHOT_INVALID");
    }
    return structuredClone(snapshot);
  };
  const load = (): Promise<void> => {
    if (loading) return loading;
    const job = (async () => {
      const value = await options.loadSnapshot();
      if (disposed) throw abortError(); current = value == null ? null : validate(value);
    })().catch(error => { if (loading === job) loading = undefined; throw error; });
    loading = job; return job;
  };
  const commit = (value: BrowserChatSnapshot): Promise<void> => {
    const next = validate(value);
    const write = saveTail.catch(() => {}).then(async () => {
      if (disposed) throw abortError();
      try { await options.saveSnapshot(structuredClone(next)); } catch { report("storage"); throw new Error("BROWSER_CHAT_STORAGE_FAILED"); }
      if (disposed) throw abortError(); current = next;
    });
    saveTail = write; return write;
  };
  const checkpoint = async (record: RecordValue): Promise<void> => {
    if (!record.snapshot) throw new Error("BROWSER_CHAT_PROTOCOL");
    const next = validate(record.snapshot), accepted = new Set(record.acknowledged ?? []);
    const pending = current?.pending?.filter(row => !accepted.has(row.id));
    if (pending?.length) next.pending = pending;
    await commit(next);
  };
  const history = async (): Promise<ChatHistory & { backgroundTasks?: boolean }> => {
    if (!current) throw new Error("BROWSER_CHAT_NOT_INITIALIZED");
    if (cachedView?.key !== current.view) cachedView = { key: current.view, value: await browserChatView(current) };
    const view = cachedView!;
    const result = structuredClone(view.value);
    if (current.choice) {
      result.chat.modelId = current.choice.modelId; result.chat.providerId = current.choice.providerId;
      if (current.choice.reasoning !== undefined) result.chat.reasoning = current.choice.reasoning; else delete result.chat.reasoning;
    }
    if (!active) {
      result.running = false; result.detachedAnswer = false; result.compacting = false;
      result.messages = result.messages.map(message => message.metadata?.status === "streaming" ? { ...message, metadata: { ...message.metadata, status: "interrupted" as const } } : message);
    }
    const pending = current.pending?.filter(row => !result.messages.some(message => message.id === row.id)) ?? [];
    for (const row of pending) result.messages.push({ id: row.id, role: "user", parts: [{ type: "text", text: row.text }] });
    if (!active && pending.length) result.messages.push({ id: pending.at(-1)!.answerId ?? `${pending.at(-1)!.id}-interrupted`, role: "assistant", parts: [], metadata: { status: "interrupted" } });
    else if (!active && result.messages.at(-1)?.role === "user" && view.value.running) result.messages.push({ id: `${result.messages.at(-1)!.id}-interrupted`, role: "assistant", parts: [], metadata: { status: "interrupted" } });
    return result;
  };
  const remote = async (operation: Record<string, unknown>, signal?: AbortSignal): Promise<Response> => {
    if (disposed || signal?.aborted) throw abortError();
    const controller = new AbortController(); controllers.add(controller);
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
    const own = { controller, done }, isTurn = operation.type !== "models";
    if (isTurn) { if (active) { controllers.delete(controller); signal?.removeEventListener("abort", abort); return failure(409, "busy"); } active = own; }
    let handedOff = false;
    let records: ReturnType<typeof recordReader> | undefined;
    const release = () => { controllers.delete(controller); signal?.removeEventListener("abort", abort); if (active === own) active = undefined; finish(); };
    try {
      const response = await perform(options.endpoint, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ chatId: options.chatId, snapshot: operation.type === "models" ? null : current, operation }) });
      if (!response.ok) return new Response(await response.text(), { status: response.status, headers: response.headers });
      if (response.headers.get("content-type")?.includes("application/json")) {
        const result = await response.json() as RecordValue;
        if (result.type === "models") { menu = result.data as ModelMenu; return Response.json(result.data); }
        if (result.type !== "result") throw new Error("BROWSER_CHAT_PROTOCOL");
        await checkpoint(result); return Response.json(await history());
      }
      if (!response.body || !response.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error("BROWSER_CHAT_PROTOCOL");
      records = recordReader(response.body);
      const streamRecords = records;
      const ready = await streamRecords.next();
      if (!ready || ready.type !== "ready") throw new Error("BROWSER_CHAT_PROTOCOL");
      await checkpoint(ready); handedOff = true;
      const body = new ReadableStream<Uint8Array>({
        async start(out) {
          try {
            out.enqueue(encoder.encode(": ready\n\n"));
            for (;;) {
              const record = await streamRecords.next();
              if (!record) throw new Error("BROWSER_CHAT_INCOMPLETE");
              if (disposed || controller.signal.aborted) throw abortError();
              if (record.type === "ping") { out.enqueue(encoder.encode(": ping\n\n")); continue; }
              if (record.type === "end") { await checkpoint(record); await streamRecords.cancel(); release(); out.enqueue(encoder.encode("data: [DONE]\n\n")); out.close(); break; }
              if (record.type !== "data" || !Array.isArray(record.chunks)) throw new Error("BROWSER_CHAT_PROTOCOL");
              await checkpoint(record);
              if (disposed || controller.signal.aborted) throw abortError();
              for (const chunk of record.chunks) out.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          } catch (error) { if (!controller.signal.aborted && !disposed) report("network"); controller.abort(); try { out.error(error); } catch {} }
          finally { await streamRecords.cancel(); release(); }
        },
        async cancel() { controller.abort(); await streamRecords.cancel(); await done; },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1", "x-agent-chat-heartbeat-ms": "1000", "cache-control": "no-store" } });
    } finally { if (!handedOff) { controller.abort(); await records?.cancel(); release(); } }
  };
  const ensure = async (signal?: AbortSignal) => {
    await load(); if (current) return;
    bootstrap ??= (async () => { const response = await remote({ type: "bootstrap" }, signal); if (!response.ok) throw new Error("BROWSER_CHAT_BOOTSTRAP_FAILED"); })().catch(error => { bootstrap = undefined; throw error; });
    await bootstrap;
  };
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    try {
      if (disposed) throw abortError();
      const request = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input), typeof location === "undefined" ? "http://browser-chat.local" : location.href), init);
      const url = new URL(request.url), path = url.pathname;
      if (!path.startsWith(api + "/")) { report("unsupported"); return failure(404, "not_found"); }
      const parts = path.slice(api.length + 1).split("/").map(decodeURIComponent);
      if (parts.length === 1 && parts[0] === "models" && request.method === "GET") return await remote({ type: "models" }, request.signal);
      if (parts[0] !== options.chatId || parts.length > 2) { report("unsupported"); return failure(404, "not_found"); }
      await ensure(request.signal); const action = parts[1];
      if (request.method === "GET") {
        if (action === "stream" || action === "watch") return new Response(null, { status: 204 });
        const view = await history();
        if (action === undefined) return Response.json(view);
        if (action === "branches") return Response.json({ forks: view.forks });
        if (action === "compactions") return Response.json({ compactions: view.compactions, compacting: false });
        report("unsupported"); return failure(404, "not_found");
      }
      if (action === "stop" && request.method === "POST") { preparation?.abort(); const running = active; running?.controller.abort(); await running?.done; return new Response(null, { status: 204 }); }
      if (active || preparation) return failure(409, "busy");
      const preparing = new AbortController(); preparation = preparing;
      const mutationSignal = AbortSignal.any([request.signal, preparing.signal]);
      try {
      const data = request.body ? await request.json() as Record<string, unknown> : {};
      if (action === "model" && request.method === "PUT") {
        if (!menu) { const response = await remote({ type: "models" }, request.signal); if (!response.ok) return response; }
        const model = menu?.providers.find(provider => provider.id === data.providerId)?.models.find(model => model.id === data.modelId);
        if (!model) return failure(400, "invalid");
        const reasoning = typeof data.reasoning === "string" ? data.reasoning : model.reasoning.defaultLevel;
        if (reasoning !== null && !model.reasoning.levels.includes(reasoning)) return failure(400, "invalid");
        const choice: ModelChoice = { modelId: String(data.modelId), providerId: String(data.providerId), ...(reasoning !== null && { reasoning }) };
        await commit({ ...current!, choice }); return Response.json({ ...choice, reasoning });
      }
      if (request.method !== "POST") return failure(404, "not_found");
      let operation: Record<string, unknown>;
      if (action === "messages") operation = { type: "message", message: data.message };
      else if (action === "edit") operation = { type: "edit", messageId: data.editedMessageId, message: data.message };
      else if (action === "regenerate") operation = { type: "regenerate", messageId: data.messageId };
      else if (action === "branch") operation = { type: "selectBranch", messageId: data.messageId };
      else if (action === "retry") operation = { type: "retry" };
      else { report("unsupported"); return failure(404, "not_found"); }
      if (operation.type === "retry" && current?.pending?.length) {
        const pending = current.pending.at(-1)!;
        operation = { type: pending.editedMessageId ? "edit" : "message", ...(pending.editedMessageId && { messageId: pending.editedMessageId }), message: { id: pending.id, role: "user", parts: [{ type: "text", text: pending.text }] } };
      }
      if (operation.type === "message" || operation.type === "edit") {
        const outgoing = operation.message as { id?: unknown; role?: unknown; parts?: Array<{ type?: unknown; text?: unknown }> };
        if (!outgoing || typeof outgoing.id !== "string" || outgoing.role !== "user" || !Array.isArray(outgoing.parts) || outgoing.parts.some(part => part.type !== "text" || typeof part.text !== "string")) return failure(400, "invalid");
        if (current?.pending?.some(row => row.editedMessageId && row.id !== outgoing.id)) return failure(409, "busy");
        const text = outgoing.parts.map(part => part.text).join("");
        const previous = current!.pending ?? [];
        await commit({ ...current!, pending: [...previous.filter(row => row.id !== outgoing.id), { id: outgoing.id, text, answerId: globalThis.crypto.randomUUID(), ...(operation.type === "edit" && { editedMessageId: String(operation.messageId) }) }] });
        operation.message = { id: outgoing.id, role: "user", parts: outgoing.parts.map(part => ({ type: "text", text: part.text })) };
      }
      return await remote(operation, mutationSignal);
      } finally { if (preparation === preparing) preparation = undefined; }
    } catch (error) { if (error instanceof DOMException && error.name === "AbortError") throw error; report("network"); return failure(); }
  };
  return {
    chatProps: { api, chatId: options.chatId, transport: { kind: "browser-owned", fetch: fetchImpl, watch: false }, steering: false },
    getSnapshot: () => current && structuredClone(current),
    dispose() { disposed = true; preparation?.abort(); for (const controller of controllers) controller.abort(); controllers.clear(); },
  };
}

function recordReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader(), decoder = new TextDecoder(); let buffer = "", ended = false;
  let cancellation: Promise<void> | undefined;
  return {
    async next(): Promise<RecordValue | null> {
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line) return JSON.parse(line) as RecordValue; continue; }
        if (ended) { if (buffer.trim()) throw new Error("BROWSER_CHAT_INCOMPLETE_RECORD"); return null; }
        const next = await reader.read();
        if (next.done) { ended = true; buffer += decoder.decode(); }
        else buffer += decoder.decode(next.value, { stream: true });
        if (buffer.length > 32 * 1024 * 1024) { await reader.cancel(); throw new Error("BROWSER_CHAT_RECORD_LIMIT"); }
      }
    },
    cancel(): Promise<void> { return cancellation ??= (async () => { try { await reader.cancel(); } catch {} finally { try { reader.releaseLock(); } catch {} } })(); },
  };
}
