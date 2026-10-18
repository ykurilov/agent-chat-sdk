import { isExternalContentTool } from "../external-content/external-content";
import { generateText, stepCountIs } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { emptyTokenUsage, addTokenUsage } from "../conversation/token-usage";
import type { AgentChatMessage, ChatErrorKind, UsageSource } from "../conversation/types";
import { findModel } from "../models/model-catalog";
import type { ModelCatalog, ProviderDescription } from "../models/model-catalog";
import { classifyProviderError, isKeyLimit } from "../provider-errors/classify-provider-error";
import { describeProviderFailure } from "../provider-errors/provider-failure-log";
import { createProviderOutages, isProviderOutage } from "../provider-errors/provider-outages";
import type { ProviderOutageKind, ProviderOutages } from "../provider-errors/provider-outages";
import type { ModelSilenceLimits } from "../provider-errors/model-silence";
import { SpendingLimitReachedError } from "../spending/spending-limits";
import type { ChatStorage } from "../storage/chat-storage";
import { environmentSecrets } from "../text/scrub-secrets";
import { prepareToolApproval } from "../tool-approval/tool-approval-policy";
import { recordSpentTokens } from "../usage/record-usage";
import { buildModelRequest } from "../agent-run/build-model-request";
import { lastStepSettings } from "../agent-run/last-step";
import { gateToolApproval, gateToolCalls } from "../agent-run/tool-call-gate";
import { decideNextAttempt, errorKindForPerson, fallbackProviders } from "../agent-run/next-attempt";
import type { ProviderFallbackSetting } from "../agent-run/next-attempt";
import { createRepairToolCall, describeToolInputRepair } from "../agent-run/repair-tool-call";
import type { AgentToolsModel } from "../agent-run/run-agent-turn";
import { withToolObserver } from "../agent-run/run-agent-turn";
import { withoutEndTurn } from "../agent-run/end-turn";
import { createToolQueue, withSequentialTools } from "../agent-run/sequential-tools";
import type { ResolvedSequentialTools, ToolQueue } from "../agent-run/sequential-tools";
import { trackToolErrors } from "../agent-run/tool-errors";
import { cutToolResult, resolveToolResultLimit } from "../agent-run/tool-result-limit";
import type { ResolvedToolResultLimit } from "../agent-run/tool-result-limit";
import { resolveToolTimeout, withToolTimeout } from "../agent-run/tool-timeout";
import type { ResolvedToolTimeout } from "../agent-run/tool-timeout";
import type { TurnObserver } from "../agent-run/turn-observer";
import type { AgentHelper, HelperPendingApproval, HelperProgress, HelperStep, HelperStepReport, RunHelperInput, RunHelperResult } from "./helper-types";

const DEFAULT_HELPER_MAX_STEPS = 10;
/** Результат вызова инструмента в шагах части: человеку хватает начала. */
const STEP_OUTPUT_MAX_LENGTH = 2048;
/** Что помощник отвечает, когда кончился лимит расходов: модель основного агента видит это итогом. */
export const HELPER_LIMIT_REACHED = "лимит исчерпан";
/** Id сообщения с заданием: постоянный, чтобы начало запроса помощника было тем же (кэш модели). */
const TASK_MESSAGE_ID = "helper-task";

/** Всё, что цикл помощника берёт у службы: хранилище, каталог, настройки инструментов, расход и наблюдатель. */
export interface HelperRunContext {
  storage: ChatStorage;
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  chatId: string;
  ownerId: string;
  /** Ответ основного агента, на который пишется расход; у фоновой задачи — `null`. */
  messageId: string | null;
  usageSource: Extract<UsageSource, "helper" | "background">;
  toolResultLimit?: ResolvedToolResultLimit;
  toolTimeout?: ResolvedToolTimeout;
  sequentialTools?: ResolvedSequentialTools;
  /** Очередь инструментов «по одному» чата: помощник делит её с основным агентом. */
  toolQueue?: ToolQueue;
  providerFallback?: ProviderFallbackSetting;
  /** Память службы об отказах провайдеров по деньгам и ключу. Нет — своя на запуск. */
  providerOutages?: ProviderOutages;
  modelSilence?: ModelSilenceLimits;
  turnObserver?: TurnObserver;
  /** Проверка лимита расходов перед каждым шагом; бросает `SpendingLimitReachedError`. Нет — без лимита. */
  assertWithinLimit?: () => Promise<void>;
  logError: (message: string) => void;
}

