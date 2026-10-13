import type { AspectRatio } from "../image-catalog";

/**
 * Что с задачей картинки.
 * - `generating` — готовится: отправка, опрос, скачивание, доставка.
 * - `ready` — приёмник принял картинку.
 * - `failed` — не получилась; при `lateUntil` задача у провайдера ещё опрашивается и может прийти поздно.
 * - `superseded` — на то же место заказана новая картинка или задачу остановили.
 * - `discarded` — приёмник отказался от готовой картинки (место уже занято).
 */
export type ImageJobStatus = "generating" | "ready" | "failed" | "superseded" | "discarded";

/** Оплата одной задачи провайдера. `usageId` — id записи расхода: вторая вставка того же id отвергается базой. */
export interface ImageJobCharge {
  usageId: string;
  modelId: string;
  providerId: string;
  costUsd: number;
  /** Запись расхода сделана. */
  recorded: boolean;
}

/** Задача шага, которая ушла провайдеру (или уходит прямо сейчас) и ещё не оплачена. */
export interface ImageJobTask {
  usageId: string;
  modelId: string;
  providerId: string;
  /** Цена модели: так задача оплачивается, если провайдер не сообщил свою (срок, обрыв, вытеснение). */
  priceUsd: number;
  sentAt: string;
  /** Id задачи в очереди провайдера; нет — отправка не закончилась или провайдер без очереди. */
  taskId?: string;
}

/** Шаг задачи: картинка, затем, если нужно, её же без фона. */
export interface ImageJobStep {
  task?: ImageJobTask;
  /** Адреса готового результата: дальше шаг не заказывается, только скачивается. */
  urls?: string[];
  charges: ImageJobCharge[];
}

