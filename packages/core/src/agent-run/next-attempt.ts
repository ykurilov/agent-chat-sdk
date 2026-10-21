import type { ModelCatalog } from "../models/model-catalog";
import { AUTO_CONTINUES_PER_TURN, autoContinuePauseMs } from "./auto-continue";
import { isAccessRefusal } from "../provider-errors/classify-provider-error";
import { isProviderOutage } from "../provider-errors/provider-outages";
import type { ProviderOutageKind } from "../provider-errors/provider-outages";
import { isProviderSilence } from "../provider-errors/transient-retry-middleware";
import type { ChatErrorKind } from "../conversation/types";
import type { AttemptResult } from "./turn-attempt";

/**
 * Запасные провайдеры той же модели (FR-030): `false` — выключены; `byModel` — свой порядок для модели или `false` для
 * одной модели. Без `byModel` для модели — её провайдеры по порядку профиля.
 */
export type ProviderFallbackSetting =
  | false
  | {
      byModel?: Record<string, string[] | false>;
      /**
       * Паузы (мс) тихих повторов временного сбоя до перехода к запасному: по умолчанию [250], [] — сразу к нему.
       * Длина — число повторов. Только пока ответ не начался и есть доступный запасной; иначе прежние 1/3/6 с.
       * Сроки молчания модели и onSilence задаются отдельно.
       */
      retryDelaysMs?: readonly number[];
      /**
       * Модель молчит дольше срока `modelSilenceTimeout` — до первого куска шага или между кусками.
       * `"restart-step-on-next"` — шаг обрывается, показанное в нём стирается, шаг начинается заново у следующего
       * провайдера списка; тихого повтора у того же нет. `"continue"` (по умолчанию) — как раньше: повтор у того же,
       * запасной только до первого куска ответа, после — автопродолжение.
       */
      onSilence?: "continue" | "restart-step-on-next";
      /** После такого перехода: `"turn"` (по умолчанию) — запасной до конца хода; `"step"` — следующий шаг снова у основного. */
      scope?: "turn" | "step";
      /** Сколько таких переходов за ход, по умолчанию 1. Каждый съедает шаг из предела шагов хода. */
      maxSwitches?: number;
    };

/** Переход при молчании модели с подставленными значениями по умолчанию. */
export interface SilenceSwitch {
  onSilence: "continue" | "restart-step-on-next";
  scope: "turn" | "step";
  maxSwitches: number;
}

export function resolveSilenceSwitch(setting: ProviderFallbackSetting | undefined): SilenceSwitch {
  const options = setting || {};
  return { onSilence: options.onSilence ?? "continue", scope: options.scope ?? "turn", maxSwitches: options.maxSwitches ?? 1 };
}

/** Следующий провайдер при молчании: с основного — первый запасной, с запасного — следующий за ним по списку. */
export function nextSilenceProvider(input: { currentProviderId: string; primaryProviderId: string; fallbackProviderIds: readonly string[] }): string | undefined {
  if (input.currentProviderId === input.primaryProviderId) return input.fallbackProviderIds[0];
  const index = input.fallbackProviderIds.indexOf(input.currentProviderId);
  return index === -1 ? input.fallbackProviderIds[0] : input.fallbackProviderIds[index + 1];
}

/**
 * Значение по умолчанию — единственное место. Решение В1: запасные включены, переход теряет кэш и идёт по цене
 * запасного. Выключить для всех по умолчанию — заменить `{}` на `false`.
 */
export const PROVIDER_FALLBACK_BY_DEFAULT: ProviderFallbackSetting = {};

/** Быстрый повтор, когда следующий провайдер действительно доступен. */
export const FALLBACK_RETRY_DELAYS_MS: readonly number[] = [250];

/**
 * Что делать после попытки хода. `compact-and-continue` — ход упёрся в окно модели: сжать и продолжить тот же ответ;
 * `history` — история чата до вопроса, `answer-steps` — пересказ первых шагов текущего ответа. `auto-continue` — ответ
 * оборвался временным сбоем посреди текста: после паузы `pauseMs` продолжить его у того же провайдера.
 */
