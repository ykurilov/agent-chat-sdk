import { asSchema } from "ai";
import type { ToolSet } from "ai";
import sharp from "sharp";
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { describe, expect, it } from "vitest";
import { createImageGeneration, runwareProvider } from "../src/index";
import type { CreateImageGenerationOptions } from "../src/index";
import { saveGeneratedImage } from "../src/save-images";
import { executeOptions, fakeRunware, json, KEY } from "./support/fake-runware";

const turn = { ownerId: "anna", chatId: "chat-1" };

/** Настоящий PNG 300×200 с альфой: половина прозрачная, половина — красная. */
async function transparentPng(): Promise<Uint8Array> {
  const pixels = Buffer.alloc(300 * 200 * 4);
  for (let index = 0; index < 300 * 200; index++) {
    if (index % 300 < 150) pixels.set([220, 30, 30, 255], index * 4);
  }
  return new Uint8Array(await sharp(pixels, { raw: { width: 300, height: 200, channels: 4 } }).png().toBuffer());
}

function setup(overrides: Partial<CreateImageGenerationOptions> = {}, runware = fakeRunware()) {
  const storage = createMemoryAttachmentStorage();
  const images = createImageGeneration({ attachments: { storage }, env: { RUNWARE_API_KEY: KEY }, fetch: runware.fetch, ...overrides });
  return { storage, images, runware };
}

async function generate(tools: ToolSet, input: Record<string, unknown>) {
  const parsed = await asSchema(tools.generate_images!.inputSchema).validate!(input);
  if (!parsed.success) throw parsed.error;
  return (await tools.generate_images!.execute!(parsed.value as never, executeOptions())) as Record<string, any>;
}

describe("Runware: качество и прозрачный фон из настройки приложения", () => {
  it("по умолчанию как раньше: GPT Image 2 в низком качестве, JPG", async () => {
    const { images, runware } = setup();
    await generate(images.tools(turn), { prompt: "Маяк" });
    expect(runware.sent[0]!.task).toMatchObject({ outputFormat: "JPG", providerSettings: { openai: { quality: "low" } } });
  });

  it("quality для GPT Image 2 — в providerSettings.openai, для 2.5 — в settings", async () => {
    const gpt2 = setup({ quality: "high" });
    await generate(gpt2.images.tools(turn), { prompt: "Маяк" });
    expect(gpt2.runware.sent[0]!.task).toMatchObject({ providerSettings: { openai: { quality: "high" } } });

    const flare = setup({ model: "gpt-image-2.5-flare", quality: "medium" });
    await generate(flare.images.tools(turn), { prompt: "Маяк" });
    expect(flare.runware.sent[0]!.task).toMatchObject({ settings: { quality: "medium" } });
  });

  it("прозрачный фон: PNG и background transparent там же, где качество; качество модели остаётся", async () => {
    const sunburst = setup({ model: "gpt-image-2.5-sunburst", transparentBackground: true });
    await generate(sunburst.images.tools(turn), { prompt: "Сундук" });
    expect(sunburst.runware.sent[0]!.task).toMatchObject({ outputFormat: "PNG", settings: { quality: "low", background: "transparent" } });

    const flare = setup({ model: "gpt-image-2.5-flare", transparentBackground: true, quality: "auto" });
    await generate(flare.images.tools(turn), { prompt: "Сундук" });
    expect(flare.runware.sent[0]!.task).toMatchObject({ outputFormat: "PNG", settings: { quality: "auto", background: "transparent" } });
  });

  it("назначения задают качество и фон каждое своё", async () => {
    const { images, runware } = setup({
      purposes: {
        draft: { description: "черновик", model: "gpt-image-2" },
        sprite: { description: "спрайт без фона", model: "gpt-image-2.5-sunburst", quality: "medium", transparentBackground: true },
      },
    });
    await generate(images.tools(turn), { prompt: "Сундук", purpose: "sprite" });
    await generate(images.tools(turn), { prompt: "Сундук", purpose: "draft" });
    expect(runware.sent[0]!.task).toMatchObject({ model: "openai:gpt-image@2.5-sunburst", outputFormat: "PNG", settings: { quality: "medium", background: "transparent" } });
    expect(runware.sent[1]!.task).toMatchObject({ model: "openai:gpt-image@2", outputFormat: "JPG", providerSettings: { openai: { quality: "low" } } });
  });

  it("модель не умеет качество или прозрачный фон — ошибка настройки при создании", () => {
    const storage = createMemoryAttachmentStorage();
    const base = { attachments: { storage }, env: { RUNWARE_API_KEY: KEY } };
    expect(() => createImageGeneration({ ...base, model: "seedream-5-flash", quality: "high" })).toThrow(/качеств/);
    expect(() => createImageGeneration({ ...base, model: "seedream-5-flash", transparentBackground: true })).toThrow(/прозрачн/);
    expect(() => createImageGeneration({ ...base, quality: "ultra" as never })).toThrow(/quality/);
    expect(() => createImageGeneration({ ...base, model: "gpt-image-2.5-sunburst", transparentBackground: true, output: { format: "jpeg" } })).toThrow(/jpeg/);
    expect(() => createImageGeneration({ ...base, output: { maxSide: 0 } })).toThrow(/maxSide/);
  });

  it("провайдер Runware переводит формат: png → PNG, webp → WEBP, без формата — JPG", async () => {
    const answer = () => json({ data: [{ imageURL: "https://im.runware.ai/image/1.png" }] });
    const sent: unknown[] = [];
    const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body))[0]);
      return answer();
    }) as typeof globalThis.fetch;
    const request = { taskUUID: "t", providerModelId: "m", prompt: "p", width: 816, height: 816, timeoutMs: 1000 };
    await runwareProvider.generate({ ...request, outputFormat: "png" }, { apiKey: KEY, fetch });
    await runwareProvider.generate({ ...request, outputFormat: "webp" }, { apiKey: KEY, fetch });
    await runwareProvider.generate(request, { apiKey: KEY, fetch });
    expect(sent.map((task) => (task as { outputFormat: string }).outputFormat)).toEqual(["PNG", "WEBP", "JPG"]);
  });
});

