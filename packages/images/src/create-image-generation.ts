import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import type { AttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { SpendingLimitReachedError, declareToolTimeout } from "@ykurilov/agent-chat-core";
import type { ChatStorage, SpendingLimits } from "@ykurilov/agent-chat-core";
import { aspectRatios } from "./image-catalog";
import type { AspectRatio, ImageCatalog, ImageQuality, ImageSize } from "./image-catalog";
import { ImageGenerationError } from "./image-generation-error";
import { createImageJobs } from "./image-jobs";
import type { ImageJobInput, ImageJobOutcome, LateImage, ReceivedImageFile } from "./image-jobs";
import { createImageQueue } from "./image-queue/create-image-queue";
import type { GeneratedImage, ImageDeliveryContext, ImageJob, ImageQueue } from "./image-queue/create-image-queue";
import type { ImageJobStore } from "./image-queue/image-job-store";
import { createTurnCounter } from "./image-queue/turn-counter";
import { resolveImageSetups } from "./image-setup";
import type { ImagePurpose, ImageSetup } from "./image-setup";
import { recordImageUsage } from "./images-usage";
import type { ImageOutputOptions } from "./postprocess-image";
import { DOWNLOAD_TIMEOUT_MS, saveImageToChat } from "./save-images";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 150_000;
const DEFAULT_LATE_RESULT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Срок вызова `generate_images` при сроке генерации по умолчанию: генерация до 150 с и скачивание до 60 с. Инструмент
 * объявляет ядру свой срок сам (`requestTimeoutMs` + скачивание), настраивать `agent.toolTimeoutMs` не нужно.
 */
export const imageToolTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS + DOWNLOAD_TIMEOUT_MS;

export interface CreateImageGenerationOptions {
  /** Тот же объект `createAttachments`: картинки ложатся в его хранилище и отдаются его маршрутом. */
  attachments: { storage: AttachmentStorage };
  /** Окружение сервера: ключ провайдера берётся только отсюда, по `apiKeyEnv`. */
  env: Record<string, string | undefined>;
  catalog?: ImageCatalog;
  /** Модель картинок из каталога; по умолчанию `gpt-image-2`. С `purposes` не задаётся. */
  model?: string;
  /** Провайдер модели; по умолчанию первый из её `providerModelIds`. */
  provider?: string;
  /** Качество GPT Image (`low`, `medium`, `high`, `auto`); по умолчанию — из профиля (`low`). Для назначений — общее по умолчанию. */
  quality?: ImageQuality;
  /** Размер картинки: `1k` — длинная сторона около 1024 (1:1 — 1024×1024); по умолчанию — размер модели. Для назначений — общий по умолчанию. */
  size?: ImageSize;
  /** Прозрачный фон (GPT Image 2.5 у Runware): файл PNG с альфой. Для назначений — общий по умолчанию. */
  transparentBackground?: boolean;
  /** Постобработка перед сохранением: формат файла и предел большей стороны (sharp). Для назначений — общая по умолчанию. */
  output?: ImageOutputOptions;
  /**
   * Назначения: имя → модель и описание для агента. Агент выбирает назначение параметром `purpose`, по умолчанию —
   * первое. Описание инструмента собирается из них один раз и дальше не меняется (кэш модели).
   */
  purposes?: Record<string, ImagePurpose>;
  /**
   * Расход картинок в лимиты: запись на каждую отправленную задачу и проверка лимита до генерации. Заказанное, но ещё не
   * записанное (вызовы, которые идут прямо сейчас, и задачи в фоне) проверка видит в `pendingUsd`: параллельные вызовы
   * одного шага не проходят лимит все разом.
   */
  spending?: {
    storage: Pick<ChatStorage, "insertUsageRecord">;
    /** `afterSpending` (если есть) зовётся после каждой записи расхода: пороги лимитов видят и картинки. */
    limits?: Pick<SpendingLimits, "assertWithinLimit" | "afterSpending">;
  };
  /** Предел одного файла; по умолчанию 10 МБ. */
  maxImageBytes?: number;
  /** Срок одной генерации; по умолчанию 150 000 мс. */
  requestTimeoutMs?: number;
  /**
   * Провайдер с очередью (KIE): сколько ещё ждать картинку в фоне после срока вызова; по умолчанию 10 минут, 0 — не
   * ждать. Готовая сохраняется в чат и отдаётся повтору того же вызова бесплатно, а приложение узнаёт о ней в `onLateImage`.
   */
  lateResultWindowMs?: number;
  /**
   * Картинка пришла после срока вызова (в фоновом режиме — всегда) и сохранена в чат. Ошибка обработчика — в `logError`,
   * не наружу. Со своим приёмником `deliver` не зовётся: картинку получает приёмник.
   */
  onLateImage?: (image: LateImage) => void | Promise<void>;
  /**
   * Свой приёмник картинки вместо вложений чата: записать файл, обновить экран. Ответ (JSON) получает модель в
   * `результат`; `false` — картинка больше не нужна. В фоновом режиме приёмника зовут хотя бы один раз (после сбоя
   * сервера — ещё раз), поэтому повтор должен быть безопасен. Запись — условная, по `context.isCurrent()`: пока приёмник
   * работает, задачу могут вытеснить или остановить.
   */
  deliver?: (image: GeneratedImage, delivery: ImageDelivery, context: ImageDeliveryContext) => unknown;
  /**
   * `wait` (по умолчанию) — вызов ждёт картинку. `background` — вызов отвечает, как только задача ушла провайдеру, а
   * картинка приходит позже: во вложения (и `onLateImage`) или в `deliver`. Фоновые задачи лежат в `jobStore`.
   */
  mode?: "wait" | "background";
  /** Фоновый режим: где лежат задачи; по умолчанию в памяти. `sqliteImageJobStore` или `postgresImageJobStore` — переживают перезапуск. */
  jobStore?: ImageJobStore;
  /** Фоновый режим: шаг проверки задачи у провайдера с очередью; по умолчанию 3000 мс. */
  pollIntervalMs?: number;
  /** Фоновый режим: сколько попыток по `requestTimeoutMs`; следующая проверяет ту же задачу без новой оплаты. По умолчанию 1. */
  attempts?: number;
  /** Не больше стольких картинок за ход (`turnId`; без него — за набор `tools()`). Лишние — в ошибках, без заказа. */
  maxImagesPerTurn?: number;
  /** Фоновый режим: поля для ответа модели о заказанной картинке (например, куда она ляжет). */
  onQueued?: (job: ImageJob) => Record<string, unknown> | void | Promise<Record<string, unknown> | void>;
  fetch?: typeof globalThis.fetch;
  logError?: (message: string) => void;
  now?: () => Date;
}

/** Чья и какая картинка пришла в `deliver`. */
export interface ImageDelivery {
  ownerId: string;
  chatId: string;
  turnId?: string;
  /** Номер картинки в вызове, с 1. */
  number: number;
  prompt: string;
  aspectRatio: AspectRatio;
  purpose?: string;
  /** Модель картинки (первого шага). */
  modelId: string;
  /** Фоновый режим: id задачи из ответа модели. */
  jobId?: string;
}

/** Выбранная модель хода: ядро передаёт в `agent.tools(model)` того, чей ход, чат и номер хода. */
export interface ImageGenerationModel {
  ownerId?: string;
  chatId?: string;
  /** Номер хода: один на все попытки и запасного провайдера. По нему считается `maxImagesPerTurn`. */
  turnId?: string;
}

export interface ImageGeneration {
  /** `{ generate_images }` для `agent.tools`; без `ownerId` и `chatId` — пустой набор. */
  tools(model: ImageGenerationModel): ToolSet;
  /** Фоновый режим: подобрать незаконченные задачи. Зовётся само при создании; в режиме `wait` ничего не делает. */
  start(): Promise<void>;
  /** Фоновый режим: остановить опрос и таймеры перед закрытием хранилища; задачи продолжатся следующим `start`. */
  stop(): Promise<void>;
}

/** Кто заказывает: из `tools(model)`. */
interface Caller {
  ownerId: string;
  chatId: string;
  turnId?: string;
  /** Счёт предела за ход: номер хода или свой у набора `tools()`. */
  turnKey: string;
}

interface GenerateImagesInput {
  prompt: string;
  purpose?: string;
  count: number;
  aspectRatio: AspectRatio;
}

interface SavedImage {
  номер: number;
  /** Вложение чата; со своим приёмником его нет. */
  id?: string;
  ширина: number;
  высота: number;
  /** Ответ своего приёмника. */
  результат?: unknown;
}
interface FailedImage {
  номер: number;
  причина: string;
  /** Картинка ещё готовится у провайдера: повтор того же вызова получит её без новой оплаты. */
  готовится?: true;
}

/** Основа описания не зависит от человека и времени: от этого зависит кэш модели. */
const baseDescription =
  "Создаёт картинки по описанию и показывает их человеку в чате. " +
  "Пиши описание подробно: что изображено, стиль, цвета, композиция. " +
  "Человек видит картинки сам: в ответе не пересказывай их и не вставляй ссылки.";
/** Фоновый режим: картинка приходит сама, повторять вызов незачем. */
const backgroundDescription =
  "Заказывает картинки по описанию: они готовятся в фоне и появятся у человека сами. " +
  "Пиши описание подробно: что изображено, стиль, цвета, композиция. " +
  "Ответ приходит сразу, без картинок: не жди их, не вызывай инструмент снова ради них и не вставляй ссылки.";
const queuedMessage = "Картинки готовятся в фоне и появятся у человека сами. Не жди их и не заказывай заново.";
/** Только если есть провайдер с очередью: иначе «готовится» не бывает. */
const repeatHint = " Если у картинки в ошибках «готовится», повтори вызов с теми же параметрами позже: готовая придёт без новой оплаты.";

const promptSchema = z.string().min(2).max(2000).describe("Описание картинки, от 2 до 2000 знаков.");
const countSchema = z.number().int().min(1).max(8).default(1).describe("Сколько вариантов создать, от 1 до 8.");
const aspectRatioSchema = z.enum(aspectRatios as [AspectRatio, ...AspectRatio[]]).default("1:1").describe("Пропорции картинки.");

const LIMIT_REACHED = "лимит расходов исчерпан";
const NOT_NEEDED = "картинка больше не нужна приложению";

/** Бронь вызова, который идёт: задачи, ещё не отданные реестру задач, по цене назначения. */
interface Reservation {
  ownerId: string;
  chatId: string;
  openTasks: number;
  priceUsd: number;
}

/** Сумма в долларах без хвоста двоичной дроби: 8 × 0,02 — это 0,16. */
const roundUsd = (value: number) => Math.round(value * 1e9) / 1e9;

function checkNumbers(options: CreateImageGenerationOptions) {
  for (const [name, value] of [["maxImageBytes", options.maxImageBytes], ["requestTimeoutMs", options.requestTimeoutMs]] as const) {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) throw new Error(`Картинки: ${name} — нужно число больше нуля`);
  }
  const window = options.lateResultWindowMs;
  if (window !== undefined && !(Number.isFinite(window) && window >= 0)) throw new Error("Картинки: lateResultWindowMs — число не меньше нуля");
  const limit = options.maxImagesPerTurn;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1)) throw new Error("Картинки: maxImagesPerTurn — целое число от 1");
  if (options.mode !== "background") {
    const backgroundOnly = (["jobStore", "pollIntervalMs", "attempts", "onQueued"] as const).filter((name) => options[name] !== undefined);
    if (backgroundOnly.length > 0) throw new Error(`Картинки: ${backgroundOnly.join(", ")} — только для mode: "background"`);
  }
}

