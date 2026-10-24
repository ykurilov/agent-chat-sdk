import {
  AnswerEditError,
  answerText,
  ChatClosedError,
  ChatNotFoundError,
  createRequestOriginCheck,
  isSafeMethod,
  originRefusalHint,
} from "@ykurilov/agent-chat-core";
import type { AgentViewerInput, AgentViewerSource, AnswerEdit, AnswerEditErrorKind, ChatService, StoredMessage } from "@ykurilov/agent-chat-core";
import { allowedUser, createChatServer } from "@ykurilov/agent-chat-server";
import type { ChatHandler } from "@ykurilov/agent-chat-server";
import { secretsFromEnv } from "./journal/hide-secrets";
import { createPeopleRoutes } from "./people/people-routes";
import { createStaffCopies } from "./people/staff-copies";
import { readOnlyMemory } from "./read-only-memory";
import { realOwnerOf, sandboxOwnerOf } from "./sandbox-owner";
import { sandboxTools } from "./sandbox-tools";
import type {
  AnswerEditMark,
  AnswerEditResponse,
  JournalListResponse,
  SandboxHandlerOptions,
  SandboxHistoryExtras,
  SandboxJournal,
  SandboxSettingsResponse,
} from "./types";

export { isSandboxOwner } from "./sandbox-owner";

/**
 * Инструменты, чей результат правка ответа не меняет: файлы картинок и видео лежат отдельно от текста ответа.
 * Имена строками, без зависимости от пакетов картинок и видео; приложение добавляет свои через `chat.lockedToolOutputs`.
 */
export const SANDBOX_LOCKED_TOOL_OUTPUTS: readonly string[] = ["generate_images", "show_video"];

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_INSTRUCTIONS_CHARS = 100_000;
/** Тело запроса песочницы больше этого не читается: инструкция до 100 000 знаков и результаты инструментов до 64 КБ. */
const MAX_BODY_BYTES = 1024 * 1024;

const answerEditStatus: Record<AnswerEditErrorKind, number> = {
  chat_not_found: 404,
  message_not_found: 404,
  not_an_answer: 400,
  answer_busy: 409,
  not_on_current_branch: 409,
  empty_text: 400,
  invalid_tool_output: 400,
  nothing_changed: 400,
};

/**
 * Песочница агента для админа: тот же чат приложения, но чаты личные (`sandbox:<id админа>`), каждый ход пишется
 * в журнал, инструкцию можно править на чат, ответ агента — исправить. Раздел «Чаты людей» (`{base}/people`): чаты
 * человека только на чтение и их копия в песочницу; в копии память человека только на чтение, инструменты получают
 * его id и `model.staff`. Не админ получает 404 на любом адресе.
 */
