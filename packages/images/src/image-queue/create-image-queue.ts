import { SpendingLimitReachedError } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { downloadGeneratedImage } from "../download-image";
import type { DownloadedImage } from "../download-image";
import { aspectRatios } from "../image-catalog";
import type { AspectRatio, ImageCatalog, ImageGenerationRequest, ImageGenerationResult, ImageQuality, ImageSize, ImageTaskState } from "../image-catalog";
import { ImageGenerationError } from "../image-generation-error";
import { resolveImageSetups } from "../image-setup";
import type { ImagePurpose, ImageSetup, ImageStep } from "../image-setup";
import { postprocessImage } from "../postprocess-image";
import type { ImageOutputOptions } from "../postprocess-image";
import { ImageJobKeyTakenError, isOpenImageJob, memoryImageJobStore } from "./image-job-store";
import type { ImageJobCharge, ImageJobFilter, ImageJobPatch, ImageJobRecord, ImageJobStatus, ImageJobStep, ImageJobStore, ImageJobTask } from "./image-job-store";
import { createTurnCounter } from "./turn-counter";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 150_000;
const DEFAULT_LATE_RESULT_WINDOW_MS = 10 * 60 * 1000;
/** В позднем окне проверки реже: картинка уже опоздала, частый опрос ничего не ускорит. */
const MIN_LATE_POLL_INTERVAL_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_ACCEPT_WAIT_MS = 5_000;
const DEFAULT_FORGET_FINISHED_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Уборка законченных задач — не чаще этого. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;
/** Условная запись не прошла столько раз подряд — задачу кто-то правит без конца, это сбой. */
const MAX_WRITE_TRIES = 10;
/** Место всё время занимают заново (другие копии сервера заказывают на него же) — столько попыток занять его. */
const MAX_PLACE_TRIES = 5;
const LIMIT_REACHED = "лимит расходов исчерпан";
const QUEUE_STOPPED = "очередь остановлена";

/** Готовая картинка для приёмника. Размер — из файла; не известен — по пропорции модели. */
export interface GeneratedImage {
  bytes: Uint8Array;
  mediaType: string;
  width: number;
  height: number;
  /** Модель картинки (первого шага). */
  modelId: string;
}

