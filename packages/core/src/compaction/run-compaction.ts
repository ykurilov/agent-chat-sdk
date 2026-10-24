import { generateText } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { buildModelRequest } from "../agent-run/build-model-request";
import type { ModelCallObservation } from "../agent-run/observe-model-calls";
import { cutToolResult } from "../agent-run/tool-result-limit";
import type { MessageAttachments } from "../attachments/message-attachments";
import type { ServiceBlockFormat } from "../agent-run/forged-blocks";
import { addTokenUsage, emptyTokenUsage, isEmptyTokenUsage } from "../conversation/token-usage";
import type { AgentChatMessage, TokenUsage } from "../conversation/types";
import { findModel } from "../models/model-catalog";
import type { ModelCatalog } from "../models/model-catalog";
import { classifyProviderError } from "../provider-errors/classify-provider-error";
import type { ResolvedCompactionSettings } from "./compaction-settings";
import { compactionTask, shrinkRequest } from "./compaction-task";
import { isReservedKey } from "../frozen-context/context-blocks";

/** Сколько раз можно просить ужать сводку, вылезшую за потолок. */
const MAX_SHRINK_ATTEMPTS = 2;
/** Потолок вывода — вдвое больше потолка сводки: чтобы сводка, вылезшая за потолок, не обрывалась молча. */
const OUTPUT_LIMIT_FACTOR = 2;
/**
 * Запас на рассуждения для моделей, которым их нельзя выключить: рассуждения считаются в потолок вывода и без запаса
 * съедали бы его, а сводка обрывалась бы по длине.
 */
const REASONING_HEADROOM_TOKENS = 8_000;
const COMPACTION_TIMEOUT_MS = 10 * 60_000;
/** До скольких знаков сокращаются результаты инструментов в повторе после переполнения (FR-014). */
const OVERFLOW_TOOL_RESULT_LENGTH = 2000;