const HELPER_RUN_CONTEXT = Symbol("agent-chat-sdk.helper-run-context");
type ModelWithContext = AgentToolsModel & { [HELPER_RUN_CONTEXT]?: HelperRunContext };

/** Модель для `runHelper` с тем, что службе нужно для цикла помощника. Сам вид модели для инструментов не меняется. */
export function helperToolsModel(model: AgentToolsModel, context: HelperRunContext): AgentToolsModel {
  return { ...model, [HELPER_RUN_CONTEXT]: context } as ModelWithContext;
}

/**
 * Один запуск цикла помощника для пакета фона: шаги до итога, паузы ради подтверждения или сбоя; `onStep` — после
 * каждого шага. `priorMessages` — сохранённые шаги: цикл продолжает с них, предел шагов их учитывает. Модель — только
 * из `helperToolsModel`, иначе ошибка.
 */
export async function runHelper(input: RunHelperInput): Promise<RunHelperResult> {
  const context = (input.model as ModelWithContext)[HELPER_RUN_CONTEXT];
  if (!context) throw new Error("runHelper: модель не от службы чата — возьмите её из задачи фона (helperToolsModel)");
  let last: HelperStepReport | undefined;
  for await (const report of helperSteps({ ...input, context })) {
    last = report;
    await input.onStep(report);
  }
  const { progress, messages } = last!;
  if (progress.status === "failed") return { status: "failed", text: helperFailureText(progress.error), messages };
  return { status: progress.status === "awaiting_approval" ? "awaiting_approval" : "done", text: progress.text, messages };
}

export const helperFailureText = (reason: string | undefined) => `Помощник не справился: ${reason ?? "неизвестная ошибка"}`;

/**
 * Цикл помощника по шагу на запрос: каждый шаг — отчёт с сообщениями помощника и видом для человека. Последний отчёт —
 * итог: `done`, `failed` или `awaiting_approval`. «Стоп» (`abortSignal`) — бросок; сбой провайдера и лимит — `failed`.
 */