/** Задача картинки, какой её видит приложение. */
export interface ImageJob {
  id: string;
  key: string;
  ownerId: string;
  chatId: string;
  turnId?: string;
  group?: string;
  /** Назначение; нет — очередь без назначений. */
  purpose?: string;
  prompt: string;
  aspectRatio: AspectRatio;
  /** Данные приложения из заказа, как были. */
  data?: unknown;
  status: ImageJobStatus;
  /** Почему не получилась. */
  reason?: string;
  /** Ответ приёмника. */
  result?: unknown;
  attempt: number;
  /** Попытки кончились, но задача у провайдера ещё опрашивается до этого времени: может прийти поздно. */
  lateUntil?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

/**
 * Доставка ещё нужна? Задачу могут вытеснить новым заказом на то же место, пока приёмник пишет файл: запись должна быть
 * условной — перед ней спросить `isCurrent()`, а долгую работу обрывать по `signal`.
 */
export interface ImageDeliveryContext {
  /** Срабатывает, когда доставка этой копией больше не нужна: задачу вытеснили, повторили или очередь остановлена. */
  signal: AbortSignal;
  /** Задача всё ещё наша и ждёт этой картинки (перечитывает хранилище). `false` — не записывать, вернуть `false`. */
  isCurrent(): Promise<boolean>;
}

/** Заказ не принят: лимит расходов, предел за ход, неверный заказ. Задачи нет, денег не потрачено. */
export interface ImageOrderRefusal {
  status: "refused";
  reason: string;
}

export interface ImageOrder {
  ownerId: string;
  chatId: string;
  /** Номер хода агента (`model.turnId` в `agent.tools`): по нему считается `maxImagesPerTurn`. */
  turnId?: string;
  /** Место картинки (например, путь файла): новый заказ на то же место у того же владельца вытесняет прежний. Нет — своё у каждого заказа. */
  key?: string;
  /** Группа для списка: например, приложение, в которое идут картинки. */
  group?: string;
  /** Назначение из `purposes`; по умолчанию первое. */
  purpose?: string;
  prompt: string;
  /** По умолчанию `1:1`. */
  aspectRatio?: AspectRatio;
  /** Данные приложения (путь, размер): приёмник получит их в `job.data`. Только JSON. */
  data?: unknown;
}

/** Назначение очереди: как у `generate_images`, но описание не обязательно (его читает только агент). */
export type ImageQueuePurpose = Omit<ImagePurpose, "description"> & { description?: string };

export interface CreateImageQueueOptions {
  /** Окружение сервера: ключ провайдера берётся только отсюда, по `apiKeyEnv`. */
  env: Record<string, string | undefined>;
  catalog?: ImageCatalog;
  /** Модель картинок из каталога; по умолчанию `gpt-image-2`. С `purposes` не задаётся. */
  model?: string;
  provider?: string;
  quality?: ImageQuality;
  /** Размер картинки: `1k` — длинная сторона около 1024; по умолчанию — размер модели. */
  size?: ImageSize;
  transparentBackground?: boolean;
  /** Постобработка перед приёмником: формат файла и предел большей стороны (sharp). */
  output?: ImageOutputOptions;
  purposes?: Record<string, ImageQueuePurpose>;
  /**
   * Приёмник готовой картинки: записать файл, положить во вложения, обновить экран. Ответ (JSON) сохраняется в задаче;
   * `false` — картинка больше не нужна (место занято другим), задача «отброшена». Ошибка — задача «не получилась», и
   * «Повторить» доставит ту же картинку без новой оплаты. Приёмника зовут хотя бы один раз: после сбоя сервера между
   * приёмником и отметкой «готово» — ещё раз, поэтому повтор должен быть безопасен. Пока приёмник работает, задачу могут
   * вытеснить: запись делать условной, по `context.isCurrent()`.
   */
  deliver(image: GeneratedImage, job: ImageJob, context: ImageDeliveryContext): unknown;
  /** Где лежат задачи; по умолчанию в памяти (до перезапуска). `sqliteImageJobStore` или `postgresImageJobStore` — переживают перезапуск. */
  store?: ImageJobStore;
  /** Расход в лимиты: запись на каждую оплаченную задачу провайдера и проверка лимита до заказа. */
  spending?: {
    /** `hasUsageRecord` — по желанию: после сбоя вставки отличает «уже записано» от «не записалось». */
    storage: Pick<ChatStorage, "insertUsageRecord" | "hasUsageRecord">;
    limits?: Pick<SpendingLimits, "assertWithinLimit" | "afterSpending">;
  };
  /** Шаг проверки задачи у провайдера с очередью; по умолчанию 3000 мс. */
  pollIntervalMs?: number;
  /** Срок одной попытки; по умолчанию 150 000 мс. */
  attemptTimeoutMs?: number;
  /**
   * Сколько попыток; по умолчанию 1. Следующая попытка после срока проверяет ту же задачу (новой оплаты нет), после
   * провала у провайдера — заказывает заново.
   */
  attempts?: number;
  /** Попытки кончились, а задача у провайдера ещё идёт: сколько её ждать; по умолчанию 10 минут, 0 — не ждать. */
  lateResultWindowMs?: number;
  /** Шаг проверки в позднем окне; по умолчанию 10 000 мс (или шаг опроса, если он больше). */
  latePollIntervalMs?: number;
  /** Срок одного обращения к провайдеру с очередью (отправка, проверка); по умолчанию 30 000 мс. */
  callTimeoutMs?: number;
  /** Сколько раз скачивать готовую картинку с того же адреса, прежде чем сдаться; по умолчанию 3. */
  downloadAttempts?: number;
  /**
   * Провайдер без очереди (Runware) не сообщает «принял»: заказ ждёт его ответа не дольше этого, по умолчанию 5000 мс.
   * Отказ (неверный ключ, нет денег) приходит раньше — и заказ сразу отвечает «не получилась».
   */
  acceptWaitMs?: number;
  /** Аренда задачи копией сервера; по умолчанию 30 000 мс. Упавшую копию заменяет другая после этого срока. */
  leaseMs?: number;
  /** Не больше стольких заказов за ход (`turnId`); по умолчанию без предела. */
  maxImagesPerTurn?: number;
  /** Законченные задачи удаляются из хранилища через столько; по умолчанию сутки. */
  forgetFinishedAfterMs?: number;
  /** Предел одного файла; по умолчанию 10 МБ. */
  maxImageBytes?: number;
  /**
   * Свой `fetch` приложения: запросы к провайдеру и скачивание картинок. Это граница доверия приложения: закрепить
   * соединение за проверенным адресом (от подмены DNS) должен он сам (`createPinnedFetch` из
   * `@ykurilov/agent-chat-web-tools/network`). Без него картинку со склада провайдера качает закреплённый `fetch`.
   */
  fetch?: typeof globalThis.fetch;
  logError?: (message: string) => void;
  now?: () => Date;
}

export interface ImageQueue {
  /** Заказ. Ответ — как только задача ушла провайдеру (или сразу не получилась); картинка придёт в `deliver` позже. */
  order(input: ImageOrder): Promise<ImageJob | ImageOrderRefusal>;
  /**
   * «Повторить» последнюю задачу места. Не получилась — новый запуск: идущая у провайдера задача проверяется, а не
   * заказывается заново; оплаченная, но не доставленная картинка скачивается с того же адреса. Задача идёт или уже
   * готова — она же, без нового заказа. Нет задачи — `null`.
   */
  retry(input: { ownerId: string; key: string }): Promise<ImageJob | ImageOrderRefusal | null>;
  get(id: string): Promise<ImageJob | null>;
  /** По порядку создания. */
  list(filter: ImageJobFilter): Promise<ImageJob[]>;
  /** Заказанное и ещё не оплаченное этой копией сервера: у человека и в чате. Для проверки лимитов. */
  pendingUsd(ownerId: string, chatId: string): { user: number; chat: number };
  /** Подобрать незаконченные задачи из хранилища и обходить его дальше. Зовётся само при создании; повтор безвреден. */
  start(): Promise<void>;
  /** Остановить опрос и таймеры, отпустить аренду. Задачи остаются в хранилище и продолжаются следующим `start`. */
  stop(): Promise<void>;
}

/** Запуск задачи этой копией сервера: опрос, деньги, доставка. */
interface Runtime {
  ownerId: string;
  chatId: string;
  setup: ImageSetup;
  /** Бронь до записи задачи: цена того, что предстоит заказать. */
  reservedUsd: number;
  record?: ImageJobRecord;
  controller: AbortController;
  /** Записи задачи идут по одной. */
  chain: Promise<unknown>;
  /** Задача ушла провайдеру (или запуск кончился): заказ можно отдать приложению. */
  sent: { promise: Promise<void>; resolve(): void };
  done?: Promise<void>;
  leaseTimer?: ReturnType<typeof setTimeout>;
  ended: boolean;
  /** Первая проверка — сразу: задача уже у провайдера (перезапуск, новая попытка, «Повторить»). */
  checkNow: boolean;
  /** «Повторить» после сбоя доставки: тот же адрес снова не скачался — заказать последний шаг заново. */
  reorderOnDeliveryFailure: boolean;
}

type StepOutcome = { kind: "ready" } | { kind: "failed"; reason: string } | { kind: "refused"; reason: string } | { kind: "timeout" };

/** Запуск закончен: вытеснен, «Повторить», чужая аренда или `stop()`. Дальше он ничего не заказывает и не пишет. */
class RunEnded extends Error {
  constructor() {
    super("Запуск задачи картинки закончен");
  }
}
const RUN_ENDED = new RunEnded();

/** Обращение к провайдеру не уложилось в свой срок. */
class CallTimedOut extends Error {
  constructor(readonly ms: number) {
    super(`Провайдер не ответил за ${Math.round(ms / 1000)} с`);
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const seconds = (ms: number) => Math.round(ms / 1000);
const roundUsd = (value: number) => Math.round(value * 1e9) / 1e9;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const unref = (timer: ReturnType<typeof setTimeout>) => (timer as { unref?: () => void }).unref?.();
const hasUnrecorded = (steps: readonly ImageJobStep[]) => steps.some((step) => step.charges.some((charge) => !charge.recorded));
const isOpen = isOpenImageJob;
const withStep = (steps: readonly ImageJobStep[], index: number, change: (step: ImageJobStep) => ImageJobStep) => steps.map((step, at) => (at === index ? change(step) : step));

function withoutTask(step: ImageJobStep): ImageJobStep {
  const { task: _task, ...rest } = step;
  return rest;
}

const chargeOf = (task: ImageJobTask, costUsd: number): ImageJobCharge => ({ usageId: task.usageId, modelId: task.modelId, providerId: task.providerId, costUsd, recorded: false });

/** Цена ответа провайдера; не сообщил — цена модели. */
function costOf(results: readonly ImageGenerationResult[], fallbackUsd: number): number {
  const known = results.filter((result) => result.costUsd !== undefined);
  return known.length > 0 ? known.reduce((total, result) => total + result.costUsd!, 0) : fallbackUsd;
}

/** Отметка «расход записан»; задача без работы — заодно без аренды. Отметка уже есть — `null`. */
function markRecorded(record: ImageJobRecord, usageId: string): ImageJobPatch | null {
  let found = false;
  const steps = record.steps.map((step) => ({
    ...step,
    charges: step.charges.map((charge) => {
      if (charge.usageId !== usageId || charge.recorded) return charge;
      found = true;
      return { ...charge, recorded: true };
    }),
  }));
  if (!found) return null;
  if (isOpen(record)) return { steps };
  const left = hasUnrecorded(steps);
  return { steps, active: left, ...(!left && { leaseOwner: undefined, leaseUntil: undefined }) };
}

function view(record: ImageJobRecord): ImageJob {
  return {
    id: record.id,
    key: record.key,
    ownerId: record.ownerId,
    chatId: record.chatId,
    ...(record.turnId !== undefined && { turnId: record.turnId }),
    ...(record.group !== undefined && { group: record.group }),
    ...(record.purpose !== "" && { purpose: record.purpose }),
    prompt: record.prompt,
    aspectRatio: record.aspectRatio,
    ...(record.data !== undefined && { data: record.data }),
    status: record.status,
    ...(record.reason !== undefined && { reason: record.reason }),
    ...(record.result !== undefined && { result: record.result }),
    attempt: record.attempt,
    ...(record.lateUntil !== undefined && { lateUntil: record.lateUntil }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.finishedAt !== undefined && { finishedAt: record.finishedAt }),
  };
}

const refused = (reason: string): ImageOrderRefusal => ({ status: "refused", reason });

function checkOptions(options: CreateImageQueueOptions) {
  const positive = ["pollIntervalMs", "attemptTimeoutMs", "latePollIntervalMs", "callTimeoutMs", "acceptWaitMs", "leaseMs", "forgetFinishedAfterMs", "maxImageBytes"] as const;
  for (const name of positive) {
    const value = options[name];
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) throw new Error(`Картинки: ${name} — нужно число больше нуля`);
  }
  for (const name of ["attempts", "downloadAttempts", "maxImagesPerTurn"] as const) {
    const value = options[name];
    if (value !== undefined && !(Number.isInteger(value) && value >= 1)) throw new Error(`Картинки: ${name} — целое число от 1`);
  }
  const window = options.lateResultWindowMs;
  if (window !== undefined && !(Number.isFinite(window) && window >= 0)) throw new Error("Картинки: lateResultWindowMs — число не меньше нуля");
  if (typeof options.deliver !== "function") throw new Error("Картинки: deliver — нужна функция-приёмник");
}

/**
 * Очередь картинок для своих инструментов приложения: заказ отвечает сразу, как задача ушла провайдеру, картинка
 * приходит в `deliver` позже. Задачи лежат в хранилище и переживают перезапуск: старт подбирает незаконченные,
 * доопрашивает провайдера и доставляет. Каждая задача провайдера оплачивается ровно один раз (постоянный id записи
 * расхода), готовая картинка не заказывается заново — только скачивается.
 */
export function createImageQueue(options: CreateImageQueueOptions): ImageQueue {
  checkOptions(options);
  const { purposes: queuePurposes, ...choice } = options;
  const purposes: Record<string, ImagePurpose> | undefined =
    queuePurposes && Object.fromEntries(Object.entries(queuePurposes).map(([name, purpose]) => [name, { ...purpose, description: purpose.description?.trim() || name }]));
  const setups = resolveImageSetups({ ...choice, ...(purposes && { purposes }) });
  const firstPurpose = setups.hasPurposes ? [...setups.byPurpose.keys()][0]! : "";
  const store = options.store ?? memoryImageJobStore();
  const now = options.now ?? (() => new Date());
  const nowMs = () => now().getTime();
  const hide = setups.hideSecrets;
  const logError = (message: string) => options.logError?.(hide(message));

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const attempts = options.attempts ?? 1;
  const lateResultWindowMs = options.lateResultWindowMs ?? DEFAULT_LATE_RESULT_WINDOW_MS;
  const latePollIntervalMs = options.latePollIntervalMs ?? Math.max(pollIntervalMs, MIN_LATE_POLL_INTERVAL_MS);
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const downloadAttempts = options.downloadAttempts ?? DEFAULT_DOWNLOAD_ATTEMPTS;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const acceptWaitMs = options.acceptWaitMs ?? DEFAULT_ACCEPT_WAIT_MS;
  const forgetFinishedAfterMs = options.forgetFinishedAfterMs ?? DEFAULT_FORGET_FINISHED_AFTER_MS;
  const maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const timeoutReason = `Картинка не успела за ${seconds(attemptTimeoutMs)} с`;

  /** Эта копия сервера: так помечена её аренда. */
  const me = crypto.randomUUID();
  /** Брони и запуски этой копии по порядку появления: проверка лимита видит тех, кто раньше. */
  const runtimes = new Set<Runtime>();
  const byJob = new Map<string, Runtime>();
  const keyLocks = new Map<string, Promise<unknown>>();
  const retries = new Map<string, Promise<ImageJob | ImageOrderRefusal | null>>();
  const turns = createTurnCounter(options.maxImagesPerTurn);
  let started = false;
  let stopped = false;
  let scanning: Promise<void> | undefined;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPruneAt = Number.NEGATIVE_INFINITY;

  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(RUN_ENDED);
      const onAbort = () => {
        clearTimeout(timer);
        reject(RUN_ENDED);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      unref(timer);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  const throwIfEnded = (rt: Runtime) => {
    if (rt.controller.signal.aborted) throw RUN_ENDED;
  };

  /** Обращение к провайдеру со своим сроком; запуск закончился — обрывается и оно. */
  async function callProvider<T>(rt: Runtime, ms: number, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("timeout", "TimeoutError")), ms);
    unref(timer);
    try {
      return await call(AbortSignal.any([rt.controller.signal, timeout.signal]));
    } catch (error) {
      if (timeout.signal.aborted && !rt.controller.signal.aborted) throw new CallTimedOut(ms);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // --- запись ---

  /**
   * Условная запись с перечитыванием: правка считается от свежей записи. Запись сменилась так, что она больше не «наша»
   * (`stillOurs`), — `null`. Правке нечего делать — запись как есть.
   */
  async function updateJob(start: ImageJobRecord, patchOf: (record: ImageJobRecord) => ImageJobPatch | null, stillOurs: (record: ImageJobRecord) => boolean): Promise<ImageJobRecord | null> {
    let current = start;
    for (let tries = 0; tries < MAX_WRITE_TRIES; tries++) {
      const patch = patchOf(current);
      if (!patch) return current;
      const next = await store.update(current.id, { ...patch, updatedAt: iso(nowMs()) }, current.version);
      if (next) return next;
      const fresh = await store.get(current.id);
      if (!fresh || !stillOurs(fresh)) return null;
      current = fresh;
    }
    throw new Error(`Картинки: задачу ${start.id} не удалось записать: её всё время правят`);
  }

  /** Запись запуска: по одной, только пока запуск свой (тот же номер и наша аренда). Чужой — запуск кончается. */
  function write(rt: Runtime, patchOf: (record: ImageJobRecord) => ImageJobPatch | null): Promise<ImageJobRecord> {
    const run = async () => {
      throwIfEnded(rt);
      const record = rt.record!;
      const next = await updateJob(record, patchOf, (fresh) => fresh.run === record.run && fresh.leaseOwner === me);
      if (!next) {
        rt.controller.abort(RUN_ENDED);
        throw RUN_ENDED;
      }
      rt.record = next;
      return next;
    };
    const result = rt.chain.then(run, run);
    rt.chain = result.catch(() => {});
    return result;
  }

  // --- деньги ---

  /** Ошибка базы «такой id уже есть» (PostgreSQL, SQLite), в том числе завёрнутая в `cause`. */
  function isDuplicateKey(error: unknown): boolean {
    for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; current = (current as { cause?: unknown }).cause, depth++) {
      const code = (current as { code?: unknown }).code;
      if (code === "23505" || code === "SQLITE_CONSTRAINT_PRIMARYKEY" || code === "SQLITE_CONSTRAINT_UNIQUE") return true;
    }
    return false;
  }

  /**
   * Запись расхода с постоянным id: вторая вставка того же id отвергается базой, расход не задваивается. `true` — расход
   * в базе (вставлен сейчас или был раньше); `false` — не записан (временный сбой), его допишет следующий обход.
   */
  async function insertUsage(record: ImageJobRecord, charge: ImageJobCharge): Promise<boolean> {
    const spending = options.spending;
    if (!spending) return true;
    try {
      await spending.storage.insertUsageRecord({
        id: charge.usageId,
        ownerId: record.ownerId,
        chatId: record.chatId,
        messageId: null,
        source: "images",
        modelId: charge.modelId,
        providerId: charge.providerId,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        costUsd: charge.costUsd,
        createdAt: iso(nowMs()),
      });
    } catch (error) {
      const known = await (spending.storage.hasUsageRecord?.(charge.usageId) ?? Promise.resolve(isDuplicateKey(error))).catch(() => false);
      if (known) return true;
      logError(`Картинки: расход ${charge.modelId} (${charge.usageId}) пока не записан, запись повторится: ${errorText(error)}`);
      return false;
    }
    const afterSpending = spending.limits?.afterSpending;
    // Пороги — фоном: задачу они не задерживают.
    if (afterSpending) {
      void afterSpending
        .call(spending.limits, { userId: record.ownerId, chatId: record.chatId })
        .catch((error: unknown) => logError(`Картинки: лимиты после расхода (чат ${record.chatId}): ${errorText(error)}`));
    }
    return true;
  }

  const unrecorded = (record: ImageJobRecord) => record.steps.flatMap((step) => step.charges.filter((charge) => !charge.recorded));

  async function recordCharges(rt: Runtime) {
    for (const charge of unrecorded(rt.record!)) {
      if (await insertUsage(rt.record!, charge)) await write(rt, (record) => markRecorded(record, charge.usageId));
    }
  }

  /** Расходы задачи без запуска (вытеснена, подобрана после сбоя); в конце — задача без работы и аренды. */
  async function settleClosed(record: ImageJobRecord) {
    let current: ImageJobRecord | null = record;
    for (const charge of unrecorded(record)) {
      if (!(await insertUsage(record, charge))) continue;
      current = await updateJob(current!, (fresh) => markRecorded(fresh, charge.usageId), () => true);
      if (!current) return;
    }
    await updateJob(current!, (fresh) => (isOpen(fresh) || (!fresh.active && fresh.leaseOwner === undefined) ? null : { active: hasUnrecorded(fresh.steps), leaseOwner: undefined, leaseUntil: undefined }), () => true);
  }

  /** Оплата ушедшей задачи шага: ценой провайдера, а без неё — ценой модели. */
  async function chargeTask(rt: Runtime, index: number, costUsd?: number) {
    await write(rt, (record) => {
      const task = record.steps[index]!.task;
      if (!task) return null;
      return { steps: withStep(record.steps, index, (step) => ({ ...withoutTask(step), charges: [...step.charges, chargeOf(task, costUsd ?? task.priceUsd)] })) };
    });
    await recordCharges(rt);
  }

  /** Шаг готов: адреса и оплата — одной записью, дальше шаг только скачивается. */
  async function acceptResults(rt: Runtime, index: number, results: readonly ImageGenerationResult[]) {
    const urls = results.map((result) => result.url);
    await write(rt, (record) => {
      const task = record.steps[index]!.task;
      if (!task) return null;
      return { steps: withStep(record.steps, index, (step) => ({ ...withoutTask(step), urls, charges: [...step.charges, chargeOf(task, costOf(results, task.priceUsd))] })) };
    });
    await recordCharges(rt);
  }

  /**
   * Закрыть задачу без её запуска: вытеснена новым заказом или настройка сменилась. Ушедшие задачи провайдера —
   * по цене модели; номер запуска растёт, и прежний запуск больше ничего не делает.
   */
  async function closeJob(record: ImageJobRecord, status: "superseded" | "failed", reason?: string) {
    const closed = await updateJob(
      record,
      (fresh) => {
        if (!isOpen(fresh)) return null;
        const steps = fresh.steps.map((step) => (step.task ? { ...withoutTask(step), charges: [...step.charges, chargeOf(step.task, step.task.priceUsd)] } : step));
        return { status, reason, run: fresh.run + 1, steps, lateUntil: undefined, active: hasUnrecorded(steps), finishedAt: iso(nowMs()), leaseOwner: undefined, leaseUntil: undefined };
      },
      () => true,
    );
    if (!closed) return;
    byJob.get(record.id)?.controller.abort(RUN_ENDED);
    await settleClosed(closed);
  }

  function openUsd(rt: Runtime): number {
    const record = rt.record;
    if (!record) return rt.reservedUsd;
    if (!isOpen(record)) return 0;
    const late = record.lateUntil !== undefined;
    const last = record.steps.length - 1;
    return record.steps.reduce((total, step, index) => {
      // «Повторить» после сбоя доставки: адрес снова не скачается — последний шаг закажется заново.
      if (step.urls) return rt.reorderOnDeliveryFailure && index === last ? total + rt.setup.steps[index]!.priceUsd : total;
      if (step.task) return total + step.task.priceUsd;
      return late ? total : total + (rt.setup.steps[index]?.priceUsd ?? 0);
    }, 0);
  }

  /** Заказанное и не оплаченное; `before` — только брони и запуски, появившиеся раньше него. */
  function pendingUsd(ownerId: string, chatId: string, before?: Runtime): { user: number; chat: number } {
    let user = 0;
    let chat = 0;
    for (const rt of runtimes) {
      if (rt === before) break;
      if (rt.ownerId !== ownerId) continue;
      const open = openUsd(rt);
      user += open;
      if (rt.chatId === chatId) chat += open;
    }
    return { user: roundUsd(user), chat: roundUsd(chat) };
  }

  async function withinLimit(rt: Runtime): Promise<string | undefined> {
    const limits = options.spending?.limits;
    if (!limits) return undefined;
    const pending = pendingUsd(rt.ownerId, rt.chatId, rt);
    try {
      await limits.assertWithinLimit({ userId: rt.ownerId, chatId: rt.chatId, ...(pending.user > 0 && { pendingUsd: pending }) });
      return undefined;
    } catch (error) {
      if (error instanceof SpendingLimitReachedError) return LIMIT_REACHED;
      logError(`Картинки: не удалось проверить лимит расходов: ${errorText(error)}`);
      return "не удалось проверить лимит расходов";
    }
  }

  // --- провайдер ---

  function requestOf(record: ImageJobRecord, step: ImageStep, sourceUrl: string | undefined, timeoutMs: number, signal: AbortSignal): ImageGenerationRequest {
    const { width, height } = step.sizes[record.aspectRatio];
    return {
      taskUUID: crypto.randomUUID(),
      providerModelId: step.providerModelId,
      prompt: step.prompt ?? record.prompt,
      width,
      height,
      aspectRatio: step.profile.aspectRatioValues?.[record.aspectRatio] ?? record.aspectRatio,
      ...(sourceUrl !== undefined && { imageUrl: sourceUrl }),
      ...(step.outputFormat && { outputFormat: step.outputFormat }),
      ...(step.providerSettings && { providerSettings: step.providerSettings }),
      abortSignal: signal,
      timeoutMs,
    };
  }

  /** Отправка не удалась: отказ до работы — без оплаты; иначе ушла ли задача, неизвестно — по цене модели. */
  async function failedSend(rt: Runtime, index: number, error: unknown, wholeAttempt: boolean): Promise<StepOutcome> {
    throwIfEnded(rt);
    if (error instanceof ImageGenerationError && error.refusedBeforeWork) {
      await write(rt, (record) => ({ steps: withStep(record.steps, index, withoutTask) }));
      return { kind: "refused", reason: hide(error.reason) };
    }
    let reason: string;
    if (error instanceof ImageGenerationError) reason = hide(error.reason);
    else if (error instanceof CallTimedOut) reason = wholeAttempt ? timeoutReason : error.message;
    else {
      logError(`Картинки: сбой провайдера ${rt.setup.steps[index]!.provider.id}: ${errorText(error)}`);
      reason = "Провайдер не смог создать картинку";
    }
    await chargeTask(rt, index);
    return { kind: "failed", reason };
  }

  async function send(rt: Runtime, index: number): Promise<StepOutcome> {
    const step = rt.setup.steps[index]!;
    const task: ImageJobTask = { usageId: crypto.randomUUID(), modelId: step.profile.id, providerId: step.provider.id, priceUsd: step.priceUsd, sentAt: iso(nowMs()) };
    // Сначала отметка «уходит»: упал сервер посреди отправки — задача всё равно будет оплачена.
    await write(rt, (record) => ({ steps: withStep(record.steps, index, (current) => ({ ...current, task })) }));
    const record = rt.record!;
    const sourceUrl = index > 0 ? record.steps[index - 1]!.urls?.[0] : undefined;
    const queue = step.provider.queue;
    if (queue) {
      let taskId: string;
      try {
        taskId = await callProvider(rt, callTimeoutMs, (signal) => queue.submit(requestOf(record, step, sourceUrl, callTimeoutMs, signal), step.connection));
      } catch (error) {
        return failedSend(rt, index, error, false);
      }
      await write(rt, (fresh) => ({ steps: withStep(fresh.steps, index, (current) => ({ ...current, task: { ...current.task!, taskId } })) }));
      return poll(rt, index);
    }
    // Без очереди «принял» не бывает: заказ отвечает, когда провайдер ответил (отказ виден сразу) или через acceptWaitMs.
    const accepted = setTimeout(() => rt.sent.resolve(), acceptWaitMs);
    unref(accepted);
    const timeoutMs = Math.max(1, Date.parse(record.attemptDeadline) - nowMs());
    let results: ImageGenerationResult[];
    try {
      results = await callProvider(rt, timeoutMs, (signal) => step.provider.generate(requestOf(record, step, sourceUrl, timeoutMs, signal), step.connection));
    } catch (error) {
      return failedSend(rt, index, error, true);
    } finally {
      clearTimeout(accepted);
    }
    throwIfEnded(rt);
    await acceptResults(rt, index, results);
    return { kind: "ready" };
  }

  /** Опрос задачи в очереди провайдера до готовности, провала или срока (попытки или позднего окна). */
  async function poll(rt: Runtime, index: number): Promise<StepOutcome> {
    rt.sent.resolve();
    const step = rt.setup.steps[index]!;
    const queue = step.provider.queue!;
    const taskId = rt.record!.steps[index]!.task!.taskId!;
    const checkNow = rt.checkNow;
    rt.checkNow = false;
    for (let first = true; ; first = false) {
      if (!(first && checkNow)) {
        const record = rt.record!;
        const deadline = Date.parse(record.lateUntil ?? record.attemptDeadline);
        const wait = Math.min(record.lateUntil !== undefined ? latePollIntervalMs : pollIntervalMs, deadline - nowMs());
        if (wait > 0) await sleep(wait, rt.controller.signal);
        if (nowMs() >= deadline) return { kind: "timeout" };
      }
      let state: ImageTaskState;
      try {
        state = await callProvider(rt, callTimeoutMs, (signal) => queue.check(taskId, step.connection, signal));
      } catch (error) {
        throwIfEnded(rt);
        if (error instanceof ImageGenerationError) {
          await chargeTask(rt, index);
          return { kind: "failed", reason: hide(error.reason) };
        }
        // Временный сбой или срок обращения: проверка повторится.
        continue;
      }
      throwIfEnded(rt);
      if (state.status === "ready") {
        await acceptResults(rt, index, state.results);
        return { kind: "ready" };
      }
      if (state.status === "failed") {
        await chargeTask(rt, index, state.costUsd);
        return { kind: "failed", reason: hide(state.reason) };
      }
    }
  }

  // --- запуск ---

  async function finishFailed(rt: Runtime, reason: string, extra: ImageJobPatch = {}) {
    await write(rt, (record) => ({
      status: "failed",
      reason,
      lateUntil: undefined,
      ...extra,
      active: hasUnrecorded(record.steps),
      finishedAt: iso(nowMs()),
      leaseOwner: undefined,
      leaseUntil: undefined,
    }));
  }

  const nextAttempt = (rt: Runtime) => write(rt, (record) => ({ attempt: record.attempt + 1, attemptDeadline: iso(nowMs() + attemptTimeoutMs) }));

  /** Шаг до готовых адресов; `false` — задача закончилась без них (запись уже сделана). */
  async function runStep(rt: Runtime, index: number): Promise<boolean> {
    for (;;) {
      throwIfEnded(rt);
      const record = rt.record!;
      const step = record.steps[index]!;
      if (step.urls) return true;
      const late = record.lateUntil !== undefined;
      let outcome: StepOutcome;
      if (step.task?.taskId !== undefined) outcome = await poll(rt, index);
      else if (step.task) {
        // Сервер упал посреди отправки: ушла ли задача, неизвестно — по цене модели, попытка не удалась.
        await chargeTask(rt, index);
        outcome = { kind: "failed", reason: "Провайдер не ответил: сервер перезапускался" };
      } else if (late) outcome = { kind: "failed", reason: record.reason ?? timeoutReason };
      else if (nowMs() >= Date.parse(record.attemptDeadline)) outcome = { kind: "failed", reason: timeoutReason };
      else outcome = await send(rt, index);

      if (outcome.kind === "ready") {
        if (late) await write(rt, () => ({ status: "generating", reason: undefined, lateUntil: undefined, attemptDeadline: iso(nowMs() + attemptTimeoutMs) }));
        return true;
      }
      if (outcome.kind === "refused") {
        await finishFailed(rt, outcome.reason);
        return false;
      }
      if (outcome.kind === "failed") {
        if (!late && rt.record!.attempt < attempts) {
          await nextAttempt(rt);
          continue;
        }
        await finishFailed(rt, outcome.reason);
        return false;
      }
      // Срок вышел, задача у провайдера ещё идёт.
      if (late) {
        await chargeTask(rt, index);
        await finishFailed(rt, rt.record!.reason ?? timeoutReason);
        return false;
      }
      if (rt.record!.attempt < attempts) {
        await nextAttempt(rt);
        rt.checkNow = true;
        continue;
      }
      if (lateResultWindowMs > 0) {
        await write(rt, () => ({ status: "failed", reason: timeoutReason, lateUntil: iso(nowMs() + lateResultWindowMs) }));
        continue;
      }
      await chargeTask(rt, index);
      await finishFailed(rt, timeoutReason);
      return false;
    }
  }

  /** Скачать с того же адреса (несколько раз) и отдать приёмнику. `reorder` — после «Повторить» адрес так и не скачался. */
  async function deliverResult(rt: Runtime): Promise<"done" | "reorder"> {
    rt.sent.resolve();
    const record = rt.record!;
    const last = rt.setup.steps.at(-1)!;
    // У модели с основой первым идёт фон без предмета, картинка — следующая.
    const url = record.steps.at(-1)!.urls?.[last.profile.firstResultIsBase ? 1 : 0];
    if (!url) {
      await finishFailed(rt, "Провайдер не вернул картинку");
      return "done";
    }
    const output = rt.setup.output;
    let file: DownloadedImage;
    for (let attempt = 1; ; attempt++) {
      try {
        file = await downloadGeneratedImage({
          url,
          ...(last.downloadFetch && { fetch: last.downloadFetch }),
          maxImageBytes,
          ...(last.trustedOrigin !== undefined && { trustedOrigin: last.trustedOrigin }),
          abortSignal: rt.controller.signal,
          ...(output && { transform: (bytes: Uint8Array, mediaType: string) => postprocessImage(bytes, mediaType, output) }),
        });
        break;
      } catch (error) {
        throwIfEnded(rt);
        if (attempt >= downloadAttempts) {
          if (rt.reorderOnDeliveryFailure) return "reorder";
          await finishFailed(rt, error instanceof ImageGenerationError ? hide(error.reason) : "Картинка не скачалась", { deliveryFailed: true });
          return "done";
        }
        await sleep(pollIntervalMs, rt.controller.signal);
      }
    }
    throwIfEnded(rt);
    const first = rt.setup.steps[0]!.profile;
    const planned = rt.setup.steps[0]!.sizes[record.aspectRatio];
    const image: GeneratedImage = { bytes: file.bytes, mediaType: file.mediaType, width: file.width ?? planned.width, height: file.height ?? planned.height, modelId: first.id };
    const run = record.run;
    const context: ImageDeliveryContext = {
      signal: rt.controller.signal,
      async isCurrent() {
        if (rt.controller.signal.aborted) return false;
        const fresh = await store.get(record.id);
        return fresh !== null && fresh.run === run && fresh.leaseOwner === me && isOpen(fresh) && !rt.controller.signal.aborted;
      },
    };
    let result: unknown;
    try {
      result = await options.deliver(image, view(record), context);
    } catch (error) {
      throwIfEnded(rt);
      logError(`Картинки: приёмник не принял картинку задачи ${record.id}: ${errorText(error)}`);
      await finishFailed(rt, "Приёмник не принял картинку", { deliveryFailed: true });
      return "done";
    }
    throwIfEnded(rt);
    await write(rt, (fresh) => ({
      status: result === false ? "discarded" : "ready",
      reason: undefined,
      lateUntil: undefined,
      deliveryFailed: undefined,
      ...(result !== false && result !== undefined && { result }),
      active: hasUnrecorded(fresh.steps),
      finishedAt: iso(nowMs()),
      leaseOwner: undefined,
      leaseUntil: undefined,
    }));
    return "done";
  }

  async function generate(rt: Runtime) {
    for (;;) {
      for (let index = 0; index < rt.setup.steps.length; index++) {
        if (!(await runStep(rt, index))) return;
      }
      if ((await deliverResult(rt)) === "done") return;
      // Тот же адрес не скачался и после «Повторить»: последний шаг заказывается заново, прежние — нет.
      rt.reorderOnDeliveryFailure = false;
      const last = rt.setup.steps.length - 1;
      await write(rt, (record) => ({
        deliveryFailed: undefined,
        attemptDeadline: iso(nowMs() + attemptTimeoutMs),
        steps: withStep(record.steps, last, ({ urls: _urls, ...step }) => step),
      }));
    }
  }

  async function drive(rt: Runtime) {
    try {
      await recordCharges(rt);
      if (isOpen(rt.record!)) await generate(rt);
    } catch (error) {
      if (error !== RUN_ENDED && !rt.controller.signal.aborted) logError(`Картинки: задача ${rt.record?.id ?? ""} остановилась: ${errorText(error)}`);
    } finally {
      rt.ended = true;
      clearTimeout(rt.leaseTimer);
      runtimes.delete(rt);
      if (rt.record && byJob.get(rt.record.id) === rt) byJob.delete(rt.record.id);
      rt.sent.resolve();
    }
  }

  function keepLease(rt: Runtime) {
    const renew = () => {
      rt.leaseTimer = setTimeout(async () => {
        if (rt.ended || rt.controller.signal.aborted) return;
        try {
          await write(rt, (record) => (record.leaseOwner === me ? { leaseUntil: iso(nowMs() + leaseMs) } : null));
        } catch (error) {
          if (error !== RUN_ENDED) logError(`Картинки: аренда задачи ${rt.record?.id ?? ""} не продлилась: ${errorText(error)}`);
        }
        if (!rt.ended && !rt.controller.signal.aborted) renew();
      }, Math.max(1, Math.floor(leaseMs / 3)));
      unref(rt.leaseTimer);
    };
    renew();
  }

  function newRuntime(ownerId: string, chatId: string, setup: ImageSetup, reservedUsd: number): Runtime {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => (resolve = done));
    return { ownerId, chatId, setup, reservedUsd, controller: new AbortController(), chain: Promise.resolve(), sent: { promise, resolve }, ended: false, checkNow: false, reorderOnDeliveryFailure: false };
  }

