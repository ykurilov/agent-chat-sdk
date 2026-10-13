import { turnOriginOf } from "../agent-run/channel-notes";
import { STEP_LIMIT_PART_TYPE } from "../agent-run/last-step";
import { LENGTH_CUT_PART_TYPE } from "../agent-run/length-cut";
import type { ChatEvents } from "../chat-events/chat-events";
import { answerText } from "../conversation/edit-answer-parts";
import { FROZEN_CONTEXT_PART_TYPE } from "../frozen-context/context-blocks";
import { END_TURN_PART_TYPE } from "../agent-run/end-turn";
import { subjectOfChat } from "../conversation/types";
import { chatDataOfInput } from "../storage/chat-data";
import type { Chat, ChatSubject, StoredMessage } from "../conversation/types";
import type { ModelCatalog } from "../models/model-catalog";
import type { ChatStorage } from "../storage/chat-storage";
import { APP_EVENT_PART_TYPE } from "./app-events";
import { validateAppEvent } from "./turn-hooks";
import type { AfterTurnHandler, AppEvent, StaffActor, TurnAction, TurnResult, TurnStopReason } from "./turn-hooks";

/** Срок хука итога по умолчанию: все попытки и паузы между ними, мс. */
export const DEFAULT_AFTER_TURN_TIMEOUT_MS = 30_000;
/** Попыток хука итога по умолчанию. */
export const DEFAULT_AFTER_TURN_ATTEMPTS = 3;
/** Паузы перед второй и следующими попытками; последняя повторяется. */
const AFTER_TURN_RETRY_PAUSES_MS = [1000, 3000];
/**
 * Запас сверх срока хука, прежде чем чужой ждущий хук считается брошенным: столько ещё может идти запись состояния
 * у копии сервера, которая ведёт хук.
 */
const AFTER_TURN_RECOVERY_MARGIN_MS = 60_000;

/** Хук итога и его пределы, как их задаёт приложение. */
export interface AfterTurnSettings {
  handler: AfterTurnHandler;
  timeoutMs?: number;
  attempts?: number;
}

/** Хранилище, которое помнит состояние хука итога. */
export type AfterTurnStorage = ChatStorage & Required<Pick<ChatStorage, "setAfterTurnState" | "listPendingAfterTurn">>;

/** Ход этой копии сервера, чей итог уже записан с `afterTurn: "pending"`, а расход — в журнале. */
export interface FinishedTurn {
  ownerId: string;
  chatId: string;
  messageId: string;
  status: TurnResult["status"];
  /** Кто остановил ход (`status: "stopped"`). */
  stopReason?: TurnStopReason;
  parts: StoredMessage["parts"];
  usage: StoredMessage["usage"];
  error: StoredMessage["error"];
  modelId: string;
  /** Провайдер, который ответил: по его цене решается, есть ли у хода цена. */
  providerId: string;
  trigger: TurnAction;
  channel: TurnResult["channel"];
  staff?: StaffActor;
  /** Объект чата; нет — обычный чат. */
  subject?: ChatSubject;
  /** Данные чата на начало хода; итог берёт данные на момент итога заново, а этот снимок — запасной, если чат не прочитался. */
  chatData?: Record<string, unknown>;
}

/** Хук итога одной службы: зовёт обработчик приложения и закрывает состояние хука в ответе. */
export interface AfterTurn {
  /**
   * Ход закончен: зовёт хук с повторами в пределах срока и закрывает состояние ответа — `done` с событиями хука в
   * конце частей или `failed` (журнал и событие `after-turn-failed`). Закрывает, только если состояние ещё `pending`:
   * другая копия сервера могла успеть раньше. Возвращает события, дописанные в ответ (их ещё нужно отдать в поток).
   * `stopWaiting` сработал («Стоп») — сразу `[]`: хук доделывается в фоне в своём сроке, а его события, дописанные в
   * ответ, уходят открытой вкладке событием `app-event` с `messageId`. Не бросает.
   */
  afterTurn(turn: FinishedTurn, stopWaiting?: AbortSignal): Promise<AppEvent[]>;
  /**
   * Восстановление: доделать хук ответа, чьё состояние `pending` (прерванного сейчас или ждущего с прошлого запуска),
   * с `recovered: true`. Идёт в фоне; ответ, чей хук в этой копии уже идёт, второй раз не зовётся.
   */
  recoverLater(messageId: string): void;
  /**
   * Ответы, чей хук ждёт дольше срока с запасом (свежий может вести другая копия), кроме `skip` (их ведёт эта копия):
   * каждый — `recoverLater`.
   */
  recoverPending(skip: ReadonlySet<string>): Promise<void>;
  /** Ждёт все хуки этой копии, включая доделку в фоне после «Стопа» и восстановление. Каждый — в своём сроке. */
  drain(): Promise<void>;
}