export function createSandboxHandler(options: SandboxHandlerOptions): ChatHandler {
  const { chat, journal } = options;
  const basePath = (options.basePath ?? "/api/sandbox").replace(/\/+$/, "");
  const logError = chat.logError ?? ((message: string) => console.error(message));
  const allowsOrigin = createRequestOriginCheck({
    allowedOrigins: chat.allowedOrigins,
    onRefused: (refusal) => logError(`Песочница: ${originRefusalHint(refusal)}`),
  });
  // Владелец уже проверенного запроса: внутренний обработчик не зовёт `resolveUser` приложения второй раз.
  const ownerOfRequest = new WeakMap<Request, string>();
  const staffCopies = createStaffCopies();
  const { handler: inner, service } = createChatServer({
    ...chat,
    basePath,
    resolveUser: async (request) => {
      const owner = ownerOfRequest.get(request);
      return owner ? { id: owner } : null;
    },
    agent: {
      ...chat.agent,
      ...(chat.agent.tools && { tools: sandboxTools(chat.agent.tools, options.chatOwnedTools, staffCopies.toolsModel) }),
      // Права — по тому же владельцу, что видят инструменты: настоящий админ или человек копии.
      ...(chat.agent.viewer && { viewer: viewerOfSandbox(chat.agent.viewer, staffCopies.viewerInput) }),
    },
    // Лимиты приложения в песочницу не переходят: только свои, по умолчанию без лимита.
    limits: options.limits,
    // Проверка приложения перед ходом тоже: она ждёт человека приложения, а в песочнице ходит `sandbox:<админ>`.
    beforeTurn: undefined,
    turnNotStarted: undefined,
    // Права приложения тоже: в песочнице ходит админ, ему доступно всё.
    chatCapabilities: undefined,
    // И запрет новых чатов: админ заводит песочные чаты, сколько нужно для теста.
    beforeCreateChat: undefined,
    // Чаты объектов приложения тоже: его `subjectChats` ждёт человека, а получил бы `sandbox:<админ>`. Адреса `/subject` нет.
    subjectChats: undefined,
    // Данные нового чата тоже: они про человека приложения, а в песочнице чат создаёт админ.
    newChatData: undefined,
    // Хуки, что пишут в данные приложения, тоже: копия состояния, итог хода и выбор модели легли бы на `sandbox:<админ>`,
    // а в копии чата человека — поверх его данных (у этих хуков нет `staff`, отличить копию приложению нечем).
    onStateChanged: undefined,
    onTurnFinished: undefined,
    onModelChosen: undefined,
    // Решения, что только читают, — для настоящего админа, как у инструментов: песочного владельца приложение не знает.
    ...(chat.newChatGreeting && { newChatGreeting: forRealAdmin(chat.newChatGreeting) }),
    ...(chat.modelMenu && { modelMenu: forRealAdmin(chat.modelMenu) }),
    // Итог хода приложению — только из копии чата человека, с его объектом и `staff` (см. `staffCopies.afterTurn`).
    afterTurn: chat.afterTurn && staffCopies.afterTurn(chat.afterTurn),
    memory: chat.memory && readOnlyMemory(chat.memory, staffCopies),
    // Копии чатов людей — чаты объектов (`staff-copy:…`): в списке песочницы они видны.
    chatList: { subjectChats: true },
    staffOfChat: staffCopies.staffOf,
    turnObserver: { modelCall: (event) => journal.enqueueModelCall(event), toolCall: (event) => journal.enqueueToolCall(event) },
    chatInstructions: async (sandboxChat) => (await journal.getSettings(sandboxChat.id))?.instructions ?? null,
    lockedToolOutputs: [...new Set([...SANDBOX_LOCKED_TOOL_OUTPUTS, ...(chat.lockedToolOutputs ?? [])])],
  });
  // Ключи провайдеров из окружения чата прячутся в журнале, даже если журнал создан без `env`.
  if (chat.env) journal.addSecrets?.(secretsFromEnv(chat.env));
  // Без опции `people` раздела нет: адреса `/people…` — 404, как до него.
  const people = options.people ? createPeopleRoutes({ service, storage: chat.storage, attachments: chat.attachments, people: options.people }) : null;
  const routes = createSandboxRoutes({ service, journal, people, staffCopies, appInstructions: chat.agent.instructions, logError, readHistory: (request) => inner.fetch(request) });
  startRetention(journal, options.retentionDays ?? DEFAULT_RETENTION_DAYS, logError);

  return {
    basePath,
    recoverInterruptedAnswers: () => inner.recoverInterruptedAnswers(),
    async flush(flushOptions) {
      await inner.flush(flushOptions);
      await journal.flush();
    },
    async fetch(request) {
      const segments = pathSegments(new URL(request.url).pathname, basePath);
      if (!segments) return notFound();
      try {
        const resolved = await chat.resolveUser(request);
        // Отказ приложения в доступе — тоже 404: не-админ не должен узнать, что песочница есть, и не получает слов приложения.
        const user = allowedUser(resolved);
        if (!user || !(await options.isAdmin(user, request))) return notFound();
        // Источник проверяется после админа: не-админ всегда получает 404, как будто песочницы нет.
        if (!isSafeMethod(request.method) && !allowsOrigin(request)) return errorResponse(403, "forbidden_origin");
        const owner = sandboxOwnerOf(user.id);
        ownerOfRequest.set(request, owner);
        const own = await routes.handle(request, segments, { adminId: user.id, owner });
        if (own) return own;
        return await inner.fetch(request);
      } catch (error) {
        return errorToResponse(error, request, logError);
      }
    },
  };
}

/** Решение приложения о человеке (`{ userId }`) получает настоящего админа вместо песочного владельца. */
function forRealAdmin<Input extends { userId: string }, Result>(decide: (input: Input) => Result): (input: Input) => Result {
  return (input) => decide({ ...input, userId: realOwnerOf(input.userId) });
}

interface RouteInput {
  readHistory: (request: Request) => Promise<Response>;
  service: ChatService;
  journal: SandboxJournal;
  people: ReturnType<typeof createPeopleRoutes> | null;
  staffCopies: ReturnType<typeof createStaffCopies>;
  appInstructions: string;
  logError: (message: string) => void;
}

type MessagePart = StoredMessage["parts"][number];

interface Caller {
  adminId: string;
  owner: string;
}

