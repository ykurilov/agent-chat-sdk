import type { ChatService, ChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatAttachments } from "@ykurilov/agent-chat-server";
import { isSandboxOwner } from "../sandbox-owner";
import type { PeopleSearchResponse, Person, PersonChatsResponse, SandboxPeople, StaffCopyResponse } from "../types";
import { copyPersonChat, EmptyPersonChatError } from "./copy-person-chat";

const PERSON_ID_MAX_LENGTH = 128;
const QUERY_MAX_LENGTH = 200;

export interface PeopleRoutesInput {
  /** Служба песочницы: то же хранилище, что у боевого чата, поэтому чаты людей читаются по их id. */
  service: ChatService;
  storage: ChatStorage;
  attachments: ChatAttachments | undefined;
  /** `true` — поиска нет, человека вводят по id. */
  people: SandboxPeople | true;
}

/**
 * Раздел «Чаты людей» под `{base}/people`: поиск человека, его чаты, история и файлы только на чтение и копия чата
 * в песочницу админа. Админ уже проверен. Записи в чат человека здесь нет ни одной: всё, кроме перечисленного, — 404.
 *
 * - `GET /people?query=` — люди (`PeopleSearchResponse`);
 * - `GET /people/:personId/chats` — чаты человека с чатами объектов (`PersonChatsResponse`);
 * - `GET /people/:personId/models` — меню моделей (экрану чата на чтение);
 * - `GET /people/:personId/:chatId` — история, как её видит человек, без данных объекта;
 * - `GET /people/:personId/:chatId/attachments/:fileId` — файл вложения;
 * - `POST /people/:personId/:chatId/staff-copy` — копия текущей ветки (`StaffCopyResponse`, 201).
 */
export function createPeopleRoutes({ service, storage, attachments, people }: PeopleRoutesInput) {
  async function search(request: Request): Promise<Response> {
    const query = (new URL(request.url).searchParams.get("query") ?? "").trim().slice(0, QUERY_MAX_LENGTH);
    const finder = people === true ? null : people;
    const found = finder && query.length > 0 ? await finder.find(query) : [];
    const body: PeopleSearchResponse = { search: finder !== null, people: found.flatMap(publicPerson) };
    return Response.json(body);
  }

  /** `segments` — путь после `people`; `owner` — песочный владелец админа. */
  async function handle(request: Request, segments: string[], owner: string): Promise<Response> {
    const method = request.method.toUpperCase();
    const [personId, second, third, fourth, ...rest] = segments;
    if (personId === undefined) return method === "GET" ? search(request) : notFound();
    // Песочные владельцы — не люди: чужая песочница через этот раздел не читается.
    if (!isPersonId(personId) || second === undefined || rest.length > 0) return notFound();

    if (third === undefined && method === "GET") {
      if (second === "chats") {
        const body: PersonChatsResponse = { chats: await service.listChats(personId, { subjects: "include" }) };
        return Response.json(body);
      }
      if (second === "models") return Response.json(await service.getModelMenu());
      return Response.json(await service.peekHistory(personId, second));
    }
    if (third === "attachments" && fourth !== undefined && method === "GET" && attachments) {
      await service.assertOwnChat(personId, second);
      return attachments.handle({ request, userId: personId, chatId: second, segments: [fourth] });
    }
    if (third === "staff-copy" && fourth === undefined && method === "POST") {
      try {
        const { chatId } = await copyPersonChat({ service, storage, attachments, personId, chatId: second, owner, request });
        const body: StaffCopyResponse = { id: chatId };
        return Response.json(body, { status: 201 });
      } catch (error) {
        if (error instanceof EmptyPersonChatError) return Response.json({ error: { kind: "empty_chat" } }, { status: 400 });
        throw error;
      }
    }
    return notFound();
  }

  return { handle };
}

function isPersonId(id: string): boolean {
  return id.length > 0 && id.length <= PERSON_ID_MAX_LENGTH && !isSandboxOwner(id);
}

/** Только поля договора: лишнее, что вернуло приложение, наружу не идёт. */
function publicPerson(person: Person): Person[] {
  if (typeof person?.id !== "string" || !isPersonId(person.id)) return [];
  return [
    {
      id: person.id,
      ...(typeof person.name === "string" && { name: person.name }),
      ...(typeof person.hint === "string" && { hint: person.hint }),
    },
  ];
}

function notFound(): Response {
  return Response.json({ error: { kind: "not_found" } }, { status: 404 });
}
