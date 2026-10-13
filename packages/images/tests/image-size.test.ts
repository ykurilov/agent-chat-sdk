import { asSchema } from "ai";
import type { ToolSet } from "ai";
import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { describe, expect, it } from "vitest";
import { createImageGeneration, createImageQueue, extendImageCatalog, imageSizes, standardImageCatalog } from "../src/index";
import type { CreateImageGenerationOptions } from "../src/index";
import { resolveImageSetups } from "../src/image-setup";
import { executeOptions, fakeRunware, hanging, KEY } from "./support/fake-runware";

const turn = { ownerId: "anna", chatId: "chat-1" };
const env = { RUNWARE_API_KEY: KEY };
const gptModels = ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"];
const modelOf = (id: string) => standardImageCatalog.models.find((model) => model.id === id)!;

function setup(overrides: Partial<CreateImageGenerationOptions> = {}, runware = fakeRunware()) {
  const images = createImageGeneration({ attachments: { storage: createMemoryAttachmentStorage() }, env, fetch: runware.fetch, ...overrides });
  return { images, runware };
}

async function generate(tools: ToolSet, input: Record<string, unknown>) {
  const parsed = await asSchema(tools.generate_images!.inputSchema).validate!(input);
  if (!parsed.success) throw parsed.error;
  return (await tools.generate_images!.execute!(parsed.value as never, executeOptions())) as Record<string, any>;
}

const priceOf = (choice: Parameters<typeof resolveImageSetups>[0], purpose = "") => resolveImageSetups(choice).byPurpose.get(purpose)!.priceUsd;

describe("размер 1K у GPT Image", () => {
  it("каталог: 1:1 — 1024×1024, у остальных длинная сторона около 1024; шаг 16, площадь не меньше 655 360, пропорция точнее 1 %", () => {
    expect(imageSizes).toContain("1k");
    for (const id of gptModels) {
      const sizes = modelOf(id).sizes!["1k"]!.aspectRatios;
      expect(sizes["1:1"], id).toEqual({ width: 1024, height: 1024 });
      expect(sizes["16:9"], id).toEqual({ width: 1088, height: 608 });
      for (const [ratio, { width, height }] of Object.entries(sizes)) {
        const [a, b] = ratio.split(":").map(Number) as [number, number];
        expect(width % 16, `${id} ${ratio}`).toBe(0);
        expect(height % 16, `${id} ${ratio}`).toBe(0);
        expect(width * height, `${id} ${ratio}`).toBeGreaterThanOrEqual(655_360);
        expect(Math.max(width, height), `${id} ${ratio}`).toBeGreaterThanOrEqual(1000);
        expect(Math.max(width, height), `${id} ${ratio}`).toBeLessThanOrEqual(1100);
        expect(Math.abs(width / height / (a / b) - 1), `${id} ${ratio}`).toBeLessThan(0.01);
      }
    }
  });

  it("size: \"1k\" в общих настройках — Runware получает 1024×1024 и 1088×608; без настройки — как раньше, 816×816", async () => {
    const big = setup({ model: "gpt-image-2.5-sunburst", size: "1k" });
    await generate(big.images.tools(turn), { prompt: "Маяк" });
    await generate(big.images.tools(turn), { prompt: "Маяк", aspectRatio: "16:9" });
    expect(big.runware.sent.map(({ task }) => [task.width, task.height])).toEqual([
      [1024, 1024],
      [1088, 608],
    ]);
    const result = await generate(big.images.tools(turn), { prompt: "Маяк" });
    expect(result.картинки[0]).toMatchObject({ ширина: expect.any(Number) });

    const plain = setup({ model: "gpt-image-2.5-sunburst" });
    await generate(plain.images.tools(turn), { prompt: "Маяк" });
    expect(plain.runware.sent[0]!.task).toMatchObject({ width: 816, height: 816 });
  });

  it("size в назначении главнее общего", async () => {
    const { images, runware } = setup({
      size: "1k",
      purposes: {
        icon: { description: "значок", model: "gpt-image-2.5-sunburst" },
        draft: { description: "черновик", model: "gpt-image-2.5-sunburst", size: "default" },
      },
    });
    await generate(images.tools(turn), { prompt: "Маяк", purpose: "icon" });
    await generate(images.tools(turn), { prompt: "Маяк", purpose: "draft" });
    expect(runware.sent.map(({ task }) => task.width)).toEqual([1024, 816]);
  });

  it("модель без такого размера и неизвестный размер — ошибка при запуске, с именем назначения", () => {
    const { sizes: _sizes, ...withoutSizes } = modelOf("gpt-image-2.5-sunburst");
    const catalog = extendImageCatalog(standardImageCatalog, { addModels: [{ ...withoutSizes, id: "own-model" }] });
    expect(() => setup({ catalog, model: "own-model", size: "1k" })).toThrow(/модель own-model не умеет размер 1k/);
    for (const model of standardImageCatalog.models) expect(model.sizes?.["1k"], model.id).toBeDefined();
    expect(() => setup({ purposes: { hero: { description: "обложка", model: "gpt-image-2", size: "8k" as never } } })).toThrow(/назначение hero: size/);
  });
});

