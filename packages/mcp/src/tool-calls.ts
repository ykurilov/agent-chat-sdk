import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { cleanExternalText } from "./snapshot/tool-snapshot";
import type { McpCallResult, ServerConnection } from "./connection/server-connection";
import { McpError } from "./mcp-error";
import type { McpToolsModel } from "./mcp-servers";
import { modelToolName } from "./model-tools";
import { DEFAULT_RESULT_MAX_CHARS, reportedCostUsd, resultBody, resultForModel } from "./result-text";
import type { McpStore, StoredMcpServer } from "./types";

/** Пределы вызовов: защита от зацикленной модели и от счёта за чужой сервис. */
export interface McpCallLimits {
  /** Вызовов за один ход агента; по умолчанию 20. */
  callsPerTurn?: number;
  /** Вызовов в минуту на человека; по умолчанию 30. */
  callsPerMinute?: number;
}

/** Учёт расходов: запись идёт в то же хранилище, по которому ядро считает лимит. */
export interface McpSpending {
  storage: Pick<ChatStorage, "insertUsageRecord">;
  /** Стоимость вызова в долларах. По умолчанию — `_meta.costUsd` из ответа, если сервер его прислал. */
  costOf?: (result: McpCallResult, call: { serverId: string; prefix: string; toolName: string }) => number | undefined;
  logError?: (message: string) => void;
}

export interface ToolCallerDeps {
  store: McpStore;
  now: () => number;
  log: (line: string) => void;
  resultMaxChars?: number;
  limits?: McpCallLimits;
  spending?: McpSpending;
  /** Сервер и связь, если вызов сейчас разрешён; иначе `McpError`. */
  current(serverId: string, toolName: string, model: McpToolsModel): { server: StoredMcpServer; connection: ServerConnection };
}

export interface ToolCall {
  serverId: string;
  toolName: string;
  input: Record<string, unknown>;
  model: McpToolsModel;
  toolCallId: string;
  abortSignal?: AbortSignal;
}

const DEFAULT_CALLS_PER_TURN = 20;
const DEFAULT_CALLS_PER_MINUTE = 30;
const MINUTE_MS = 60_000;
/** Сколько ходов помнить для предела «за ход»: старые ходы давно закончились. */
const TURNS_REMEMBERED = 1_000;

/** Счётчики пределов в памяти процесса: за ход (по `turnId`) и скользящая минута на человека. */
function createCallLimiter(limits: McpCallLimits, now: () => number) {
  const perTurn = limits.callsPerTurn ?? DEFAULT_CALLS_PER_TURN;
  const perMinute = limits.callsPerMinute ?? DEFAULT_CALLS_PER_MINUTE;
  const turns = new Map<string, number>();
  const minutes = new Map<string, number[]>();

  return {
    /** Берёт место под вызов или отказывает понятным текстом — до запроса к серверу. */
    take(model: McpToolsModel) {
      const at = now();
      const recent = (minutes.get(model.ownerId) ?? []).filter((time) => time > at - MINUTE_MS);
      if (recent.length >= perMinute) {
        minutes.set(model.ownerId, recent);
        throw new McpError("limit", `Предел вызовов внешних сервисов: не больше ${perMinute} в минуту. Подожди минуту или ответь без инструмента.`);
      }
      if (model.turnId !== undefined) {
        const used = turns.get(model.turnId) ?? 0;
        if (used >= perTurn) throw new McpError("limit", `Предел вызовов внешних сервисов за один ход: ${perTurn}. Ответь по тому, что уже узнал.`);
        turns.delete(model.turnId);
        turns.set(model.turnId, used + 1);
        if (turns.size > TURNS_REMEMBERED) turns.delete(turns.keys().next().value!);
      }
      recent.push(at);
      minutes.set(model.ownerId, recent);
    },
  };
}

/** Вызов инструмента сервера: проверка доступа и пределов, запрос, журнал, расход, ответ для модели. */
export function createToolCaller(deps: ToolCallerDeps) {
  const limiter = createCallLimiter(deps.limits ?? {}, deps.now);
  const resultMaxChars = deps.resultMaxChars ?? DEFAULT_RESULT_MAX_CHARS;

  async function journal(server: StoredMcpServer, call: ToolCall, startedAt: number, error: string | undefined) {
    const durationMs = Math.max(0, deps.now() - startedAt);
    const record = {
      id: crypto.randomUUID(),
      serverId: server.id,
      toolName: call.toolName,
      ownerId: call.model.ownerId,
      chatId: call.model.chatId,
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      ok: error === undefined,
      ...(error !== undefined && { error }),
    };
    // Строка журнала сервера: кто, где, что и сколько — без входа, ответа и секретов.
    deps.log(
      `MCP: ${modelToolName(server.prefix, call.toolName)} owner=${call.model.ownerId} chat=${call.model.chatId} ${durationMs}ms ${error === undefined ? "ok" : `error: ${error}`}`,
    );
    await deps.store.recordCall(record).catch((caught: unknown) => deps.log(`MCP: журнал вызовов не записан: ${caught instanceof Error ? caught.message : String(caught)}`));
  }

  async function spend(server: StoredMcpServer, call: ToolCall, result: McpCallResult) {
    const spending = deps.spending;
    if (!spending) return;
    const costUsd = spending.costOf ? spending.costOf(result, { serverId: server.id, prefix: server.prefix, toolName: call.toolName }) : reportedCostUsd(result);
    if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd < 0) return;
    try {
      await spending.storage.insertUsageRecord({
        id: crypto.randomUUID(),
        ownerId: call.model.ownerId,
        chatId: call.model.chatId,
        messageId: null,
        source: "mcp_tool",
        modelId: modelToolName(server.prefix, call.toolName),
        providerId: "mcp",
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd,
        createdAt: new Date(deps.now()).toISOString(),
      });
    } catch (error) {
      spending.logError?.(`MCP: не удалось записать расход ${call.toolName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    async call(call: ToolCall): Promise<string> {
      const { server, connection } = deps.current(call.serverId, call.toolName, call.model);
      limiter.take(call.model);
      const startedAt = deps.now();
      let result: McpCallResult;
      try {
        result = await connection.callTool(call.toolName, call.input, call.abortSignal);
      } catch (error) {
        // «Стоп» человека: ядро должно увидеть свою остановку, а не ошибку сервера.
        const stopped = call.abortSignal?.aborted === true;
        const message = stopped ? "Вызов остановлен." : error instanceof McpError ? error.message : "Вызов не удался.";
        await journal(server, call, startedAt, message);
        if (stopped || error instanceof McpError) throw error;
        throw new McpError("unavailable", message);
      }
      await spend(server, call, result);
      if (result.isError === true) {
        // Текст ошибки пишет чужой сервер: чистим, как описания, коротко и без секретов (сервер мог повторить ключ из адреса).
        const message = connection.scrub(`Внешний сервис «${server.name}» вернул ошибку: ${cleanExternalText(resultBody(result), 500) || "без текста"}`);
        await journal(server, call, startedAt, message);
        throw new McpError("tool_error", message);
      }
      await journal(server, call, startedAt, undefined);
      return resultForModel(server.name, result, resultMaxChars);
    },
  };
}
