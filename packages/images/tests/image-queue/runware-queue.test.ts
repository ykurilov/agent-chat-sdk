import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageJob, ImageQueue } from "../../src/index";
import { alphaShares } from "../support/alpha";
import { deferred, fakeRunware, ready } from "../support/fake-runware";
import { costs, flush, order, queueSetup, stopQueues } from "./queue-harness";

/** Настоящий PNG с альфой: левая половина прозрачная, правая — красная. */
async function transparentPng(): Promise<Uint8Array> {
  const pixels = Buffer.alloc(64 * 64 * 4);
  for (let index = 0; index < 64 * 64; index++) if (index % 64 >= 32) pixels.set([220, 30, 30, 255], index * 4);
  return new Uint8Array(await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } }).png().toBuffer());
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-05T10:00:00.000Z"), toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});
afterEach(async () => {
  await stopQueues();
  vi.useRealTimers();
});

async function ordered(queue: ImageQueue, input: Parameters<ImageQueue["order"]>[0] = order): Promise<ImageJob> {
  const job = await queue.order(input);
  if (job.status === "refused") throw new Error(`заказ отклонён: ${job.reason}`);
  return job;
}

const purposes = {
  plain: { model: "gpt-image-2.5-sunburst", size: "1k" as const, quality: "low" as const },
  no_background: { model: "gpt-image-2.5-sunburst", size: "1k" as const, quality: "low" as const, transparentBackground: true },
};

describe("createImageQueue с Runware: ответ сразу, без опроса", () => {
  it("быстрый ответ провайдера: заказ отвечает, не дожидаясь acceptWaitMs; картинка — в deliver; расход — цена из ответа", async () => {
    const runware = fakeRunware({ tasks: { 1: ready(1, 0.00599) } });
    const { queue, delivered, usage } = queueSetup(runware, { model: undefined, purposes });

    const job = await ordered(queue, { ...order, purpose: "plain" });
    await flush();
    expect(job).toMatchObject({ turnId: "answer-1", purpose: "plain" });
    expect(runware.sent[0]!.task).toMatchObject({ model: "openai:gpt-image@2.5-sunburst", width: 1024, height: 1024, outputFormat: "JPG", settings: { quality: "low" } });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.job).toMatchObject({ id: job.id, data: order.data });
    expect(await queue.get(job.id)).toMatchObject({ status: "ready" });
    expect(costs(usage)).toEqual([{ modelId: "gpt-image-2.5-sunburst", providerId: "runware", costUsd: 0.00599 }]);
    expect(queue.pendingUsd("anna", "chat-1")).toEqual({ user: 0, chat: 0 });
  });

  it("долгий ответ: заказ отвечает «generating» через acceptWaitMs, картинка приходит позже", async () => {
    const answer = deferred<Response>();
    const runware = fakeRunware({ tasks: { 1: () => answer.promise } });
    const { queue, delivered } = queueSetup(runware, { model: undefined, purposes, acceptWaitMs: 2_000 });

    const pending = queue.order({ ...order, purpose: "plain" });
    await vi.advanceTimersByTimeAsync(2_000);
    const job = await pending;
    expect(job).toMatchObject({ status: "generating" });
    expect(delivered).toHaveLength(0);

    answer.resolve(ready(1, 0.006));
    await flush();
    expect(delivered).toHaveLength(1);
    expect(await queue.get((job as ImageJob).id)).toMatchObject({ status: "ready" });
  });

  it("прозрачный фон без removeBackground: одна задача, PNG и background transparent, в deliver — PNG с альфой", async () => {
    const png = await transparentPng();
    const runware = fakeRunware({ tasks: { 1: ready(1, 0.00599) }, downloads: { 1: new Response(png as BodyInit, { headers: { "content-type": "image/png" } }) } });
    const { queue, delivered } = queueSetup(runware, { model: undefined, purposes });

    await ordered(queue, { ...order, purpose: "no_background" });
    await flush();
    expect(runware.sent).toHaveLength(1);
    expect(runware.sent[0]!.task).toMatchObject({ width: 1024, height: 1024, outputFormat: "PNG", settings: { quality: "low", background: "transparent" } });
    expect(delivered).toHaveLength(1);
    const { image } = delivered[0]!;
    expect(image).toMatchObject({ mediaType: "image/png", modelId: "gpt-image-2.5-sunburst" });
    const alpha = await alphaShares(image.bytes);
    expect(alpha.transparent).toBeGreaterThan(0.4);
    expect(alpha.opaque).toBeGreaterThan(0.4);
  });

  it("maxImagesPerTurn с Runware: третий заказ хода — отказ, провайдеру ушло два", async () => {
    const runware = fakeRunware();
    const { queue } = queueSetup(runware, { model: undefined, purposes, maxImagesPerTurn: 2 });
    await ordered(queue, { ...order, key: "a", purpose: "plain" });
    await ordered(queue, { ...order, key: "b", purpose: "no_background" });
    expect(await queue.order({ ...order, key: "c", purpose: "plain" })).toEqual({ status: "refused", reason: expect.stringContaining("2") });
    await flush();
    expect(runware.sent).toHaveLength(2);
  });
});
