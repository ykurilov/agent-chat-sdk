import type { AgentChatMessage } from "../conversation/types";
import type { ThoughtTitles } from "./turn-thought-titles";

type MessagePart = AgentChatMessage["parts"][number];
type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;

/**
 * Ключ SDK в метаданных части рассуждения: там лежит заголовок раздумья (`thoughtTitle`). Новых полей хранилищам не
 * нужно, а перед запросом к модели ключ снимается (`withoutThoughtTitles`): запрос побайтно тот же.
 */
export const THOUGHT_TITLE_METADATA_KEY = "agentChat";

const ownOf = (part: ReasoningPart) => part.providerMetadata?.[THOUGHT_TITLE_METADATA_KEY] as { thoughtTitle?: unknown; thoughtTitleAsked?: unknown } | undefined;
const titleOfPart = (part: ReasoningPart): string | undefined => {
  const own = ownOf(part);
  return typeof own?.thoughtTitle === "string" ? own.thoughtTitle : undefined;
};

/** Сколько раздумий сообщения уже пересказывала модель заголовков: `maxPerTurn` — на ответ целиком, с продолжениями. */
export function askedThoughtTitlesOfParts(parts: readonly MessagePart[]): number {
  return parts.filter((part) => part.type === "reasoning" && ownOf(part)?.thoughtTitleAsked === true).length;
}

/** Заголовки из частей сообщения по порядковому номеру рассуждения. */
export function thoughtTitlesOfParts(parts: readonly MessagePart[]): ThoughtTitles {
  const titles: ThoughtTitles = {};
  let ordinal = 0;
  for (const part of parts) {
    if (part.type !== "reasoning") continue;
    const title = titleOfPart(part);
    if (title !== undefined) titles[String(ordinal)] = title;
    ordinal++;
  }
  return titles;
}

/**
 * Части с заголовками в метаданных рассуждений и отметкой «модель уже спрашивали» (`asked`); ничего не изменилось — тот
 * же массив.
 */
export function withThoughtTitles<Parts extends readonly MessagePart[]>(parts: Parts, titles: ThoughtTitles, asked: ReadonlySet<string> = new Set()): Parts {
  if (Object.keys(titles).length === 0 && asked.size === 0) return parts;
  let ordinal = 0;
  let changed = false;
  const decorated = parts.map((part) => {
    if (part.type !== "reasoning") return part;
    const key = String(ordinal++);
    const title = titles[key];
    const own = ownOf(part);
    const needsTitle = title !== undefined && own?.thoughtTitle !== title;
    const needsAsked = asked.has(key) && own?.thoughtTitleAsked !== true;
    if (!needsTitle && !needsAsked) return part;
    changed = true;
    return {
      ...part,
      providerMetadata: {
        ...part.providerMetadata,
        [THOUGHT_TITLE_METADATA_KEY]: { ...own, ...(title !== undefined && { thoughtTitle: title }), ...(asked.has(key) && { thoughtTitleAsked: true }) },
      },
    };
  });
  return (changed ? decorated : parts) as Parts;
}

/** История без заголовков раздумий: ключ SDK снят с метаданных рассуждений, пустые метаданные убраны. */
export function withoutThoughtTitles(messages: readonly AgentChatMessage[]): readonly AgentChatMessage[] {
  let changed = false;
  const cleaned = messages.map((message) => {
    if (message.role !== "assistant" || !message.parts.some(hasTitleKey)) return message;
    changed = true;
    return { ...message, parts: message.parts.map((part) => (hasTitleKey(part) ? withoutTitleKey(part) : part)) };
  });
  return changed ? cleaned : messages;
}

function hasTitleKey(part: MessagePart): part is ReasoningPart {
  return part.type === "reasoning" && part.providerMetadata !== undefined && THOUGHT_TITLE_METADATA_KEY in part.providerMetadata;
}

function withoutTitleKey(part: ReasoningPart): ReasoningPart {
  const { [THOUGHT_TITLE_METADATA_KEY]: _own, ...rest } = part.providerMetadata!;
  const { providerMetadata: _metadata, ...withoutMetadata } = part;
  return Object.keys(rest).length > 0 ? { ...withoutMetadata, providerMetadata: rest } : withoutMetadata;
}
