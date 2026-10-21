// Платная регрессия профиля 1017: <= 25 запросов, без повторов платных вызовов.
import { deflateSync } from "node:zlib";
import { readUIMessageStream, stepCountIs, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildModelRequest } from "../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../src/conversation/types";
import { standardCatalog } from "../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { createThoughtTitleModel } from "../../src/thought-titles/thought-title-model";
import { fitsLanguage } from "../../src/thought-titles/thought-title-text";

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

const modelId = "deepseek-4.1-flash";
let requestCount = 0;
const realFetch = globalThis.fetch;
const limitedFetch: typeof fetch = (input, init) => {
  if (init?.method === "POST" && ++requestCount > 25) throw new Error("Budget: 25 model calls");
  return realFetch(input, init);
};
const tools = {
  add: tool({ description: "Add two numbers", inputSchema: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => a + b }),
  show_picture: colorTool(solidPng([20, 60, 220])),
};
const user = (id: string, text: string): AgentChatMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const instructions = [
  `Unique run ${Date.now()}. You are a test assistant. Follow user instructions precisely.`,
  ...Array.from({ length: 100 }, (_, i) => `Rule ${i}: use tools for additions and images. Never invent a tool result. Answer briefly, do not write for the user.`),
].join("\n");

describe.each(["deepseek", "openrouter"])("1017: %s", (providerId) => {
  it("parallel tools, image, reasoning replay, cache, off and thought title", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const recordingFetch: typeof fetch = (input, init) => {
      if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
      return limitedFetch(input, init);
    };
    async function turn(history: AgentChatMessage[], reasoning: string) {
      const request = await buildModelRequest({ catalog: standardCatalog, modelId, providerId, chatId: `1017-${providerId}`, instructions, tools, history, reasoning, env: process.env, fetch: recordingFetch });
      const result = streamText({ ...request, maxRetries: 0, maxOutputTokens: 4000, stopWhen: stepCountIs(3) });
      let answer: AgentChatMessage | undefined;
      for await (const message of readUIMessageStream<AgentChatMessage>({ stream: result.toUIMessageStream<AgentChatMessage>() })) answer = message;
      return { answer: answer!, text: await result.text, steps: await result.steps, usage: await result.totalUsage };
    }
    const question = user("u1", "Think through the task and verify all constraints before acting. In one parallel batch call add(17,25), add(30,12) and show_picture. Then report both sums and the picture color in one short sentence.");
    const first = await turn([question], "on");
    const calls = first.steps[0]!.toolCalls;
    const reasoningText = first.steps[0]!.reasoning.map((part) => "text" in part ? part.text : "").join("");
    expect(calls.filter((call) => call.toolName === "add")).toHaveLength(2);
    expect(calls.some((call) => call.toolName === "show_picture")).toBe(true);
    expect(first.text.toLowerCase()).toContain("blue");
    expect(first.text).toContain("42");
    expect(reasoningText.length).toBeGreaterThan(0);
    const replay = JSON.stringify(bodies[1]?.messages ?? []);
    expect(replay).toContain(JSON.stringify(reasoningText).slice(1, -1));
    const firstBody = bodies[0]!;
    if (providerId === "openrouter") expect(firstBody.min_p).toBe(0.05);
    else expect(firstBody.min_p).toBeUndefined();
    const beforeSecond = bodies.length;
    const second = await turn([question, { ...first.answer, metadata: { modelId, providerId, status: "complete" } }, user("u2", "Do not call tools. Repeat the two sums and color in one short sentence.")], "on");
    expect(JSON.stringify(bodies[beforeSecond]?.messages)).toContain(JSON.stringify(reasoningText).slice(1, -1));
    expect(second.text.toLowerCase()).toContain("blue");
    const hit1 = first.steps[0]!.usage.inputTokenDetails.cacheReadTokens ?? 0;
    const hit2 = second.steps[0]!.usage.inputTokenDetails.cacheReadTokens ?? 0;
    expect(hit2).toBeGreaterThan(hit1);
    const off = await turn([user("off", "Reply exactly: API OK")], "off");
    expect(off.text).toContain("API OK");
    expect(off.steps.map((step) => step.reasoning.map((part) => "text" in part ? part.text : "").join("")).join("")).toBe("");
    for (const result of [first, second, off]) expect(result.text).not.toMatch(/<\|(?:user|assistant|im_start)|\nuser\b|\nassistant\b/);
    const storage = createInMemoryChatStorage();
    const titleModel = createThoughtTitleModel(
      { storage, catalog: standardCatalog, env: process.env, logError: console.error, assertWithinLimit: async () => {}, afterSpending: () => {} },
      { modelId, providerId, reasoning: "off" }, 30_000,
    );
    globalThis.fetch = limitedFetch;
    let title: string | undefined;
    try { title = await titleModel({ ownerId: "test", chatId: "title", messageId: "a1", text: reasoningText, language: "ru" }); }
    finally { globalThis.fetch = realFetch; }
    expect(title).toBeTruthy();
    expect(fitsLanguage(title!, "ru")).toBe(true);
    expect(title!.split(" ").length).toBeLessThanOrEqual(6);
    const signatures = first.answer.parts.filter((p) => p.type === "reasoning").map((p) => p.providerMetadata);
    console.log("[1017]", JSON.stringify({ providerId, parallel: calls.length, text: first.text, reasoningChars: reasoningText.length, signatures, replayWithinStep: true, replayPastTurn: true, cacheFirst: hit1, cacheSecond: hit2, off: off.text, title, requests: requestCount }));
  }, 300_000);
});

describe.each(["together", "fireworks"])("1017 image compatibility: %s", (providerId) => {
  it("датированный id принимает картинку из результата инструмента", async () => {
    const request = await buildModelRequest({ catalog: standardCatalog, modelId, providerId, chatId: `1017-${providerId}`, instructions: "Use the picture tool before answering.", tools: { show_picture: tools.show_picture }, history: [user("image", "Call show_picture then answer the color in one English word.")], reasoning: "off", env: process.env, fetch: limitedFetch });
    const result = streamText({ ...request, maxRetries: 0, maxOutputTokens: 1000, stopWhen: stepCountIs(2) });
    const text = await result.text;
    expect(text.toLowerCase()).toContain("blue");
    expect((await result.steps)[0]!.toolCalls).toHaveLength(1);
    console.log("[1017-image]", JSON.stringify({ providerId, text, requests: requestCount }));
  }, 120_000);
});
