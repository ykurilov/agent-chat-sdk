import type { AppRefusal } from "../app-refusal";
import { appRefusalOf } from "../app-refusal";
import type { ChatClosure } from "../chat-access";

/** Строка списка чатов, как её отдаёт сервер (`GET {api}`). */
export interface ChatListEntry {
  id: string;
  /** `null` — у чата ещё нет названия. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
  /** Мессенджер, из которого создан чат; нет — чат из веба. */
  origin?: string;
  /** Ключ объекта приложения (урок, заказ): есть у чатов объектов, когда сервер их показывает (`chatList.subjectChats`). */
  subjectKey?: string;
  /** Чат закрыт (`closeChat`): причина кодом и словами; у открытого чата поля нет. Форму проверяет слой поведения. */
  closed?: ChatClosure;
}

type Fetch = typeof globalThis.fetch;

/** Сервер ответил отказом; `status` — код ответа. */
export class ChatListRequestError extends Error {
  constructor(
    readonly status: number,
    action: string,
  ) {
    super(`Chat list request failed (${action}): HTTP ${status}`);
    this.name = "ChatListRequestError";
  }
}

/** Приложение не дало создать чат (`403 { error: { kind: "chat_creation_refused", code, message } }`). */
export class ChatCreationRefusedError extends Error {
  constructor(readonly refusal: AppRefusal) {
    super(refusal.message);
    this.name = "ChatCreationRefusedError";
  }
}

const chatUrl = (api: string, chatId: string) => `${api.replace(/\/+$/, "")}/${encodeURIComponent(chatId)}`;

async function request(fetchImpl: Fetch, action: string, url: string, init?: RequestInit): Promise<Response> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new ChatListRequestError(response.status, action);
  return response;
}

const jsonBody = (body: unknown): RequestInit => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchChatList(api: string, fetchImpl: Fetch): Promise<ChatListEntry[]> {
  const response = await request(fetchImpl, "list", api.replace(/\/+$/, ""));
  return ((await response.json()) as { chats: ChatListEntry[] }).chats;
}

/** Создаёт пустой чат; возвращает его id. */
export async function createChatOnServer(api: string, fetchImpl: Fetch): Promise<string> {
  const response = await fetchImpl(api.replace(/\/+$/, ""), { method: "POST" });
  if (!response.ok) {
    const refusal = await appRefusalOf(response);
    if (refusal?.kind === "chat_creation_refused") throw new ChatCreationRefusedError(refusal);
    throw new ChatListRequestError(response.status, "create");
  }
  return ((await response.json()) as { id: string }).id;
}

/** Возвращает название, как оно записано на сервере. */
export async function renameChatOnServer(api: string, fetchImpl: Fetch, chatId: string, title: string): Promise<string> {
  const response = await request(fetchImpl, "rename", chatUrl(api, chatId), { method: "PATCH", ...jsonBody({ title }) });
  return ((await response.json()) as { title: string }).title;
}

/** Удаляет чат. Чата уже нет (404) — это тоже успех: человек хотел, чтобы его не было. */
export async function deleteChatOnServer(api: string, fetchImpl: Fetch, chatId: string): Promise<void> {
  const response = await fetchImpl(chatUrl(api, chatId), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new ChatListRequestError(response.status, "delete");
}
