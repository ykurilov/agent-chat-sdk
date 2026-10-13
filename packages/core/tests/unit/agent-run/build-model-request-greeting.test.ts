import { streamText } from "ai";
import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { GREETING_LEAD } from "../../../src/agent-run/greeting-lead";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { GREETING_LEAD as exportedLead } from "../../../src/index";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "../support/mock-model";

async function promptFor(history: AgentChatMessage[]) {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["ок"])));
  const request = await buildModelRequest({
    catalog: mockCatalog({ mock: model }),
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions: "Ты помощник.",
    history,
    env: mockEnv,
  });
  await streamText(request).consumeStream();
  return model.doStreamCalls[0]!.prompt;
}

const greeting: AgentChatMessage = { id: "g", role: "assistant", parts: [{ type: "text", text: "Здравствуйте!" }] };
const question: AgentChatMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };

describe("запрос к модели: чат начат агентом", () => {
  it("служебная строка — постоянная, без дат и подстановок, есть в публичных именах", () => {
    expect(GREETING_LEAD).toBe(exportedLead);
    expect(GREETING_LEAD).not.toMatch(/\d/);
    expect(GREETING_LEAD.length).toBeGreaterThan(0);
  });

  it("история начинается с ответа агента — перед ним сообщение человека со служебной строкой", async () => {
    const prompt = await promptFor([greeting, question]);
    expect(prompt.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(prompt[1]).toEqual({ role: "user", content: [{ type: "text", text: GREETING_LEAD }] });
  });

  it("история с сообщения человека — запрос побайтно прежний, строки нет", async () => {
    const plain = await promptFor([question, { ...greeting, id: "a1" }, { ...question, id: "u2" }]);
    expect(JSON.stringify(plain)).not.toContain(GREETING_LEAD);
    expect(plain.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(plain[1]).toMatchObject({ role: "user", content: [{ type: "text", text: "Привет" }] });
  });

  it("картинка в ответе агента — модели текст «[картинка: имя]»; у человека остаётся вложением", async () => {
    const prompt = await promptFor([
      {
        id: "a0",
        role: "assistant",
        parts: [
          { type: "text", text: "Вот схема" },
          { type: "file", url: "attachment:1", mediaType: "image/png", filename: "схема.png" },
        ],
      },
      question,
    ]);
    expect(prompt[2]).toMatchObject({
      role: "assistant",
      content: [
        { type: "text", text: "Вот схема" },
        { type: "text", text: "[картинка: схема.png]" },
      ],
    });
  });

  it("картинка без имени — «[картинка]»", async () => {
    const prompt = await promptFor([
      question,
      { id: "a0", role: "assistant", parts: [{ type: "file", url: "attachment:1", mediaType: "image/png" }] },
      { ...question, id: "u2" },
    ]);
    expect(prompt[2]).toMatchObject({ role: "assistant", content: [{ type: "text", text: "[картинка]" }] });
  });
});