export type NextAttempt =
  | { action: "fallback"; providerId: string }
  | { action: "restart-step"; providerId: string }
  | { action: "compact-and-continue"; scope: "history" | "answer-steps" }
  | { action: "auto-continue"; pauseMs: number }
  | { action: "fail" };

/** Временные виды сбоя — провайдер занят, а не запрос плох: после них пробуется запасной или ответ продолжается. */
const TRANSIENT_KINDS = new Set(["overloaded", "rate_limited"]);

/**
 * Запасные провайдеры для хода: по порядку настройки, без выбранного и без провайдеров, чьего ключа нет на сервере.
 * Пустой список — переходов нет.
 */
export function fallbackProviders(input: {
  catalog: ModelCatalog;
  modelId: string;
  chosenProviderId: string;
  env: Record<string, string | undefined>;
  setting?: ProviderFallbackSetting;
}): string[] {
  const setting = input.setting ?? PROVIDER_FALLBACK_BY_DEFAULT;
  if (setting === false) return [];
  const profile = input.catalog.models.find((model) => model.id === input.modelId);
  if (!profile) return [];
  const order = setting.byModel?.[input.modelId] ?? Object.keys(profile.providerModelIds);
  if (order === false) return [];
  return order.filter((providerId) => {
    if (providerId === input.chosenProviderId || !profile.providerModelIds[providerId]) return false;
    const provider = input.catalog.providers.find((candidate) => candidate.id === providerId);
    return provider !== undefined && Boolean(input.env[provider.apiKeyEnv]);
  });
}

/**
 * Кончились деньги или не принят ключ — провайдер не ответит ни на какой запрос: сразу следующий из списка, в любом
 * месте хода и сколько угодно раз (список только убывает). Такой переход не тратит единственный переход по перегрузке.
 * Переход к запасному при перегрузке, лимите или отказе по доступу (403: регион, модель) — до первого куска ответа и
 * один раз на ход (FR-031, FR-032).
 * Переполнение — сжатие: сначала истории чата, затем первых шагов ответа, каждое не больше раза на ход (FR-012).
 * После первого куска та же перегрузка или лимит — автопродолжение у того же провайдера, до двух на ход и не при
 * запросе подтверждения (FR-037, FR-042, FR-044). Запасной после первого куска не выбирается никогда.
 */
export function decideNextAttempt(
  result: Extract<AttemptResult, { outcome: "failed" }>,
  state: {
    fallbackUsed: boolean;
    fallbackProviderIds: readonly string[];
    /** Какие сжатия ходу ещё доступны: есть зависимость и в этом ходе не тратилось. Нет — переполнение сразу `fail`. */
    overflowCompaction?: { history: boolean; answerSteps: boolean };
    /**
     * Автопродолжения: сколько уже было в ходе, есть ли в ответе неотвеченный запрос подтверждения и случайность разброса
     * паузы (по умолчанию `Math.random`). Нет — после первого куска сбой сразу `fail`.
     */
    autoContinue?: { done: number; approvalRequested: boolean; random?: () => number };
    /**
     * Переход при молчании (`onSilence: "restart-step-on-next"`): сколько было в ходе, предел и следующий провайдер.
     * Нет — молчание идёт прежним путём.
     */
    silenceSwitch?: { done: number; max: number; nextProviderId?: string | undefined };
  },
): NextAttempt {
  const silenceSwitch = state.silenceSwitch;
  if (
    silenceSwitch?.nextProviderId !== undefined &&
    silenceSwitch.done < silenceSwitch.max &&
    !state.autoContinue?.approvalRequested &&
    isProviderSilence(result.error)
  ) {
    return { action: "restart-step", providerId: silenceSwitch.nextProviderId };
  }
  if (result.kind === "context_overflow") {
    if (state.overflowCompaction?.history) return { action: "compact-and-continue", scope: "history" };
    if (state.overflowCompaction?.answerSteps) return { action: "compact-and-continue", scope: "answer-steps" };
    return { action: "fail" };
  }
  if (isProviderOutage(result.kind)) {
    const next = state.fallbackProviderIds[0];
    return next === undefined ? { action: "fail" } : { action: "fallback", providerId: next };
  }
  // Отказ по доступу (регион, модель) — как перегрузка: один переход на ход, до первого куска.
  const accessRefused = result.kind === "other" && isAccessRefusal(result.error);
  if (!TRANSIENT_KINDS.has(result.kind) && !accessRefused) return { action: "fail" };
  if (result.contentSeen) {
    if (accessRefused) return { action: "fail" };
    const auto = state.autoContinue;
    if (!auto || auto.approvalRequested || auto.done >= AUTO_CONTINUES_PER_TURN) return { action: "fail" };
    return { action: "auto-continue", pauseMs: autoContinuePauseMs({ index: auto.done, error: result.error, random: auto.random ?? Math.random }) };
  }
  const next = state.fallbackProviderIds[0];
  if (state.fallbackUsed || next === undefined) return { action: "fail" };
  return { action: "fallback", providerId: next };
}

