import type { ToolSet } from "ai";
import type { MessageAttachments } from "../attachments/message-attachments";
import type { ServiceBlockFormat } from "../agent-run/forged-blocks";
import type { AgentToolsSource } from "../agent-run/run-agent-turn";
import { resolveViewerOutsideTurn } from "../agent-run/agent-viewer";
import { turnChannelOf } from "../agent-run/channel-notes";
import type { AgentViewerSource } from "../agent-run/agent-viewer";
import type { TurnObserver } from "../agent-run/turn-observer";
import { loadCurrentBranch } from "../conversation/load-current-branch";
import { subjectOfChat } from "../conversation/types";
import { chatDataOfInput } from "../storage/chat-data";
import type { AgentChatMessage, Chat, StoredCompaction, StoredMessage, TokenUsage } from "../conversation/types";
import { findModel } from "../models/model-catalog";
import type { ModelCatalog } from "../models/model-catalog";
import { classifyProviderError } from "../provider-errors/classify-provider-error";
import { describeProviderFailure } from "../provider-errors/provider-failure-log";
import type { ChatStorage } from "../storage/chat-storage";
import { recordSpentTokens } from "../usage/record-usage";
import { answerStepsTask } from "./answer-steps";
import { applyCompaction } from "./compacted-history";
import { activeCompaction, contextSizeOf, isCompactionDue, planCompaction, planOverflowCompaction } from "./compaction-plan";
import { isContextNearLimit } from "./compaction-settings";
import type { ResolvedCompactionSettings } from "./compaction-settings";
import { CompactionFailedError, runCompaction } from "./run-compaction";
import { isCorrection } from "../steering/turn-steering";

/** После сбоя или пустой попытки («нечего сжимать») автоматическое сжатие в чате не пробуется заново столько времени. */
const RETRY_AFTER_PAUSE_MS = 5 * 60_000;
/** Сколько ждать, пока отменённое при остановке сжатие отпустит запрос: провайдер мог не услышать отмену. */
const ABORT_SETTLE_MS = 5_000;

/** Итог сжатия словами строки `[переполнение]`. */
const OVERFLOW_STATUS: Record<CompactionOutcome, string> = { compacted: "готово", "nothing-to-compact": "нечего сжимать", failed: "не вышло" };

/** Выбор, на котором идёт чат: им же сжимаем, если в настройках не задана другая модель. */
export interface CompactionChoice {
  modelId: string;
  providerId: string;
}

export type CompactionOutcome = "compacted" | "nothing-to-compact" | "failed";

/** Запись сжатия для экрана: без расхода и модели. */
export interface CompactionMarker {
  id: string;
  fromMessageId: string;
  throughMessageId: string;
  summary: string;
  summaryTokens: number;
  createdAt: string;
}