/** Проверяет пределы хука и хранилище; не годится — понятная ошибка при создании службы. */
export function createAfterTurn(context: {
  settings: AfterTurnSettings;
  storage: ChatStorage;
  catalog: ModelCatalog;
  chatEvents: ChatEvents;
  logError: (message: string) => void;
  /** Сотрудник хода по чату (`staffOfChat` службы): итог, доделанный после перезапуска, получает его как у живого хода. */
  staffOf?: (chat: Chat) => StaffActor | null | undefined;
}): AfterTurn {
  const { settings, catalog, chatEvents, logError } = context;
  const storage = assertAfterTurnStorage(context.storage);
  const timeoutMs = settings.timeoutMs ?? DEFAULT_AFTER_TURN_TIMEOUT_MS;
  const attempts = settings.attempts ?? DEFAULT_AFTER_TURN_ATTEMPTS;
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new TypeError("afterTurnTimeoutMs — число миллисекунд больше нуля");
  if (!(Number.isInteger(attempts) && attempts >= 1)) throw new TypeError("afterTurnAttempts — целое число от 1");
  // Ответы, чей хук идёт в этой копии: восстановление их не трогает.
  const inFlight = new Set<string>();
  // Идущие хуки этой копии: остановка службы ждёт их до конца.
  const running = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    running.add(work);
    void work.then(
      () => running.delete(work),
      () => running.delete(work),
    );
    return work;
  }

  async function complete(result: TurnResult): Promise<AppEvent[]> {
    const where = `чат ${result.chatId}, ответ ${result.messageId}, итог ${result.status}`;
    const outcome = await callWithRetries(settings.handler, result, { timeoutMs, attempts });
    if (!outcome.ok) {
      logError(`afterTurn не отработал (${where}): ${outcome.reason}`);
      chatEvents.emit({ type: "after-turn-failed", ownerId: result.ownerId, chatId: result.chatId, messageId: result.messageId });
      await closeState(storage, result.messageId, "failed", [], logError, where);
      return [];
    }
    const parts = outcome.events.map((event) => ({ type: APP_EVENT_PART_TYPE, data: event }) as StoredMessage["parts"][number]);
    const written = await closeState(storage, result.messageId, "done", parts, logError, where);
    return written ? outcome.events : [];
  }

  async function costOf(answer: { chatId: string; messageId: string; modelId: string; providerId: string }): Promise<number | null> {
    const price = catalog.models.find((model) => model.id === answer.modelId)?.pricing?.[answer.providerId];
    if (!price) return null;
    try {
      const sums = await storage.sumUsage({ chatId: answer.chatId, messageId: answer.messageId });
      return sums.reduce((total, sum) => total + sum.costUsd, 0);
    } catch (failure) {
      logError(`Цена ответа ${answer.messageId} для afterTurn не прочитана: ${failure instanceof Error ? failure.message : String(failure)}`);
      return null;
    }
  }

  /**
   * Данные чата на момент итога: так же, как у итога, доделанного после перезапуска. Снимок на начало хода — запасной,
   * если чат не прочитался: хук всё равно получит итог.
   */
  async function chatDataAtResult(turn: Pick<TurnResult, "chatId" | "chatData">): Promise<TurnResult["chatData"]> {
    try {
      const chat = await storage.getChat(turn.chatId);
      return chat ? chatDataOfInput(chat) : turn.chatData;
    } catch (failure) {
      logError(`Данные чата ${turn.chatId} для afterTurn не прочитаны: ${failure instanceof Error ? failure.message : String(failure)}`);
      return turn.chatData;
    }
  }

  async function recover(messageId: string): Promise<void> {
    const message = await storage.getMessage(messageId);
    if (!message || message.afterTurn !== "pending" || message.status === "streaming" || message.role !== "assistant") return;
    const chat = await storage.getChat(message.chatId);
    if (!chat) return;
    const origin = turnOriginOf(branchUpTo(await storage.listMessages(message.chatId), messageId));
    const costUsd =
      message.modelId && message.providerId
        ? await costOf({ chatId: message.chatId, messageId, modelId: message.modelId, providerId: message.providerId })
        : null;
    await complete(
      turnResultOf({ ...message, status: message.status }, {
        ownerId: chat.ownerId,
        // Действие ядро не помнит; ход по служебному сообщению виден по истории.
        trigger: origin.trigger === "notice" ? "notice" : null,
        channel: origin.channel,
        costUsd,
        recovered: true,
        subject: subjectOfChat(chat),
        chatData: chatDataOfInput(chat),
        ...withStaff(context.staffOf?.(chat)),
      }),
    );
  }

  return {
    async afterTurn(turn, stopWaiting) {
      inFlight.add(turn.messageId);
      const work = track((async () => {
        try {
          const costUsd = await costOf(turn);
          const { ownerId, trigger, channel, staff, subject, stopReason } = turn;
          const chatData = await chatDataAtResult(turn);
          return await complete(
            turnResultOf(
              { id: turn.messageId, ...turn },
              { ownerId, trigger, channel, costUsd, recovered: false, staff, subject, chatData, ...(turn.status === "stopped" && stopReason && { stopReason }) },
            ),
          );
        } finally {
          inFlight.delete(turn.messageId);
        }
      })());
      if (!stopWaiting) return work;
      const stopped = whenAborted(stopWaiting);
      const waited = await Promise.race([work, stopped.promise.then(() => null)]);
      stopped.dispose();
      if (waited) return waited;
      // «Стоп»: ход хук больше не ждёт. Дописанные события — открытой вкладке через канал наблюдения.
      void work.then((events) => {
        for (const event of events) {
          chatEvents.emit({ type: "app-event", ownerId: turn.ownerId, chatId: turn.chatId, messageId: turn.messageId, event });
        }
      }).catch((failure: unknown) =>
        logError(`События afterTurn ответа ${turn.messageId} после «Стопа» не отданы: ${failure instanceof Error ? failure.message : String(failure)}`),
      );
      return [];
    },
    recoverLater(messageId) {
      if (inFlight.has(messageId)) return;
      inFlight.add(messageId);
      void track(recover(messageId))
        .catch((failure: unknown) =>
          logError(`afterTurn ответа ${messageId} после перезапуска не доделан: ${failure instanceof Error ? failure.message : String(failure)}`),
        )
        .finally(() => inFlight.delete(messageId));
    },
    async recoverPending(skip) {
      const pendingForMs = timeoutMs + AFTER_TURN_RECOVERY_MARGIN_MS;
      for (const messageId of await storage.listPendingAfterTurn({ pendingForMs })) if (!skip.has(messageId)) this.recoverLater(messageId);
    },
    async drain() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}

