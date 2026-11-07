import type { IncomingUserMessage } from "@ykurilov/agent-chat-core";
import type { BrowserChatOperation, BrowserChatRequest } from "./types";
export const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\p{Cc}]/u.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function plainUserMessage(value: unknown): IncomingUserMessage {
  if (!object(value) || !identifier(value.id) || value.role !== "user" || !Array.isArray(value.parts)
    || Object.keys(value).some(key => !["id", "role", "parts"].includes(key)) || value.parts.length > 100) throw new TypeError("invalid browser message");
  const parts = value.parts.map(part => {
    if (!object(part) || part.type !== "text" || typeof part.text !== "string" || part.text.length > 100_000) throw new TypeError("only text is supported in browser chat");
    return { type: "text" as const, text: part.text };
  });
  if (!parts.length || parts.reduce((sum, part) => sum + part.text.length, 0) > 100_000) throw new TypeError("invalid browser message");
  return { id: value.id, role: "user", parts };
}
export async function readBrowserRequest(request: Request, maxBytes: number, signal?: AbortSignal): Promise<BrowserChatRequest> {
  const reader = request.body?.getReader();
  if (!reader || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new TypeError("invalid browser request");
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new RangeError("request limit"); } chunks.push(next.value); }
  } finally { signal?.removeEventListener("abort", abort); reader.releaseLock(); }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!object(body) || !identifier(body.chatId) || !object(body.operation) || !("snapshot" in body)
    || Object.keys(body).some(key => !["chatId", "snapshot", "operation"].includes(key))) throw new TypeError("invalid browser request");
  const raw = body.operation; let operation: BrowserChatOperation;
  if (["bootstrap", "models", "retry"].includes(String(raw.type))) operation = { type: raw.type as "bootstrap" | "models" | "retry" };
  else if (raw.type === "message") operation = { type: "message", message: plainUserMessage(raw.message) };
  else if (raw.type === "edit" && identifier(raw.messageId)) operation = { type: "edit", messageId: raw.messageId, message: plainUserMessage(raw.message) };
  else if ((raw.type === "regenerate" || raw.type === "selectBranch") && identifier(raw.messageId)) operation = { type: raw.type, messageId: raw.messageId };
  else throw new TypeError("invalid browser operation");
  // Unknown operation fields never become service options, context, or permissions.
  return { chatId: body.chatId, snapshot: body.snapshot as BrowserChatRequest["snapshot"], operation };
}