/** Сжатие не вышло. Текст без переписки и без сырых сообщений провайдера. */
export class CompactionFailedError extends Error {
  /** Что уже оплачено до провала (например, сводка пришла пустой): такой расход всё равно попадает в журнал. */
  usage?: TokenUsage;
  constructor(reason: string, options?: { cause?: unknown; usage?: TokenUsage }) {
    super(`Не удалось сжать историю: ${reason}`, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CompactionFailedError";
    if (options?.usage) this.usage = options.usage;
  }
}

export interface CompactionRunInput {
  catalog: ModelCatalog;
  env: Record<string, string | undefined>;
  chatId: string;
  /** Чем сжимаем: по умолчанию модель чата. */
  model: { modelId: string; providerId: string };
  /** Те же инструкция и инструменты, что у обычного хода: префикс запроса и его кэш сохраняются. */
  instructions: string;
  tools?: ToolSet;
  /** Виджеты, которые чат может выключить: как у хода, прошлые вызовы выключенных — текстом. */
  switchableTools?: ReadonlySet<string>;
  /** Что сжимаем: история до границы включительно (со сводкой прежней записи, если она есть). */
  history: readonly AgentChatMessage[];
  /** Полная эффективная ветка: только для выбора app anchor, сообщения за границей в пересказ не идут. */
  contextHistory?: readonly AgentChatMessage[];
  /** Только пересказ шагов внутри текущего ответа: не сохраняется как общая сводка чата. */
  transient?: true;
  /** Вложения проходят тот же путь, что в обычном ходе: сводка видит текст файлов. */
  attachments?: MessageAttachments;
  /** Служебные форматы хода: поддельные блоки в прошлых ответах вырезаются так же, как в ходе (кэш хода). */
  serviceBlocks?: readonly ServiceBlockFormat[];
  settings: ResolvedCompactionSettings;
  /** Задание последним сообщением; по умолчанию — сводка всей переписки (`compactionTask`). */
  task?: string;
  abortSignal?: AbortSignal;
  logError: (message: string) => void;
  fetch?: typeof globalThis.fetch;
  /** Наблюдатель хода: обращения сжатия — событиями с назначением `compaction`. Нет — запрос как прежде. */
  observe?: Omit<ModelCallObservation, "purpose">;
}

export interface CompactionResult {
  summary: string;
  /** Размер сводки по числу провайдера: выход без рассуждений. */
  summaryTokens: number;
  /** Расход на все попытки. */
  usage: TokenUsage;
}

/**
 * Один запрос сжатия: та же модель и тот же префикс, что у обычного хода, задание последним сообщением, вызывать
 * инструменты нельзя. Сводка больше потолка ужимается повторно до двух раз; если всё равно больше — она
 * сохраняется, а превышение остаётся предупреждением в журнале. Запрос не влез в окно модели — один повтор,
 * где длинные результаты инструментов сокращены (FR-014): обычное сжатие их не трогает и берёт кэш хода.
 */
export async function runCompaction(input: CompactionRunInput): Promise<CompactionResult> {
  const { settings } = input;
  const { provider, profile } = findModel(input.catalog, input.model.modelId, input.model.providerId);
  // Сводке рассуждения не нужны: самый малый уровень модели, каким бы уровень ни был выбран в чате.
  const lowestLevel = profile.reasoning.levels?.[0];
  const mayStillReason = lowestLevel !== "off";
  const signal = AbortSignal.any([AbortSignal.timeout(COMPACTION_TIMEOUT_MS), ...(input.abortSignal ? [input.abortSignal] : [])]);
  const spent = emptyTokenUsage();
  try {
    const { observe, ...requestInput } = input;
    const maxOutputTokens = settings.summaryCeilingTokens * OUTPUT_LIMIT_FACTOR + (mayStillReason ? REASONING_HEADROOM_TOKENS : 0);
    const request = await buildModelRequest({
      ...requestInput,
      ...input.model,
      // Общая сводка не несёт privacy-схему: только публичные app blocks, без памяти/даты/места.
      // Пересказ шагов остаётся на прежнем пути без frozen blocks; никакого нового private opt-in.
      ...(!input.transient && { frozenContext: {
        group: true,
        includeKey: (key: string) => !isReservedKey(key),
        ...(input.contextHistory && { anchorHistory: input.contextHistory }),
      } }),
      // Бюджет рассуждений — от предела сводки, а не от потолка модели: иначе он больше предела.
      maxOutputTokens,
      ...(lowestLevel && { reasoning: lowestLevel }),
      ...(input.tools && { tools: inertTools(input.tools) }),
      ...(observe && { observe: { ...observe, purpose: "compaction" as const } }),
    });
    const task: ModelMessage = {
      role: "user",
      content: input.task ?? compactionTask({ summaryCeilingTokens: settings.summaryCeilingTokens, instruction: settings.instruction }),
    };
    let base: ModelMessage[] = [...request.messages, ...(request.noteAfterApprovals ?? []), task];
    let messages = base;
    let summary = "";
    let summaryTokens = 0;
    let shortened = false;
    for (let shrinks = 0; ; ) {
      let result: Awaited<ReturnType<typeof generateText>>;
      try {
        result = await generateText({
          model: request.model,
          instructions: request.instructions,
          messages,
          ...(request.tools && { tools: request.tools, toolChoice: "none" as const }),
          ...(request.providerOptions && { providerOptions: request.providerOptions }),
          ...(request.headers && { headers: request.headers }),
          ...(request.reasoning && { reasoning: request.reasoning }),
          maxOutputTokens,
          maxRetries: 0,
          abortSignal: signal,
        });
      } catch (error) {
        if (shortened || classifyProviderError(error, provider) !== "context_overflow") throw error;
        shortened = true;
        base = withShortToolResults(base);
        messages = withShortToolResults(messages);
        continue;
      }
      addTokenUsage(spent, result.totalUsage);
      if (result.finishReason === "length") throw new CompactionFailedError("сводка оборвана по длине");
      // Сводка хранится как есть: слова в скобках в ней законные, вырезать их нельзя.
      // Символ с кодом ноль выбрасывается: Postgres не принимает его в колонке `text`, и запись сжатия падала бы при каждой попытке.
      summary = result.text.replace(/\u0000/g, "").trim();
      if (summary === "") throw new CompactionFailedError("модель не вернула сводку");
      summaryTokens = Math.max(
        0,
        (result.totalUsage.outputTokens ?? 0) - (result.totalUsage.outputTokenDetails?.reasoningTokens ?? 0),
      );
      if (summaryTokens <= settings.summaryCeilingTokens) break;
      if (shrinks >= MAX_SHRINK_ATTEMPTS) {
        input.logError(
          `Сжатие чата ${input.chatId}: сводка на ${summaryTokens} токенов не уместилась в потолок ${settings.summaryCeilingTokens}, сохранена как есть`,
        );
        break;
      }
      shrinks++;
      messages = [
        ...base,
        { role: "assistant", content: summary },
        { role: "user", content: shrinkRequest({ summaryTokens, summaryCeilingTokens: settings.summaryCeilingTokens }) },
      ];
    }
    return { summary, summaryTokens, usage: spent };
  } catch (error) {
    const usage = isEmptyTokenUsage(spent) ? undefined : spent;
    if (error instanceof CompactionFailedError) {
      if (usage) error.usage = usage;
      throw error;
    }
    throw new CompactionFailedError(classifyProviderError(error, provider), { cause: error, ...(usage && { usage }) });
  }
}

/**
 * Результаты инструментов длиннее `OVERFLOW_TOOL_RESULT_LENGTH` знаков — их начало с пометкой (текст и JSON; картинки
 * и прочее содержимое — как есть). Остальные сообщения те же.
 */
function withShortToolResults(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "tool-result") return part;
        const { output } = part;
        if (output.type !== "text" && output.type !== "json" && output.type !== "error-text" && output.type !== "error-json") return part;
        const cut = cutToolResult(output.value, OVERFLOW_TOOL_RESULT_LENGTH);
        if (!cut.cut) return part;
        const isError = output.type === "error-text" || output.type === "error-json";
        return { ...part, output: { type: isError ? ("error-text" as const) : ("text" as const), value: cut.text } };
      }),
    };
  });
}

/** Инструменты остаются в запросе описанием (кэш), но выполняться не могут, даже если модель их вызовет. */
function inertTools(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).map(([name, definition]) => [name, { ...definition, execute: undefined }]));
}
