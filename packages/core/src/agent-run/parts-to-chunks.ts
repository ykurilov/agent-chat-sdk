import type { UIMessageChunk } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { FROZEN_CONTEXT_PART_TYPE } from "../frozen-context/context-blocks";
import { END_TURN_PART_TYPE } from "./end-turn";

type MessagePart = AgentChatMessage["parts"][number];

/** Поля частей, нужные для кусков: части разных видов читаются через одно представление. */
interface PartView {
  type: string;
  text?: string;
  providerMetadata?: Record<string, never>;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  preliminary?: boolean;
  providerExecuted?: boolean;
  callProviderMetadata?: Record<string, never>;
  resultProviderMetadata?: Record<string, never>;
  title?: string;
  toolMetadata?: Record<string, never>;
  approval?: { id: string; approved?: boolean; reason?: string; requestReason?: string };
  id?: string;
  data?: unknown;
  sourceId?: string;
  url?: string;
  mediaType?: string;
  filename?: string;
  kind?: `${string}.${string}`;
}

/** Необязательное поле куска: нет значения — нет и поля. */
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

function toolChunks(part: PartView): UIMessageChunk[] {
  const toolCallId = part.toolCallId!;
  const dynamic = part.type === "dynamic-tool";
  const chunks: UIMessageChunk[] = [
    {
      type: "tool-input-available",
      toolCallId,
      toolName: dynamic ? part.toolName! : part.type.slice("tool-".length),
      input: part.input,
      ...optional("providerExecuted", part.providerExecuted),
      ...optional("providerMetadata", part.callProviderMetadata),
      ...optional("toolMetadata", part.toolMetadata),
      ...optional("title", part.title),
      ...(dynamic && { dynamic: true }),
    },
  ];
  if (part.approval) {
    const { id: approvalId, approved, reason, requestReason } = part.approval;
    chunks.push({ type: "tool-approval-request", approvalId, toolCallId, ...optional("reason", requestReason) });
    if (approved !== undefined) chunks.push({ type: "tool-approval-response", approvalId, approved, ...optional("reason", reason) });
  }
  if (part.state === "output-available") {
    chunks.push({
      type: "tool-output-available",
      toolCallId,
      output: part.output,
      ...optional("providerExecuted", part.providerExecuted),
      ...optional("providerMetadata", part.resultProviderMetadata),
      ...optional("preliminary", part.preliminary),
    });
  } else if (part.state === "output-error") {
    chunks.push({
      type: "tool-output-error",
      toolCallId,
      errorText: part.errorText ?? "",
      ...optional("providerExecuted", part.providerExecuted),
      ...optional("providerMetadata", part.resultProviderMetadata),
    });
  } else if (part.state === "output-denied") {
    chunks.push({ type: "tool-output-denied", toolCallId });
  }
  return chunks;
}

/**
 * Куски UI-потока, из которых клиент соберёт те же части: так продолжение после «Повторить» начинается для клиента
 * со скопированных шагов (и при переподключении тоже). Id текстов и рассуждений свои на каждую часть: иначе части
 * склеились бы. Каждый начатый шаг закрыт `finish-step`, чтобы следующий шаг хода начался с чистого листа.
 */
export function chunksForParts(parts: readonly MessagePart[]): UIMessageChunk[] {
  const chunks: UIMessageChunk[] = [];
  let stepOpen = false;
  parts.forEach((source, index) => {
    const part = source as unknown as PartView;
    // У рассуждения id свой (его кладёт сборщик), у текста id нет: берётся номер части.
    const id = part.type === "reasoning" && part.id ? part.id : `replay-${index}`;
    if (part.type === "step-start") {
      if (stepOpen) chunks.push({ type: "finish-step" });
      chunks.push({ type: "start-step" });
      stepOpen = true;
    } else if (part.type === "text" || part.type === "reasoning") {
      const kind = part.type;
      const metadata = optional("providerMetadata", part.providerMetadata);
      chunks.push(
        { type: `${kind}-start`, id, ...metadata },
        { type: `${kind}-delta`, id, delta: part.text ?? "" },
        { type: `${kind}-end`, id, ...metadata },
      );
    } else if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      chunks.push(...toolChunks(part));
    } else if (part.type === FROZEN_CONTEXT_PART_TYPE || part.type === END_TURN_PART_TYPE) {
      // Застывшие блоки и отметка `endTurn` — только для модели: клиенту не уходят.
    } else if (part.type.startsWith("data-")) {
      chunks.push({ type: part.type as `data-${string}`, ...optional("id", part.id), data: part.data });
    } else if (part.type === "source-url") {
      chunks.push({ type: "source-url", sourceId: part.sourceId!, url: part.url!, ...optional("title", part.title), ...optional("providerMetadata", part.providerMetadata) });
    } else if (part.type === "source-document") {
      chunks.push({
        type: "source-document",
        sourceId: part.sourceId!,
        mediaType: part.mediaType!,
        title: part.title ?? "",
        ...optional("filename", part.filename),
        ...optional("providerMetadata", part.providerMetadata),
      });
    } else if (part.type === "file" || part.type === "reasoning-file") {
      chunks.push({ type: part.type, url: part.url!, mediaType: part.mediaType!, ...optional("providerMetadata", part.providerMetadata) });
    } else if (part.type === "custom") {
      chunks.push({ type: "custom", kind: part.kind!, ...optional("providerMetadata", part.providerMetadata) });
    }
  });
  if (stepOpen) chunks.push({ type: "finish-step" });
  return chunks;
}
