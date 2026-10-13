// Живая проверка KIE.ai: по одной картинке на назначение, самые дешёвые настройки (центы за всё).
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import type { UsageRecord } from "@ykurilov/agent-chat-core";
import { asSchema } from "ai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createImageGeneration } from "../../src/index";
import { alphaShares } from "../support/alpha";
import { executeOptions } from "../support/fake-runware";

if (!process.env.KIE_API_KEY) throw new Error("Нет KIE_API_KEY: выполните `pnpm secrets:load`");

const purposes = {
  picture: { description: "картинка без текста", model: "z-image" },
  "with-text": { description: "картинка с надписью", model: "seedream-5-flash-kie" },
  "no-background": { description: "предмет без фона", model: "z-image", removeBackground: { model: "seedream-5-flash-layers" } },
};

function setup() {
  const storage = createMemoryAttachmentStorage();
  const usage: UsageRecord[] = [];
  const errors: string[] = [];
  const images = createImageGeneration({
    attachments: { storage },
    env: process.env,
    purposes,
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
    картинки: Array<{ id: string; ширина: number; высота: number }>;
    ошибки?: Array<{ номер: number; причина: string }>;
  };
}

const price = (usage: UsageRecord[]) => usage.map((record) => `${record.modelId} $${record.costUsd.toFixed(4)}`).join(", ");

describe("картинки у настоящего KIE.ai", () => {
  it("z-image: PNG сохранён в чат, расход ценой KIE", async () => {
    const { storage, usage, errors, tools } = setup();
    const started = Date.now();
    const result = await generate(tools, { prompt: "Simple flat illustration: a red apple on a white table", purpose: "picture" });

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result.создано).toBe(1);
    const image = result.картинки[0]!;
    expect(await storage.get(image.id)).toMatchObject({ chatId: "live-chat", attached: true, mediaType: "image/png" });
    expect(usage).toMatchObject([{ source: "images", modelId: "z-image", providerId: "kie" }]);
    expect(usage[0]!.costUsd).toBeGreaterThan(0);
    expect(usage[0]!.costUsd).toBeLessThan(0.02);
    expect(errors).toEqual([]);
    console.info(`KIE z-image: ${image.ширина}×${image.высота} за ${((Date.now() - started) / 1000).toFixed(1)} с, ${price(usage)}`);
  }, 180_000);

  it("Seedream 5.0 Flash: картинка с надписью, расход ценой KIE", async () => {
    const { usage, errors, tools } = setup();
    const started = Date.now();
    const result = await generate(tools, { prompt: 'Minimal poster with the big word "COFFEE" in black letters on a beige background', purpose: "with-text" });

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result.создано).toBe(1);
    expect(usage).toMatchObject([{ modelId: "seedream-5-flash-kie", providerId: "kie" }]);
    expect(usage[0]!.costUsd).toBeGreaterThan(0);
    expect(usage[0]!.costUsd).toBeLessThan(0.1);
    expect(errors).toEqual([]);
    console.info(`KIE Seedream text-to-image: ${result.картинки[0]!.ширина}×${result.картинки[0]!.высота} за ${((Date.now() - started) / 1000).toFixed(1)} с, ${price(usage)}`);
  }, 180_000);

  it("без фона: генерация, затем разделение на слои; сохранён предмет с настоящей прозрачностью, расход за оба шага", async () => {
    const { storage, usage, errors, tools } = setup();
    const started = Date.now();
    const result = await generate(tools, { prompt: "A single red apple with a green leaf, studio photo, plain light background", purpose: "no-background" });

    expect(result.ошибки, JSON.stringify(result.ошибки)).toBeUndefined();
    expect(result.создано).toBe(1);
    const bytes = await storage.readBytes(result.картинки[0]!.id);
    const meta = await sharp(bytes!).metadata();
    const alpha = await alphaShares(bytes!);
    expect(meta.hasAlpha).toBe(true);
    // Есть и прозрачные пиксели (фон), и непрозрачные (предмет).
    expect(alpha.transparent).toBeGreaterThan(0.05);
    expect(alpha.opaque).toBeGreaterThan(0.2);
    expect(usage.map((record) => record.modelId)).toEqual(["z-image", "seedream-5-flash-layers"]);
    expect(errors).toEqual([]);
    console.info(`KIE без фона: ${meta.width}×${meta.height} ${meta.format}, прозрачно ${Math.round(alpha.transparent * 100)} %, за ${((Date.now() - started) / 1000).toFixed(1)} с, ${price(usage)}`);
  }, 180_000);
});
