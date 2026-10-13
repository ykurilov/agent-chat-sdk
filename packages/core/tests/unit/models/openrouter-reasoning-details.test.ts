import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../../src/chat-service";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";

const ownerId = "owner";
const encryptedBlob = "gAAAAABqvghRotVl3tfqNF57FR0BGBiSBJu7vg-encrypted-by-gpt";
const geminiSignature = "EpYGCpMGAWkUfRNlwhB+gemini-signature";

type Chunk = Record<string, unknown>;

/** Кусок потока OpenRouter: поля `delta` и, если нужно, расход. */
function chunk(delta: Chunk, extra: Chunk = {}): Chunk {
  return { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p", choices: [{ index: 0, delta: { role: "assistant", ...delta }, ...extra }] };
}

const usageChunk: Chunk = {
  ...chunk({ content: "" }, { finish_reason: "stop" }),
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

/** Куски приходят по одному с паузой, как по сети: сборка ответа успевает обработать каждый до следующего. */
function sse(chunks: Chunk[]): Response {
  const lines = [...chunks.map((piece) => `data: ${JSON.stringify(piece)}\n\n`), "data: [DONE]\n\n"];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

interface SentMessage {
  role: string;
  content?: unknown;
  reasoning?: string;
  reasoning_details?: Array<Record<string, unknown>>;
}

/** Ответы модели по очереди; тела запросов — для разбора, что ушло провайдеру. */
function fakeProvider(answers: Chunk[][]) {
  const bodies: Array<{ messages: SentMessage[] }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return sse(answers[bodies.length - 1] ?? []);
    }),
  );
  return bodies;
}

async function drain(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // ход дочитывается до конца
  }
}

/** Два хода подряд в одном чате: первый ответ из хранилища уходит в запрос второго. */
async function twoTurns(modelId: string, answers: Chunk[][]) {
  const bodies = fakeProvider(answers);
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: { modelId, providerId: "openrouter" },
    agent: { instructions: "Ты помощник." },
    env: { OPENROUTER_API_KEY: "test-key" },
  });
  const chat = await service.createChat(ownerId);
  const ask = (id: string, text: string) =>
    service.sendMessage(ownerId, chat.id, { id, role: "user", parts: [{ type: "text", text }] }).then(drain);
  await ask("u1", "Загадай число");
  await ask("u2", "Какое?");
  const stored = (await service.getHistory(ownerId, chat.id)).messages.find((message) => message.role === "assistant");
  const sentAgent = bodies[1]!.messages.find((message) => message.role === "assistant");
  return { stored, sentAgent, bodies };
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter: детали рассуждений, которые провайдер кладёт только в итог шага", () => {
  it("GPT: шифр без видимого рассуждения доезжает до хранилища и уходит во второй запрос", async () => {
    const { sentAgent } = await twoTurns("gpt-6-luna", [
      [
        chunk({ content: "", reasoning: null, reasoning_details: [{ type: "reasoning.encrypted", data: encryptedBlob, format: "azure-openai-responses-v1", id: "rs_1", index: 0 }] }),
        chunk({ content: "Загадал" }),
        usageChunk,
      ],
      [chunk({ content: "583" }), usageChunk],
    ]);
    expect(sentAgent?.reasoning_details).toEqual([
      { type: "reasoning.encrypted", data: encryptedBlob, format: "azure-openai-responses-v1", id: "rs_1", index: 0 },
    ]);
  });

  it("Gemini: подпись без текста рассуждения не теряется", async () => {
    const { sentAgent } = await twoTurns("gemini-3.8-flash", [
      [
        chunk({ content: "Загадал" }),
        chunk({ content: "", reasoning_details: [{ type: "reasoning.text", signature: geminiSignature, format: "google-gemini-v1", index: 0 }] }),
        usageChunk,
      ],
      [chunk({ content: "583" }), usageChunk],
    ]);
    expect(sentAgent?.reasoning_details).toEqual([
      { type: "reasoning.text", signature: geminiSignature, format: "google-gemini-v1", index: 0 },
    ]);
  });

  it("Gemini: подпись, пришедшая после начала ответа, доезжает к рассуждению", async () => {
    const { stored, sentAgent } = await twoTurns("gemini-3.8-flash", [
      [
        chunk({ reasoning_details: [{ type: "reasoning.text", text: "Беру 583.", format: "google-gemini-v1", index: 0 }] }),
        chunk({ content: "Загадал" }),
        chunk({ content: "", reasoning_details: [{ type: "reasoning.text", text: "", signature: geminiSignature, format: "google-gemini-v1", index: 0 }] }),
        usageChunk,
      ],
      [chunk({ content: "583" }), usageChunk],
    ]);
    expect(stored?.parts.some((part) => part.type === "reasoning" && part.text === "Беру 583.")).toBe(true);
    expect(sentAgent?.reasoning_details).toEqual([
      { type: "reasoning.text", text: "Беру 583.", signature: geminiSignature, format: "google-gemini-v1", index: 0 },
    ]);
  });

  it("ответ без деталей рассуждений уходит без них", async () => {
    const { sentAgent } = await twoTurns("gemini-3.8-flash", [
      [chunk({ content: "Загадал" }), usageChunk],
      [chunk({ content: "583" }), usageChunk],
    ]);
    expect(sentAgent?.reasoning_details ?? []).toEqual([]);
  });
});