export async function* helperSteps(input: {
  name: string;
  helper: AgentHelper;
  task: string;
  model: AgentToolsModel;
  context: HelperRunContext;
  priorMessages?: readonly ModelMessage[];
  abortSignal: AbortSignal;
}): AsyncGenerator<HelperStepReport> {
  const { helper, task, context, abortSignal } = input;
  const messages: ModelMessage[] = [...(input.priorMessages ?? [])];
  const maxSteps = helper.maxSteps ?? DEFAULT_HELPER_MAX_STEPS;
  const { modelId } = helper.model;
  const outages = context.providerOutages ?? createProviderOutages({ now: Date.now, logError: context.logError });
  // Как у хода: запасные на паузе пропускаются, основной на паузе — сразу первый запасной.
  const allFallbackIds = fallbackProviders({
    catalog: context.catalog,
    modelId,
    chosenProviderId: helper.model.providerId,
    env: context.env,
    ...(context.providerFallback !== undefined && { setting: context.providerFallback }),
  });
  const fallbackProviderIds = allFallbackIds.filter((candidate) => outages.pausedKind(candidate) === undefined);
  const toolQueue = context.toolQueue ?? createToolQueue();
  let providerId = helper.model.providerId;
  let fallbackUsed = false;
  // Отказ основного по деньгам или ключу в этом запуске — причина для человека, если и запасные не ответят.
  let firstOutage: ProviderOutageKind | undefined;
  const primaryPaused = outages.admit(providerId);
  if (primaryPaused !== undefined && fallbackProviderIds[0] !== undefined) {
    context.logError(
      `[запасной провайдер] чат=${context.chatId} помощник=${input.name} модель=${modelId} с=${providerId} на=${fallbackProviderIds[0]} причина=${primaryPaused} основной на паузе`,
    );
    providerId = fallbackProviderIds[0];
  }
  // Чужой текст: вызов инструмента с пометкой `externalContent` хоть на одном шаге (и до перезапуска тоже).
  let externalContent = false;
  const report = (status: HelperProgress["status"], extra: Partial<HelperProgress> = {}): HelperStepReport => ({
    messages: [...messages],
    progress: { ...progressOf(task, messages), status, ...extra, ...(externalContent && { externalContent: true as const }) },
  });

  for (;;) {
    const stepsDone = messages.filter((message) => message.role === "assistant").length;
    if (context.assertWithinLimit) {
      try {
        await context.assertWithinLimit();
      } catch (error) {
        if (!(error instanceof SpendingLimitReachedError)) throw error;
        yield report("failed", { error: HELPER_LIMIT_REACHED });
        return;
      }
    }
    let provider: ProviderDescription | undefined;
    let response: ModelMessage[];
    let tools: ToolSet | undefined;
    try {
      const found = findModel(context.catalog, modelId, providerId);
      provider = found.provider;
      ({ response, tools } = await helperStep({ ...input, providerId, toolsModel: { ...input.model, profile: found.profile, providerId }, toolQueue, messages, stepsDone, maxSteps }));
    } catch (error) {
      if (abortSignal.aborted) throw error;
      const kind = classifyProviderError(error, provider);
      // С запасного — только провайдеры после него.
      const candidates = providerId === helper.model.providerId ? fallbackProviderIds : fallbackProviderIds.slice(fallbackProviderIds.indexOf(providerId) + 1);
      const next = decideNextAttempt({ outcome: "failed", kind, error, contentSeen: false }, { fallbackUsed, fallbackProviderIds: candidates });
      const outage = isProviderOutage(kind) ? kind : undefined;
      if (outage) {
        if (providerId === helper.model.providerId) firstOutage ??= outage;
        outages.report({
          providerId,
          kind: outage,
          ...(isKeyLimit(error) && { keyLimit: true }),
          ...(next.action === "fallback"
            ? { fallbackProviderId: next.providerId }
            : { fallbacksPaused: allFallbackIds.some((candidate) => candidate !== providerId && outages.pausedKind(candidate) !== undefined) }),
        });
      }
      if (next.action === "fallback") {
        context.logError(`[запасной провайдер] чат=${context.chatId} помощник=${input.name} модель=${modelId} с=${providerId} на=${next.providerId} причина=${kind}`);
        if (!outage) fallbackUsed = true;
        providerId = next.providerId;
        continue;
      }
      context.logError(describeProviderFailure(error, { chatId: context.chatId, modelId, providerId, kind, env: context.env, catalog: context.catalog }));
      yield report("failed", { error: FAILURE_REASONS[errorKindForPerson(kind, firstOutage)] });
      return;
    }
    outages.recovered(providerId);
    messages.push(...response);
    externalContent ||= callsExternalContentTool(messages, tools);
    const pendingApproval = pendingApprovalOf(messages, tools);
    if (pendingApproval) {
      yield report("awaiting_approval", { pendingApproval });
      return;
    }
    const finished = !hasToolCalls(response) || stepsDone + 1 >= maxSteps;
    yield report(finished ? "done" : "running");
    if (finished) return;
  }
}

/** Причина сбоя для модели основного агента: без сырого текста провайдера. */
const FAILURE_REASONS: Record<ChatErrorKind, string> = {
  overloaded: "провайдер модели перегружен",
  rate_limited: "провайдер модели ограничил частоту запросов",
  insufficient_funds: "у провайдера модели кончились средства",
  invalid_key: "провайдер модели не принял ключ",
  context_overflow: "задание не влезло в окно модели",
  other: "сбой модели",
};

