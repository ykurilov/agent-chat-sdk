import type { ChatStorage, LongTermMemory } from "@ykurilov/agent-chat-core";
import { memoryInstructions } from "./instructions";
import { createManageMemoryTool } from "./manage-memory-tool";
import { createMemoryOperations, requiredStorageMethods } from "./memory-operations";
import type { MemoryOperations, MemoryStorage } from "./memory-operations";
import { defaultMemoryLimits } from "./note-rules";
import { createOwnerLock } from "./owner-lock";
import { createMergeHistory } from "./optimizer/merge-history";
import type { MergeHistory } from "./optimizer/merge-history";
import { optimizerRules, requiredOptimizerMethods, runMemoryOptimization } from "./optimizer/run-optimization";
import type { OptimizerStorage } from "./optimizer/run-optimization";
import { memoryToolTitles } from "./tool-titles";

export interface LongTermMemoryOptions {
  /** Хранилище чатов приложения: в нём должны быть методы памяти. */
  storage: ChatStorage;
  /** Записей на человека. По умолчанию 200. */
  maxNotes?: number;
  /** Знаков в сумме (разделы и тексты). По умолчанию 48 000. */
  maxTotalChars?: number;
  /** Записей в одном вызове `create`. По умолчанию 5. */
  maxBatch?: number;
  /** Знаков в блоке памяти, который идёт в запрос. По умолчанию 12 000. */
  maxBlockChars?: number;
  /**
   * Проверка дублей после ответа: модель, что вела ход, предлагает слить повторы, код проверяет и применяет, слияние
   * можно вернуть. Не задано — включена, если хранилище умеет (иначе выключена); `false` — выключена;
   * объект — включена, и хранилище обязано уметь. Отдельной модели для проверки нет.
   */
  optimizer?: { intervalHours?: number } | false;
}

export type ConfiguredLongTermMemory = LongTermMemory & {
  /** Названия строк вызова инструмента для ленты чата. */
  toolTitles: typeof memoryToolTitles;
  /** Имена инструментов памяти: ядро проверит их на повтор с инструментами приложения. */
  toolNames: readonly string[];
} & Pick<MemoryOperations, "list" | "create" | "createMany" | "update" | "remove" | "clear" | "search"> &
  MergeHistory;

/** Хранилище не умеет хранить память: в нём нет части методов. */
export class MemoryStorageNotSupportedError extends Error {
  constructor(readonly missing: string[]) {
    super(`Хранилище не поддерживает долгую память: нет методов ${missing.join(", ")}`);
    this.name = "MemoryStorageNotSupportedError";
  }
}

/** Собирает долгую память: инструкция, инструмент `manage_memory`, блок для запроса и действия для сервера. */
export function createLongTermMemory(options: LongTermMemoryOptions): ConfiguredLongTermMemory {
  const missing = requiredStorageMethods.filter((method) => typeof options.storage[method] !== "function");
  if (missing.length > 0) throw new MemoryStorageNotSupportedError(missing);
  const limits = {
    maxNotes: options.maxNotes ?? defaultMemoryLimits.maxNotes,
    maxTotalChars: options.maxTotalChars ?? defaultMemoryLimits.maxTotalChars,
    maxBatch: options.maxBatch ?? defaultMemoryLimits.maxBatch,
    maxBlockChars: options.maxBlockChars ?? defaultMemoryLimits.maxBlockChars,
    searchLimit: defaultMemoryLimits.searchLimit,
  };
  const lock = createOwnerLock();
  const operations = createMemoryOperations(options.storage as MemoryStorage, limits, lock);
  const optimizer = optimizerIn(options);
  return {
    instructions: memoryInstructions,
    toolNames: ["manage_memory"],
    toolTitles: memoryToolTitles,
    tools: ({ ownerId }) => createManageMemoryTool(operations, ownerId),
    snapshot: ({ userId }) => operations.snapshot(userId),
    blocks: ({ userId }) => operations.blocks(userId),
    list: operations.list,
    create: operations.create,
    createMany: operations.createMany,
    update: operations.update,
    remove: operations.remove,
    clear: operations.clear,
    search: operations.search,
    ...createMergeHistory(options.storage, limits, lock),
    ...(optimizer && {
      afterAnswer: async ({ userId, model, recordUsage }) => {
        const result = await runMemoryOptimization({ storage: optimizer.storage, ownerId: userId, model, recordUsage, limits, rules: optimizer.rules, now: () => new Date() });
        // Сбой модели или хранилища: запуск уже закрыт с причиной, а в журнал сервера его отправит ядро.
        if (result.status !== "skipped" && result.cause !== undefined) throw result.cause;
      },
    }),
  };
}

/** Проверка дублей включена? Нужные методы хранилища, а с ними и правила запуска, или `null`. */
function optimizerIn(options: LongTermMemoryOptions): { storage: OptimizerStorage; rules: ReturnType<typeof optimizerRules> } | null {
  if (options.optimizer === false) return null;
  const missing = requiredOptimizerMethods.filter((method) => typeof options.storage[method] !== "function");
  if (missing.length > 0) {
    if (options.optimizer === undefined) return null;
    throw new MemoryStorageNotSupportedError(missing);
  }
  return { storage: options.storage as OptimizerStorage, rules: optimizerRules(options.optimizer?.intervalHours) };
}