  function launch(rt: Runtime, record: ImageJobRecord) {
    rt.record = record;
    byJob.set(record.id, rt);
    keepLease(rt);
    rt.done = drive(rt);
  }

  /** Настройка задачи из её назначения; назначение пропало или шаги другие — `undefined`. */
  function setupOf(record: ImageJobRecord): ImageSetup | undefined {
    const setup = setups.byPurpose.get(record.purpose);
    if (!setup || setup.steps.length !== record.steps.length) return undefined;
    const sameProviders = record.steps.every((step, index) => !step.task || step.task.providerId === setup.steps[index]!.provider.id);
    return sameProviders ? setup : undefined;
  }

  /** Работа с одним местом (`ownerId` + `key`) — по одной в этой копии: заказ и «Повторить» не перебивают друг друга. */
  function underKey<T>(ownerId: string, key: string, work: () => Promise<T>): Promise<T> {
    const lockKey = JSON.stringify([ownerId, key]);
    const current = (keyLocks.get(lockKey) ?? Promise.resolve()).then(work, work);
    const tail = current.catch(() => {});
    keyLocks.set(lockKey, tail);
    void tail.then(() => {
      if (keyLocks.get(lockKey) === tail) keyLocks.delete(lockKey);
    });
    return current;
  }

  // --- обход хранилища ---

