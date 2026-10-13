import { stripVoiceTags } from "@ykurilov/agent-chat-core";
import type { StoredMessage } from "@ykurilov/agent-chat-core";

interface ToolPart {
  type: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function toolText(part: ToolPart): string {
  const name = part.type === "dynamic-tool" ? (part.toolName ?? "tool") : part.type.slice("tool-".length);
  const result = part.errorText ?? (part.output === undefined ? "" : asText(part.output));
  return `[${name}] ${part.input === undefined ? "" : asText(part.input)} ${result}`.trim();
}

/**
 * Что в сообщении можно найти: слова человека и агента и вызовы инструментов. Рассуждения и картинки не читаются.
 * У ответа голосового хода (`voiceAnswer`) теги голоса вырезаны: человек их не видел. В остальных ответах скобки — текст.
 */
export function searchableText(message: StoredMessage, { voiceAnswer = false }: { voiceAnswer?: boolean } = {}): string {
  const texts: string[] = [];
  for (const part of message.parts) {
    if (part.type === "text") texts.push(voiceAnswer && message.role === "assistant" ? stripVoiceTags(part.text) : part.text);
    else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) texts.push(toolText(part as ToolPart));
  }
  return texts.join("\n");
}
