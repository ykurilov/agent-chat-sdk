import { chatDataOfInput, DuplicateChatSubjectError, IMPORT_MAX_IMAGE_BYTES, IMPORT_MAX_IMAGES, IMPORT_MAX_MESSAGES } from "@ykurilov/agent-chat-core";
import type { AgentChatMessage, ChatService, ChatStorage, ImportChatInput } from "@ykurilov/agent-chat-core";
import type { ChatAttachments } from "@ykurilov/agent-chat-server";
import { parseStaffCopyKey, staffCopyKey, staffCopySubjectData } from "./staff-copies";

const TITLE_MAX_LENGTH = 100;
const COPY_TITLE_PREFIX = "Копия: ";
/**
 * Сколько раз взять следующий номер, если такой же номер одновременно заняли другие запросы. Каждая попытка берёт
 * номер не меньше прошлого + 1, поэтому N одновременных копий укладываются в N попыток.
 */
const COPY_NUMBER_ATTEMPTS = 20;

type ImportedPart = ImportChatInput["messages"][number]["parts"][number];
type MessagePart = AgentChatMessage["parts"][number];

export interface CopyPersonChatInput {
  service: ChatService;
  storage: ChatStorage;
  attachments: ChatAttachments | undefined;
  personId: string;
  chatId: string;
  /** Песочный владелец админа: копия записывается на него. */
  owner: string;
  /** Запрос админа: из него собирается чтение файла человека. */
  request: Request;
}

/** Копию сделать нечем: в чате человека нет сообщений. */
export class EmptyPersonChatError extends Error {
  constructor(chatId: string) {
    super(`В чате ${chatId} нет сообщений`);
    this.name = "EmptyPersonChatError";
  }
}

/**
 * Копия текущей ветки чата человека в песочнице админа (`service.importChat`): даты как есть, ответы законченные,
 * текст и картинки. Картинки — через вложения (`importFile`), без них — текстовой пометкой; прочие файлы, вызовы
 * инструментов и рассуждения не копируются. Исходный чат (ключ объекта и данные) едет в данные копии.
 * Чат человека только читается.
 * @throws ChatNotFoundError чата нет или он не этого человека.
 * @throws EmptyPersonChatError в чате нет сообщений.
 */
export async function copyPersonChat(input: CopyPersonChatInput): Promise<{ chatId: string }> {
  const { service, storage, personId, chatId, owner } = input;
  const history = await service.peekHistory(personId, chatId);
  const createdAtOf = new Map((await storage.listMessages(chatId)).map((message) => [message.id, message.createdAt]));
  const images = { count: 0, bytes: 0 };
  const messages: Array<ImportChatInput["messages"][number]> = [];
  for (const message of history.messages.slice(-IMPORT_MAX_MESSAGES)) {
    const createdAt = createdAtOf.get(message.id);
    if ((message.role !== "user" && message.role !== "assistant") || !createdAt) continue;
    const parts = await copiedParts(message.parts, input, images);
    if (parts.length > 0) messages.push({ role: message.role, createdAt, parts });
  }
  if (messages.length === 0) throw new EmptyPersonChatError(chatId);

  const { modelId, providerId, reasoning } = history.chat;
  // История отдаёт чат без данных: ключ объекта и данные исходного чата берутся из хранилища и едут в копию.
  const source = await storage.getChat(chatId);
  const sourceData = source ? chatDataOfInput(source) : undefined;
  const subjectData = staffCopySubjectData({
    ...(source?.subjectKey !== undefined && { key: source.subjectKey }),
    ...(sourceData !== undefined && { data: sourceData }),
  });
  const title = Array.from(`${COPY_TITLE_PREFIX}${history.chat.title ?? ""}`.trim()).slice(0, TITLE_MAX_LENGTH).join("");
  let copyNumber = 0;
  for (let attempt = 1; ; attempt++) {
    copyNumber = Math.max(copyNumber + 1, await nextCopyNumber(service, owner, personId, chatId));
    try {
      return await service.importChat({
        ownerId: owner,
        chat: {
          title,
          subjectKey: staffCopyKey(personId, chatId, copyNumber),
          ...(subjectData && { subjectData }),
          ...(modelId && providerId && { model: { modelId, providerId, ...(reasoning && { reasoning }) } }),
        },
        messages,
      });
    } catch (error) {
      if (!(error instanceof DuplicateChatSubjectError) || attempt >= COPY_NUMBER_ATTEMPTS) throw error;
    }
  }
}

/**
 * Номер следующей копии этого чата человека у админа: на 1 больше самого большого. Считаются только ключи ровно этого
 * человека и чата: у человека `x:y` начало ключа копии такое же, как у чата `y` человека `x`.
 */
async function nextCopyNumber(service: ChatService, owner: string, personId: string, chatId: string): Promise<number> {
  const numbers = (await service.listChats(owner, { subjects: "only" })).flatMap((chat) => {
    const copy = parseStaffCopyKey(chat.subjectKey);
    return copy?.personId === personId && copy.chatId === chatId ? [copy.copyNumber] : [];
  });
  return Math.max(0, ...numbers) + 1;
}

async function copiedParts(parts: readonly MessagePart[], input: CopyPersonChatInput, images: { count: number; bytes: number }): Promise<ImportedPart[]> {
  const copied: ImportedPart[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) copied.push({ type: "text", text: part.text });
    } else if (part.type === "file") {
      copied.push(await copiedFile(part, input, images));
    }
  }
  return copied;
}

/** Картинка — байтами через вложения (в пределах импорта); не вышло или не картинка — пометкой с именем. */
async function copiedFile(
  part: Extract<MessagePart, { type: "file" }>,
  input: CopyPersonChatInput,
  images: { count: number; bytes: number },
): Promise<ImportedPart> {
  const name = part.filename ?? "файл";
  const isImage = part.mediaType.startsWith("image/");
  const note: ImportedPart = { type: "text", text: isImage ? `[картинка: ${name}]` : `[файл: ${name}]` };
  const fileId = part.url.startsWith("attachment:") ? part.url.slice("attachment:".length) : null;
  if (!isImage || !fileId || !input.attachments?.importFile || images.count >= IMPORT_MAX_IMAGES) return note;
  const response = await input.attachments.handle({
    request: new Request(input.request.url, { method: "GET", headers: input.request.headers }),
    userId: input.personId,
    chatId: input.chatId,
    segments: [fileId],
  });
  if (!response.ok) return note;
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? part.mediaType;
  if (!mediaType.startsWith("image/") || bytes.length === 0 || images.bytes + bytes.length > IMPORT_MAX_IMAGE_BYTES) return note;
  images.count += 1;
  images.bytes += bytes.length;
  return { type: "image", bytes, mediaType, filename: name };
}
