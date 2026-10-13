import type {
  AnswerEditMark,
  AnswerEditRequest,
  AnswerEditResponse,
  JournalBlobResponse,
  JournalCallResponse,
  JournalListResponse,
  PeopleSearchResponse,
  PersonChatsResponse,
  SandboxHistoryExtras,
  SandboxSettingsRequest,
  SandboxSettingsResponse,
  StaffCopyResponse,
} from "../types";

type Fetch = typeof globalThis.fetch;

export const DEFAULT_SANDBOX_BASE_PATH = "/api/sandbox";

/** Сервер ответил отказом: `status` — код ответа, `kind` — вид ошибки из тела (`answer_busy`, `empty_text`…), если он есть. */
export class SandboxRequestError extends Error {
  constructor(
    readonly status: number,
    readonly kind: string | null,
    action: string,
  ) {
    super(`Sandbox request failed (${action}): HTTP ${status}${kind ? ` ${kind}` : ""}`);
    this.name = "SandboxRequestError";
  }
}

/** Запросы экрана песочницы к адресам из plan.md, «Адреса песочницы». */
export interface SandboxClient {
  /** Обращения и вызовы всего чата; с `messageId` — одного хода. */
  journal(chatId: string, messageId?: string): Promise<JournalListResponse["entries"]>;
  call(callId: string): Promise<JournalCallResponse>;
  blob(hash: string): Promise<JournalBlobResponse>;
  settings(chatId: string): Promise<SandboxSettingsResponse>;
  /** `null` — вернуть боевую инструкцию. */
  saveSettings(chatId: string, instructions: string | null): Promise<SandboxSettingsResponse>;
  editAnswer(chatId: string, messageId: string, edit: AnswerEditRequest): Promise<AnswerEditResponse>;
  /** Отметки правок по id ответа — из дополнения к истории чата. */
  answerEdits(chatId: string): Promise<Map<string, AnswerEditMark>>;
  /** Поиск человека; `search: false` — приложение поиск не дало, id вводится вручную. */
  searchPeople(query: string): Promise<PeopleSearchResponse>;
  personChats(personId: string): Promise<PersonChatsResponse["chats"]>;
  /** Копия текущей ветки чата человека в песочнице; ответ — id песочного чата. */
  copyPersonChat(personId: string, chatId: string): Promise<string>;
  /** Открывает закрытый инструментом чат снова: ходы идут дальше (`POST …/chats/{id}/reopen`, 204). */
  reopenChat(chatId: string): Promise<void>;
  /** Адрес чатов человека только на чтение: его отдают `AgentChat` как `api`. */
  personChatApi(personId: string): string;
}

export function createSandboxClient({ basePath = DEFAULT_SANDBOX_BASE_PATH, fetch: fetchImpl = (...args) => globalThis.fetch(...args) }: { basePath?: string; fetch?: Fetch } = {}): SandboxClient {
  const base = basePath.replace(/\/+$/, "");
  const segment = encodeURIComponent;
  const chat = (chatId: string) => `${base}/chats/${segment(chatId)}`;

  async function json<T>(action: string, url: string, init?: RequestInit): Promise<T> {
    const response = await fetchImpl(url, init);
    if (!response.ok) throw new SandboxRequestError(response.status, await errorKindOf(response), action);
    return (await response.json()) as T;
  }
  const send = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    journal: async (chatId, messageId) =>
      (
        await json<JournalListResponse>(
          "journal",
          `${chat(chatId)}/journal${messageId === undefined ? "" : `?messageId=${segment(messageId)}`}`,
        )
      ).entries,
    call: (callId) => json("call", `${base}/journal/calls/${segment(callId)}`),
    blob: (hash) => json("blob", `${base}/journal/blobs/${segment(hash)}`),
    settings: (chatId) => json("settings", `${chat(chatId)}/settings`),
    saveSettings: (chatId, instructions) =>
      json("save-settings", `${chat(chatId)}/settings`, send("PUT", { instructions } satisfies SandboxSettingsRequest)),
    editAnswer: (chatId, messageId, edit) =>
      json("answer-edit", `${chat(chatId)}/messages/${segment(messageId)}/answer-edit`, send("POST", edit)),
    answerEdits: async (chatId) => {
      const history = await json<Partial<SandboxHistoryExtras>>("history", `${base}/${segment(chatId)}`);
      return new Map(Object.entries(history.answerEdits ?? {}));
    },
    searchPeople: (query) => json("people", `${base}/people?query=${segment(query)}`),
    personChats: async (personId) => (await json<PersonChatsResponse>("person-chats", `${base}/people/${segment(personId)}/chats`)).chats,
    copyPersonChat: async (personId, chatId) =>
      (await json<StaffCopyResponse>("staff-copy", `${base}/people/${segment(personId)}/${segment(chatId)}/staff-copy`, { method: "POST" })).id,
    reopenChat: async (chatId) => {
      const response = await fetchImpl(`${chat(chatId)}/reopen`, { method: "POST" });
      if (!response.ok) throw new SandboxRequestError(response.status, await errorKindOf(response), "reopen");
    },
    personChatApi: (personId) => `${base}/people/${segment(personId)}`,
  };
}

async function errorKindOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { kind?: unknown } };
    return typeof body.error?.kind === "string" ? body.error.kind : null;
  } catch {
    return null;
  }
}
