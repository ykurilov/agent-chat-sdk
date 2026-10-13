/**
 * Настройка `agent.modelSilenceTimeout`: сроки молчания потока модели, мс. `false` — без предела. У срока 0 или
 * `Infinity` — без этого срока. Время, пока выполняется серверный инструмент, молчанием модели не считается: поток шага
 * к этому времени уже закрыт, у инструмента свой предел (`agent.toolTimeoutMs`).
 */
export type ModelSilenceSetting = false | { firstChunkMs?: number; betweenChunksMs?: number };

/** Проверенные сроки молчания, мс; `Infinity` — срока нет. */
export interface ModelSilenceLimits {
  /** От запроса до первого куска ответа (текст, рассуждение, вызов). Сработал — тихий повтор, затем запасной провайдер. */
  firstChunkMs: number;
  /** Между кусками после начала ответа. Сработал — автопродолжение. */
  betweenChunksMs: number;
}

/**
 * Сроки по умолчанию. До первого куска — 90 с: модель со скрытыми рассуждениями или с очень длинным контекстом может
 * молчать минуту и дольше, и при 60 с такой ответ не пришёл бы ни в одной попытке. Между кусками — 120 с: вызов
 * инструмента с большими аргументами часть провайдеров присылает целиком, одним куском в конце, а ложный обрыв здесь
 * дорог — написанное оплачивается заново в автопродолжении.
 */
export const DEFAULT_MODEL_SILENCE: ModelSilenceLimits = { firstChunkMs: 90_000, betweenChunksMs: 120_000 };

const MIN_TIMEOUT_MS = 1_000;
/** Больше — таймер Node сработал бы сразу. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Проверка при создании службы или провайдера: неверная форма или срок — `TypeError` с путём настройки `name`.
 * `base` — сроки, которые остаются у пропущенных полей (у провайдера — общие сроки агента).
 */
export function resolveModelSilence(
  setting: ModelSilenceSetting | undefined,
  base: ModelSilenceLimits = DEFAULT_MODEL_SILENCE,
  name = "agent.modelSilenceTimeout",
): ModelSilenceLimits {
  if (setting === undefined) return base;
  if (setting === false) return { firstChunkMs: Number.POSITIVE_INFINITY, betweenChunksMs: Number.POSITIVE_INFINITY };
  if (typeof setting !== "object" || setting === null || Array.isArray(setting)) {
    throw new TypeError(`${name}: ждём false или объект { firstChunkMs?, betweenChunksMs? }`);
  }
  return {
    firstChunkMs: resolveTimeoutMs(setting.firstChunkMs, base.firstChunkMs, `${name}.firstChunkMs`),
    betweenChunksMs: resolveTimeoutMs(setting.betweenChunksMs, base.betweenChunksMs, `${name}.betweenChunksMs`),
  };
}

/** Срок ожидания: нет — `fallback`; 0 и `Infinity` — без срока (`Infinity`); иначе целое от 1 с до 2³¹−1 мс. */
export function resolveTimeoutMs(setting: number | undefined, fallback: number, name: string): number {
  if (setting === undefined) return fallback;
  if (setting === 0 || setting === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (typeof setting !== "number" || !Number.isFinite(setting) || setting < MIN_TIMEOUT_MS || setting > MAX_TIMEOUT_MS) {
    throw new TypeError(`${name}: ждём число мс от ${MIN_TIMEOUT_MS} до ${MAX_TIMEOUT_MS}, 0 или Infinity (без предела)`);
  }
  return Math.floor(setting);
}
