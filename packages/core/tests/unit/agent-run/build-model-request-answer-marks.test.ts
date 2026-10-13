import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { LENGTH_CUT_NOTE, LENGTH_CUT_PART_TYPE } from "../../../src/agent-run/length-cut";
import { UNANSWERED_NOTE } from "../../../src/agent-run/unanswered-messages";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "../support/mock-model";

type Part = AgentChatMessage["parts"][number];

const texts = (message: ModelMessage): string[] =>
  typeof message.content === "string" ? [message.content] : message.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));

const historyWith = (answer: Part[]): AgentChatMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Расскажи" }] },
  { id: "a1", role: "assistant", parts: answer },
  { id: "u2", role: "user", parts: [{ type: "text", text: "Дальше?" }] },
];

function build(history: readonly AgentChatMessage[]) {
  return buildModelRequest({
    catalog: mockCatalog({ mock: mockModel(() => streamOf(reasoningAndTextParts(["ок"]))) }),
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions: "Ты помощник.",
    history,
    env: mockEnv,
  });
}

describe("buildModelRequest: ответ из одних рассуждений в запрос не идёт (FR-055)", () => {
  it("«Стоп» на рассуждении: ответа модели в запросе нет, вопросы — отдельными сообщениями, между ними пометка «ответа не было»", async () => {
    const request = await build(historyWith([{ type: "step-start" }, { type: "reasoning", text: "думаю", state: "done" }]));
    // Строгие провайдеры не принимают два сообщения человека подряд, а слитые в одно вопросы модель читает как один.
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(texts(request.messages[0]!)).toEqual(["Расскажи"]);
    expect(request.messages[1]!.content).toEqual([{ type: "text", text: UNANSWERED_NOTE }]);
    expect(texts(request.messages[2]!)).toEqual(["Дальше?"]);
  });

  it("пустой текст — тоже не содержание", async () => {
    const request = await build(
      historyWith([{ type: "reasoning", text: "думаю", state: "done" }, { type: "text", text: "  \n", state: "done" }]),
    );
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(request.messages[1]!.content).toEqual([{ type: "text", text: UNANSWERED_NOTE }]);
  });

  it("кэш: вопрос без ответа и пометка на следующем ходе — те же байты", async () => {
    const stopped: Part[] = [{ type: "reasoning", text: "думаю", state: "done" }];
    const first = await build(historyWith(stopped));
    const next = await build([
      ...historyWith(stopped),
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Вот дальше", state: "done" }] },
      { id: "u3", role: "user", parts: [{ type: "text", text: "Спасибо" }] },
    ]);
    expect(next.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(JSON.stringify(next.messages.slice(0, 2))).toBe(JSON.stringify(first.messages.slice(0, 2)));
  });

  it("человек сразу после человека (ответ не записан вовсе) — пометка между каждой парой", async () => {
    const request = await build([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Раз" }] },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Два" }] },
      { id: "u3", role: "user", parts: [{ type: "text", text: "Три" }] },
    ]);
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
    expect(request.messages.filter((message) => message.role === "user").map((message) => texts(message)[0])).toEqual(["Раз", "Два", "Три"]);
  });

  it("рассуждение и текст — ответ идёт как раньше", async () => {
    const request = await build(
      historyWith([{ type: "reasoning", text: "думаю", state: "done" }, { type: "text", text: "Вот", state: "done" }]),
    );
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
  });

  it("рассуждение и вызов инструмента — ответ идёт", async () => {
    const call = { type: "tool-lookup", toolCallId: "c1", state: "output-available", input: {}, output: "нашёл" } as unknown as Part;
    const request = await build(historyWith([{ type: "reasoning", text: "думаю", state: "done" }, call]));
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "user"]);
  });
});

describe("buildModelRequest: пометка обрыва по длине (FR-054)", () => {
  it("часть-отметка становится постоянным текстом в конце ответа модели", async () => {
    const request = await build(
      historyWith([{ type: "text", text: "Первая половина", state: "done" }, { type: LENGTH_CUT_PART_TYPE, data: true } as Part]),
    );
    const assistant = request.messages[1]!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.content).toEqual([
      { type: "text", text: "Первая половина" },
      { type: "text", text: LENGTH_CUT_NOTE },
    ]);
  });

  it("другие части-данные (отметка голосового режима) в запрос по-прежнему не идут", async () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }, { type: "data-voice-mode", data: true } as Part] },
    ];
    const request = await build(history);
    expect(request.messages[0]!.content).toEqual([{ type: "text", text: "Привет" }]);
  });
});