/**
 * Вид ошибки для человека, когда не ответил никто. Был отказ по деньгам или ключу (`firstOutage` — первый в ходе), а
 * последний провайдер лишь занят или запрос велик — его вид: «попробуйте позже» или «короче» поможет. Иначе — исходная
 * причина у основного: её и чинить владельцу.
 */
export function errorKindForPerson(lastKind: ChatErrorKind, firstOutage: ProviderOutageKind | undefined): ChatErrorKind {
  if (firstOutage === undefined || TRANSIENT_KINDS.has(lastKind) || lastKind === "context_overflow") return lastKind;
  return firstOutage;
}

/** Проверка настройки при создании службы: неверная форма, неизвестная модель или чужой провайдер — `TypeError`. */
export function checkProviderFallback(setting: ProviderFallbackSetting | undefined, catalog: ModelCatalog): void {
  if (setting === undefined || setting === false) return;
  if (typeof setting !== "object" || setting === null || Array.isArray(setting)) {
    throw new TypeError("providerFallback: ждём false или объект { byModel }");
  }
  const { byModel, onSilence, scope, maxSwitches, retryDelaysMs } = setting;
  if (retryDelaysMs !== undefined && (!Array.isArray(retryDelaysMs) || retryDelaysMs.some((delay) => typeof delay !== "number" || !Number.isFinite(delay) || delay < 0))) {
    throw new TypeError("providerFallback.retryDelaysMs: ждём массив конечных чисел от нуля (мс), [] — без повторов");
  }
  if (onSilence !== undefined && onSilence !== "continue" && onSilence !== "restart-step-on-next") {
    throw new TypeError(`providerFallback.onSilence: ждём "continue" или "restart-step-on-next", пришло ${JSON.stringify(onSilence)}`);
  }
  if (scope !== undefined && scope !== "turn" && scope !== "step") {
    throw new TypeError(`providerFallback.scope: ждём "turn" или "step", пришло ${JSON.stringify(scope)}`);
  }
  if (maxSwitches !== undefined && !(Number.isInteger(maxSwitches) && maxSwitches >= 0)) {
    throw new TypeError(`providerFallback.maxSwitches: ждём целое число от нуля, пришло ${JSON.stringify(maxSwitches)}`);
  }
  if (byModel === undefined) return;
  if (typeof byModel !== "object" || byModel === null || Array.isArray(byModel)) {
    throw new TypeError("providerFallback.byModel: ждём объект «модель → список провайдеров или false»");
  }
  for (const [modelId, order] of Object.entries(byModel)) {
    const profile = catalog.models.find((model) => model.id === modelId);
    if (!profile) throw new TypeError(`providerFallback.byModel: модели «${modelId}» нет в каталоге`);
    if (order === false) continue;
    if (!Array.isArray(order) || order.some((providerId) => typeof providerId !== "string")) {
      throw new TypeError(`providerFallback.byModel["${modelId}"]: ждём список id провайдеров или false`);
    }
    const foreign = order.find((providerId) => !profile.providerModelIds[providerId]);
    if (foreign !== undefined) {
      throw new TypeError(`providerFallback.byModel["${modelId}"]: провайдер «${foreign}» не обслуживает модель ${modelId}`);
    }
  }
}
