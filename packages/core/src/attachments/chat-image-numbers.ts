import type { AgentChatMessage } from "../conversation/types";
import { isHumanMessage } from "../agent-run/channel-notes";

/** @internal Серверная метка: создаётся ядром вместе с принятой картинкой, не из входных data-частей. */
export const CHAT_IMAGE_NUMBER_PART = "data-chat-image-number";

export interface ChatImageReference {
  number: number;
  attachmentId: string;
  /** Первое сообщение с этой нумерованной картинкой в выбранной ветке. */
  messageId: string;
}

const PREFIX = "attachment:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function imageId(part: AgentChatMessage["parts"][number]): string | undefined {
  if (part.type !== "file" || !part.mediaType.startsWith("image/") || !part.url.startsWith(PREFIX)) return undefined;
  const id = part.url.slice(PREFIX.length);
  return UUID.test(id) ? id : undefined;
}

/** @internal Читается только сохранённая сервером метка, сопряжённая с картинкой того же сообщения. */
export function chatImageReferences(messages: readonly Pick<AgentChatMessage, "id" | "role" | "parts">[]): ChatImageReference[] {
  const byId = new Map<string, ChatImageReference>();
  const byNumber = new Map<number, string>();
  for (const message of messages) {
    if (!isHumanMessage(message)) continue;
    const files = new Set(message.parts.map(imageId).filter((id) => id !== undefined));
    for (const part of message.parts) {
      if (part.type !== CHAT_IMAGE_NUMBER_PART) continue;
      const data = part.data as { attachmentId?: unknown; number?: unknown } | undefined;
      if (!data || typeof data.attachmentId !== "string" || !files.has(data.attachmentId) || !Number.isSafeInteger(data.number) || (data.number as number) < 1) continue;
      const number = data.number as number;
      const existing = byId.get(data.attachmentId);
      if ((existing && existing.number !== number) || (byNumber.has(number) && byNumber.get(number) !== data.attachmentId)) throw new Error("Повреждены серверные номера картинок чата");
      byNumber.set(number, data.attachmentId);
      if (!existing) byId.set(data.attachmentId, { number, attachmentId: data.attachmentId, messageId: message.id });
    }
  }
  return [...byId.values()].sort((a, b) => a.number - b.number);
}

/** Один снимок ВСЕХ сообщений чата под его арендой: скрытая ветка резервирует номера навсегда. */
export function numberedImageParts(history: readonly AgentChatMessage[], parts: AgentChatMessage["parts"]): AgentChatMessage["parts"] {
  if (!parts.some(part => imageId(part) !== undefined)) return parts;
  const references = chatImageReferences(history);
  const numbers = new Map(references.map(ref => [ref.attachmentId, ref.number]));
  let max = references.at(-1)?.number ?? 0;
  return parts.flatMap((part) => {
    const id = imageId(part);
    if (!id) return [part];
    let number = numbers.get(id);
    if (number === undefined) {
      if (max === Number.MAX_SAFE_INTEGER) throw new Error("Исчерпаны номера картинок чата");
      number = ++max;
      numbers.set(id, number);
    }
    return [part, { type: CHAT_IMAGE_NUMBER_PART, data: { attachmentId: id, number } }];
  });
}
