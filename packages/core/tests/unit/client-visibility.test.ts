import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import { clientVisibilityOf } from "../../src/access/client-visibility";

const PUBLIC = clientVisibilityOf({ reasoning: false, toolDetails: false }, () => false);
const NO_REASONING = clientVisibilityOf({ reasoning: false, toolDetails: true }, () => false);

/** Детали рассуждений OpenRouter: шифр мыслей GPT и подпись Gemini едут в метаданных текста и вызова. */
const openrouter = { openrouter: { reasoning_details: [{ type: "reasoning.text", text: "секретная мысль" }], usage: { cost: 1 } } };

function streamOf(chunks: UIMessageChunk[], ending: "close" | Error = "close"): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (ending === "close") controller.close();
      else controller.error(ending);
    },
  });
}

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const seen: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) seen.push(read.value);
  return seen;
}

/** Начало и вход скрытого вызова, без итога и без запроса подтверждения. */
const hiddenCallStart: UIMessageChunk[] = [
  { type: "tool-input-start", toolCallId: "c-hidden", toolName: "lookup" },
  { type: "tool-input-delta", toolCallId: "c-hidden", inputTextDelta: '{"q":"цены"}' },
  { type: "tool-input-available", toolCallId: "c-hidden", toolName: "lookup", input: { q: "цены" } },
];

describe("видимость: детали рассуждений OpenRouter при reasoning: false", () => {
  const chunks: UIMessageChunk[] = [
    { type: "text-start", id: "t1", providerMetadata: openrouter },
    { type: "text-delta", id: "t1", delta: "Готово", providerMetadata: openrouter },
    { type: "text-end", id: "t1", providerMetadata: openrouter },
    { type: "tool-input-start", toolCallId: "c1", toolName: "lookup", providerMetadata: openrouter },
    { type: "tool-input-available", toolCallId: "c1", toolName: "lookup", input: {}, providerMetadata: openrouter },
  ];

  it("поток: у кусков текста и входа инструмента детали вычищены, остальные метаданные целы", async () => {
    const seen = await readAll(NO_REASONING.visibleChunks(streamOf(chunks)));
    expect(seen).toHaveLength(chunks.length);
    expect(JSON.stringify(seen)).not.toContain("reasoning_details");
    expect(JSON.stringify(seen)).not.toContain("секретная мысль");
    expect(seen[0]).toMatchObject({ providerMetadata: { openrouter: { usage: { cost: 1 } } } });
  });

  it("история: у частей текста и вызова детали вычищены", () => {
    const message = {
      role: "assistant",
      parts: [
        { type: "text", text: "Готово", providerMetadata: openrouter },
        { type: "tool-lookup", toolCallId: "c1", state: "output-available", input: {}, output: "ок", callProviderMetadata: openrouter },
      ],
    };
    const visible = NO_REASONING.visibleMessage(message);
    expect(JSON.stringify(visible)).not.toContain("reasoning_details");
    expect(visible.parts[0]).toMatchObject({ text: "Готово", providerMetadata: { openrouter: { usage: { cost: 1 } } } });
    // Исходное сообщение не тронуто: хранилище и модель получают детали.
    expect(JSON.stringify(message)).toContain("reasoning_details");
  });

  it("мысли разрешены: детали остаются", async () => {
    const all = clientVisibilityOf({ reasoning: true, toolDetails: false }, () => false);
    const seen = await readAll(all.visibleChunks(streamOf(chunks.slice(0, 3))));
    expect(JSON.stringify(seen)).toContain("reasoning_details");
  });
});

describe("видимость: придержанные куски скрытого вызова", () => {
  it("поток кончился без итога вызова — придержанное не уходит", async () => {
    const seen = await readAll(PUBLIC.visibleChunks(streamOf([...hiddenCallStart, { type: "finish" }])));
    expect(seen).toEqual([{ type: "finish" }]);
  });

  it("ошибка потока — ошибка доходит до читателя, придержанное не уходит", async () => {
    const seen: UIMessageChunk[] = [];
    const reader = PUBLIC.visibleChunks(streamOf(hiddenCallStart, new Error("сбой модели"))).getReader();
    await expect(
      (async () => {
        for (let read = await reader.read(); !read.done; read = await reader.read()) seen.push(read.value);
      })(),
    ).rejects.toThrow("сбой модели");
    expect(seen).toEqual([]);
  });

  it("отмена читателем — придержанное не уходит, источник отменён", async () => {
    let cancelled: unknown;
    const source = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of hiddenCallStart) controller.enqueue(chunk);
      },
      cancel(reason) {
        cancelled = reason;
      },
    });
    const reader = PUBLIC.visibleChunks(source).getReader();
    const first = reader.read();
    await reader.cancel("ушёл");
    expect(await first).toEqual({ done: true, value: undefined });
    await expect.poll(() => cancelled).toBe("ушёл");
  });
});

describe("видимость: метаданные поставщика у итога инструмента (resultProviderMetadata)", () => {
  const routed = { openrouter: { provider: "Anthropic", reasoning_details: [{ type: "reasoning.text", text: "секретная мысль" }] } };
  const message = {
    role: "assistant",
    parts: [{ type: "tool-web_search", toolCallId: "c1", state: "output-available", input: {}, output: "ок", providerExecuted: true, resultProviderMetadata: routed }],
  };

  it("modelDetails: false — у части инструмента нет resultProviderMetadata", () => {
    const visible = clientVisibilityOf({ reasoning: true, toolDetails: true, modelDetails: false }, () => false).visibleMessage(message);
    expect(visible.parts[0]).not.toHaveProperty("resultProviderMetadata");
    expect(JSON.stringify(visible)).not.toContain("Anthropic");
  });

  it("reasoning: false — из resultProviderMetadata вычищены детали мыслей", () => {
    const visible = NO_REASONING.visibleMessage(message);
    expect(JSON.stringify(visible)).not.toContain("секретная мысль");
    expect(visible.parts[0]).toMatchObject({ resultProviderMetadata: { openrouter: { provider: "Anthropic" } } });
  });
});