/** Адреса песочницы поверх чата: журнал, настройки, правка ответа, история с отметками правок, удаление с журналом, чаты людей. */
function createSandboxRoutes({ service, journal, people, staffCopies, appInstructions, logError, readHistory }: RouteInput) {
  async function settingsResponse(chatId: string): Promise<Response> {
    const settings = await journal.getSettings(chatId);
    const body: SandboxSettingsResponse = {
      instructions: settings?.instructions ?? null,
      appInstructions,
      updatedAt: settings?.updatedAt.toISOString() ?? null,
    };
    return Response.json(body);
  }

  async function answerEdits(chatId: string): Promise<SandboxHistoryExtras["answerEdits"]> {
    const records = await journal.listEditedAnswers(chatId);
    return Object.fromEntries(records.map(({ messageId, textEdited, editedToolCallIds }) => [messageId, { textEdited, editedToolCallIds }]));
  }

  async function editAnswer(request: Request, chatId: string, messageId: string, caller: Caller): Promise<Response> {
    const edit = parseAnswerEdit(await readJson(request));
    if (!edit) return errorResponse(400, "invalid");
    const { messages } = await service.getHistory(caller.owner, chatId);
    const replacement = await service.editAnswer(caller.owner, chatId, messageId, edit);
    // Правка прошла — значит, ответ был на текущей ветке и есть в истории.
    const source = messages.find((message) => message.id === messageId)!;
    const earlier = (await journal.listEditedAnswers(chatId)).find((record) => record.messageId === messageId);
    const mark = editMark(source.parts as MessagePart[], edit, earlier);
    // Ответ уже заменён: сбой журнала не должен превращать успех в 500, отметка просто пропадёт.
    try {
      await journal.markAnswerEdited({ messageId: replacement.id, sourceMessageId: messageId, chatId, editedBy: caller.adminId, editedAt: new Date(), ...mark });
    } catch (error) {
      logError(`Песочница: отметка правки ответа не записана: ${describe(error)}`);
    }
    const body: AnswerEditResponse = { messageId: replacement.id, mark };
    return Response.json(body);
  }

  /** Ответ, если адрес песочницы свой; `null` — адрес чата, его обслуживает внутренний обработчик. */
  async function handle(request: Request, segments: string[], caller: Caller): Promise<Response | null> {
    const method = request.method.toUpperCase();
    const [first, second, third, fourth, ...rest] = segments;

    // Экран памяти в песочнице закрыт: память админа там только для чтения.
    if (first === "memory") return notFound();

    if (first === "people") return people ? people.handle(request, segments.slice(1), caller.owner) : notFound();

    if (first === "journal") {
      if (method !== "GET" || third === undefined || fourth !== undefined) return notFound();
      if (second === "calls") {
        const details = await journal.getCall(third);
        return details && details.call.ownerId === caller.owner ? Response.json(details) : notFound();
      }
      if (second === "blobs") {
        const blob = await journal.getBlob(third, caller.owner);
        return blob ? Response.json(blob) : notFound();
      }
      return notFound();
    }

    if (first === "chats") {
      if (second === undefined) return notFound();
      await service.assertOwnChat(caller.owner, second);
      if (third === "journal" && fourth === undefined && method === "GET") {
        const messageId = new URL(request.url).searchParams.get("messageId");
        const entries = await journal.listForChat(second, messageId ? { messageId } : undefined);
        return Response.json({ entries } as unknown as JournalListResponse);
      }
      if (third === "settings" && fourth === undefined) {
        if (method === "GET") return settingsResponse(second);
        if (method !== "PUT") return notFound();
        const instructions = parseInstructions(await readJson(request));
        if (instructions === "invalid") return errorResponse(400, "invalid");
        await journal.setSettings({ chatId: second, instructions, updatedBy: caller.adminId, updatedAt: new Date() });
        return settingsResponse(second);
      }
      if (third === "messages" && fourth !== undefined && rest.length === 1 && rest[0] === "answer-edit" && method === "POST") {
        return editAnswer(request, second, fourth, caller);
      }
      // Закрытие в песочнице настоящее (так видно, что оно работает); открыть чат снова — чтобы продолжить тест.
      if (third === "reopen" && fourth === undefined && method === "POST") {
        await service.reopenChat({ ownerId: caller.owner, chatId: second });
        return new Response(null, { status: 204 });
      }
      return notFound();
    }

    // Идентификаторы чатов — UUID, поэтому пути `models`, `chats`, `journal`, `memory` и `people` с чатом не пересекаются.
    if (first !== undefined && first !== "models" && second === undefined) {
      if (method === "GET") {
        // Preserve transport metadata (including backgroundTasks:false), then add sandbox marks.
        const response = await readHistory(request);
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
        const history = await response.json();
        const headers = new Headers(response.headers);
        // The augmented JSON has a different byte length; retain all other transport headers/status.
        headers.delete("content-length");
        return Response.json({ ...history, answerEdits: await answerEdits(first) }, { status: response.status, headers });
      }
      if (method === "DELETE") {
        await service.deleteChat(caller.owner, first);
        staffCopies.forget(first);
        // Чат уже удалён: журнал, который не вычистился сейчас, дочистит суточная чистка.
        try {
          await journal.deleteChat(first);
        } catch (error) {
          logError(`Песочница: журнал удалённого чата не вычищен: ${describe(error)}`);
        }
        return new Response(null, { status: 204 });
      }
    }
    return null;
  }

  return { handle };
}

