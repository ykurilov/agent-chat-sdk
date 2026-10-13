/** Зачем было обращение к модели: ответ в чате или служебная работа рядом с ним. */
export type ModelCallPurpose = "answer" | "compaction" | "memory" | "title" | "helper" | "other";

/** Одно обращение к модели целиком: что ушло, что пришло, сколько стоило. */
export interface ModelCallEvent {
  callId: string;
  chatId: string;
  ownerId: string;
  /** Ответ агента, если обращение внутри хода. */
  messageId: string | null;
  purpose: ModelCallPurpose;
  /** 1, 2… — повторы после сбоя провайдера. */
  attempt: number;
  modelId: string;
  providerId: string;
  request: {
    /** То, что ушло: prompt[0] system. */
    instructions: unknown;
    /** Остальной prompt. */
    messages: unknown[];
    tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
    /** temperature, maxOutputTokens, reasoning, providerOptions. */
    settings: Record<string, unknown>;
  };
  response: {
    text: string;
    reasoning: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    finishReason: string | null;
  };
  usage: {
    inputTokens: number;
    cachedInputTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  } | null;
  costUsd: number | null;
  startedAt: Date;
  firstChunkMs: number | null;
  durationMs: number;
  status: "complete" | "error" | "aborted";
  error: string | null;
}

/** Один вызов инструмента внутри хода. */
export interface ToolCallEvent {
  chatId: string;
  ownerId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  /** После cutToolResult — то, что увидит модель. */
  output: unknown;
  error: string | null;
  startedAt: Date;
  durationMs: number;
}

/** Наблюдатель хода: ядро сообщает ему о каждом обращении к модели и вызове инструмента. */
export interface TurnObserver {
  /** Синхронно, без ожидания; бросок ловится и уходит в logError. */
  modelCall(event: ModelCallEvent): void;
  toolCall(event: ToolCallEvent): void;
}