describe("цена в каталоге: замер Runware, 1024×1024, low", () => {
  it("1K low — не меньше замера и не больше чем в полтора раза", () => {
    const measured: Record<string, number> = { "gpt-image-2": 0.00602, "gpt-image-2.5-flare": 0.00602, "gpt-image-2.5-sunburst": 0.00599 };
    for (const [id, cost] of Object.entries(measured)) {
      const price = priceOf({ env, model: id, size: "1k" });
      expect(price, id).toBeGreaterThanOrEqual(cost);
      expect(price, id).toBeLessThanOrEqual(cost * 1.5);
    }
  });

  it("запас в лимитах растёт с размером и качеством; прозрачный фон цену не меняет", () => {
    const smallest = priceOf({ env, model: "gpt-image-2.5-sunburst" });
    const big = priceOf({ env, model: "gpt-image-2.5-sunburst", size: "1k" });
    const medium = priceOf({ env, model: "gpt-image-2.5-sunburst", size: "1k", quality: "medium" });
    const high = priceOf({ env, model: "gpt-image-2.5-sunburst", size: "1k", quality: "high" });
    expect(smallest).toBeLessThan(big);
    expect(medium).toBeGreaterThan(big * 3);
    expect(high).toBeGreaterThan(medium * 3);
    expect(priceOf({ env, model: "gpt-image-2.5-sunburst", size: "1k", quality: "auto" })).toBe(high);
    expect(priceOf({ env, model: "gpt-image-2.5-sunburst", size: "1k", transparentBackground: true })).toBe(big);
  });

  it("очередь бронирует в лимите цену своего размера и качества", async () => {
    const runware = fakeRunware({ tasks: { 1: hanging } });
    const queue = createImageQueue({ env, fetch: runware.fetch, model: "gpt-image-2.5-sunburst", size: "1k", quality: "medium", deliver: () => true, acceptWaitMs: 1 });
    try {
      await queue.order({ ownerId: "anna", chatId: "chat-1", prompt: "Маяк" });
      expect(queue.pendingUsd("anna", "chat-1").user).toBe(priceOf({ env, model: "gpt-image-2.5-sunburst", size: "1k", quality: "medium" }));
    } finally {
      await queue.stop();
    }
  });
});

describe("GPT Image 2 не умеет прозрачный фон у Runware", () => {
  it("каталог: transparentBackground только у 2.5", () => {
    expect(modelOf("gpt-image-2").transparentBackground).toBeFalsy();
    expect(modelOf("gpt-image-2.5-flare").transparentBackground).toBe(true);
    expect(modelOf("gpt-image-2.5-sunburst").transparentBackground).toBe(true);
  });

  it("настройка «прозрачный фон» с gpt-image-2 — понятная ошибка при запуске: и у инструмента, и у очереди", () => {
    expect(() => setup({ transparentBackground: true })).toThrow(/gpt-image-2 не умеет прозрачный фон/);
    expect(() => setup({ purposes: { sprite: { description: "спрайт", model: "gpt-image-2", transparentBackground: true } } })).toThrow(/назначение sprite: модель gpt-image-2 не умеет прозрачный фон/);
    expect(() => createImageQueue({ env, model: "gpt-image-2", transparentBackground: true, deliver: () => true })).toThrow(/gpt-image-2 не умеет прозрачный фон/);
  });
});
