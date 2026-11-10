import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { BrowserChatSnapshot, ChatHistory, InMemoryChatSnapshot } from "@ykurilov/agent-chat-core";
import type { BrowserChatUsage } from "./types";

/** Сколько неучтённых записей расхода может ждать в снимке повторного `onUsage`. */
const MAX_UNBILLED = 10_000;

export interface BrowserChatPayload {
  version: 1;
  internalChatId: string;
  storage: InMemoryChatSnapshot;
  /** Расход, который `onUsage` не принял: повторяется на следующем запросе, пока не примет. */
  unbilled?: BrowserChatUsage[];
}
export function createBrowserChatCodec(keyInput: string | Uint8Array, namespace: string, maxBytes: number) {
  const key = typeof keyInput === "string" ? Buffer.from(keyInput, "base64url") : Buffer.from(keyInput);
  if (key.length !== 32 || !namespace || namespace.length > 200) throw new TypeError("browser chat requires a 32-byte snapshot key and a namespace");
  const zip = (value: unknown): Buffer => {
    const bytes = Buffer.from(JSON.stringify(value));
    if (bytes.byteLength > maxBytes) throw new RangeError("browser chat snapshot limit exceeded");
    return gzipSync(bytes, { level: 1 });
  };
  const unzip = (bytes: Uint8Array): unknown => JSON.parse(gunzipSync(bytes, { maxOutputLength: maxBytes }).toString("utf8"));
  const aad = (ownerId: string, chatId: string, view: string) => Buffer.from(JSON.stringify([1, namespace, ownerId, chatId, view]));
  return {
    encode(ownerId: string, chatId: string, payload: BrowserChatPayload, history: ChatHistory): BrowserChatSnapshot {
      const view = zip({ ...history, chat: { ...history.chat, id: chatId }, backgroundTasks: false }).toString("base64");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(aad(ownerId, chatId, view));
      const ciphertext = Buffer.concat([cipher.update(zip(payload)), cipher.final()]);
      return { version: 1, ownerId, chatId, view, sealed: [iv, ciphertext, cipher.getAuthTag()].map(part => part.toString("base64url")).join(".") };
    },
    decode(value: unknown, ownerId: string, chatId: string): BrowserChatPayload {
      if (!value || typeof value !== "object") throw new TypeError("invalid browser snapshot");
      const snapshot = value as BrowserChatSnapshot;
      if (snapshot.version !== 1 || snapshot.ownerId !== ownerId || snapshot.chatId !== chatId || typeof snapshot.view !== "string" || typeof snapshot.sealed !== "string"
        || snapshot.view.length > maxBytes * 2 || snapshot.sealed.length > maxBytes * 2) throw new TypeError("invalid browser snapshot");
      const parts = snapshot.sealed.split(".");
      if (parts.length !== 3 || parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part))) throw new TypeError("invalid browser snapshot");
      const [iv, ciphertext, tag] = parts.map(part => Buffer.from(part, "base64url"));
      if (iv!.length !== 12 || tag!.length !== 16) throw new TypeError("invalid browser snapshot");
      const cipher = createDecipheriv("aes-256-gcm", key, iv!);
      cipher.setAAD(aad(ownerId, chatId, snapshot.view)); cipher.setAuthTag(tag!);
      const payload = unzip(Buffer.concat([cipher.update(ciphertext!), cipher.final()])) as BrowserChatPayload;
      if (payload.version !== 1 || typeof payload.internalChatId !== "string" || payload.storage?.version !== 1 || payload.storage.chats.length !== 1
        || payload.storage.chats[0]?.id !== payload.internalChatId || payload.storage.chats[0]?.ownerId !== ownerId
        || payload.storage.messages.some(message => message.chatId !== payload.internalChatId)
        || payload.storage.compactions.some(row => row.chatId !== payload.internalChatId)
        || payload.storage.branchSelections.some(row => row.chatId !== payload.internalChatId)
        || payload.storage.usageRecords.some(row => row.ownerId !== ownerId || row.chatId !== payload.internalChatId)
        || (payload.unbilled !== undefined && (!Array.isArray(payload.unbilled) || payload.unbilled.length > MAX_UNBILLED
          || payload.unbilled.some(row => !row || typeof row !== "object" || row.ownerId !== ownerId || typeof row.id !== "string")))) throw new TypeError("invalid browser snapshot");
      return payload;
    },
  };
}
