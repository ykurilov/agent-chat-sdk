import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { vi } from "vitest";
import { createImageQueue } from "../../src/index";
import type { CreateImageQueueOptions, GeneratedImage, ImageDeliveryContext, ImageJob, ImageQueue } from "../../src/index";
import { KEY } from "../support/fake-runware";
import { fakeKie, KIE_KEY } from "../support/fake-kie";

/** Журнал расходов, как в базе чатов: второй id отвергается. */
export function usageBook() {
  const records: UsageRecord[] = [];
  return {
    records,
    async insertUsageRecord(record: UsageRecord) {
      if (records.some((existing) => existing.id === record.id)) throw new Error(`Запись расхода ${record.id} уже есть`);
      records.push(structuredClone(record));
    },
    async hasUsageRecord(id: string) {
      return records.some((record) => record.id === id);
    },
  };
}

export const costs = (records: UsageRecord[]) => records.map(({ modelId, providerId, costUsd }) => ({ modelId, providerId, costUsd: Math.round(costUsd * 1e6) / 1e6 }));

export interface Delivery {
  image: GeneratedImage;
  job: ImageJob;
}

const queues: ImageQueue[] = [];

/** Все очереди теста останавливаются в `afterEach`. */
export async function stopQueues() {
  for (const queue of queues.splice(0)) await queue.stop();
}

/** Очередь на поддельном KIE (или своём `fetch`) с приёмником-заглушкой: путь из данных заказа — в ответ приёмника. */
export function queueSetup(kie: { fetch: typeof globalThis.fetch } = fakeKie(), overrides: Partial<CreateImageQueueOptions> = {}) {
  const usage = overrides.spending?.storage ? undefined : usageBook();
  const delivered: Delivery[] = [];
  const deliver = vi.fn(async (image: GeneratedImage, job: ImageJob, _context?: ImageDeliveryContext): Promise<unknown> => {
    delivered.push({ image, job });
    return { path: (job.data as { path?: string } | undefined)?.path ?? null };
  });
  const logError = vi.fn();
  const limits = {
    assertWithinLimit: vi.fn(async (_input: { userId: string; chatId: string; pendingUsd?: { user: number; chat: number } }) => {}),
    afterSpending: vi.fn(async (_input: { userId: string; chatId: string }) => {}),
  };
  const queue = createImageQueue({
    env: { KIE_API_KEY: KIE_KEY, RUNWARE_API_KEY: KEY },
    fetch: kie.fetch,
    model: "z-image",
    deliver,
    spending: { storage: usage!, limits },
    logError,
    pollIntervalMs: 3_000,
    attemptTimeoutMs: 90_000,
    lateResultWindowMs: 0,
    ...overrides,
  });
  queues.push(queue);
  return { queue, usage: usage?.records ?? [], delivered, deliver, logError, limits };
}

export const order = { ownerId: "anna", chatId: "chat-1", turnId: "answer-1", key: "app-1/img/hero.webp", group: "app-1", prompt: "Красное яблоко", data: { path: "img/hero.webp", size: 512 } };

/** Дать дойти цепочкам обещаний, не двигая подменённые часы (setImmediate настоящий). */
export async function flush(rounds = 20) {
  for (let index = 0; index < rounds; index++) await new Promise<void>((resolve) => setImmediate(resolve));
}