/** Один шаг помощника: запрос к модели (его инструменты выполняются здесь же) и запись расхода. Отдаёт новые сообщения и инструменты шага. */
async function helperStep(input: {
  name: string;
  helper: AgentHelper;
  task: string;
  context: HelperRunContext;
  providerId: string;
  toolsModel: AgentToolsModel;
  toolQueue: ToolQueue;
  messages: readonly ModelMessage[];
  stepsDone: number;
  maxSteps: number;
  abortSignal: AbortSignal;
}): Promise<{ response: ModelMessage[]; tools: ToolSet | undefined }> {
  const { helper, context, providerId } = input;
  const startedAt = new Date().toISOString();
  // Последний шаг помощника — без инструментов: вызов вопреки запрету не выполняется. Одобренный человеком вызов
  // выполняется до первого шага (до `prepareStep`) и отказа не получает.
  let toolsClosed = false;
  const tools = helperOwnTools({ ...input, toolsClosed: () => toolsClosed });
  const approval = prepareToolApproval(tools, new Set());
  const history: AgentChatMessage[] = [{ id: TASK_MESSAGE_ID, role: "user", parts: [{ type: "text", text: input.task }] }];
  const request = await buildModelRequest({
    catalog: context.catalog,
    modelId: helper.model.modelId,
    providerId,
    chatId: context.chatId,
    sessionId: `helper:${input.name}:${context.ownerId}`,
    instructions: helper.instructions,
    history,
    ...(input.messages.length > 0 && { tailMessages: input.messages }),
    ...(approval.tools && { tools: approval.tools }),
    env: context.env,
    logError: context.logError,
    ...(context.modelSilence && { modelSilence: context.modelSilence }),
    ...(context.turnObserver && {
      observe: { observer: context.turnObserver, ownerId: context.ownerId, messageId: context.messageId ?? "", purpose: "helper" as const },
    }),
  });
  const result = await generateText({
    ...request,
    ...(approval.toolApproval && { toolApproval: gateToolApproval(approval.toolApproval, () => toolsClosed) }),
    stopWhen: stepCountIs(1),
    // Последний шаг помощника — без вызовов и с пометкой «подведи итог» в самом конце запроса.
    prepareStep: ({ messages }) => {
      const settings = lastStepSettings({ turnStep: input.stepsDone, maxSteps: input.maxSteps, messages });
      toolsClosed = settings !== undefined;
      return settings;
    },
    // Временные сбои повторяет обёртка модели из `buildModelRequest`.
    maxRetries: 0,
    abortSignal: input.abortSignal,
    repairToolCall: createRepairToolCall({
      onRepaired: (repair) => context.logError(describeToolInputRepair(repair, { chatId: context.chatId, modelId: helper.model.modelId, providerId })),
    }),
  });
  const spent = emptyTokenUsage();
  addTokenUsage(spent, result.usage);
  await recordSpentTokens({
    storage: context.storage,
    catalog: context.catalog,
    ownerId: context.ownerId,
    chatId: context.chatId,
    messageId: context.messageId,
    source: context.usageSource,
    modelId: helper.model.modelId,
    providerId,
    spent,
    startedAt,
    logError: context.logError,
  });
  return { response: result.responseMessages as ModelMessage[], tools };
}

/** Инструменты помощника под те же правила, что у основного агента: срок, очередь, обрезка, наблюдатель. */
function helperOwnTools(input: {
  helper: AgentHelper;
  context: HelperRunContext;
  toolsModel: AgentToolsModel;
  toolQueue: ToolQueue;
  /** Шаг без инструментов: вызов получает отказ. */
  toolsClosed: () => boolean;
}): ToolSet | undefined {
  const { context } = input;
  const source = input.helper.tools;
  // Пометка `endTurn` у инструмента помощника снимается: ход основного агента она не кончает.
  const own = withoutEndTurn(typeof source === "function" ? source(input.toolsModel) : source);
  if (!own || Object.keys(own).length === 0) return undefined;
  const limit = context.toolResultLimit ?? resolveToolResultLimit(undefined);
  const toolTimeout = context.toolTimeout ?? resolveToolTimeout(undefined);
  const timed = withToolTimeout(own, {
    timeoutFor: (toolName, declaredMs) => toolTimeout.forTool(toolName, declaredMs),
    onTimeout: (toolName, timeoutMs) => context.logError(`[инструмент не ответил] чат=${context.chatId} инструмент=${toolName} срок=${timeoutMs}мс`),
  });
  const queued = withSequentialTools(timed, {
    isSequential: (toolName) => context.sequentialTools?.isSequential(toolName) ?? false,
    queue: input.toolQueue,
    kindsFrom: own,
  });
  const tracked = trackToolErrors(gateToolCalls(queued, { closed: input.toolsClosed, kindsFrom: own }), {
    limit,
    secrets: environmentSecrets(context.env, context.catalog),
    onCut: (toolName, length) =>
      context.logError(`[результат обрезан] чат=${context.chatId} инструмент=${toolName} знаков=${length} предел=${limit.forTool(toolName)}`),
  });
  return context.turnObserver
    ? withToolObserver(tracked.tools, {
        observer: context.turnObserver,
        chatId: context.chatId,
        ownerId: context.ownerId,
        messageId: context.messageId ?? "",
        skip: new Set(),
        logError: context.logError,
      })
    : tracked.tools;
}

