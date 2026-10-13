import type { ModelPrice } from "../models/model-catalog";

/** Промах меньше этого (токенов) — шум границ кэша, не поломка. */
const NOISE_FLOOR_TOKENS = 1024;
const MAX_REMEMBERED_CHATS = 500;
const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** Что известно о запросе к модели: по этому следилка решает, продолжает ли он прошлый запрос чата. */
export interface WatchedRequest {
  chatId: string;
  modelId: string;
  providerId: string;
  /** Номера сообщений истории, ушедшей в запрос (у сжатой — вместе со сводкой). */
  historyIds: readonly string[];
  /** Номер ответа, который строится этим запросом. */
  answerId: string;
  /** История хода переписана (сжатие, пересказ шагов): номера те же, а начало запроса другое. */
  historyRewritten?: boolean;
  /**
   * Концовка первого шага (пометка попытки, например автопродолжения) остаётся внутри запросов следующих шагов, а в
   * следующий ход не попадает: следующий ход совпадает с этим запросом только до неё.
   */
  tailNoteInside?: boolean;
  /** Цены модели у этого провайдера; нет — переплата неизвестна. */
  price: ModelPrice | undefined;
}

/** Расход одного шага; `inputTokens` включает прочитанное и записанное в кэш. */
export interface WatchedStepUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  /**
   * Концовка этого шага, которая не сохраняется (снимок `stepContext`, пометка попытки, пометка «подведи итог»), токенов:
   * в начале следующих запросов — и шагов этого хода, и следующего хода — её уже нет.
   */
  tailTokens?: number;
}

export interface CacheMissWatch {
  /** Начинает слежку за запросом: шаги хода сообщаются `onStep` по мере готовности. */
  forRequest(request: WatchedRequest): { onStep(usage: WatchedStepUsage): void };
}

interface ChatCacheState {
  modelKey: string;
  historyIds: readonly string[];
  answerId: string;
  /** Размер входа последнего шага: всё его начало, кроме концовки, — в начале следующего хода. */
  promptTokens: number;
  /** Концовка последнего шага: на следующем ходе она не входит в общее начало и из промаха вычитается. */
  tailTokens: number;
  /** Провайдер хоть раз сообщал о кэше для этой модели в этом чате. */
  reportedCache: boolean;
  /** Когда закончился последний шаг. */
  at: number;
}

export interface CacheMissWatchOptions {
  logError: (message: string) => void;
  now?: () => number;
}

/**
 * Замечает, что кэш провайдера перестал работать: начало запроса то же, что в прошлом, а прочитано из кэша мало
 * (например, в инструкцию вписали текущее время). Пишет одну строку `[промах кэша]` в журнал сервера: чат, модель,
 * провайдер, сколько токенов прошло мимо кэша, примерная переплата в долларах и пауза с прошлого шага. Текстов
 * сообщений и ключей в строке нет.
 *
 * Ожидание кэша — вход прошлого шага без его концовки: внутри хода это прошлый шаг, на первом шаге хода — последний
 * шаг прошлого хода (застывший контекст: прошлый ход целиком в начале следующего).
 *
 * Не пишет там, где начало запроса законно другое: первый запрос чата (после перезапуска сервера тоже), другая ветка
 * (правка, «Переделать»), сжатая или переписанная внутри хода история, другая модель или провайдер. Провайдер, ни разу не сообщавший о кэше, не
 * в счёт. Память — в процессе, на последние `MAX_REMEMBERED_CHATS` чатов.
 */
export function createCacheMissWatch(options: CacheMissWatchOptions): CacheMissWatch {
  const now = options.now ?? Date.now;
  const chats = new Map<string, ChatCacheState>();

  function remember(chatId: string, state: ChatCacheState): void {
    chats.delete(chatId);
    chats.set(chatId, state);
    if (chats.size > MAX_REMEMBERED_CHATS) chats.delete(chats.keys().next().value!);
  }

  return {
    forRequest(request) {
      const modelKey = `${request.providerId}/${request.modelId}`;
      const earlier = chats.get(request.chatId);
      const sameModel = earlier?.modelKey === modelKey ? earlier : undefined;
      let previous = sameModel && continuesRequest(sameModel, request) ? { promptTokens: sameModel.promptTokens, tailTokens: sameModel.tailTokens, at: sameModel.at } : undefined;
      let reportedCache = sameModel?.reportedCache ?? false;
      // Для следующего хода у попытки с пометкой внутри — начало первого шага, до пометки.
      let firstStep: { promptTokens: number; tailTokens: number } | undefined;

      return {
        onStep(usage) {
          const promptTokens = usage.inputTokens;
          if (promptTokens <= 0) return;
          const at = now();
          const cacheTouched = usage.cachedInputTokens + usage.cacheWriteTokens > 0;
          if (previous && (cacheTouched || reportedCache)) {
            const missedTokens = Math.min(previous.promptTokens, promptTokens) - previous.tailTokens - usage.cachedInputTokens;
            if (missedTokens > NOISE_FLOOR_TOKENS) options.logError(describeMiss(request, missedTokens, at - previous.at));
          }
          reportedCache ||= cacheTouched;
          previous = { promptTokens, tailTokens: usage.tailTokens ?? 0, at };
          firstStep ??= previous;
          const forNextTurn = request.tailNoteInside ? { ...firstStep, at } : previous;
          remember(request.chatId, { modelKey, historyIds: request.historyIds, answerId: request.answerId, ...forNextTurn, reportedCache });
        },
      };
    },
  };
}

/** Начало запроса то же, что у прошлого: история прошлого запроса и его ответ идут в начале этой истории. */
function continuesRequest(earlier: ChatCacheState, request: WatchedRequest): boolean {
  if (request.historyRewritten) return false;
  const { historyIds } = request;
  const length = earlier.historyIds.length;
  return historyIds.length > length && historyIds[length] === earlier.answerId && earlier.historyIds.every((id, index) => historyIds[index] === id);
}

/** `[промах кэша] чат=… модель=… провайдер=… токенов=20000 переплата≈$0.0540 пауза=1.5мин`; нет цены кэша — «переплата=неизвестна». */
function describeMiss(request: WatchedRequest, missedTokens: number, pauseMs: number): string {
  const { price } = request;
  const cachedPrice = price?.cachedInputPerMillion;
  const overpay =
    price && cachedPrice !== undefined
      ? `переплата≈$${((missedTokens * Math.max(0, price.inputPerMillion - cachedPrice)) / TOKENS_PER_PRICE_UNIT).toFixed(4)}`
      : "переплата=неизвестна";
  return `[промах кэша] чат=${request.chatId} модель=${request.modelId} провайдер=${request.providerId} токенов=${missedTokens} ${overpay} пауза=${(Math.max(0, pauseMs) / 60_000).toFixed(1)}мин`;
}
