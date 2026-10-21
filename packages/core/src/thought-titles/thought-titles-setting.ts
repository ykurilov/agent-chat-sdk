import { findModel } from "../models/model-catalog";
import type { ModelCatalog } from "../models/model-catalog";
import type { ModelChoice } from "../models/model-choice";
import { languageOfText } from "./thought-title-text";

/** Что знает функция языка заголовков: чей чат и последнее сообщение человека текстом. */
export interface ThoughtTitleLanguageInput {
  ownerId: string;
  chatId: string;
  lastUserText: string;
}

/**
 * Заголовки раздумий вместо «Думал 3 сек» (`createChatService({ thoughtTitles })`). Провайдер сам отдаёт заголовки
 * (сводка рассуждений GPT через OpenRouter) — берутся они; иначе пересказ моделью `model`. Нет настройки — заголовков
 * нет, ход и запрос побайтно прежние.
 */
export interface ThoughtTitlesSetting {
  /**
   * `false` — выключено. Функция — решение на каждый ход (например, только для части людей); сбой функции — без
   * заголовков, строка в журнал. По умолчанию включено, если настройка задана.
   */
  enabled?: boolean | ((chat: { ownerId: string; chatId: string }) => boolean);
  /**
   * Дешёвая модель каталога для пересказа, например `{ modelId: "deepseek-4.1-flash", providerId: "deepseek",
   * reasoning: "off" }`. Нет — только заголовки провайдера и первые предложения коротких раздумий.
   */
  model?: ModelChoice;
  /**
   * Показывать заголовки тем, у кого нет права `reasoning` (по умолчанию да): включая `thoughtTitles`, приложение разрешает
   * показывать людям сжатую суть раздумий. Сам текст раздумий им не уходит. `false` — без права `reasoning` как раньше:
   * ни раздумий, ни заголовков.
   */
  showWithoutReasoning?: boolean;
  /**
   * Свои слова, которых не должно быть в заголовке: имена навыков, внутренние названия. Имена инструментов хода ядро
   * знает само. Например `async () => (await skills.manage.list()).map((skill) => skill.name)`. Сбой — без них, строка в журнал.
   */
  hiddenNames?: (chat: { ownerId: string; chatId: string }) => readonly string[] | Promise<readonly string[]>;
  /** Самый длинный заголовок, знаков. По умолчанию 60. */
  maxLength?: number;
  /** Сколько раз за ход звать модель заголовков. По умолчанию 6. */
  maxPerTurn?: number;
  /** Раздумье короче — без модели: первое предложение или прежняя подпись. По умолчанию 150 знаков. */
  minChars?: number;
  /** Срок ответа модели заголовков, мс. По умолчанию 8000. */
  timeoutMs?: number;
  /**
   * Язык заголовков: код («ru», «en») или функция хода. Нет или функция вернула пусто — по последнему сообщению
   * человека: есть кириллица — русский, иначе английский.
   */
  language?: string | ((input: ThoughtTitleLanguageInput) => string | undefined);
}

export interface ResolvedThoughtTitles {
  enabled?: (chat: { ownerId: string; chatId: string }) => boolean;
  showWithoutReasoning: boolean;
  hiddenNames?: ThoughtTitlesSetting["hiddenNames"];
  model?: ModelChoice;
  maxLength: number;
  maxPerTurn: number;
  minChars: number;
  timeoutMs: number;
  language?: ThoughtTitlesSetting["language"];
}

const positive = (name: string, value: number | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`thoughtTitles.${name}: нужно положительное число, а не ${String(value)}`);
  return value;
};

/** Настройка к одному виду; ошибка в ней — `TypeError` при создании службы. Выключено или нет — `null`. */
export function resolveThoughtTitles(setting: ThoughtTitlesSetting | undefined, catalog: ModelCatalog): ResolvedThoughtTitles | null {
  if (setting === undefined || setting.enabled === false) return null;
  if (setting.model) {
    try {
      findModel(catalog, setting.model.modelId, setting.model.providerId);
    } catch (error) {
      throw new TypeError(`thoughtTitles.model: ${(error as Error).message}`);
    }
  }
  if (setting.enabled !== undefined && typeof setting.enabled !== "boolean" && typeof setting.enabled !== "function") {
    throw new TypeError("thoughtTitles.enabled: нужно true, false или функция");
  }
  if (setting.language !== undefined && typeof setting.language !== "string" && typeof setting.language !== "function") {
    throw new TypeError("thoughtTitles.language: нужен код языка или функция");
  }
  if (setting.hiddenNames !== undefined && typeof setting.hiddenNames !== "function") throw new TypeError("thoughtTitles.hiddenNames: нужна функция");
  return {
    ...(typeof setting.enabled === "function" && { enabled: setting.enabled }),
    showWithoutReasoning: setting.showWithoutReasoning !== false,
    ...(setting.hiddenNames && { hiddenNames: setting.hiddenNames }),
    ...(setting.model && { model: setting.model }),
    maxLength: positive("maxLength", setting.maxLength, 60),
    maxPerTurn: Math.floor(positive("maxPerTurn", setting.maxPerTurn, 6)),
    minChars: positive("minChars", setting.minChars, 150),
    timeoutMs: positive("timeoutMs", setting.timeoutMs, 8000),
    ...(setting.language !== undefined && { language: setting.language }),
  };
}

/** Язык заголовков хода: настройка, иначе по сообщению человека. Сбой функции — по сообщению, строка в журнал. */
export function thoughtTitleLanguage(resolved: ResolvedThoughtTitles, input: ThoughtTitleLanguageInput, logError: (message: string) => void): string {
  const { language } = resolved;
  if (typeof language === "string" && language.trim()) return language.trim();
  if (typeof language === "function") {
    try {
      const chosen = language(input);
      if (typeof chosen === "string" && chosen.trim()) return chosen.trim();
    } catch (error) {
      logError(`[заголовок раздумья] thoughtTitles.language упала: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return languageOfText(input.lastUserText);
}

/** Включены ли заголовки в этом ходе; сбой функции `enabled` — нет, строка в журнал. */
export function thoughtTitlesEnabled(resolved: ResolvedThoughtTitles, chat: { ownerId: string; chatId: string }, logError: (message: string) => void): boolean {
  if (!resolved.enabled) return true;
  try {
    return resolved.enabled(chat) === true;
  } catch (error) {
    logError(`[заголовок раздумья] thoughtTitles.enabled упала: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Свои слова приложения для проверки заголовков; сбой функции — без них, строка в журнал. */
export async function thoughtTitleHiddenNames(resolved: ResolvedThoughtTitles, chat: { ownerId: string; chatId: string }, logError: (message: string) => void): Promise<string[]> {
  if (!resolved.hiddenNames) return [];
  try {
    const names = await resolved.hiddenNames(chat);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === "string") : [];
  } catch (error) {
    logError(`[заголовок раздумья] thoughtTitles.hiddenNames упала: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