/** Ветка от корня до сообщения `messageId` по ссылкам на родителя. */
function branchUpTo(messages: readonly StoredMessage[], messageId: string): StoredMessage[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const branch: StoredMessage[] = [];
  for (let current = byId.get(messageId); current; current = current.parentId ? byId.get(current.parentId) : undefined) {
    branch.unshift(current);
  }
  return branch;
}

/** Хранилище с состоянием хука итога или понятная ошибка: без него хук после перезапуска не доделать. */
export function assertAfterTurnStorage(storage: ChatStorage): AfterTurnStorage {
  if (!storage.setAfterTurnState || !storage.listPendingAfterTurn) {
    throw new Error(
      "afterTurn задан, а хранилище не помнит состояние хука итога (нет setAfterTurnState и listPendingAfterTurn): обновите хранилище",
    );
  }
  return storage as AfterTurnStorage;
}

/** Итог хода для приложения: текст — текстовые части ответа через пустую строку. Обрыв по длине — по отметке в частях. */
function turnResultOf(
  message: Pick<StoredMessage, "id" | "chatId" | "parts" | "usage" | "error"> & { status: TurnResult["status"] },
  context: Pick<TurnResult, "ownerId" | "trigger" | "channel" | "costUsd" | "recovered" | "staff" | "subject" | "chatData" | "stopReason">,
): TurnResult {
  // Шаги идущего хода нужны только восстановлению: приложению — расход ответа.
  const { pendingSteps: _pendingSteps, ...usage } = message.usage ?? {};
  return {
    ownerId: context.ownerId,
    actorId: context.staff?.id ?? context.ownerId,
    chatId: message.chatId,
    messageId: message.id,
    status: message.status,
    ...(context.stopReason && { stopReason: context.stopReason }),
    ...(message.parts.some((part) => part.type === LENGTH_CUT_PART_TYPE) && { lengthCut: true as const }),
    ...(message.parts.some((part) => part.type === STEP_LIMIT_PART_TYPE) && { stepLimit: true as const }),
    text: answerText(message.parts),
    // Служебные части для модели приложению не нужны: в блоках контекста личная память и тексты, которые оно само отдало.
    parts: message.parts.filter((part) => part.type !== FROZEN_CONTEXT_PART_TYPE && part.type !== END_TURN_PART_TYPE),
    usage: message.usage ? (usage as TurnResult["usage"]) : null,
    costUsd: context.costUsd,
    ...(message.error && { error: message.error }),
    trigger: context.trigger,
    channel: context.channel,
    ...(context.staff && { staff: context.staff }),
    ...(context.subject && { subject: context.subject }),
    ...(context.chatData && { chatData: context.chatData }),
    recovered: context.recovered,
  };
}

