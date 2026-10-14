import type { AskModel, ChatService, RecordUsage } from "@ykurilov/agent-chat-core";
import { requestDecision } from "./decisions-client";
import type { FlowJudge, JudgeMessage, JudgeSettings, JudgeVerdict } from "./flow-types";
import { buildJudgeContext } from "./judge-context";

export const DEFAULT_JUDGE_THRESHOLD = 0.7;
export const DEFAULT_JUDGE_MODEL = "microsoft/microsoft-decision-1";
export const DEFAULT_JUDGE_TIMEOUT_MS = 5000;

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Что подменяют тесты. Окружение — откуда берутся ключ и адрес OpenRouter, если в настройках судьи их нет. */
export interface JudgeDeps {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  logError?: (message: string) => void;
}

interface Question {
  ownerId: string;
  chatId: string;
  goal?: string;
  why?: string;
  messages: JudgeMessage[];
  conditions: Array<{ exitId: string; text: string }>;
  signal?: AbortSignal;
}

const FALLBACK_INSTRUCTIONS =
  "Ты судья в диалоге человека с ИИ-агентом. Для каждого условия реши, выполнено ли оно по последним репликам. " +
  "Верни в met номера (id) только тех условий, которые явно выполнены. Сомневаешься — не включай.";

const FALLBACK_SCHEMA = {
  type: "object",
  properties: { met: { type: "array", items: { type: "string" } } },
  required: ["met"],
  additionalProperties: false,
};

const conditionQuestion = (text: string) => `Выполнено ли условие «${text}»?`;

/** Что судье нужно от службы чата. */
export type JudgePort = Pick<ChatService, "assertWithinLimit"> & { askModel: AskModel; recordUsage: RecordUsage };

/** Судья: decision-1, при сбое — запасная модель через `askModel`; расход — в журнал с `source: "judge"`. Служба — та, что ведёт чат вопроса. */
export function createFlowJudge(settings: JudgeSettings, port: (chat: { ownerId: string; chatId: string }) => JudgePort | Promise<JudgePort>, deps: JudgeDeps = {}): FlowJudge {
  const threshold = settings.threshold ?? DEFAULT_JUDGE_THRESHOLD;
  const model = settings.model ?? DEFAULT_JUDGE_MODEL;
  const timeoutMs = settings.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
  const env = deps.env ?? process.env;
  const logError = deps.logError ?? (() => {});

  /** Вероятности основного судьи по `id` условий; `null` — не ответил. Расход записывается, даже если ответ негодный. */
  async function askDecision(question: Question, conditions: Question["conditions"], state: unknown): Promise<Record<string, number> | null> {
    const apiKey = settings.openrouter?.apiKey ?? env.OPENROUTER_API_KEY;
    if (!apiKey) {
      logError("Судья: нет ключа OpenRouter, работает запасная модель");
      return null;
    }
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(question.signal ? [question.signal] : [])]);
    try {
      const response = await requestDecision(
        { apiKey, baseUrl: settings.openrouter?.baseUrl ?? env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL, ...(settings.openrouter?.headers && { headers: settings.openrouter.headers }), ...(deps.fetch && { fetch: deps.fetch }) },
        { model, state, questions: conditions.map(({ exitId, text }) => ({ id: exitId, instructions: conditionQuestion(text) })), signal },
      );
      try {
        await (await port(question)).recordUsage({
          ownerId: question.ownerId,
          chatId: question.chatId,
          source: "judge",
          cost: response.cost,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          modelId: model,
          providerId: "openrouter",
        });
      } catch (error) {
        logError(`Судья: расход не записан — ${errorText(error)}`);
      }
      if (conditions.some(({ exitId }) => response.answers[exitId] === undefined)) {
        logError("Судья: ответ без части вопросов, работает запасная модель");
        return null;
      }
      return response.answers;
    } catch (error) {
      logError(`Судья ${model}: ${errorText(error)}`);
      return null;
    }
  }

  /** Номера условий, которые запасная модель признала выполненными; `null` — не ответила. */
  async function askFallback(question: Question, conditions: Question["conditions"], state: unknown): Promise<Set<string> | null> {
    try {
      const result = await (await port(question)).askModel({
        ownerId: question.ownerId,
        chatId: question.chatId,
        model: settings.fallback,
        system: FALLBACK_INSTRUCTIONS,
        prompt: JSON.stringify({ ...(state as object), conditions: conditions.map(({ exitId, text }) => ({ id: exitId, text })) }),
        schema: FALLBACK_SCHEMA,
        source: "judge",
        ...(question.signal && { signal: question.signal }),
      });
      const met = (result.object as { met?: unknown } | undefined)?.met;
      if (!Array.isArray(met) || !met.every((id) => typeof id === "string")) throw new Error("ответ не по схеме");
      return new Set(met as string[]);
    } catch (error) {
      logError(`Судья, запасная модель: ${errorText(error)}`);
      return null;
    }
  }

  /** Решение по каждому условию (выполнено или нет), в порядке условий. `null` — не проверено. */
  async function judge(question: Question): Promise<JudgeVerdict[] | null> {
    const context = buildJudgeContext({
      ...(question.goal !== undefined && { goal: question.goal }),
      ...(question.why !== undefined && { why: question.why }),
      messages: question.messages,
      conditions: question.conditions,
    });
    // Лимит расходов исчерпан — не платить ни decision-1, ни запасной: «не проверено».
    try {
      await (await port(question)).assertWithinLimit(question.ownerId, question.chatId);
    } catch (error) {
      logError(`Судья не спрошен: ${errorText(error)}`);
      return null;
    }
    const answers = await askDecision(question, context.conditions, context.state);
    if (answers) {
      return context.conditions.map(({ exitId }) => ({ exitId, probability: answers[exitId]!, confirmed: answers[exitId]! >= threshold, source: "decision" }));
    }
    if (question.signal?.aborted) return null;
    const met = await askFallback(question, context.conditions, context.state);
    if (!met) return null;
    return context.conditions.map(({ exitId }) => ({ exitId, probability: met.has(exitId) ? 1 : 0, confirmed: met.has(exitId), source: "fallback" }));
  }

  return {
    async checkClaim({ ownerId, chatId, exitId, condition, goal, why, messages, signal }) {
      const verdicts = await judge({
        ownerId,
        chatId,
        ...(goal !== undefined && { goal }),
        ...(why !== undefined && { why }),
        messages,
        conditions: [{ exitId, text: condition }],
        ...(signal && { signal }),
      });
      return verdicts?.[0] ?? null;
    },
    async checkAll({ ownerId, chatId, goal, conditions, messages, signal }) {
      if (conditions.length === 0) return [];
      const verdicts = await judge({ ownerId, chatId, ...(goal !== undefined && { goal }), messages, conditions, ...(signal && { signal }) });
      return verdicts?.filter((verdict) => verdict.confirmed) ?? [];
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