/** Задача картинки, как она лежит в хранилище. Времена — ISO 8601. */
export interface ImageJobRecord {
  id: string;
  /** Место картинки: новый заказ с тем же `key` у того же владельца вытесняет прежний. */
  key: string;
  ownerId: string;
  chatId: string;
  turnId?: string;
  /** Группа для списка (например, приложение, в которое идут картинки). */
  group?: string;
  /** Назначение; `""` — без назначений. */
  purpose: string;
  prompt: string;
  aspectRatio: AspectRatio;
  /** Данные приложения (путь, размер): отдаются приёмнику как есть. Только JSON. */
  data?: unknown;
  status: ImageJobStatus;
  reason?: string;
  /** Ответ приёмника (JSON). */
  result?: unknown;
  /** У задачи есть работа: опрос, позднее окно или незаписанный расход. Такие задачи подбирает старт сервера. */
  active: boolean;
  /** Номер запуска: «Повторить» начинает новый, прежний больше ничего не делает. */
  run: number;
  /** Номер попытки запуска, с 1. */
  attempt: number;
  attemptDeadline: string;
  /** Позднее окно: попытки кончились, а задача у провайдера ещё опрашивается. */
  lateUntil?: string;
  /** Готовая картинка не дошла до приёмника (скачивание, обработка, сам приёмник): «Повторить» сначала пробует тот же адрес. */
  deliveryFailed?: boolean;
  steps: ImageJobStep[];
  leaseOwner?: string;
  leaseUntil?: string;
  /** Версия записи: каждая правка условна по ней и прибавляет 1. */
  version: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

/** Правка задачи: переданный `undefined` стирает поле. */
export type ImageJobPatch = Partial<Omit<ImageJobRecord, "id" | "key" | "ownerId" | "chatId" | "createdAt" | "version">>;

export interface ImageJobFilter {
  ownerId?: string;
  chatId?: string;
  key?: string;
  group?: string;
}

/** У задачи ещё идёт работа с провайдером: генерация или позднее окно. Открытая на место (`ownerId` + `key`) — одна. */
export const isOpenImageJob = (job: Pick<ImageJobRecord, "status" | "lateUntil">) => job.status === "generating" || job.lateUntil !== undefined;

/** На это место (`ownerId` + `key`) уже есть открытая задача: вторую база не пускает, даже с двух копий сервера. */
export class ImageJobKeyTakenError extends Error {
  constructor(readonly ownerId: string, readonly key: string) {
    super(`Картинки: на место ${key} уже есть открытая задача`);
    this.name = "ImageJobKeyTakenError";
  }
}

/**
 * Хранилище задач картинок: память, SQLite, PostgreSQL (договор один). Открытая задача на место — одна: `insert` и
 * `update`, после которых их стало бы две, бросают `ImageJobKeyTakenError` и ничего не пишут.
 */
export interface ImageJobStore {
  insert(job: ImageJobRecord): Promise<void>;
  get(id: string): Promise<ImageJobRecord | null>;
  /** По порядку создания. */
  list(filter: ImageJobFilter): Promise<ImageJobRecord[]>;
  /** Условная запись: версия в базе равна `expectedVersion` — правка и версия +1; иначе `null`, запись прежняя. */
  update(id: string, patch: ImageJobPatch, expectedVersion: number): Promise<ImageJobRecord | null>;
  /** Задачи с работой (`active`), чья аренда свободна или истекла к `now`. */
  listResumable(now: string): Promise<ImageJobRecord[]>;
  /** Удаляет задачи без работы, законченные раньше `before`; ответ — сколько удалено. */
  deleteFinishedBefore(before: string): Promise<number>;
  close?(): Promise<void>;
}

/** Ошибка базы или её причина (`cause`, драйвер под drizzle), подходящая под `test`. */
export function findErrorCause(error: unknown, test: (cause: Record<string, unknown>) => boolean): boolean {
  for (let current = error, depth = 0; current !== null && typeof current === "object" && depth < 5; current = (current as { cause?: unknown }).cause, depth++) {
    if (test(current as Record<string, unknown>)) return true;
  }
  return false;
}

/** Колонки поиска; остальное хранилища держат одним JSON. */
export const IMAGE_JOB_COLUMNS = ["id", "key", "ownerId", "chatId", "group", "status", "active", "leaseOwner", "leaseUntil", "version", "createdAt", "updatedAt", "finishedAt"] as const;

/** Запись с правкой: `undefined` в правке стирает поле. */
export function applyImageJobPatch(job: ImageJobRecord, patch: ImageJobPatch): ImageJobRecord {
  const next = { ...job } as Record<string, unknown>;
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  return next as unknown as ImageJobRecord;
}

/** Часть записи, которая хранится JSON: всё, кроме колонок поиска. */
export function imageJobBody(job: ImageJobRecord): Record<string, unknown> {
  const body = { ...job } as Record<string, unknown>;
  for (const column of IMAGE_JOB_COLUMNS) delete body[column];
  return body;
}

const matches = (job: ImageJobRecord, filter: ImageJobFilter) =>
  (filter.ownerId === undefined || job.ownerId === filter.ownerId) &&
  (filter.chatId === undefined || job.chatId === filter.chatId) &&
  (filter.key === undefined || job.key === filter.key) &&
  (filter.group === undefined || job.group === filter.group);

/** Хранилище в памяти: по умолчанию и для тестов, живёт до перезапуска. */
export function memoryImageJobStore(): ImageJobStore {
  const jobs = new Map<string, ImageJobRecord>();
  const copy = (job: ImageJobRecord) => structuredClone(job);
  const checkPlace = (job: ImageJobRecord) => {
    if (!isOpenImageJob(job)) return;
    for (const other of jobs.values()) {
      if (other.id !== job.id && other.ownerId === job.ownerId && other.key === job.key && isOpenImageJob(other)) throw new ImageJobKeyTakenError(job.ownerId, job.key);
    }
  };
  return {
    async insert(job) {
      if (jobs.has(job.id)) throw new Error(`Задача картинки ${job.id} уже есть`);
      checkPlace(job);
      jobs.set(job.id, copy(job));
    },
    async get(id) {
      const job = jobs.get(id);
      return job ? copy(job) : null;
    },
    async list(filter) {
      return [...jobs.values()].filter((job) => matches(job, filter)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(copy);
    },
    async update(id, patch, expectedVersion) {
      const job = jobs.get(id);
      if (!job || job.version !== expectedVersion) return null;
      const next = { ...applyImageJobPatch(job, structuredClone(patch)), version: job.version + 1 };
      checkPlace(next);
      jobs.set(id, next);
      return copy(next);
    },
    async listResumable(now) {
      return [...jobs.values()].filter((job) => job.active && (job.leaseUntil === undefined || job.leaseUntil < now)).map(copy);
    },
    async deleteFinishedBefore(before) {
      let deleted = 0;
      for (const job of jobs.values()) {
        if (!job.active && job.status !== "generating" && job.finishedAt !== undefined && job.finishedAt < before) {
          jobs.delete(job.id);
          deleted++;
        }
      }
      return deleted;
    },
  };
}
