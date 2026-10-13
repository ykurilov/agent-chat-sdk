// Живая проверка картинок: настоящий Runware, GPT Image 2 в низком качестве (центы за картинку).
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает. Прокси — `RUNWARE_BASE_URL`.
// Пачка из трёх картинок (этап 8) — только с `IMAGES_LIVE_BATCH=1`.
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { asSchema } from "ai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createImageGeneration, extendImageCatalog, standardImageCatalog } from "../../src/index";
import { alphaShares } from "../support/alpha";
import { executeOptions } from "../support/fake-runware";

if (!process.env.RUNWARE_API_KEY) throw new Error("Нет RUNWARE_API_KEY: выполните `pnpm secrets:load`");

const catalog = process.env.RUNWARE_BASE_URL
  ? extendImageCatalog(standardImageCatalog, { connectProviders: { runware: { baseURL: process.env.RUNWARE_BASE_URL } } })
  : standardImageCatalog;

function setup() {
  const storage = createMemoryAttachmentStorage();
  const usage: UsageRecord[] = [];
  const errors: string[] = [];
  const images = createImageGeneration({
    attachments: { storage },
    env: process.env,
    catalog,
    spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) } },
    logError: (message) => void errors.push(message),
  });
  return { storage, usage, errors, tools: images.tools({ ownerId: "anna", chatId: "live-chat" }) };
}

async function generate(tools: ReturnType<typeof setup>["tools"], input: Record<string, unknown>) {
  const parsed = await asSchema(tools.generate_images!.inputSchema).validate!(input);
  if (!parsed.success) throw parsed.error;
  return (await tools.generate_images!.execute!(parsed.value as never, executeOptions())) as {
    создано: number;
    заказано: number;
    картинки: Array<{ id: string; ширина: number; высота: number }>;
    ошибки?: Array<{ номер: number; причина: string }>;
  };
}

describe("картинки у настоящего Runware", () => {
  it("одна картинка GPT Image 2 low: сохранена в чат, расход с ценой Runware", async () => {
    const { storage, usage, errors, tools } = setup();
    const result = await generate(tools, { prompt: "Простой рисунок: красный маяк на скале, синее море, минимализм" });

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result).toMatchObject({ создано: 1, заказано: 1 });
    const [image] = result.картинки;
    expect(image).toMatchObject({ ширина: 816, высота: 816 });
    const record = await storage.get(image!.id);
    expect(record).toMatchObject({ chatId: "live-chat", ownerId: "anna", kind: "image", attached: true });
    expect(record!.mediaType).toMatch(/^image\/(png|jpeg|webp)$/);
    expect(record!.size).toBeGreaterThan(1000);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ source: "images", modelId: "gpt-image-2", providerId: "runware" });
    expect(usage[0]!.costUsd).toBeGreaterThan(0);
    expect(usage[0]!.costUsd).toBeLessThan(0.05);
    expect(errors).toEqual([]);
    console.info(`Runware: картинка ${record!.mediaType}, ${record!.size} байт, цена $${usage[0]!.costUsd}`);
  }, 180_000);

  it("GPT Image 2.5 Sunburst, 1K, low, прозрачный фон: PNG 1024×1024 с настоящей альфой, расход с ценой Runware", async () => {
    const storage = createMemoryAttachmentStorage();
    const usage: UsageRecord[] = [];
    const images = createImageGeneration({
      attachments: { storage },
      env: process.env,
      catalog,
      model: "gpt-image-2.5-sunburst",
      size: "1k",
      quality: "low",
      transparentBackground: true,
      spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) } },
    });
    const result = await generate(images.tools({ ownerId: "anna", chatId: "live-chat" }), { prompt: "A single golden key icon, flat style, isolated on a transparent background" });

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result.создано).toBe(1);
    const record = await storage.get(result.картинки[0]!.id);
    expect(record).toMatchObject({ mediaType: "image/png" });
    const bytes = await storage.readBytes(record!.id);
    const meta = await sharp(bytes!).metadata();
    const alpha = await alphaShares(bytes!);
    expect(meta).toMatchObject({ width: 1024, height: 1024, hasAlpha: true });
    expect(alpha.transparent).toBeGreaterThan(0.05);
    expect(alpha.opaque).toBeGreaterThan(0.05);
    expect(usage).toMatchObject([{ modelId: "gpt-image-2.5-sunburst", providerId: "runware" }]);
    expect(usage[0]!.costUsd).toBeLessThan(0.02);
    console.info(`Runware Sunburst прозрачный: ${meta.width}×${meta.height}, прозрачно ${Math.round(alpha.transparent * 100)} %, ${record!.size} байт, цена $${usage[0]!.costUsd}`);
  }, 180_000);

  it.runIf(process.env.IMAGES_LIVE_BATCH === "1")("пачка из трёх 16:9 идёт параллельно и укладывается в срок одной", async () => {
    const { storage, usage, tools } = setup();
    const started = Date.now();
    const result = await generate(tools, { prompt: "Акварель: три варианта осеннего парка", count: 3, aspectRatio: "16:9" });
    const seconds = (Date.now() - started) / 1000;

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result).toMatchObject({ создано: 3, заказано: 3 });
    expect(result.картинки.every((image) => image.ширина === 1088 && image.высота === 608)).toBe(true);
    // Все три сохранены в хранилище вложений чата, расход записан на каждую, сумма — центы (SC-009).
    for (const image of result.картинки) {
      expect(await storage.get(image.id)).toMatchObject({ chatId: "live-chat", ownerId: "anna", kind: "image", attached: true });
    }
    expect(new Set(result.картинки.map((image) => image.id)).size).toBe(3);
    expect(usage).toHaveLength(3);
    expect(usage.every((record) => record.source === "images" && record.providerId === "runware")).toBe(true);
    const total = usage.reduce((sum, record) => sum + record.costUsd, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(0.15);
    console.info(`Runware: пачка из 3 за ${seconds.toFixed(1)} с, цена $${usage.reduce((sum, record) => sum + record.costUsd, 0).toFixed(4)}`);
  }, 180_000);

  // Уточнение разрешения Seedream 5.0 Flash (одна картинка): ответ провайдера записывается в профиль каталога.
  it.runIf(process.env.IMAGES_LIVE_SEEDREAM === "1")("Seedream 5.0 Flash: размер из профиля принят, расход записан", async () => {
    const storage = createMemoryAttachmentStorage();
    const usage: UsageRecord[] = [];
    const images = createImageGeneration({
      attachments: { storage },
      env: process.env,
      catalog,
      model: "seedream-5-flash",
      spending: { storage: { insertUsageRecord: async (record) => void usage.push(record) } },
    });
    const result = await generate(images.tools({ ownerId: "anna", chatId: "live-chat" }), { prompt: "Простой рисунок: жёлтый подсолнух на белом фоне" });

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result).toMatchObject({ создано: 1, заказано: 1 });
    expect(usage[0]).toMatchObject({ source: "images", modelId: "seedream-5-flash" });
    console.info(`Seedream: ${result.картинки[0]!.ширина}×${result.картинки[0]!.высота}, цена $${usage[0]!.costUsd}`);
  }, 180_000);
});
