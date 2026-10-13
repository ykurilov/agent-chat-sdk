import type { LanguageModelV4, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../../../src/models/providers/openrouter";

// OpenRouter кэширует Gemini по последней метке и метку на самом конце запроса пропускает: кэш не пишется (опыт
// 2026-10-11, запрос ~6300 токенов: метка в конце — запись 0, та же метка с коротким хвостом после — запись 6265).
// Поэтому у Gemini метка с последнего сообщения переезжает на предпоследнее. У Claude метка в конце работает — как есть.

type Body = { messages: Array<{ role: string; content?: unknown }> };

function stubbedFetch(bodies: Body[]) {
  const lines = [
    { id: "g", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", content: "ок" } }] },
    { id: "g", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Body);
    return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  });
}

const mark = { openrouter: { cacheControl: { type: "ephemeral" } } };

/** Конец прошлого хода (ответ после инструмента) и новый вопрос с меткой — как шаг 0 хода N+1. */
const promptEndingWithMarkedQuestion: LanguageModelV4Prompt = [
  { role: "system", content: "Инструкция", providerOptions: mark },
  { role: "user", content: [{ type: "text", text: "посмотри" }] },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "look", input: {} }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "look", output: { type: "text", value: "вижу" } }] },
  { role: "assistant", content: [{ type: "text", text: "Посмотрел." }] },
  { role: "user", content: [{ type: "text", text: "спасибо" }], providerOptions: mark },
];

async function bodyFor(providerModelId: string, prompt: LanguageModelV4Prompt): Promise<Body> {
  const bodies: Body[] = [];
  const model = createOpenRouterProvider().createLanguageModel(providerModelId, "test-key", { fetch: stubbedFetch(bodies) }) as LanguageModelV4;
  const { stream } = await model.doStream({ prompt });
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // дочитать
  }
  return bodies[0]!;
}

const marked = (body: Body) => body.messages.flatMap((message, index) => (JSON.stringify(message).includes("cache_control") ? [index] : []));

describe("OpenRouter: метка кэша у Gemini — не на самом конце запроса", () => {
  it("Gemini: метка с последнего сообщения переезжает на предпоследнее; инструкция с меткой как была", async () => {
    const body = await bodyFor("google/gemini-3.8-flash", promptEndingWithMarkedQuestion);
    expect(marked(body)).toEqual([0, 4]);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "спасибо" });
  });

  it("Gemini: перед последним сообщением только инструкция — метка с конца снимается, инструкция с меткой", async () => {
    const body = await bodyFor("google/gemini-3.8-flash", [promptEndingWithMarkedQuestion[0]!, promptEndingWithMarkedQuestion[5]!]);
    expect(marked(body)).toEqual([0]);
  });

  it("Gemini: последнее сообщение без метки (после метки хвост) — запрос не меняется", async () => {
    const withTail: LanguageModelV4Prompt = [...promptEndingWithMarkedQuestion, { role: "user", content: [{ type: "text", text: "Снимок шага" }] }];
    const body = await bodyFor("google/gemini-3.8-flash", withTail);
    expect(marked(body)).toEqual([0, 5]);
  });

  it("Claude: метка на конце запроса остаётся", async () => {
    const body = await bodyFor("anthropic/claude-sonnet-5.5", promptEndingWithMarkedQuestion);
    expect(marked(body)).toEqual([0, 5]);
  });
});
