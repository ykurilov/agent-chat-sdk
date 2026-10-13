// Живая проверка: доходит ли картинка из результата инструмента до модели через OpenRouter.
// Инструмент отдаёт снимок сплошного цвета; модель, которая его видит, называет цвет.
// Ключ — только из окружения (`pnpm secrets:load`), в вывод он не попадает.
import { deflateSync } from "node:zlib";
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createWebTools } from "../../src/create-web-tools";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const providerId = "openrouter";
// Через OpenRouter картинку в результате инструмента видят модели с отметкой `toolResultImageProviders`. Хозяева модели,
// которые её не видят или отвергают запрос, запрещены в профиле (`providerOptions.openrouter.provider.ignore`, замер —
// docs/research/openrouter-tool-images.md); без запрета запрос иногда попадает к ним, и модель картинки «не видит».
const seeingModels = standardCatalog.models.filter((model) => model.toolResultImageProviders?.includes(providerId));

const colors = [
  { rgb: [220, 20, 20], english: "red" },
  { rgb: [20, 60, 220], english: "blue" },
] as const;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG 64×64 одного цвета, data-адрес. */
function solidPng(rgb: readonly number[]): string {
  const size = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => [...rgb]).flat())]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: size }, () => row)));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

describe("картинка в результате инструмента через OpenRouter", () => {
  it.each(seeingModels.map((model, index) => ({ model, color: colors[index % colors.length]! })))(
    "$model.id называет цвет снимка",
    async ({ model, color }) => {
      const webTools = createWebTools({
        search: { search: async () => [] },
        reader: { readPage: async (url) => ({ url, title: "Тест", markdown: "Тест" }) },
        screenshots: { takeScreenshot: async () => ({ imageUrl: solidPng(color.rgb) }) },
      });
      const service = createChatService({
        storage: createInMemoryChatStorage(),
        catalog: standardCatalog,
        defaultChoice: { modelId: model.id, providerId },
        agent: {
          instructions: "You are a test assistant. Use the page_screenshot tool when asked, then describe what the picture shows.",
          tools: webTools,
          maxSteps: 4,
        },
        env: process.env,
      });
      const chat = await service.createChat("anna");
      const stream = await service.sendMessage("anna", chat.id, {
        id: "q1",
        role: "user",
        parts: [
          {
            type: "text",
            text: "Call page_screenshot for https://example.com, then answer with one English word: the color that fills the whole picture.",
          },
        ],
      });
      for await (const _chunk of stream) {
        // ход дочитывается до конца
      }
      const { messages } = await service.getHistory("anna", chat.id);
      const parts = messages.findLast((message) => message.role === "assistant")?.parts ?? [];
      const called = parts.some((part) => part.type === "tool-page_screenshot" && "state" in part && part.state === "output-available");
      const text = parts.map((part) => (part.type === "text" ? part.text : "")).join("").toLowerCase();
      expect(called, "снимок сделан").toBe(true);
      expect(text).toContain(color.english);
    },
    120_000,
  );
});
