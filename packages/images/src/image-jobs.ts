import { downloadGeneratedImage } from "./download-image";
import type { AspectRatio, ImageGenerationRequest, ImageGenerationResult } from "./image-catalog";
import { ImageGenerationError } from "./image-generation-error";
import type { ImageSetup, ImageStep } from "./image-setup";
import { waitForImageTask } from "./image-task-polling";
import { postprocessImage } from "./postprocess-image";

/** Пауза или готовая картинка без вызова, который её ждёт, хранится столько: повтор найдёт её, потом память чистится. */
const FORGET_AFTER_MS = 60 * 60 * 1000;

/** Одна картинка одного вызова: кто, где, что и по какой настройке. */
export interface ImageJobInput {
  ownerId: string;
  chatId: string;
  /** Номер картинки в вызове, с 1. */
  number: number;
  prompt: string;
  aspectRatio: AspectRatio;
  setup: ImageSetup;
}

/** Картинка у приложения: во вложениях чата (`id`) или у своего приёмника (`result` — его ответ). */
export interface DeliveredImage {
  id?: string;
  result?: unknown;
  mediaType: string;
  width: number;
  height: number;
}

/** Картинка пришла после срока вызова и уже сохранена в чат: приложение может показать её человеку. */
export interface LateImage {
  ownerId: string;
  chatId: string;
  number: number;
  attachmentId: string;
  mediaType: string;
  width: number;
  height: number;
  prompt: string;
  aspectRatio: AspectRatio;
  /** Модель картинки (первого шага). */
  modelId: string;
  /** Назначение, если приложение их задало. */
  purpose?: string;
}

/** Чем кончилось ожидание одной картинки для вызова. */
export type ImageJobOutcome =
  | { status: "saved"; image: DeliveredImage }
  | { status: "failed"; reason: string }
  /** Срок вызова вышел, задача ещё у провайдера: повтор того же вызова найдёт её. */
  | { status: "pending" }
  | { status: "stopped" };

/** Скачанная картинка с размером: из файла, а не известен — по пропорции модели. */
export interface ReceivedImageFile {
  bytes: Uint8Array;
  mediaType: string;
  width: number;
  height: number;
}

export interface ImageJobsOptions {
  /** Приёмник скачанной картинки: вложения чата или свой у приложения. */
  /** `signal` — задача остановлена: приёмник не записывает картинку. */
  receive(input: ImageJobInput, image: ReceivedImageFile, signal: AbortSignal): Promise<{ id?: string; result?: unknown }>;
  maxImageBytes: number;
  requestTimeoutMs: number;
  lateResultWindowMs: number;
  now: () => Date;
  /** Запись расхода шага: один раз на задачу провайдера. */
  record(input: ImageJobInput, step: ImageStep, costUsd: number): Promise<void>;
  onLateImage?: (image: LateImage) => void | Promise<void>;
  logError(message: string): void;
  hideSecrets(text: string): string;
}

interface StepState {
  step: ImageStep;
  /** Id задачи в очереди провайдера: по нему повтор проверяет старую задачу. */
  taskId?: string;
  /** Задача могла уйти провайдеру: без ответа она всё равно оплачивается по цене модели. */
  sent: boolean;
  charged: boolean;
  /** Провайдер отказал до работы: платить не за что. */
  released: boolean;
  results?: ImageGenerationResult[];
}

type Settled = { status: "saved"; image: DeliveredImage } | { status: "failed"; reason: string } | { status: "paused" };

interface ImageJob {
  /** Ключ повтора; есть только у задач с очередью — синхронную задачу проверить потом нечем. */
  key?: string;
  input: ImageJobInput;
  steps: StepState[];
  state: "running" | "paused" | "saved" | "finished";
  /** Задача скачивается и сохраняется: срок вызова её уже не обрывает. */
  saving: boolean;
  controller: AbortController;
  /** Дальше опрос не идёт: срок вызова плюс фоновое окно. */
  hardDeadline: number;
  waiters: number;
  settled: Promise<Settled>;
  settle(result: Settled): void;
  image?: DeliveredImage;
  forgetTimer?: ReturnType<typeof setTimeout>;
}

/** Срок фонового опроса вышел без результата. */
const EXPIRED = Symbol("expired");
const STOPPED = Symbol("stopped");
const DEADLINE = Symbol("deadline");

function whenStopped(signal: AbortSignal | undefined): Promise<typeof STOPPED> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve(STOPPED);
    else signal.addEventListener("abort", () => resolve(STOPPED), { once: true });
  });
}