  /** Взять задачу из хранилища: аренда свободна или истекла. Закрытой — дописать расход, открытую — вести. */
  async function claim(record: ImageJobRecord) {
    if (stopped || byJob.has(record.id)) return;
    const claimed = await store.update(record.id, { leaseOwner: me, leaseUntil: iso(nowMs() + leaseMs), updatedAt: iso(nowMs()) }, record.version);
    if (!claimed) return;
    if (!isOpen(claimed)) return settleClosed(claimed);
    const setup = setupOf(claimed);
    if (!setup) return closeJob(claimed, "failed", `Настройка картинок сменилась: назначения «${claimed.purpose}» в ней больше нет`);
    const rt = newRuntime(claimed.ownerId, claimed.chatId, setup, 0);
    rt.checkNow = true;
    rt.reorderOnDeliveryFailure = false;
    runtimes.add(rt);
    launch(rt, claimed);
  }

  function scheduleScan() {
    if (stopped || !started) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => void scan(), leaseMs);
    unref(scanTimer);
  }

  function scan(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (scanning) return scanning;
    scanning = (async () => {
      try {
        if (nowMs() - lastPruneAt >= PRUNE_EVERY_MS) {
          lastPruneAt = nowMs();
          await store.deleteFinishedBefore(iso(nowMs() - forgetFinishedAfterMs));
        }
        for (const record of await store.listResumable(iso(nowMs()))) {
          if (stopped) break;
          await claim(record).catch((error: unknown) => logError(`Картинки: задачу ${record.id} не удалось подобрать: ${errorText(error)}`));
        }
      } catch (error) {
        logError(`Картинки: обход задач не удался: ${errorText(error)}`);
      } finally {
        scanning = undefined;
        scheduleScan();
      }
    })();
    return scanning;
  }

