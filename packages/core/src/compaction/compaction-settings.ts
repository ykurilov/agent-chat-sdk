/** Настройки сжатия истории; всё необязательно, значения по умолчанию подобраны в SDK. */
export interface CompactionSettings {
  /** С какого размера контекста сжимать (токены провайдера). Для малых окон порог не выше 80% окна. */
  thresholdTokens?: number;
  /** Сколько свежей переписки оставлять как есть. */
  tailTokens?: number;
  /** Потолок сводки; вылезла — сводка ужимается повторно. */
  summaryCeilingTokens?: number;
  /** Чем сжимать; по умолчанию — моделью чата. */
  model?: { modelId: string; providerId: string };
  /** Своё задание сжатия вместо задания ядра. */
  instruction?: string;
  /** Сколько штатная остановка (`flush`) ждёт идущее сжатие, мс; потом отменяет его без записи сводки. */
  flushWaitMs?: number;
}

export interface ResolvedCompactionSettings extends CompactionSettings {
  thresholdTokens: number;
  tailTokens: number;
  summaryCeilingTokens: number;
  flushWaitMs: number;
}

const DEFAULTS = { thresholdTokens: 250_000, tailTokens: 20_000, summaryCeilingTokens: 20_000, flushWaitMs: 30_000 };
/** Доля окна, выше которой порог не поднимается. */
const THRESHOLD_WINDOW_SHARE = 0.8;
/** Доля окна, с которой следующий ответ ждёт сжатия: дальше запрос рискует не поместиться. */
const NEAR_LIMIT_WINDOW_SHARE = 0.9;

/** Настройки с значениями по умолчанию; `false` выключает сжатие (`null`). */
export function resolveCompactionSettings(setting: CompactionSettings | false | undefined): ResolvedCompactionSettings | null {
  if (setting === false) return null;
  const resolved = { ...DEFAULTS, ...definedOnly(setting ?? {}) };
  for (const key of ["thresholdTokens", "tailTokens", "summaryCeilingTokens", "flushWaitMs"] as const) {
    if (!Number.isFinite(resolved[key]) || resolved[key] <= 0) {
      throw new Error(`Настройка сжатия ${key} должна быть положительным числом`);
    }
  }
  if (resolved.tailTokens >= resolved.thresholdTokens) {
    throw new Error("Настройка сжатия: хвост (tailTokens) должен быть меньше порога (thresholdTokens)");
  }
  return resolved;
}

function definedOnly<T extends object>(values: T): T {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as T;
}

/** Доля окна модели чата на хвост и сводку вместе: остальное — системному промпту, новому сообщению и ответу. */
const KEPT_WINDOW_SHARE = 0.6;

/** Хвост и потолок сводки для окна модели чата: в малом окне (32 тыс. токенов) они вместе не уместились бы и пропорционально ужимаются. */
export function settingsForWindow(settings: ResolvedCompactionSettings, contextWindowTokens: number): ResolvedCompactionSettings {
  const kept = settings.tailTokens + settings.summaryCeilingTokens;
  const room = Math.floor(contextWindowTokens * KEPT_WINDOW_SHARE);
  if (kept <= room) return settings;
  const scale = room / kept;
  return { ...settings, tailTokens: Math.floor(settings.tailTokens * scale), summaryCeilingTokens: Math.floor(settings.summaryCeilingTokens * scale) };
}

/** Порог для выбранной модели: не выше 80% её окна. */
export function effectiveThreshold(settings: ResolvedCompactionSettings, contextWindowTokens: number): number {
  return Math.min(settings.thresholdTokens, Math.floor(contextWindowTokens * THRESHOLD_WINDOW_SHARE));
}

/** Контекст у предела окна: новый ответ должен дождаться сжатия. */
export function isContextNearLimit(contextTokens: number, contextWindowTokens: number): boolean {
  return contextTokens >= contextWindowTokens * NEAR_LIMIT_WINDOW_SHARE;
}