const contentOf = (message: ModelMessage): ReadonlyArray<Record<string, any>> =>
  typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content as ReadonlyArray<Record<string, any>>);

/** Среди вызовов есть инструмент с пометкой `externalContent`. */
const callsExternalContentTool = (messages: readonly ModelMessage[], tools: ToolSet | undefined): boolean =>
  messages.some(
    (message) => message.role === "assistant" && contentOf(message).some((part) => part.type === "tool-call" && isExternalContentTool(tools?.[part.toolName])),
  );

const hasToolCalls = (messages: readonly ModelMessage[]): boolean =>
  messages.some((message) => message.role === "assistant" && contentOf(message).some((part) => part.type === "tool-call"));

/** Запрос подтверждения последнего шага, на который ещё нет ответа; `title` — из инструмента помощника. */
function pendingApprovalOf(messages: readonly ModelMessage[], tools: ToolSet | undefined): HelperPendingApproval | undefined {
  const answered = new Set<string>();
  for (const message of messages) {
    for (const part of contentOf(message)) if (part.type === "tool-approval-response") answered.add(part.approvalId);
  }
  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  if (!lastAssistant) return undefined;
  const parts = contentOf(lastAssistant);
  const request = parts.find((part) => part.type === "tool-approval-request" && !answered.has(part.approvalId));
  if (!request) return undefined;
  const call = parts.find((part) => part.type === "tool-call" && part.toolCallId === request.toolCallId);
  const toolName: string = call?.toolName ?? "";
  const title = tools?.[toolName]?.title;
  return { approvalId: request.approvalId, toolName, ...(title && { title }), input: call?.input };
}

/** Шаги и текст помощника для человека: вызовы с коротким результатом и куски текста. */
function progressOf(task: string, messages: readonly ModelMessage[]): Pick<HelperProgress, "task" | "steps" | "text"> {
  const steps: HelperStep[] = [];
  const calls = new Map<string, Extract<HelperStep, { type: "tool" }>>();
  let text = "";
  for (const message of messages) {
    if (message.role === "assistant") {
      const written = contentOf(message)
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text as string)
        .join("");
      if (written) {
        steps.push({ type: "text", text: written });
        text = written;
      }
      for (const part of contentOf(message)) {
        if (part.type !== "tool-call") continue;
        const step: Extract<HelperStep, { type: "tool" }> = { type: "tool", toolName: part.toolName, input: part.input };
        calls.set(part.toolCallId, step);
        steps.push(step);
      }
    }
    if (message.role === "tool") {
      for (const part of contentOf(message)) {
        const step = part.type === "tool-result" ? calls.get(part.toolCallId) : undefined;
        if (step) Object.assign(step, stepOutcome(part.output));
      }
    }
  }
  return { task, steps, text };
}

function stepOutcome(output: { type: string; value?: unknown; reason?: string } | undefined): { output?: unknown; error?: string } {
  switch (output?.type) {
    case "text":
    case "json":
      return { output: shortOutput(output.value) };
    case "error-text":
      return { error: String(output.value) };
    case "error-json":
      return { error: JSON.stringify(output.value) };
    case "execution-denied":
      return { error: output.reason ?? "Действие отклонено" };
    default:
      return { output: shortOutput(output?.value ?? output) };
  }
}

function shortOutput(value: unknown): unknown {
  const cut = cutToolResult(value, STEP_OUTPUT_MAX_LENGTH);
  return cut.cut ? cut.text : value;
}