/** Цена ответа провайдера; не сообщил — цена модели. */
function costOf(results: readonly ImageGenerationResult[], fallbackUsd: number): number {
  const known = results.filter((result) => result.costUsd !== undefined);
  return known.length > 0 ? known.reduce((total, result) => total + result.costUsd!, 0) : fallbackUsd;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Задачи картинок, которые живут дольше вызова. Задача с очередью (KIE) после срока вызова опрашивается в фоне, а повтор
 * того же вызова (тот же человек, чат, назначение, описание, пропорция и номер) сначала берёт старую задачу: ждёт её,
 * проверяет или отдаёт уже сохранённую картинку. Каждая задача провайдера оплачивается ровно один раз: его ценой, а без
 * ответа («Стоп», срок, сбой) — ценой модели. Реестр — в памяти процесса.
 */
export function createImageJobs(options: ImageJobsOptions) {
  const jobs = new Set<ImageJob>();
  const byKey = new Map<string, ImageJob>();

  const keyOf = (input: ImageJobInput) =>
    JSON.stringify([input.ownerId, input.chatId, input.setup.purpose ?? input.setup.steps[0]!.profile.id, input.prompt, input.aspectRatio, input.number]);

  function forget(job: ImageJob) {
    clearTimeout(job.forgetTimer);
    jobs.delete(job);
    if (job.key !== undefined && byKey.get(job.key) === job) byKey.delete(job.key);
  }

  function forgetLater(job: ImageJob) {
    clearTimeout(job.forgetTimer);
    job.forgetTimer = setTimeout(() => forget(job), FORGET_AFTER_MS);
    (job.forgetTimer as { unref?: () => void }).unref?.();
  }

  async function charge(job: ImageJob, state: StepState, costUsd: number) {
    if (state.charged) return;
    state.charged = true;
    await options.record(job.input, state.step, costUsd);
  }

  /** Ушедшие и не оплаченные задачи — по цене модели: лучше записать лишнее, чем потерять. */
  const chargeOpen = (job: ImageJob) =>
    Promise.all(job.steps.filter((state) => state.sent && !state.charged && !state.released).map((state) => charge(job, state, state.step.priceUsd)));

  function request(job: ImageJob, state: StepState, sourceUrl: string | undefined, signal: AbortSignal): ImageGenerationRequest {
    const { step } = state;
    const { aspectRatio } = job.input;
    const { width, height } = step.sizes[aspectRatio];
    return {
      taskUUID: crypto.randomUUID(),
      providerModelId: step.providerModelId,
      prompt: step.prompt ?? job.input.prompt,
      width,
      height,
      aspectRatio: step.profile.aspectRatioValues?.[aspectRatio] ?? aspectRatio,
      ...(sourceUrl !== undefined && { imageUrl: sourceUrl }),
      ...(step.outputFormat && { outputFormat: step.outputFormat }),
      ...(step.providerSettings && { providerSettings: step.providerSettings }),
      abortSignal: signal,
      timeoutMs: options.requestTimeoutMs,
    };
  }

  async function runStep(job: ImageJob, state: StepState, sourceUrl: string | undefined, signal: AbortSignal): Promise<ImageGenerationResult[]> {
    const { step } = state;
    const refused = (error: unknown) => {
      if (error instanceof ImageGenerationError && error.refusedBeforeWork && !signal.aborted) {
        state.sent = false;
        state.released = true;
      }
      return error;
    };
    const queue = step.provider.queue;
    if (!queue) {
      state.sent = true;
      let results: ImageGenerationResult[];
      try {
        results = await step.provider.generate(request(job, state, sourceUrl, signal), step.connection);
      } catch (error) {
        throw refused(error);
      }
      await charge(job, state, costOf(results, step.priceUsd));
      return results;
    }

    // Задача уже у провайдера (повтор, фоновый опрос после паузы) — сначала проверка, без ожидания.
    const checkNow = state.taskId !== undefined;
    if (state.taskId === undefined) {
      // Прошлая отправка оборвалась без id и уже оплачена по цене модели: новая задача — новая оплата.
      state.charged = false;
      state.sent = true;
      try {
        state.taskId = await queue.submit(request(job, state, sourceUrl, signal), step.connection);
      } catch (error) {
        throw refused(error);
      }
    }
    const taskId = state.taskId;
    const outcome = await waitForImageTask({ check: (abortSignal) => queue.check(taskId, step.connection, abortSignal), deadline: job.hardDeadline, abortSignal: signal, checkNow });
    if (outcome.status === "ready") {
      await charge(job, state, costOf(outcome.results, step.priceUsd));
      return outcome.results;
    }
    if (outcome.status === "failed") {
      await charge(job, state, outcome.costUsd ?? step.priceUsd);
      throw new ImageGenerationError(outcome.reason, { refusedBeforeWork: false });
    }
    throw EXPIRED;
  }

  /** Адрес картинки шага: у модели с основой первым идёт фон без предмета, картинка — следующая. */
  function resultUrl(state: StepState): string {
    const result = state.results?.[state.step.profile.firstResultIsBase ? 1 : 0];
    if (!result) throw new ImageGenerationError("Провайдер не вернул картинку", { refusedBeforeWork: false });
    return result.url;
  }

  async function save(job: ImageJob, url: string, signal: AbortSignal): Promise<DeliveredImage> {
    const { input } = job;
    const last = job.steps.at(-1)!.step;
    const output = input.setup.output;
    const file = await downloadGeneratedImage({
      url,
      fetch: last.connection.fetch,
      maxImageBytes: options.maxImageBytes,
      ...(last.trustedOrigin !== undefined && { trustedOrigin: last.trustedOrigin }),
      ...(output && { transform: (bytes: Uint8Array, mediaType: string) => postprocessImage(bytes, mediaType, output) }),
      abortSignal: signal,
    });
    const planned = input.setup.steps[0]!.sizes[input.aspectRatio];
    const image = { bytes: file.bytes, mediaType: file.mediaType, width: file.width ?? planned.width, height: file.height ?? planned.height };
    const received = await options.receive(input, image, signal);
    return { ...received, mediaType: image.mediaType, width: image.width, height: image.height };
  }

  async function drive(job: ImageJob, signal: AbortSignal) {
    let saving = false;
    try {
      let sourceUrl: string | undefined;
      for (const [index, state] of job.steps.entries()) {
        state.results ??= await runStep(job, state, sourceUrl, signal);
        if (signal.aborted) return;
        if (index < job.steps.length - 1) sourceUrl = state.results[0]?.url;
      }
      saving = job.saving = true;
      const image = await save(job, resultUrl(job.steps.at(-1)!), signal);
      if (signal.aborted) return;
      finish(job, { status: "saved", image });
    } catch (error) {
      // «Стоп» или пауза: оплату и состояние ведёт `pause`.
      if (signal.aborted) return;
      if (error === EXPIRED) return void (await pause(job));
      let reason: string;
      if (error instanceof ImageGenerationError) reason = options.hideSecrets(error.reason);
      else if (saving) {
        options.logError(`Картинки: не удалось сохранить картинку: ${errorText(error)}`);
        reason = "Картинка не сохранилась";
      } else {
        options.logError(`Картинки: сбой провайдера ${job.steps.find((state) => !state.results)?.step.provider.id ?? ""}: ${errorText(error)}`);
        reason = "Провайдер не смог создать картинку";
      }
      await chargeOpen(job);
      finish(job, { status: "failed", reason });
    }
  }

  function finish(job: ImageJob, result: Exclude<Settled, { status: "paused" }>) {
    if (result.status === "saved" && job.waiters === 0 && job.key !== undefined) {
      // Вызов, который ждал, уже ушёл: картинка ждёт повтора, а приложение узнаёт о ней сразу.
      job.state = "saved";
      job.image = result.image;
      forgetLater(job);
      // Свой приёмник картинку уже получил; о вложении чата приложение узнаёт здесь.
      if (result.image.id !== undefined) void notifyLate(job, result.image.id, result.image);
    } else {
      job.state = "finished";
      forget(job);
    }
    job.settle(result);
  }

  async function notifyLate(job: ImageJob, attachmentId: string, image: DeliveredImage) {
    const { input } = job;
    try {
      await options.onLateImage?.({
        ownerId: input.ownerId,
        chatId: input.chatId,
        number: input.number,
        attachmentId,
        mediaType: image.mediaType,
        width: image.width,
        height: image.height,
        prompt: input.prompt,
        aspectRatio: input.aspectRatio,
        modelId: input.setup.steps[0]!.profile.id,
        ...(input.setup.purpose !== undefined && { purpose: input.setup.purpose }),
      });
    } catch (error) {
      options.logError(`Картинки: onLateImage не принял картинку: ${errorText(error)}`);
    }
  }

  /**
   * Опрос остановлен («Стоп», срок): ушедшие задачи оплачены по цене модели. Задача с очередью ждёт повтора, синхронная
   * забывается — проверить её нечем.
   */
  async function pause(job: ImageJob) {
    if (job.state !== "running") return;
    job.state = job.key !== undefined ? "paused" : "finished";
    job.controller.abort(new DOMException("paused", "AbortError"));
    await chargeOpen(job);
    if (job.state === "paused") forgetLater(job);
    else forget(job);
    job.settle({ status: "paused" });
  }

  function start(job: ImageJob) {
    clearTimeout(job.forgetTimer);
    job.state = "running";
    job.saving = false;
    job.controller = new AbortController();
    job.hardDeadline = Date.now() + options.requestTimeoutMs + options.lateResultWindowMs;
    job.settled = new Promise((resolve) => (job.settle = resolve));
    void drive(job, job.controller.signal);
  }

  /** Срок вызова: только у задач с очередью и только пока картинка не готова. */
  function deadline(job: ImageJob): { promise: Promise<typeof DEADLINE>; cancel(): void } {
    if (job.key === undefined) return { promise: new Promise(() => {}), cancel() {} };
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<typeof DEADLINE>((resolve) => (timer = setTimeout(() => resolve(DEADLINE), options.requestTimeoutMs)));
    return { promise, cancel: () => clearTimeout(timer) };
  }

  /** Вызов ждёт картинку: готова, провал, «Стоп» или срок вызова. Последний ушедший без картинки останавливает опрос сам. */
  async function attend(job: ImageJob, abortSignal: AbortSignal | undefined): Promise<ImageJobOutcome> {
    job.waiters++;
    const stopped = whenStopped(abortSignal);
    const timer = deadline(job);
    let outcome = await Promise.race([job.settled, stopped, timer.promise]);
    if (outcome === DEADLINE && job.saving) outcome = await Promise.race([job.settled, stopped]);
    timer.cancel();
    job.waiters--;
    if (outcome === STOPPED) {
      if (job.waiters === 0) await pause(job);
      return { status: "stopped" };
    }
    if (outcome === DEADLINE) {
      // Фонового окна нет или оно кончилось: опрос останавливается вместе с вызовом.
      if (job.waiters === 0 && Date.now() >= job.hardDeadline) await pause(job);
      return { status: "pending" };
    }
    if (outcome.status === "paused") return { status: "pending" };
    return outcome;
  }

  return {
    /**
     * Картинка для вызова: уже сохранённая с прошлого раза (сразу, без оплаты), старая задача (ждать или проверить) или
     * новая. Найденная готовая картинка «израсходована»: следующий такой же вызов — новая.
     */
    async obtain(input: ImageJobInput, abortSignal: AbortSignal | undefined): Promise<ImageJobOutcome> {
      const queued = input.setup.steps.some((step) => step.provider.queue !== undefined);
      const key = queued ? keyOf(input) : undefined;
      const existing = key !== undefined ? byKey.get(key) : undefined;
      if (existing?.state === "saved") {
        forget(existing);
        existing.state = "finished";
        return { status: "saved", image: existing.image! };
      }
      let job = existing;
      if (job?.state === "paused") start(job);
      if (!job) {
        job = {
          ...(key !== undefined && { key }),
          input,
          steps: input.setup.steps.map((step) => ({ step, sent: false, charged: false, released: false })),
          waiters: 0,
        } as Omit<ImageJob, "state" | "saving" | "controller" | "hardDeadline" | "settled" | "settle"> as ImageJob;
        jobs.add(job);
        if (key !== undefined) byKey.set(key, job);
        start(job);
      }
      return attend(job, abortSignal);
    },

    /** Задачи в работе, ещё не оплаченные: их цена по профилям — у человека и в этом чате. */
    pendingUsd(ownerId: string, chatId: string): { user: number; chat: number } {
      let user = 0;
      let chat = 0;
      for (const job of jobs) {
        if (job.state !== "running" || job.input.ownerId !== ownerId) continue;
        const open = job.steps.reduce((total, state) => total + (state.charged || state.released ? 0 : state.step.priceUsd), 0);
        user += open;
        if (job.input.chatId === chatId) chat += open;
      }
      return { user, chat };
    },
  };
}

export type ImageJobs = ReturnType<typeof createImageJobs>;
