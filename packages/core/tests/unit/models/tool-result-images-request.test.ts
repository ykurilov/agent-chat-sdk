import { generateText } from "ai";
import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { createFireworksProvider } from "../../../src/models/providers/fireworks";
import { createTogetherProvider } from "../../../src/models/providers/together";

// Пакеты Together и Fireworks (совместимые с OpenAI) кладут ответ инструмента с картинкой строкой JSON: модель видит
// буквы base64 вместо картинки и думает без конца (живой ход 2026-10-15). Сами провайдеры картинку в ответе инструмента
// видят, если она частью `image_url` (живой замер того же дня): запрос переписывается перед отправкой.

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const pngBase64 = Buffer.from(png).toString("base64");

function messages(imageData: Uint8Array | string): ModelMessage[] {
  return [
    { role: "user", content: "Покажи картинку" },
    { role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "show", input: {} }] },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "show",
          output: { type: "content", value: [{ type: "text", text: "Снимок:" }, { type: "file", data: { type: "data", data: imageData }, mediaType: "image/png" }] },
        },
      ],
    },
  ];
}

async function sentToolMessage(provider: ReturnType<typeof createTogetherProvider>, imageData: Uint8Array | string, output?: unknown) {
  let body: Record<string, any> = {};
  const fetch = (async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "r", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const prompt = messages(imageData);
  if (output) (prompt[2] as any).content[0].output = output;
  await generateText({ model: provider.createLanguageModel("m", "key", { fetch }), messages: prompt, maxRetries: 0 });
  return body.messages.find((message: { role: string }) => message.role === "tool");
}

describe.each([
  ["Together", createTogetherProvider],
  ["Fireworks", createFireworksProvider],
])("%s: картинка в ответе инструмента", (_name, create) => {
  it.each([
    ["байтами", png],
    ["строкой base64", pngBase64],
  ])("уходит частью image_url (данные %s), текст — частью text", async (_kind, data) => {
    const message = await sentToolMessage(create(), data);
    expect(message.content).toEqual([
      { type: "text", text: "Снимок:" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}` } },
    ]);
  });

  it("ответ без картинки — как раньше, строкой", async () => {
    const message = await sentToolMessage(create(), png, { type: "content", value: [{ type: "text", text: "только текст" }] });
    expect(message.content).toBe(JSON.stringify([{ type: "text", text: "только текст" }]));
  });

  it("обычный текст и JSON инструмента не трогаются", async () => {
    expect((await sentToolMessage(create(), png, { type: "text", value: '[{"type":"file"}]' })).content).toBe('[{"type":"file"}]');
    expect((await sentToolMessage(create(), png, { type: "json", value: { a: 1 } })).content).toBe('{"a":1}');
  });
});