  // --- снаружи ---

  async function order(input: ImageOrder): Promise<ImageJob | ImageOrderRefusal> {
    if (stopped) throw new Error("Картинки: очередь остановлена (stop) — заказы не принимаются");
    if (!input.ownerId || !input.chatId) throw new Error("Картинки: order — нужны ownerId и chatId");
    const aspectRatio = input.aspectRatio ?? "1:1";
    if (!aspectRatios.includes(aspectRatio)) return refused(`пропорции ${aspectRatio} нет: ${aspectRatios.join(", ")}`);
    if (typeof input.prompt !== "string" || !input.prompt.trim()) return refused("пустое описание картинки");
    const purpose = setups.hasPurposes ? (input.purpose ?? firstPurpose) : input.purpose === undefined ? "" : undefined;
    const setup = purpose === undefined ? undefined : setups.byPurpose.get(purpose);
    if (purpose === undefined || !setup) return refused(`назначения «${input.purpose}» нет`);
    if (!turns.take(input.turnId)) return refused(`не больше ${options.maxImagesPerTurn} картинок за ход`);

    // Бронь — до первого await: параллельный заказ уже видит её в pendingUsd.
    const rt = newRuntime(input.ownerId, input.chatId, setup, setup.priceUsd);
    runtimes.add(rt);
    let accepted = false;
    try {
      const refusal = await withinLimit(rt);
      if (refusal) return refused(refusal);
      if (rt.controller.signal.aborted) return refused(QUEUE_STOPPED);
      const id = crypto.randomUUID();
      const key = input.key ?? id;
      const newRecord = (): ImageJobRecord => {
        const at = nowMs();
        return {
          id,
          key,
          ownerId: input.ownerId,
          chatId: input.chatId,
          ...(input.turnId !== undefined && { turnId: input.turnId }),
          ...(input.group !== undefined && { group: input.group }),
          purpose,
          prompt: input.prompt,
          aspectRatio,
          ...(input.data !== undefined && { data: input.data }),
          status: "generating",
          active: true,
          run: 1,
          attempt: 1,
          attemptDeadline: iso(at + attemptTimeoutMs),
          steps: setup.steps.map(() => ({ charges: [] })),
          leaseOwner: me,
          leaseUntil: iso(at + leaseMs),
          version: 1,
          createdAt: iso(at),
          updatedAt: iso(at),
        };
      };
      const record = await underKey(input.ownerId, key, async () => {
        // Открытая задача на место — одна, это держит база: если другая копия сервера успела занять место между
        // закрытием и вставкой, вставка не проходит — закрываем и её, пробуем снова.
        for (let tries = 1; ; tries++) {
          for (const old of await store.list({ ownerId: input.ownerId, key })) if (isOpen(old)) await closeJob(old, "superseded");
          if (stopped) return null;
          const created = newRecord();
          try {
            await store.insert(created);
            return created;
          } catch (error) {
            if (!(error instanceof ImageJobKeyTakenError) || tries >= MAX_PLACE_TRIES) throw error;
          }
        }
      });
      if (!record) return refused(QUEUE_STOPPED);
      // stop() пришёл, пока задача записывалась: провайдеру ничего не ушло — задача закрывается без аренды.
      if (stopped) {
        await closeJob(record, "failed", QUEUE_STOPPED);
        return refused(QUEUE_STOPPED);
      }
      accepted = true;
      launch(rt, record);
      await rt.sent.promise;
      return view(rt.record!);
    } finally {
      if (!accepted) {
        runtimes.delete(rt);
        turns.give(input.turnId);
      }
    }
  }

