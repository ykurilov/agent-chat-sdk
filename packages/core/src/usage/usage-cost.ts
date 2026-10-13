import type { ModelPrice, ModelPriceRates } from "../models/model-catalog";
import { isPeakTime } from "./peak-hours";

const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Токены одного расхода. `inputTokens` включает кэш, `outputTokens` включает рассуждения. */
export interface UsageTokens {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
}

/** Расход одного запроса и когда он сделан (ISO): по времени выбирается цена часов пик. */
export type TimedUsageTokens = UsageTokens & { at?: string };

/**
 * Доллары за один запрос по ценам модели. Вход делится на три части: прочитанный из кэша, записанный
 * в кэш и обычный. Нет цены кэша — эта часть идёт по цене входа: дешевле, чем есть на самом деле, не считаем.
 * Модель пишет кэш на час (`cacheWriteTtl: "1h"`) — запись по часовой цене, нет её — по цене записи на 5 минут.
 * Рассуждения входят в выход и отдельно не прибавляются. Вход больше порога ступени — весь запрос по ценам ступени.
 * У цены есть часы пик и известно время запроса `at` — в пик цены умножаются (вход из кэша — своим множителем).
 * Время неизвестно — цена вне пика.
 */
export function costOfUsage(usage: UsageTokens, price: ModelPrice, at?: Date | string): number {
  const rates = peakRates(ratesFor(usage.inputTokens, price), price, at);
  const cachedRead = Math.min(usage.cachedInputTokens, usage.inputTokens);
  const cachedWrite = Math.min(usage.cacheWriteTokens, usage.inputTokens - cachedRead);
  const plainInput = usage.inputTokens - cachedRead - cachedWrite;
  const perMillion =
    plainInput * rates.inputPerMillion +
    cachedRead * (rates.cachedInputPerMillion ?? rates.inputPerMillion) +
    cachedWrite * (cacheWriteRate(rates, price) ?? rates.inputPerMillion) +
    usage.outputTokens * rates.outputPerMillion;
  return perMillion / TOKENS_PER_PRICE_UNIT;
}

/**
 * Доллары за ход из нескольких запросов: ступень цены у каждого запроса своя, по его входу, час пик — по его времени
 * (`at` шага; нет — `fallbackAt`, обычно начало хода).
 */
export function costOfSteps(steps: readonly TimedUsageTokens[], price: ModelPrice, fallbackAt?: Date | string): number {
  return steps.reduce((sum, step) => sum + costOfUsage(step, price, step.at ?? fallbackAt), 0);
}

function cacheWriteRate(rates: ModelPriceRates, price: ModelPrice): number | undefined {
  return price.cacheWriteTtl === "1h" ? (rates.cacheWrite1hPerMillion ?? rates.cacheWritePerMillion) : rates.cacheWritePerMillion;
}

function peakRates(rates: ModelPriceRates, price: ModelPrice, at: Date | string | undefined): ModelPriceRates {
  if (!price.peakHours || at === undefined) return rates;
  const moment = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(moment.getTime()) || !isPeakTime(price.peakHours, moment)) return rates;
  const { multiplier, cachedInputMultiplier = multiplier } = price.peakHours;
  return {
    inputPerMillion: rates.inputPerMillion * multiplier,
    outputPerMillion: rates.outputPerMillion * multiplier,
    ...(rates.cachedInputPerMillion !== undefined && { cachedInputPerMillion: rates.cachedInputPerMillion * cachedInputMultiplier }),
    ...(rates.cacheWritePerMillion !== undefined && { cacheWritePerMillion: rates.cacheWritePerMillion * multiplier }),
    ...(rates.cacheWrite1hPerMillion !== undefined && { cacheWrite1hPerMillion: rates.cacheWrite1hPerMillion * multiplier }),
  };
}

function ratesFor(inputTokens: number, price: ModelPrice): ModelPriceRates {
  let rates: ModelPriceRates = price;
  let passed = -1;
  for (const tier of price.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > passed) {
      rates = tier;
      passed = tier.inputTokensAbove;
    }
  }
  return rates;
}
