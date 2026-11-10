import type { BrowserChatSnapshot, BrowserChatHistory as ChatHistory } from "./types";
/** Наибольшие пределы сервера (`maxRequestBytes` до 64 MiB, `maxSnapshotBytes` до 128 MiB): всё, что сервер может прислать, браузер принимает. */
export const MAX_ENVELOPE_CHARS = 64 * 1024 * 1024;
const MAX_VIEW_BYTES = 128 * 1024 * 1024;
/** Opaque compressed public view. Browser storage is not trusted server state. */
export async function browserChatView(snapshot: BrowserChatSnapshot): Promise<ChatHistory & { backgroundTasks?: boolean }> {
  if (typeof DecompressionStream === "undefined" || snapshot.view.length > MAX_ENVELOPE_CHARS) throw new Error("BROWSER_CHAT_VIEW_UNAVAILABLE");
  const bytes = Uint8Array.from(atob(snapshot.view), char => char.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const decoder = new TextDecoder(); let size = 0, text = "";
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > MAX_VIEW_BYTES) { await reader.cancel(); throw new Error("BROWSER_CHAT_VIEW_LIMIT"); } text += decoder.decode(next.value, { stream: true }); }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const history = JSON.parse(text) as ChatHistory & { backgroundTasks?: boolean };
  if (!Array.isArray(history.messages) || !history.chat || !history.capabilities) throw new Error("BROWSER_CHAT_VIEW_INVALID");
  return history;
}
