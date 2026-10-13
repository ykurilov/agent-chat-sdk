import type { ModelCatalog } from "../models/model-catalog";
import { resolveTimeoutMs } from "../provider-errors/model-silence";

/**
 * Настройка `agent.turnTimeoutMs`: общий срок хода от запуска до итога, мс. Число — всем моделям; `{ default?, byModel? }`
 * — свой срок модели. 0 и `Infinity` — без срока. Не задано — без срока, как раньше.
 */
export type TurnTimeoutSetting = number | { default?: number; byModel?: Record<string, number> };

/**
 * Настройка `agent.maxOutputTokens`: предел токенов ответа в каждом запросе к модели (шаге хода). Число — всем моделям;
 * `{ default?, byModel? }` — свой предел модели. Не задано — предела в запросе нет, как раньше.
 */
export type MaxOutputTokensSetting = number | { default?: number; byModel?: Record<string, number> };

/** Пределы хода для одной модели. */
export interface TurnLimits {
  /** Общий срок хода, мс; `null` — без срока. */
  timeoutMs: number | null;
  /** Предел токенов ответа в запросе к модели; нет — запрос без предела. */
  maxOutputTokens?: number;
}

export interface ResolvedTurnLimits {
  forModel(modelId: string): TurnLimits;
}

/** Проверяет обе настройки при создании службы: неверная форма, значение или модель не из каталога — `TypeError`. */
export function resolveTurnLimits(
  settings: { turnTimeoutMs?: TurnTimeoutSetting; maxOutputTokens?: MaxOutputTokensSetting },
  catalog: ModelCatalog,
): ResolvedTurnLimits {
  const timeout = byModelSetting(settings.turnTimeoutMs, "agent.turnTimeoutMs", catalog, (value, name) => {
    const ms = resolveTimeoutMs(value, Number.POSITIVE_INFINITY, name);
    return ms === Number.POSITIVE_INFINITY ? null : ms;
  });
  const tokens = byModelSetting(settings.maxOutputTokens, "agent.maxOutputTokens", catalog, (value, name) => {
    if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) throw new TypeError(`${name}: ждём целое число токенов от 1`);
    return value;
  });
  return {
    forModel(modelId) {
      const timeoutMs = timeout(modelId) ?? null;
      const maxOutputTokens = tokens(modelId);
      return { timeoutMs, ...(maxOutputTokens !== undefined && { maxOutputTokens }) };
    },
  };
}

/** Значение по модели: своё из `byModel`, иначе общее; нет обоих — `undefined`. */
function byModelSetting<T>(
  setting: number | { default?: number; byModel?: Record<string, number> } | undefined,
  name: string,
  catalog: ModelCatalog,
  check: (value: number, name: string) => T,
): (modelId: string) => T | undefined {
  if (setting === undefined) return () => undefined;
  if (typeof setting === "number") {
    const all = check(setting, name);
    return () => all;
  }
  if (!isPlainObject(setting)) throw new TypeError(`${name}: ждём число или объект { default?, byModel? }`);
  if (setting.byModel !== undefined && !isPlainObject(setting.byModel)) throw new TypeError(`${name}.byModel: ждём объект «модель → значение»`);
  const fallback = setting.default === undefined ? undefined : check(setting.default, `${name}.default`);
  const byModel = new Map<string, T>();
  for (const [modelId, value] of Object.entries(setting.byModel ?? {})) {
    if (!catalog.models.some((model) => model.id === modelId)) throw new TypeError(`${name}.byModel: модели «${modelId}» нет в каталоге`);
    byModel.set(modelId, check(value, `${name}.byModel["${modelId}"]`));
  }
  return (modelId) => (byModel.has(modelId) ? byModel.get(modelId) : fallback);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