  async function reviveOrTaken(id: string, patch: ImageJobPatch, version: number): Promise<ImageJobRecord | null | "taken"> {
    try {
      return await store.update(id, patch, version);
    } catch (error) {
      if (error instanceof ImageJobKeyTakenError) return "taken";
      throw error;
    }
  }

  function retryJob(ownerId: string, key: string): Promise<ImageJob | ImageOrderRefusal | null> {
    return underKey(ownerId, key, async () => {
      const latest = (await store.list({ ownerId, key })).at(-1);
      if (!latest) return null;
      if (latest.status !== "failed") return view(latest);
      const setup = setupOf(latest);
      if (!setup) return refused(`назначения «${latest.purpose}» в настройке больше нет`);
      const remaining = latest.steps.reduce((total, step, index) => (step.urls ? total : total + (step.task?.priceUsd ?? setup.steps[index]!.priceUsd)), 0);
      // Сбой доставки: тот же адрес может не скачаться снова, тогда последний шаг заказывается заново — бронь на него.
      const reorderUsd = latest.deliveryFailed ? setup.steps.at(-1)!.priceUsd : 0;
      const rt = newRuntime(ownerId, latest.chatId, setup, remaining + reorderUsd);
      runtimes.add(rt);
      let accepted = false;
      try {
        const refusal = await withinLimit(rt);
        if (refusal) return refused(refusal);
        let current: ImageJobRecord | null = latest;
        let revived: ImageJobRecord | null | "taken" = null;
        // Новый запуск — условной записью: из двух «Повторить» (и двух копий сервера) проходит один.
        while (current?.status === "failed") {
          if (stopped) return refused(QUEUE_STOPPED);
          const at = nowMs();
          revived = await reviveOrTaken(
            current.id,
            {
              status: "generating",
              run: current.run + 1,
              attempt: 1,
              attemptDeadline: iso(at + attemptTimeoutMs),
              reason: undefined,
              lateUntil: undefined,
              deliveryFailed: undefined,
              finishedAt: undefined,
              active: true,
              leaseOwner: me,
              leaseUntil: iso(at + leaseMs),
              updatedAt: iso(at),
            },
            current.version,
          );
          // Место заняла новая задача (заказ с другой копии сервера): «Повторить» отдаёт её.
          if (revived === "taken") {
            const newest = (await store.list({ ownerId, key })).at(-1);
            return newest ? view(newest) : null;
          }
          if (revived) break;
          current = await store.get(latest.id);
        }
        if (!revived) return current ? view(current) : null;
        // stop() пришёл посреди «Повторить»: аренда отпускается, задачу продолжит следующий старт.
        if (stopped) {
          await updateJob(revived, (record) => (record.leaseOwner === me ? { leaseOwner: undefined, leaseUntil: undefined } : null), (record) => record.leaseOwner === me);
          return refused(QUEUE_STOPPED);
        }
        // Прежний запуск (опрос в позднем окне) кончается: дальше задачу ведёт новый.
        byJob.get(revived.id)?.controller.abort(RUN_ENDED);
        rt.checkNow = true;
        rt.reorderOnDeliveryFailure = current!.deliveryFailed === true;
        accepted = true;
        launch(rt, revived);
        await rt.sent.promise;
        return view(rt.record!);
      } finally {
        if (!accepted) runtimes.delete(rt);
      }
    });
  }