describe("сохранение PNG с прозрачностью и постобработка", () => {
  it("PNG с альфой сохраняется байт в байт; размер берётся из файла", async () => {
    const png = await transparentPng();
    const storage = createMemoryAttachmentStorage();
    const saved = await saveGeneratedImage({
      url: "https://im.runware.ai/image/1.png",
      fetch: (async () => new Response(png as BodyInit)) as typeof globalThis.fetch,
      storage,
      chatId: "chat-1",
      ownerId: "anna",
      number: 1,
      maxImageBytes: 10 * 1024 * 1024,
      now: () => new Date(),
    });
    expect(saved).toMatchObject({ mediaType: "image/png", width: 300, height: 200 });
    const file = await storage.readBytes(saved.id);
    expect(Buffer.from(file!).equals(Buffer.from(png))).toBe(true);
    expect((await sharp(file!).metadata()).hasAlpha).toBe(true);
  });

  it("output: WebP не больше maxSide по большей стороне, прозрачность сохранена; размер в итоге — после обработки", async () => {
    const png = await transparentPng();
    const runware = fakeRunware({ downloads: { 1: new Response(png as BodyInit) } });
    const { images, storage } = setup({ model: "gpt-image-2.5-sunburst", transparentBackground: true, output: { format: "webp", maxSide: 150 } }, runware);
    const result = await generate(images.tools(turn), { prompt: "Сундук" });

    expect(result).toMatchObject({ создано: 1, картинки: [{ номер: 1, ширина: 150, высота: 100 }] });
    const record = await storage.get(result.картинки[0].id);
    expect(record).toMatchObject({ mediaType: "image/webp", name: "image-1.webp" });
    const file = await storage.readBytes(result.картинки[0].id);
    const meta = await sharp(file!).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 150, height: 100, hasAlpha: true });
  });

  it("output без формата — тот же формат, только меньше; меньшую картинку не увеличивает", async () => {
    const png = await transparentPng();
    const shrink = setup({ output: { maxSide: 100 } }, fakeRunware({ downloads: { 1: new Response(png as BodyInit) } }));
    const shrunk = await generate(shrink.images.tools(turn), { prompt: "Сундук" });
    expect(shrunk.картинки[0]).toMatchObject({ ширина: 100, высота: 67 });
    expect(await shrink.storage.get(shrunk.картинки[0].id)).toMatchObject({ mediaType: "image/png" });

    const keep = setup({ output: { maxSide: 1000 } }, fakeRunware({ downloads: { 1: new Response(png as BodyInit) } }));
    expect((await generate(keep.images.tools(turn), { prompt: "Сундук" })).картинки[0]).toMatchObject({ ширина: 300, высота: 200 });
  });
});