export interface CompactionService {
  /** История для ответа: активная запись применена. Контекст у предела окна — ждёт сжатия внутри вызова. */
  historyForAnswer(input: {
    chatId: string;
    /** Текущая ветка до вопроса включительно. */
    branch: readonly StoredMessage[];
    choice: CompactionChoice;
    /** «Стоп» хода: ожидание сжатия обрывается сразу (ошибкой отмены), само сжатие доделывается фоном. */
    abortSignal?: AbortSignal;
    /** Ответ, который ждёт сжатия: для событий наблюдателя хода. */
    answerId?: string;
  }): Promise<AgentChatMessage[]>;
  /**
   * Ответ закончился: если пора, запускает сжатие фоном. Признак «идёт сжатие» ставится сразу при вызове, до решения,
   * поэтому экран, узнавший о конце ответа, уже видит его. Промис готов, когда решение принято, а не когда сжатие готово.
   */
  afterAnswer(input: { chatId: string; answerId: string }): Promise<void>;
  /**
   * Штатная остановка: ждёт решения и идущие сжатия до `flushWaitMs`; оставшиеся отменяет, полусводка не записывается.
   * После возврата служба хранилище не трогает.
   */
  drain(): Promise<void>;
  /**
   * Чат удаляется: ждёт решения о сжатии, отменяет идущее сжатие чата без записи сводки и ждёт, пока оно отпустит
   * хранилище (не дольше пяти секунд: провайдер мог не услышать отмену).
   */
  cancel(chatId: string): Promise<void>;
  /**
   * Ход упёрся в окно модели (FR-012): сжимает, не глядя на порог и паузу после сбоя, и отдаёт историю для ответа.
   * Идущее сжатие чата ход дожидается, затем один раз дожимает до вопроса, если там осталось несжатое. `null` — сжимать
   * нечего, сжатие не вышло или выключено.
   * «Стоп» обрывает ожидание сразу (ошибкой отмены), само сжатие доделывается фоном.
   */
  compactForOverflow(input: {
    chatId: string;
    /** Текущая ветка до вопроса включительно, без ответа, который упёрся в окно. */
    branch: readonly StoredMessage[];
    /** Модель и провайдер хода: для строк журнала и как модель сжатия, если в настройках не задана своя. */
    choice: CompactionChoice;
    abortSignal?: AbortSignal;
    /** Ответ, упёршийся в окно: для событий наблюдателя хода. */
    answerId?: string;
  }): Promise<AgentChatMessage[] | null>;
  /**
   * Сжатие внутри хода: в окно не влез уже сам текущий ответ. Пересказывает его первые шаги `steps` запросом сжатия
   * по истории хода `history` (до ответа). Пересказ не хранится: он живёт только в запросах этого хода.
   * `null` — не вышло или сжатие выключено. «Стоп» отменяет запрос.
   */
  compactAnswerSteps(input: {
    chatId: string;
    history: readonly AgentChatMessage[];
    steps: AgentChatMessage["parts"];
    choice: CompactionChoice;
    abortSignal?: AbortSignal;
    /** Ответ, чьи шаги пересказываются: для событий наблюдателя хода. */
    answerId?: string;
  }): Promise<string | null>;
  /** Сжимает сейчас, не глядя на порог и паузу после сбоя. */
  compactNow(chatId: string, choice: CompactionChoice): Promise<CompactionOutcome>;
  /** Записи текущей ветки для разделителей в ленте. */
  markers(chatId: string, branch: readonly { id: string }[]): Promise<CompactionMarker[]>;
  isCompacting(chatId: string): boolean;
}

export interface CompactionServiceOptions {
  storage: ChatStorage;
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  /** `viewer` — права человека: инструменты сжатия те же, что у хода (кэш). */
  agent: { instructions: string; tools?: AgentToolsSource; viewer?: AgentViewerSource };
  attachments?: MessageAttachments;
  /** Служебные форматы хода: запрос сжатия чистит прошлые ответы так же, как ход (кэш хода). */
  serviceBlocks?: readonly ServiceBlockFormat[];
  /** `null` — автосжатие выключено; записи, уже сделанные, всё равно применяются к истории. */
  settings: ResolvedCompactionSettings | null;
  logError: (message: string) => void;
  fetch?: typeof globalThis.fetch;
  /** Часы для паузы после сбоя; в тестах подменяются. */
  now?: () => number;
  /** Наблюдатель хода: обращения сжатия — событиями с назначением `compaction`. Нет — запрос как прежде. */
  turnObserver?: TurnObserver;
  /** Своя инструкция чата (песочница): сжатие идёт с той же инструкцией, что и ход. Нет — `agent.instructions`. */
  instructionsFor?: (chat: Chat) => Promise<string>;
  /** Виджеты, которые чат может выключить: прошлые вызовы выключенных идут сжатию текстом, как ходу (кэш). */
  switchableTools?: ReadonlySet<string>;
}

/** Ветка по ответ включительно: поправки за ним и ответ на них сжатие по этому ответу не трогает. Ответа в ветке нет — вся ветка. */
function branchThroughAnswer(branch: StoredMessage[], answerId: string | undefined): StoredMessage[] {
  const index = branch.findIndex((message) => message.id === answerId);
  return index < 0 ? branch : branch.slice(0, index + 1);
}