  async function start() {
    if (started) return scanning ?? Promise.resolve();
    started = true;
    stopped = false;
    return scan();
  }

  async function stop() {
    stopped = true;
    started = false;
    clearTimeout(scanTimer);
    scanTimer = undefined;
    await scanning;
    const all = [...runtimes];
    for (const rt of all) {
      clearTimeout(rt.leaseTimer);
      rt.controller.abort(RUN_ENDED);
    }
    await Promise.all(all.map((rt) => rt.done));
    // Аренда отпускается сразу: следующий старт (или другая копия) берёт задачи без ожидания срока.
    for (const rt of all) {
      if (!rt.record) continue;
      await rt.chain;
      await updateJob(rt.record, (record) => (record.leaseOwner === me ? { leaseOwner: undefined, leaseUntil: undefined } : null), (record) => record.leaseOwner === me).catch((error: unknown) =>
        logError(`Картинки: аренда задачи ${rt.record?.id ?? ""} не отпущена: ${errorText(error)}`),
      );
    }
  }

  void start();

  return {
    order,
    retry({ ownerId, key }) {
      if (stopped) return Promise.reject(new Error("Картинки: очередь остановлена (stop) — повтор не принимается"));
      const flight = JSON.stringify([ownerId, key]);
      const running = retries.get(flight);
      if (running) return running;
      const promise = retryJob(ownerId, key).finally(() => retries.delete(flight));
      retries.set(flight, promise);
      return promise;
    },
    async get(id) {
      const record = await store.get(id);
      return record ? view(record) : null;
    },
    async list(filter) {
      return (await store.list(filter)).map(view);
    },
    pendingUsd: (ownerId, chatId) => pendingUsd(ownerId, chatId),
    start,
    stop,
  };
}
