// Живая проверка: видит ли модель картинку из результата инструмента у выбранного провайдера.
// Инструмент отдаёт картинку сплошного цвета; модель, которая её видит, называет цвет.
// Пары модель+провайдер берутся из отметки профиля `toolResultImageProviders`; ключи — из окружения (`pnpm secrets:load`).
import { deflateSync } from "node:zlib";
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../src";

// Цвета, которые модели называют без разночтений: красный бывает «оранжевым», жёлтый — «оранжевым» и «белым».
const colors = [
  { rgb: [20, 60, 220], english: "blue" },
  { rgb: [20, 180, 40], english: "green" },
  { rgb: [140, 30, 200], english: "purple" },
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


function colorTool(dataUrl: string) {
  return tool({
    description: "Shows you a picture.",
    inputSchema: z.object({}),
    execute: async () => ({ shown: true }),
    toModelOutput: () => ({
      type: "content" as const,
      value: [
        { type: "text" as const, text: "The picture:" },
        { type: "file" as const, data: { type: "data" as const, data: dataUrl.split(",")[1]! }, mediaType: "image/png" },
      ],
    }),
  });
}

const pairs = standardCatalog.models.flatMap((model) =>
  (model.toolResultImageProviders ?? [])
    .filter((providerId) => process.env[standardCatalog.providers.find((provider) => provider.id === providerId)!.apiKeyEnv])
    .map((providerId) => ({ model, providerId })),
);
const runs = pairs.flatMap((pair) => colors.map((color) => ({ ...pair, color })));

describe("картинка в результате инструмента", () => {
  it.each(runs)("$model.id у $providerId называет цвет ($color.english)", async ({ model, providerId, color }) => {
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId: model.id, providerId },
      agent: { instructions: "You are a test assistant.", tools: { show_picture: colorTool(solidPng(color.rgb)) }, maxSteps: 4 },
      env: process.env,
    });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, {
      id: "q1",
      role: "user",
      parts: [{ type: "text", text: "Call show_picture, then answer with one English word: the color that fills the whole picture." }],
    });
    for await (const _chunk of stream) {
      // ход дочитывается до конца
    }
    const { messages } = await service.getHistory("anna", chat.id);
    const parts = messages.findLast((message) => message.role === "assistant")?.parts ?? [];
    const called = parts.some((part) => part.type === "tool-show_picture" && "state" in part && part.state === "output-available");
    const text = parts.map((part) => (part.type === "text" ? part.text : "")).join("").toLowerCase();
    expect(called, "инструмент вызван").toBe(true);
    expect(text).toContain(color.english);
  }, 120_000);
});