/**
 * Генерация картинок: инструмент `generate_images` для набора `agent.tools`. Настройка проверяется сразу: нет модели,
 * провайдера или ключа — исключение здесь, а не при первом вызове.
 */
export function createImageGeneration(options: CreateImageGenerationOptions): ImageGeneration {
  const setups = resolveImageSetups(options);
  checkNumbers(options);
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const logError = (message: string) => options.logError?.(setups.hideSecrets(message));
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
  const all = [...setups.byPurpose.values()];
  const queued = all.some((setup) => setup.steps.some((step) => step.provider.queue !== undefined));

  const turns = createTurnCounter(options.maxImagesPerTurn);
  const deliver = options.deliver;

  /** Свой приёмник: ответ — модели, `false` и сбой — в ошибки картинки. */
  async function deliverToApp(image: GeneratedImage, delivery: ImageDelivery, context: ImageDeliveryContext): Promise<unknown> {
    let result: unknown;
    try {
      result = await deliver!(image, delivery, context);
    } catch (error) {
      logError(`Картинки: приложение не приняло картинку ${delivery.number} (чат ${delivery.chatId}): ${errorText(error)}`);
      throw new ImageGenerationError("Приложение не приняло картинку", { refusedBeforeWork: false });
    }
    if (result === false) throw new ImageGenerationError(NOT_NEEDED, { refusedBeforeWork: false });
    return result;
  }

  const deliveryOf = (input: ImageJobInput, turnId: string | undefined, modelId: string): ImageDelivery => ({
    ownerId: input.ownerId,
    chatId: input.chatId,
    ...(turnId !== undefined && { turnId }),
    number: input.number,
    prompt: input.prompt,
    aspectRatio: input.aspectRatio,
    ...(input.setup.purpose !== undefined && { purpose: input.setup.purpose }),
    modelId,
  });

  /** Номер хода задачи прежнего режима: его ждёт свой приёмник. */
  const turnIds = new WeakMap<ImageJobInput, string>();

  async function receive(input: ImageJobInput, file: ReceivedImageFile, signal: AbortSignal): Promise<{ id?: string; result?: unknown }> {
    const modelId = input.setup.steps[0]!.profile.id;
    if (deliver) {
      const context: ImageDeliveryContext = { signal, isCurrent: async () => !signal.aborted };
      const result = await deliverToApp({ ...file, modelId }, deliveryOf(input, turnIds.get(input), modelId), context);
      return result === undefined ? {} : { result };
    }
    const saved = await saveImageToChat({ storage: options.attachments.storage, chatId: input.chatId, ownerId: input.ownerId, number: input.number, file, now });
    return { id: saved.id };
  }

  const jobs = createImageJobs({
    receive,
    maxImageBytes: options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    requestTimeoutMs,
    lateResultWindowMs: options.lateResultWindowMs ?? DEFAULT_LATE_RESULT_WINDOW_MS,
    now,
    async record(input, step, costUsd) {
      if (!options.spending) return;
      await recordImageUsage({ storage: options.spending.storage, ownerId: input.ownerId, chatId: input.chatId, modelId: step.profile.id, providerId: step.provider.id, costUsd, now, logError });
      const afterSpending = options.spending.limits?.afterSpending;
      // Пороги — фоном: картинку ход не задерживает.
      if (afterSpending) {
        void afterSpending
          .call(options.spending.limits, { userId: input.ownerId, chatId: input.chatId })
          .catch((error: unknown) => logError(`Картинки: лимиты после расхода (чат ${input.chatId}): ${errorText(error)}`));
      }
    },
    ...(options.onLateImage && { onLateImage: options.onLateImage }),
    logError,
    hideSecrets: setups.hideSecrets,
  });

  const reservations = new Set<Reservation>();
  const limitChecks = new Map<string, Promise<unknown>>();

  /** Заказанное, но не записанное: всего у человека и в этом чате — брони вызовов и задачи в работе. */
  function pendingUsd(ownerId: string, chatId: string): { user: number; chat: number } {
    const working = jobs.pendingUsd(ownerId, chatId);
    let user = working.user;
    let chat = working.chat;
    for (const reservation of reservations) {
      if (reservation.ownerId !== ownerId) continue;
      user += reservation.openTasks * reservation.priceUsd;
      if (reservation.chatId === chatId) chat += reservation.openTasks * reservation.priceUsd;
    }
    return { user: roundUsd(user), chat: roundUsd(chat) };
  }

  async function withinLimit(ownerId: string, chatId: string): Promise<string | undefined> {
    const pending = pendingUsd(ownerId, chatId);
    try {
      await options.spending?.limits?.assertWithinLimit({ userId: ownerId, chatId, ...(pending.user > 0 && { pendingUsd: pending }) });
      return undefined;
    } catch (error) {
      if (error instanceof SpendingLimitReachedError) return LIMIT_REACHED;
      logError(`Картинки: не удалось проверить лимит расходов: ${errorText(error)}`);
      return "не удалось проверить лимит расходов";
    }
  }

  /**
   * Проверка лимита и бронь `count` задач — по одному на человека: параллельный вызов того же шага проверяется уже
   * с бронью предыдущего. Сама генерация друг друга не ждёт.
   */
  function reserve(ownerId: string, chatId: string, count: number, priceUsd: number): Promise<{ refusal: string } | { reservation: Reservation }> {
    const previous = limitChecks.get(ownerId) ?? Promise.resolve();
    const check = previous.then(async () => {
      const refusal = await withinLimit(ownerId, chatId);
      if (refusal) return { refusal };
      const reservation: Reservation = { ownerId, chatId, openTasks: count, priceUsd };
      reservations.add(reservation);
      return { reservation };
    });
    limitChecks.set(ownerId, check);
    void check.finally(() => {
      if (limitChecks.get(ownerId) === check) limitChecks.delete(ownerId);
    });
    return check;
  }

  /** Места хода по номерам картинок: вышедшие за предел — в ошибки, без заказа. */
  function takeTurnPlaces(caller: Caller, count: number): { allowed: number[]; overLimit: FailedImage[] } {
    const allowed: number[] = [];
    const overLimit: FailedImage[] = [];
    for (let number = 1; number <= count; number++) {
      if (turns.take(caller.turnKey)) allowed.push(number);
      else overLimit.push({ номер: number, причина: `не больше ${options.maxImagesPerTurn} картинок за ход` });
    }
    return { allowed, overLimit };
  }

  const giveTurnPlaces = (caller: Caller, numbers: readonly number[]) => numbers.forEach(() => turns.give(caller.turnKey));

  async function generateImages(input: GenerateImagesInput, caller: Caller, abortSignal: AbortSignal | undefined) {
    const { ownerId, chatId } = caller;
    const setup = setups.byPurpose.get(setups.hasPurposes ? (input.purpose ?? "") : "")!;
    // «Стоп» до начала: ни проверки, ни генерации, ни расхода.
    const stoppedBeforeWork = { создано: 0, заказано: input.count, картинки: [], остановлено: true };
    if (abortSignal?.aborted) return stoppedBeforeWork;
    const { allowed, overLimit } = takeTurnPlaces(caller, input.count);
    if (allowed.length === 0) return { создано: 0, заказано: input.count, картинки: [], ошибки: overLimit };
    const booked = await reserve(ownerId, chatId, allowed.length, setup.priceUsd);
    if ("refusal" in booked) {
      giveTurnPlaces(caller, allowed);
      return { отказ: booked.refusal };
    }
    try {
      if (abortSignal?.aborted) {
        giveTurnPlaces(caller, allowed);
        return stoppedBeforeWork;
      }
      return await runTasks(input, setup, caller, allowed, overLimit, booked.reservation, abortSignal);
    } finally {
      // Вызов закончен: его задачи или оплачены, или в реестре задач (и видны лимиту оттуда), бронь больше не нужна.
      reservations.delete(booked.reservation);
    }
  }

  async function runTasks(
    input: GenerateImagesInput,
    setup: ImageSetup,
    caller: Caller,
    numbers: readonly number[],
    overLimit: readonly FailedImage[],
    reservation: Reservation,
    abortSignal: AbortSignal | undefined,
  ) {
    const { ownerId, chatId } = caller;
    const saved: SavedImage[] = [];
    const failed: FailedImage[] = [...overLimit];
    const pendingReason =
      `Картинка не успела за ${Math.round(requestTimeoutMs / 1000)} с и ещё готовится: ` + "повтори вызов с теми же параметрами позже — готовая придёт без новой оплаты";

    const collect = (number: number, outcome: ImageJobOutcome) => {
      if (outcome.status === "saved") {
        const { image } = outcome;
        saved.push({
          номер: number,
          ...(image.id !== undefined && { id: image.id }),
          ширина: image.width,
          высота: image.height,
          ...(image.result !== undefined && { результат: image.result }),
        });
      }
      else if (outcome.status === "failed") failed.push({ номер: number, причина: outcome.reason });
      else if (outcome.status === "pending") failed.push({ номер: number, причина: pendingReason, готовится: true });
    };
    await Promise.all(
      numbers.map(async (number) => {
        const jobInput: ImageJobInput = { ownerId, chatId, number, prompt: input.prompt, aspectRatio: input.aspectRatio, setup };
        if (caller.turnId !== undefined) turnIds.set(jobInput, caller.turnId);
        // Задача уходит в реестр: дальше лимит видит её там, а не в брони.
        const outcome = jobs.obtain(jobInput, abortSignal);
        reservation.openTasks--;
        collect(number, await outcome);
      }),
    );
    const byNumber = <T extends { номер: number }>(items: T[]) => [...items].sort((a, b) => a.номер - b.номер);
    return {
      создано: saved.length,
      заказано: input.count,
      картинки: byNumber(saved),
      ...(failed.length > 0 && { ошибки: byNumber(failed) }),
      ...(abortSignal?.aborted && { остановлено: true }),
    };
  }

  // --- фоновый режим ---

  const background = options.mode === "background";

  /** Готовая фоновая картинка: свой приёмник или вложения чата с `onLateImage`. */
  async function receiveQueued(image: GeneratedImage, job: ImageJob, context: ImageDeliveryContext): Promise<unknown> {
    const number = (job.data as { number?: number } | undefined)?.number ?? 1;
    const delivery: ImageDelivery = {
      ownerId: job.ownerId,
      chatId: job.chatId,
      ...(job.turnId !== undefined && { turnId: job.turnId }),
      number,
      prompt: job.prompt,
      aspectRatio: job.aspectRatio,
      ...(job.purpose !== undefined && { purpose: job.purpose }),
      modelId: image.modelId,
      jobId: job.id,
    };
    if (deliver) return deliver(image, delivery, context);
    const saved = await saveImageToChat({ storage: options.attachments.storage, chatId: job.chatId, ownerId: job.ownerId, number, file: image, now });
    try {
      await options.onLateImage?.({
        ownerId: job.ownerId,
        chatId: job.chatId,
        number,
        attachmentId: saved.id,
        mediaType: image.mediaType,
        width: image.width,
        height: image.height,
        prompt: job.prompt,
        aspectRatio: job.aspectRatio,
        modelId: image.modelId,
        ...(job.purpose !== undefined && { purpose: job.purpose }),
      });
    } catch (error) {
      logError(`Картинки: onLateImage не принял картинку: ${errorText(error)}`);
    }
    return { attachmentId: saved.id };
  }

  const queue: ImageQueue | undefined = background
    ? createImageQueue({
        env: options.env,
        ...(options.catalog && { catalog: options.catalog }),
        ...(options.model !== undefined && { model: options.model }),
        ...(options.provider !== undefined && { provider: options.provider }),
        ...(options.quality !== undefined && { quality: options.quality }),
        ...(options.size !== undefined && { size: options.size }),
        ...(options.transparentBackground !== undefined && { transparentBackground: options.transparentBackground }),
        ...(options.output && { output: options.output }),
        ...(options.purposes && { purposes: options.purposes }),
        ...(options.fetch && { fetch: options.fetch }),
        deliver: receiveQueued,
        ...(options.jobStore && { store: options.jobStore }),
        ...(options.spending && { spending: options.spending }),
        ...(options.pollIntervalMs !== undefined && { pollIntervalMs: options.pollIntervalMs }),
        attemptTimeoutMs: requestTimeoutMs,
        ...(options.attempts !== undefined && { attempts: options.attempts }),
        ...(options.lateResultWindowMs !== undefined && { lateResultWindowMs: options.lateResultWindowMs }),
        ...(options.maxImageBytes !== undefined && { maxImageBytes: options.maxImageBytes }),
        ...(options.logError && { logError: options.logError }),
        ...(options.now && { now: options.now }),
      })
    : undefined;

  /** Фоновый заказ: ответ модели, как только задачи ушли провайдеру. */
  async function orderImages(queue: ImageQueue, input: GenerateImagesInput, caller: Caller, abortSignal: AbortSignal | undefined) {
    if (abortSignal?.aborted) return { заказано: input.count, принято: 0, задачи: [], остановлено: true };
    const { allowed, overLimit } = takeTurnPlaces(caller, input.count);
    const failed: FailedImage[] = [...overLimit];
    const queuedJobs: Array<Record<string, unknown> & { номер: number }> = [];
    await Promise.all(
      allowed.map(async (number) => {
        let placed: Awaited<ReturnType<ImageQueue["order"]>>;
        try {
          placed = await queue.order({
            ownerId: caller.ownerId,
            chatId: caller.chatId,
            ...(caller.turnId !== undefined && { turnId: caller.turnId }),
            ...(setups.hasPurposes && input.purpose !== undefined && { purpose: input.purpose }),
            prompt: input.prompt,
            aspectRatio: input.aspectRatio,
            data: { number },
          });
        } catch (error) {
          // Каждый заказ — сам по себе: сбой одного не роняет уже принятые, иначе модель повторит вызов и оплатит их снова.
          turns.give(caller.turnKey);
          logError(`Картинки: заказ ${number} не принят: ${errorText(error)}`);
          failed.push({ номер: number, причина: "Не удалось заказать картинку" });
          return;
        }
        if (placed.status === "refused") {
          turns.give(caller.turnKey);
          failed.push({ номер: number, причина: placed.reason });
        } else if (placed.status === "failed") failed.push({ номер: number, причина: placed.reason ?? "Провайдер не смог создать картинку" });
        else queuedJobs.push({ номер: number, id: placed.id, ...(await queuedFields(placed)) });
      }),
    );
    const byNumber = <T extends { номер: number }>(items: T[]) => [...items].sort((a, b) => a.номер - b.номер);
    return {
      заказано: input.count,
      принято: queuedJobs.length,
      задачи: byNumber(queuedJobs),
      ...(failed.length > 0 && { ошибки: byNumber(failed) }),
      ...(queuedJobs.length > 0 && { сообщение: queuedMessage }),
    };
  }

  async function queuedFields(job: ImageJob): Promise<Record<string, unknown>> {
    try {
      return (await options.onQueued?.(job)) ?? {};
    } catch (error) {
      logError(`Картинки: onQueued не сработал (задача ${job.id}): ${errorText(error)}`);
      return {};
    }
  }

  // Описание и схема собираются один раз: не зависят от человека, чата и времени (кэш модели).
  const purposeList = setups.hasPurposes
    ? " Назначения (параметр purpose): " + all.map((setup) => `${setup.purpose} — ${setup.description}`).join("; ") + "."
    : "";
  const description = background ? backgroundDescription + purposeList : baseDescription + purposeList + (queued ? repeatHint : "");
  const purposeNames = all.map((setup) => setup.purpose!) as [string, ...string[]];
  const inputSchema = setups.hasPurposes
    ? z.object({
        prompt: promptSchema,
        purpose: z.enum(purposeNames).default(purposeNames[0]).describe("Назначение картинки: от него зависит модель."),
        count: countSchema,
        aspectRatio: aspectRatioSchema,
      })
    : z.object({ prompt: promptSchema, count: countSchema, aspectRatio: aspectRatioSchema });

  // Генерация и скачивание: ядро не обрывает вызов раньше, и модель не заказывает (и не оплачивает) картинки заново.
  const toolTimeoutMs = requestTimeoutMs + DOWNLOAD_TIMEOUT_MS;
  const generateImagesTool = (caller: Caller) =>
    declareToolTimeout(
      tool({
        description,
        inputSchema: inputSchema as z.ZodType<GenerateImagesInput>,
        execute: (input: GenerateImagesInput, { abortSignal }): Promise<Record<string, unknown>> =>
          queue ? orderImages(queue, input, caller, abortSignal) : generateImages(input, caller, abortSignal),
      }),
      toolTimeoutMs,
    );

  return {
    tools(model): ToolSet {
      if (!model.ownerId || !model.chatId) return {};
      const caller: Caller = {
        ownerId: model.ownerId,
        chatId: model.chatId,
        ...(model.turnId !== undefined && { turnId: model.turnId }),
        turnKey: model.turnId ?? `tools:${crypto.randomUUID()}`,
      };
      return { generate_images: generateImagesTool(caller) };
    },
    start: () => queue?.start() ?? Promise.resolve(),
    stop: () => queue?.stop() ?? Promise.resolve(),
  };
}
