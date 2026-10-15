import type { AgentAudience, AgentChannel, ChatSubject } from "../conversation/types";
import type { StaffActor } from "../turn-hooks/turn-hooks";

/**
 * Кто смотрит на ход: права и признаки человека, которые приложение берёт из своей базы (`agent.viewer`). Ядро его не
 * читает, только передаёт. `isAdmin` — общий признак для пакетов (серверы MCP, навыки): «только админы» видны, когда он
 * `true`. Остальные поля — свои у приложения.
 */
export interface AgentViewer {
  isAdmin?: boolean;
  readonly [key: string]: unknown;
}

/** Что видит `agent.viewer` в начале хода. */
export interface AgentViewerInput {
  /** Кто делает ход: сотрудник в копии чата человека, иначе владелец чата. */
  userId: string;
  chatId: string;
  /** Владелец чата. */
  ownerId: string;
  /** Ответ агента, который строит этот ход; у фонового помощника — пустая строка. */
  messageId: string;
  chat: { data?: Record<string, unknown> };
  subject?: ChatSubject;
  channel: AgentChannel;
  audience: AgentAudience;
  staff?: StaffActor;
  /** «Стоп» и срок хода. */
  abortSignal: AbortSignal;
}

/**
 * Права человека на ход: зовётся один раз в начале хода (повторная попытка и запасной провайдер не зовут снова), до
 * блоков контекста и сборки инструментов. Итог идёт полем `viewer` в `contextBlocks` и в `AgentToolsModel`; в запрос к
 * модели сам не попадает. Бросила или вернула не объект — ход кончается ошибкой.
 */
export type AgentViewerSource = (input: AgentViewerInput) => AgentViewer | Promise<AgentViewer>;

/** `agent.viewer` бросила или вернула не объект: ход кончается ошибкой, в журнал сервера — причина. */
export class AgentViewerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentViewerError";
  }
}

/** Зовёт `agent.viewer`: итог заморожен (правка не доходит до хода), «Стоп» обрывает ожидание. */
export async function resolveAgentViewer(source: AgentViewerSource, input: AgentViewerInput): Promise<AgentViewer> {
  input.abortSignal.throwIfAborted();
  let viewer: unknown;
  try {
    viewer = await Promise.race([
      Promise.resolve().then(() => source(input)),
      new Promise<never>((_, reject) => input.abortSignal.addEventListener("abort", () => reject(input.abortSignal.reason), { once: true })),
    ]);
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    throw new AgentViewerError(`agent.viewer бросила: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (typeof viewer !== "object" || viewer === null || Array.isArray(viewer)) throw new AgentViewerError("agent.viewer вернула не объект");
  return Object.freeze({ ...(viewer as AgentViewer) });
}

/** Вход `agent.viewer` из полей хода. */
export function viewerInput(turn: {
  chatId: string;
  ownerId?: string;
  messageId: string;
  chatData?: Record<string, unknown>;
  subject?: ChatSubject;
  channel?: AgentChannel;
  audience: AgentAudience;
  staff?: StaffActor;
  abortSignal: AbortSignal;
}): AgentViewerInput {
  const ownerId = turn.ownerId ?? "";
  return {
    userId: turn.staff?.id ?? ownerId,
    chatId: turn.chatId,
    ownerId,
    messageId: turn.messageId,
    chat: structuredClone({ ...(turn.chatData && { data: turn.chatData }) }),
    ...(turn.subject && { subject: structuredClone(turn.subject) }),
    channel: turn.channel ?? "web",
    audience: turn.audience,
    ...(turn.staff && { staff: structuredClone(turn.staff) }),
    abortSignal: turn.abortSignal,
  };
}

/** Срок `agent.viewer` вне хода человека (сжатие истории, фоновый помощник): «Стопа» там нет, зависание не держит работу. */
export const VIEWER_OUTSIDE_TURN_TIMEOUT_MS = 10_000;

/** `agent.viewer` для сжатия и фонового помощника: те же правила, что в ходе, плюс срок ответа. */
export async function resolveViewerOutsideTurn(
  source: AgentViewerSource,
  turn: Omit<Parameters<typeof viewerInput>[0], "abortSignal">,
  signal?: AbortSignal,
): Promise<AgentViewer> {
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new AgentViewerError(`agent.viewer не ответила за ${VIEWER_OUTSIDE_TURN_TIMEOUT_MS / 1000} с`)),
    VIEWER_OUTSIDE_TURN_TIMEOUT_MS,
  );
  try {
    return await resolveAgentViewer(source, viewerInput({ ...turn, abortSignal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal }));
  } finally {
    clearTimeout(timer);
  }
}