type HookOutcome = { ok: true; events: AppEvent[] } | { ok: false; reason: string };

/**
 * Попытки хука: бросок или отказ — пауза и снова, пока есть попытки и срок. Срок — на всё вместе: вышел — сбой сразу,
 * поздний ответ хука не учитывается. События не по правилам — сбой без повторов: повтор того же хука их не исправит.
 */
async function callWithRetries(handler: AfterTurnHandler, result: TurnResult, limits: { timeoutMs: number; attempts: number }): Promise<HookOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Срок вышел или хук ответил: пауза перед следующей попыткой снимается, таймер не висит.
  const giveUp = new AbortController();
  const deadline = new Promise<HookOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: `срок ${limits.timeoutMs} мс вышел` }), limits.timeoutMs);
  });
  let expired = false;
  const tries = (async (): Promise<HookOutcome> => {
    let reason = "";
    for (let attempt = 1; attempt <= limits.attempts && !expired; attempt++) {
      if (attempt > 1) await pause(AFTER_TURN_RETRY_PAUSES_MS[Math.min(attempt - 2, AFTER_TURN_RETRY_PAUSES_MS.length - 1)]!, giveUp.signal);
      if (expired) break;
      let returned: Awaited<ReturnType<AfterTurnHandler>>;
      try {
        returned = await handler(result);
      } catch (failure) {
        reason = `попытка ${attempt} из ${limits.attempts}: ${failure instanceof Error ? failure.message : String(failure)}`;
        continue;
      }
      try {
        return { ok: true, events: checkedEvents(returned) };
      } catch (failure) {
        return { ok: false, reason: failure instanceof Error ? failure.message : String(failure) };
      }
    }
    return { ok: false, reason };
  })();
  try {
    return await Promise.race([tries, deadline]);
  } finally {
    expired = true;
    giveUp.abort();
    clearTimeout(timer);
  }
}

function checkedEvents(returned: Awaited<ReturnType<AfterTurnHandler>>): AppEvent[] {
  if (returned === undefined || returned === null) return [];
  if (typeof returned !== "object") throw new TypeError("afterTurn вернул не объект { events? }");
  const { events } = returned;
  if (events === undefined) return [];
  if (!Array.isArray(events)) throw new TypeError("afterTurn: events — массив событий приложения");
  return events.map((event) => validateAppEvent(event));
}

/** Закрывает состояние хука; сбой записи — в журнал, ответ остаётся `pending` и доделается после перезапуска. */
async function closeState(
  storage: AfterTurnStorage,
  messageId: string,
  state: "done" | "failed",
  appendParts: StoredMessage["parts"],
  logError: (message: string) => void,
  where: string,
): Promise<boolean> {
  try {
    return await storage.setAfterTurnState(messageId, state, appendParts.length > 0 ? { appendParts } : undefined);
  } catch (failure) {
    logError(`Состояние afterTurn не записано (${where}): ${failure instanceof Error ? failure.message : String(failure)}`);
    return false;
  }
}

/** Пауза, которую снимает `signal`; таймер не держит процесс. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  const aborted = whenAborted(signal);
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    void aborted.promise.then(() => {
      clearTimeout(timer);
      resolve();
    });
  }).finally(aborted.dispose);
}

/** Обещание «сигнал сработал»; `dispose` снимает подписку, если ждать больше не нужно. */
function whenAborted(signal: AbortSignal): { promise: Promise<void>; dispose: () => void } {
  let onAbort = () => {};
  const promise = new Promise<void>((resolve) => {
    onAbort = () => resolve();
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}

const withStaff = (staff: StaffActor | null | undefined): { staff?: StaffActor } => (staff ? { staff } : {});
