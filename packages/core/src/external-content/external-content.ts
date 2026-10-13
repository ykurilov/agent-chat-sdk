import type { UIMessageChunk } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { APP_STATE_PART_TYPE } from "../app-state/app-state";
import { AGENT_NOTICE_PART_TYPE } from "../notices/agent-notice";

/**
 * Пометка инструмента «приносит чужой текст» (веб, письма, файлы, чужие системы): `metadata: { externalContent: true }`
 * в описании (`tool({ … })`). AI SDK копирует `metadata` в каждый вызов (`toolMetadata` части сообщения), модели оно не
 * уходит. Чат, где был такой вызов, остаётся «с чужим текстом»: живые демонстрации в нём не запускаются.
 */
export const EXTERNAL_CONTENT_KEY = "externalContent";

/** Временный кусок потока: в чат попал чужой текст. Клиент перестаёт запускать демонстрации, не дожидаясь истории. */
export const EXTERNAL_CONTENT_PART_TYPE = "data-external-content";

/**
 * Инструменты веб-пакета (`@ykurilov/agent-chat-web-tools`). Вызовы, сохранённые до 0.44, пометки не несут: их чужой
 * текст узнаётся по имени. Тест веб-пакета сверяет список с его набором.
 */
export const WEB_TOOL_NAMES: readonly string[] = ["web_search", "read_page", "page_screenshot"];

/**
 * Служебная пометка импорта (`importChat({ chat: { externalContent: true } })`): ключ состояния чата, закрытый от экрана
 * и `getChatState`, как все ключи `$…`.
 */
export const EXTERNAL_CONTENT_STATE_KEY = "$externalContent";

/** Источники поиска у провайдера модели (веб-поиск OpenAI, Anthropic и др.): чужой текст. */
const SOURCE_PART_TYPES: ReadonlySet<string> = new Set(["source-url", "source-document"]);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** У описания инструмента или у вызова (`toolMetadata`) есть пометка чужого текста. */
export function marksExternalContent(metadata: unknown): boolean {
  return isRecord(metadata) && metadata[EXTERNAL_CONTENT_KEY] === true;
}

/** Инструмент приносит чужой текст: пометка в его `metadata`. */
export function isExternalContentTool(tool: unknown): boolean {
  return isRecord(tool) && marksExternalContent(tool.metadata);
}

/** Итог инструмента сам сообщает о чужом тексте: так делает помощник, который вызывал инструмент с пометкой. */
const outputCarriesExternalContent = (output: unknown): boolean => isRecord(output) && output[EXTERNAL_CONTENT_KEY] === true;

function partCarriesExternalContent(role: AgentChatMessage["role"], part: AgentChatMessage["parts"][number]): boolean {
  const fields = part as Record<string, unknown>;
  // Файл человека: текст, картинка или документ со стороны. Свои картинки агента — в его ответе и не в счёт.
  if (part.type === "file") return role === "user";
  if (SOURCE_PART_TYPES.has(part.type)) return true;
  if (part.type === APP_STATE_PART_TYPE) return isRecord(fields.data) && isRecord(fields.data.set) && fields.data.set[EXTERNAL_CONTENT_STATE_KEY] === true;
  if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
    // Инструмент, который выполнил провайдер модели (его веб-поиск): итог пришёл со стороны.
    if (fields.providerExecuted === true) return true;
    const toolName = part.type === "dynamic-tool" ? fields.toolName : part.type.slice("tool-".length);
    if (typeof toolName === "string" && WEB_TOOL_NAMES.includes(toolName)) return true;
    return marksExternalContent(fields.toolMetadata) || outputCarriesExternalContent(fields.output);
  }
  if (part.type === AGENT_NOTICE_PART_TYPE) {
    const notices = isRecord(fields.data) ? fields.data.notices : undefined;
    return Array.isArray(notices) && notices.some((notice) => isRecord(notice) && notice[EXTERNAL_CONTENT_KEY] === true);
  }
  return false;
}

/**
 * Попал ли в чат чужой текст. Смотрит все сообщения чата, а не только текущую ветку: сообщения не удаляются ни сжатием,
 * ни правкой, и признак, раз появившись, не пропадает.
 */
export function chatHasExternalContent(messages: ReadonlyArray<Pick<AgentChatMessage, "role" | "parts">>): boolean {
  return messages.some((message) => message.parts.some((part) => partCarriesExternalContent(message.role, part)));
}

/** Кусок потока «в чате чужой текст». */
export const externalContentChunk = (): UIMessageChunk => ({ type: EXTERNAL_CONTENT_PART_TYPE, data: true, transient: true }) as UIMessageChunk;

/**
 * Следит за куском потока хода: вызов с пометкой (её несёт `toolMetadata` куска начала вызова), вызов, выполненный
 * провайдером (`providerExecuted`), итог с пометкой (помощник) или источник поиска у провайдера. `observe` отвечает `true` один раз — когда чужой текст пришёл впервые; дальше признак уже у клиента.
 */
export function createExternalContentWatch() {
  let external = false;
  const markedCalls = new Set<string>();
  return {
    /** Чужой текст уже в разговоре (история хода): `true`, если клиенту об этом ещё не сообщали. */
    announce(): boolean {
      if (external) return false;
      external = true;
      return true;
    },
    observe(chunk: UIMessageChunk): boolean {
      if (external) return false;
      const fields = chunk as Record<string, unknown>;
      const callId = typeof fields.toolCallId === "string" ? fields.toolCallId : undefined;
      if (SOURCE_PART_TYPES.has(chunk.type)) {
        external = true;
        return true;
      }
      if (callId && (marksExternalContent(fields.toolMetadata) || fields.providerExecuted === true)) markedCalls.add(callId);
      const outcome = chunk.type === "tool-output-available" || chunk.type === "tool-output-error";
      if (!outcome || !callId) return false;
      if (!markedCalls.has(callId) && !outputCarriesExternalContent(fields.output)) return false;
      external = true;
      return true;
    },
  };
}
