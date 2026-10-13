import { vi } from "vitest";
import { fakeChatServer } from "../../../../react/tests/support/fake-chat-server";
import { fakeChatListServer } from "../../../../react/tests/support/fake-chat-list-server";
import type { FakeListedChat } from "../../../../react/tests/support/fake-chat-list-server";
import type { AnswerEditMark, JournalCallResponse, JournalListResponse, Person, PersonChatsResponse, SandboxSettingsResponse } from "../../../src/types";

/**
 * Подменённый сервер песочницы под `/api/sandbox`: адреса чата и списка — у сервера списка чатов из тестов React,
 * журнал, настройки и правка ответа — здесь. `GET` истории дополняется `answerEdits`. «Чаты людей» (`/people`): поиск,
 * чаты человека, его чат на чтение (`personChat`; запись — 404, как у настоящего сервера) и копия в список песочницы.
 */
export function fakeSandboxServer(chats: FakeListedChat[] = [{ id: "c1", title: "Первый" }]) {
  const chatServer = fakeChatListServer(chats);
  const state = {
    entries: [] as JournalListResponse["entries"],
    calls: {} as Record<string, JournalCallResponse>,
    settings: { instructions: null, appInstructions: "Боевая инструкция", updatedAt: null } as SandboxSettingsResponse,
    answerEdits: {} as Record<string, AnswerEditMark>,
    editResult: { messageId: "a2", mark: { textEdited: true, editedToolCallIds: [] } } as { messageId: string; mark: AnswerEditMark },
    editFails: false,
    /** `POST …/chats/:id/reopen` отвечает 500; иначе 204 и чат открывается (закрытие в истории пропадает). */
    reopenFails: false,
    people: {
      search: true,
      found: [{ id: "vera", name: "Вера", hint: "vera@example.com" }] as Person[],
      chats: [
        { id: "pc1", title: "Про оплату", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:05:00.000Z" },
        { id: "pc2", title: null, createdAt: "2026-10-02T10:00:00.000Z", updatedAt: "2026-10-02T10:00:00.000Z", subjectKey: "lesson:1" },
      ] as PersonChatsResponse["chats"],
      /** Вид ошибки копии; `null` — копия создаётся. */
      copyRefusal: null as string | null,
      copies: 0,
    },
  };
  const personChat = fakeChatServer();
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://test.local");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const path = url.pathname.replace(/^\/api\/sandbox/, "");
    const segments = path.split("/").filter(Boolean);
    if (segments[0] === "people") {
      requests.push({ method, path: url.pathname + url.search, body });
      const people = state.people;
      if (segments.length === 1) {
        const query = (url.searchParams.get("query") ?? "").toLowerCase();
        const found = people.search && query ? people.found.filter((person) => (person.name ?? person.id).toLowerCase().includes(query)) : [];
        return Response.json({ search: people.search, people: found });
      }
      if (segments[2] === "chats") return Response.json({ chats: people.chats });
      if (segments[3] === "staff-copy" && method === "POST") {
        if (people.copyRefusal) return Response.json({ error: { kind: people.copyRefusal } }, { status: 400 });
        people.copies += 1;
        const now = new Date().toISOString();
        const id = `copy-${people.copies}`;
        chatServer.state.chats.unshift({ id, title: "Копия: Про оплату", createdAt: now, updatedAt: now });
        return Response.json({ id }, { status: 201 });
      }
      if (method !== "GET") return Response.json({ error: { kind: "not_found" } }, { status: 404 });
      return personChat.fetch(input, init);
    }
    if (segments[0] === "chats" || segments[0] === "journal") {
      requests.push({ method, path: url.pathname + url.search, body });
      if (segments[2] === "reopen" && method === "POST") {
        if (state.reopenFails) return Response.json({ error: { kind: "other" } }, { status: 500 });
        chatServer.chatServer.state.closed = undefined;
        return new Response(null, { status: 204 });
      }
      if (segments[2] === "journal") return Response.json({ entries: state.entries });
      if (segments[2] === "settings") {
        if (method === "PUT") {
          state.settings = { ...state.settings, instructions: (body as { instructions: string | null }).instructions, updatedAt: "2026-10-03T10:00:00.000Z" };
        }
        return Response.json(state.settings);
      }
      if (segments[4] === "answer-edit") {
        if (state.editFails) return Response.json({ error: { kind: "answer_busy" } }, { status: 409 });
        state.answerEdits[state.editResult.messageId] = state.editResult.mark;
        return Response.json(state.editResult);
      }
      if (segments[1] === "calls") {
        const call = state.calls[segments[2]!];
        return call ? Response.json(call) : Response.json({ error: { kind: "not_found" } }, { status: 404 });
      }
      return Response.json({ error: { kind: "not_found" } }, { status: 404 });
    }
    const response = await chatServer.fetch(input, init);
    if (method === "GET" && segments.length === 1 && response.ok) {
      const history = (await response.json()) as object;
      return Response.json({ ...history, answerEdits: state.answerEdits });
    }
    return response;
  });
  return {
    fetch: fetch as unknown as typeof globalThis.fetch,
    state,
    chatServer,
    /** Чат человека, открытый на чтение. */
    personChat,
    requests,
    requestsTo: (suffix: string) => requests.filter((request) => request.path.split("?")[0]!.endsWith(suffix)),
  };
}