export function createCompactionService(options: CompactionServiceOptions): CompactionService {
  const { storage, catalog, settings, logError } = options;
  const now = options.now ?? Date.now;
  const running = new Map<string, { done: Promise<CompactionOutcome>; cancel: () => void }>();
  /** Чаты, где после ответа решается, нужно ли сжатие (на этот срок чат считается сжимающимся). */
  const deciding = new Map<string, number>();
  const decisions = new Set<Promise<void>>();
  const pausedAt = new Map<string, number>();

  const pausedRecently = (chatId: string) => now() - (pausedAt.get(chatId) ?? -Infinity) < RETRY_AFTER_PAUSE_MS;

  /**
   * Одно сжатие на чат: пока оно идёт, тот же промис получают все, кто просит. `answerId` — ответ, ради которого
   * сжатие начато (для наблюдателя хода); присоединившиеся своего не передают.
   */
  function compact(chatId: string, choice: CompactionChoice, overflow?: OverflowTarget, answerId?: string): Promise<CompactionOutcome> {
    const existing = running.get(chatId);
    if (existing) return existing.done;
    const controller = new AbortController();
    const done = compactOnce(chatId, choice, controller.signal, overflow, answerId).finally(() => running.delete(chatId));
    running.set(chatId, { done, cancel: () => controller.abort() });
    return done;
  }

  /** Запрос сжатия стоил денег, даже если сервер остановили до записи сводки или сводка не получилась. */
  async function recordCompactionUsage(input: { chatId: string; model: { modelId: string; providerId: string }; spent: TokenUsage; startedAt: string }): Promise<void> {
    const ownerId = (await storage.getChat(input.chatId))?.ownerId;
    if (!ownerId) return;
    await recordSpentTokens({
      storage,
      catalog,
      ownerId,
      chatId: input.chatId,
      messageId: null,
      source: "compaction",
      modelId: input.model.modelId,
      providerId: input.model.providerId,
      spent: input.spent,
      startedAt: input.startedAt,
      logError,
    });
  }

  /** Без `overflow` — сжатие ветки из хранилища по обычному плану; с ним — ветки хода по плану переполнения. */
  async function compactOnce(
    chatId: string,
    choice: CompactionChoice,
    signal: AbortSignal,
    overflow?: OverflowTarget,
    answerId?: string,
  ): Promise<CompactionOutcome> {
    if (!settings) return "nothing-to-compact";
    const startedAt = new Date().toISOString();
    let model = { modelId: choice.modelId, providerId: choice.providerId };
    try {
      const branch = overflow?.branch ?? branchThroughAnswer(await loadCurrentBranch(storage, chatId), answerId);
      const compactions = await storage.listCompactions(chatId);
      const plan = (overflow ? planOverflowCompaction : planCompaction)({ branch, compactions, tailTokens: settings.tailTokens });
      if (!plan) {
        if (!overflow) pausedAt.set(chatId, now());
        return "nothing-to-compact";
      }
      overflow?.onStart();
      model = settings.model ?? model;
      const active = activeCompaction(branch, compactions);
      const history = applyCompaction(branch.slice(0, plan.throughIndex + 1), active);
      const chat = await storage.getChat(chatId);
      const ownerId = chat?.ownerId ?? "";
      const result = await runCompaction({
        catalog,
        env: options.env,
        chatId,
        model,
        instructions: await instructionsOf(chat),
        tools: await resolveTools(model, chat, chatId, ownerId, branch, signal),
          ...(options.switchableTools && { switchableTools: options.switchableTools }),
        ...observation(ownerId, answerId),
        history,
        contextHistory: applyCompaction(branch, active),
        ...(options.attachments && { attachments: options.attachments }),
        ...(options.serviceBlocks && { serviceBlocks: options.serviceBlocks }),
        settings,
        logError,
        abortSignal: signal,
        fetch: options.fetch,
      });
      await recordCompactionUsage({ chatId, model, spent: result.usage, startedAt });
      if (signal.aborted) return "failed";
      await storage.insertCompaction({
        id: crypto.randomUUID(),
        chatId,
        fromMessageId: plan.fromMessageId,
        throughMessageId: plan.throughMessageId,
        summary: result.summary,
        summaryTokens: result.summaryTokens,
        modelId: model.modelId,
        providerId: model.providerId,
        usage: result.usage,
        createdAt: new Date(now()).toISOString(),
      });
      pausedAt.delete(chatId);
      return "compacted";
    } catch (error) {
      if (error instanceof CompactionFailedError && error.usage) await recordCompactionUsage({ chatId, model, spent: error.usage, startedAt });
      // Отмена при остановке сервера — не сбой: ни паузы, ни записи в журнал.
      if (signal.aborted) return "failed";
      pausedAt.set(chatId, now());
      logError(compactionFailureLine(chatId, model, error));
      return "failed";
    }
  }

  /** Сбой провайдера — строка `[сбой провайдера]`, как у хода (FR-008); остальное (сводка оборвана, пуста) — прежняя строка. */
  function compactionFailureLine(chatId: string, model: { modelId: string; providerId: string }, error: unknown): string {
    if (error instanceof CompactionFailedError && error.cause !== undefined) {
      const kind = classifyProviderError(error.cause, findModel(catalog, model.modelId, model.providerId).provider);
      return describeProviderFailure(error.cause, { chatId, ...model, kind, env: options.env, catalog });
    }
    return `Сжатие чата ${chatId} не удалось: ${error instanceof Error ? error.message : "неизвестная ошибка"}`;
  }

  /** Инструкция запроса сводки: та же, что у ответа этого чата (начало запроса общее — кэш). */
  async function instructionsOf(chat: Chat | null): Promise<string> {
    return chat && options.instructionsFor ? options.instructionsFor(chat) : options.agent.instructions;
  }

  /** Наблюдатель хода для запроса сжатия; нет наблюдателя — пусто, запрос как прежде. */
  function observation(ownerId: string, answerId: string | undefined) {
    return options.turnObserver ? { observe: { observer: options.turnObserver, ownerId, messageId: answerId ?? null } } : {};
  }

  async function resolveTools(
    model: { modelId: string; providerId: string },
    chat: Chat | null,
    chatId: string,
    ownerId: string,
    branch: readonly Pick<AgentChatMessage, "role" | "parts">[],
    signal?: AbortSignal,
  ): Promise<ToolSet | undefined> {
    const { tools, viewer: viewerSource } = options.agent;
    if (typeof tools !== "function") return tools;
    // Объект чата, канал и группа — как у хода: набор инструментов совпадает с набором ответа (кэш), в группе — без админских.
    const subject = chat ? subjectOfChat(chat) : undefined;
    const chatData = chat ? chatDataOfInput(chat) : undefined;
    const { channel, group } = turnChannelOf(branch);
    const audience = group ? "group" : "private";
    const viewer =
      viewerSource &&
      (await resolveViewerOutsideTurn(viewerSource, { chatId, ownerId, messageId: "", ...(chatData && { chatData }), ...(subject && { subject }), channel, audience }, signal));
    // Сжатие идёт вне хода человека: места на экране у него нет, а браузеру сообщать об изменениях некому.
    return tools({
      profile: findModel(catalog, model.modelId, model.providerId).profile,
      providerId: model.providerId,
      chatId,
      ownerId,
      place: null,
      channel,
      audience,
      notifyDataChanged: (change) =>
        logError(`Инструмент сообщил об изменении данных «${String(change?.tag)}» во время сжатия чата ${chatId}: сообщение не отправлено`),
      ...(subject && { subject }),
      chat: { ...(chatData && { data: chatData }) },
      ...(viewer && { viewer }),
    });
  }

  return {
    async historyForAnswer({ chatId, branch, choice, abortSignal, answerId }) {
      abortSignal?.throwIfAborted();
      let compactions = await storage.listCompactions(chatId);
      if (settings && (await mustWaitForCompaction(chatId, branch, compactions, choice))) {
        await untilAborted(compact(chatId, choice, undefined, answerId), abortSignal);
        compactions = await storage.listCompactions(chatId);
      }
      return applyCompaction(branch, activeCompaction(branch, compactions));
    },

    afterAnswer({ chatId, answerId }) {
      if (!settings || running.has(chatId) || pausedRecently(chatId)) return Promise.resolve();
      deciding.set(chatId, (deciding.get(chatId) ?? 0) + 1);
      const decision = decideAfterAnswer(chatId, answerId).finally(() => {
        const left = (deciding.get(chatId) ?? 1) - 1;
        if (left > 0) deciding.set(chatId, left);
        else deciding.delete(chatId);
        decisions.delete(decision);
      });
      decisions.add(decision);
      return decision;
    },

    async drain() {
      const wait = settings?.flushWaitMs ?? 0;
      const started = Date.now();
      await withTimeout(Promise.allSettled([...decisions]), wait);
      const jobs = [...running.values()];
      await withTimeout(Promise.allSettled(jobs.map((job) => job.done)), Math.max(0, wait - (Date.now() - started)));
      // Не уложились в срок: отменяем без записи полусводки и ждём, пока запросы отпустят хранилище.
      for (const job of jobs) job.cancel();
      await withTimeout(Promise.allSettled(jobs.map((job) => job.done)), ABORT_SETTLE_MS);
    },

    async cancel(chatId) {
      await Promise.allSettled([...decisions]);
      const job = running.get(chatId);
      if (!job) return;
      job.cancel();
      await withTimeout(Promise.allSettled([job.done]), ABORT_SETTLE_MS);
    },

    async compactForOverflow({ chatId, branch, choice, abortSignal, answerId }) {
      abortSignal?.throwIfAborted();
      const line = (status: string) =>
        logError(`[переполнение] чат=${chatId} модель=${choice.modelId} провайдер=${choice.providerId} сжатие=${status}`);
      if (!settings) {
        line("выключено");
        return null;
      }
      const target: OverflowTarget = { branch, onStart: () => line("начато") };
      const joined = running.has(chatId);
      let outcome = await untilAborted(compact(chatId, choice, target, answerId), abortSignal);
      // Идущее сжатие было обычным: оно оставляет хвост и до вопроса не доходит. Тогда ещё одно — для переполнения;
      // граница уже у вопроса — ему нечего сжимать.
      if (joined) {
        const own = await untilAborted(compact(chatId, choice, target, answerId), abortSignal);
        if (own === "compacted" || outcome !== "compacted") outcome = own;
      }
      line(OVERFLOW_STATUS[outcome]);
      if (outcome !== "compacted") return null;
      return applyCompaction(branch, activeCompaction(branch, await storage.listCompactions(chatId)));
    },

    async compactAnswerSteps({ chatId, history, steps, choice, abortSignal, answerId }) {
      const line = (status: string) =>
        logError(`[переполнение] чат=${chatId} модель=${choice.modelId} провайдер=${choice.providerId} шаги ответа=${status}`);
      if (!settings) {
        line("выключено");
        return null;
      }
      line("начато");
      const startedAt = new Date().toISOString();
      const model = settings.model ?? { modelId: choice.modelId, providerId: choice.providerId };
      try {
        const chat = await storage.getChat(chatId);
        const ownerId = chat?.ownerId ?? "";
        const result = await runCompaction({
          catalog,
          env: options.env,
          chatId,
          model,
          instructions: await instructionsOf(chat),
          tools: await resolveTools(model, chat, chatId, ownerId, history, abortSignal),
          ...(options.switchableTools && { switchableTools: options.switchableTools }),
          ...observation(ownerId, answerId),
          history: [...history, { id: `${chatId}-answer-steps`, role: "assistant", parts: steps }],
          transient: true,
          ...(options.attachments && { attachments: options.attachments }),
        ...(options.serviceBlocks && { serviceBlocks: options.serviceBlocks }),
          settings,
          task: answerStepsTask(settings.summaryCeilingTokens),
          logError,
          ...(abortSignal && { abortSignal }),
          fetch: options.fetch,
        });
        await recordCompactionUsage({ chatId, model, spent: result.usage, startedAt });
        line("готово");
        return result.summary;
      } catch (error) {
        if (error instanceof CompactionFailedError && error.usage) await recordCompactionUsage({ chatId, model, spent: error.usage, startedAt });
        if (abortSignal?.aborted) return null;
        logError(compactionFailureLine(chatId, model, error));
        line("не вышло");
        return null;
      }
    },

    compactNow: (chatId, choice) => compact(chatId, choice),

    async markers(chatId, branch) {
      const compactions = await storage.listCompactions(chatId);
      return compactions.filter((record) => isOnBranch(record, branch)).map(toMarker);
    },

    isCompacting: (chatId) => running.has(chatId) || deciding.has(chatId),
  };

  /** Нужно ли сжатие после ответа; если да — запускает его фоном (признак «идёт сжатие» при этом не гаснет). */
  async function decideAfterAnswer(chatId: string, answerId: string): Promise<void> {
    try {
      const branch = await loadCurrentBranch(storage, chatId);
      const index = branch.findIndex((message) => message.id === answerId);
      const answer = branch[index];
      // За ответом могут стоять поправки и ответ на них; после нового вопроса человека решает уже его ответ.
      const answeredLater = branch.slice(index + 1).some((message) => message.role === "user" && !isCorrection(message));
      if (!answer || answeredLater || !answer.modelId || !answer.providerId) return;
      const { profile } = findModel(catalog, answer.modelId, answer.providerId);
      const compactions = await storage.listCompactions(chatId);
      if (!isCompactionDue({ branch: branchThroughAnswer(branch, answerId), compactions, contextWindowTokens: profile.contextWindowTokens, settings: settings! })) return;
      void compact(chatId, { modelId: answer.modelId, providerId: answer.providerId }, undefined, answerId);
    } catch (error) {
      logError(`Сжатие чата ${chatId}: не удалось проверить, нужно ли оно: ${error instanceof Error ? error.message : "неизвестная ошибка"}`);
    }
  }

  /** Ответ ждёт сжатия, если предыдущий ответ уже занял ≥ 90% окна модели и сжатие ещё не готово. */
  async function mustWaitForCompaction(
    chatId: string,
    branch: readonly StoredMessage[],
    compactions: readonly StoredCompaction[],
    choice: CompactionChoice,
  ): Promise<boolean> {
    const last = branch.findLast((message) => message.role === "assistant");
    const size = last ? contextSizeOf(last) : null;
    if (!last || size === null || last.status !== "complete") return false;
    const active = activeCompaction(branch, compactions);
    if (active && last.createdAt <= active.record.createdAt) return false;
    const { profile } = findModel(catalog, choice.modelId, choice.providerId);
    if (!isContextNearLimit(size, profile.contextWindowTokens)) return false;
    return running.has(chatId) || !pausedRecently(chatId);
  }
}

/** Сжатие по просьбе хода, упёршегося в окно: его ветка и отметка «начато», когда план готов. */
interface OverflowTarget {
  branch: readonly StoredMessage[];
  onStart: () => void;
}

/** Ждёт `work`, но обрывается сразу, как только сигнал отменён; сама работа при этом не останавливается. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Ждёт `work` не дольше `ms`; сама работа при этом не останавливается. */
async function withTimeout(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

function isOnBranch(record: StoredCompaction, branch: readonly { id: string }[]): boolean {
  const index = branch.findIndex((message) => message.id === record.throughMessageId);
  return index >= 0 && index + 1 < branch.length;
}

function toMarker(record: StoredCompaction): CompactionMarker {
  return {
    id: record.id,
    fromMessageId: record.fromMessageId,
    throughMessageId: record.throughMessageId,
    summary: record.summary,
    summaryTokens: record.summaryTokens,
    createdAt: record.createdAt,
  };
}