/** Отметки правки: текст изменён, результаты каких вызовов заменены; прежние отметки исправленного ответа сохраняются. */
function editMark(sourceParts: MessagePart[], edit: AnswerEdit, earlier: AnswerEditMark | undefined): AnswerEditMark {
  const outputs = new Map(
    sourceParts.flatMap((part) => {
      const call = part as { toolCallId?: unknown; state?: unknown; output?: unknown };
      return typeof call.toolCallId === "string" && call.state === "output-available" ? [[call.toolCallId, JSON.stringify(call.output)] as const] : [];
    }),
  );
  const changedCalls = Object.entries(edit.toolOutputs ?? {})
    .filter(([toolCallId, output]) => outputs.get(toolCallId) !== JSON.stringify(output))
    .map(([toolCallId]) => toolCallId);
  return {
    textEdited: (earlier?.textEdited ?? false) || edit.text !== answerText(sourceParts),
    editedToolCallIds: [...new Set([...(earlier?.editedToolCallIds ?? []), ...changedCalls])],
  };
}

/** Чистка журнала старше срока: сразу и раз в сутки. Таймер не держит процесс. */
function startRetention(journal: SandboxJournal, retentionDays: number, logError: (message: string) => void): void {
  const prune = () => {
    journal.deleteOlderThan(new Date(Date.now() - retentionDays * DAY_MS)).catch((error: unknown) => {
      logError(`Песочница: чистка журнала не удалась: ${describe(error)}`);
    });
  };
  prune();
  const timer = setInterval(prune, DAY_MS) as { unref?: () => void };
  timer.unref?.();
}

function parseAnswerEdit(body: unknown): AnswerEdit | null {
  if (!isPlainObject(body) || typeof body.text !== "string") return null;
  if (body.toolOutputs === undefined) return { text: body.text };
  return isPlainObject(body.toolOutputs) ? { text: body.text, toolOutputs: body.toolOutputs } : null;
}

function parseInstructions(body: unknown): string | null | "invalid" {
  if (!isPlainObject(body) || !Object.hasOwn(body, "instructions")) return "invalid";
  const { instructions } = body;
  if (instructions === null) return null;
  return typeof instructions === "string" && instructions.length <= MAX_INSTRUCTIONS_CHARS ? instructions : "invalid";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BodyTooLargeError extends Error {}

/** Тело JSON; не JSON — `undefined` (ответ 400), длиннее предела — 413. Больше предела не читается ни байта сверх него. */
async function readJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await request.body?.cancel().catch(() => {});
    throw new BodyTooLargeError();
  }
  const text = await readLimitedText(request);
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Тело потоком: после предела чтение обрывается, поток закрывается. */
async function readLimitedText(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pathSegments(pathname: string, basePath: string): string[] | null {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  try {
    return pathname
      .slice(basePath.length)
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    // Битая кодировка (например, `%E0`): такого адреса нет.
    return null;
  }
}

/** Ответ «нет такого адреса»: и не-админу, и на чужой чат — без слова о песочнице. */
function notFound(): Response {
  return errorResponse(404, "not_found");
}

function errorResponse(status: number, kind: string): Response {
  return Response.json({ error: { kind } }, { status });
}

function errorToResponse(error: unknown, request: Request, logError: (message: string) => void): Response {
  if (error instanceof ChatNotFoundError) return notFound();
  if (error instanceof AnswerEditError) return error.kind === "chat_not_found" ? notFound() : errorResponse(answerEditStatus[error.kind], error.kind);
  if (error instanceof BodyTooLargeError) return errorResponse(413, "too_large");
  if (error instanceof ChatClosedError) return Response.json({ error: { kind: "chat_closed", code: error.code, message: error.message } }, { status: 409 });
  logError(`Песочница: сбой на ${request.method} ${new URL(request.url).pathname}: ${describe(error)}`);
  return errorResponse(500, "other");
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** `agent.viewer` приложения в песочнице: вход с настоящим владельцем (см. `staffCopies.viewerInput`). */
function viewerOfSandbox(viewer: AgentViewerSource, input: (input: AgentViewerInput) => AgentViewerInput): AgentViewerSource {
  return (turn) => viewer(input(turn));
}
