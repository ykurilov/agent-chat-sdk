import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { jsonSchema, streamText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { HANGING_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import { mockCatalog, mockEnv, mockModel, mockModelId, reasoningAndTextParts, streamOf } from "../support/mock-model";

type Part = AgentChatMessage["parts"][number];

const tools = {
  lookup: tool({
    description: "Ищет по базе",
    inputSchema: jsonSchema<{ query: string }>({ type: "object", properties: { query: { type: "string" } } }),
    execute: async () => "нет данных",
  }),
};

const call = (id: string, fields: Record<string, unknown>): Part =>
  ({ type: "tool-lookup", toolCallId: id, input: { query: id }, ...fields }) as unknown as Part;

/** Вопрос, ответ ассистента с частями `answer`, новый вопрос. */
const historyWith = (answer: Part[]): AgentChatMessage[] => [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Найди" }] },
  { id: "a1", role: "assistant", parts: answer },
  { id: "u2", role: "user", parts: [{ type: "text", text: "Ну что?" }] },
];

function build(history: readonly AgentChatMessage[], model = mockModel(() => streamOf(reasoningAndTextParts(["ок"])))) {
  return buildModelRequest({
    catalog: mockCatalog({ mock: model }),
    modelId: mockModelId,
    providerId: "mock",
    chatId: "chat-1",
    instructions: "Ты помощник.",
    tools,
    history,
    env: mockEnv,
  });
}

/** Запрос, дошедший до модели; ошибка проверки запроса в `streamText` — исключением. */
async function sentToModel(history: readonly AgentChatMessage[]): Promise<LanguageModelV4CallOptions> {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["ок"])));
  const request = await build(history, model);
  let failure: unknown;
  await streamText({ ...request, onError: ({ error }) => void (failure = error) }).consumeStream();
  if (failure) throw failure;
  const sent = model.doStreamCalls[0];
  if (!sent) throw new Error("модель не вызвана");
  return sent;
}

const toolResults = (sent: LanguageModelV4CallOptions) =>
  sent.prompt.flatMap((message) => (message.role === "tool" ? message.content : []));

describe("buildModelRequest: висящие вызовы", () => {
  it("вызов в input-available закрыт ошибкой с постоянным текстом, модель вызвана", async () => {
    const sent = await sentToModel(historyWith([call("call-1", { state: "input-available" })]));
    expect(toolResults(sent)).toEqual([
      expect.objectContaining({
        type: "tool-result",
        toolCallId: "call-1",
        output: { type: "error-text", value: HANGING_TOOL_CALL_REASON },
      }),
    ]);
  });

  it("промежуточный результат без окончательного закрыт так же: модель видит, что вызов мог выполниться частично, и сам вывод", async () => {
    const sent = await sentToModel(
      historyWith([call("call-1", { state: "output-available", output: "половина", preliminary: true })]),
    );
    expect(toolResults(sent)).toEqual([
      expect.objectContaining({
        toolCallId: "call-1",
        output: { type: "error-text", value: `${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: половина` },
      }),
    ]);
  });

  it("законченный вызов рядом с висящим не тронут", async () => {
    const sent = await sentToModel(
      historyWith([
        call("call-1", { state: "output-available", output: "нашлось" }),
        call("call-2", { state: "input-available" }),
      ]),
    );
    expect(toolResults(sent)).toEqual([
      expect.objectContaining({ toolCallId: "call-1", output: { type: "text", value: "нашлось" } }),
      expect.objectContaining({ toolCallId: "call-2", output: { type: "error-text", value: HANGING_TOOL_CALL_REASON } }),
    ]);
  });

  it("два построения из той же истории побайтно равны; история не меняется", async () => {
    const history = historyWith([call("call-1", { state: "input-available" })]);
    const before = structuredClone(history);
    const first = await build(history);
    const second = await build(history);
    const { model: _first, ...firstRequest } = first;
    const { model: _second, ...secondRequest } = second;
    expect(JSON.stringify(secondRequest)).toBe(JSON.stringify(firstRequest));
    expect(history).toEqual(before);
  });

  it("вызовы с подтверждением не тронуты: ни запрос, ни отказ не становятся висящими", async () => {
    const denied = call("call-1", {
      state: "output-denied",
      approval: { id: "ap-1", approved: false, reason: "нельзя" },
    });
    const sent = await sentToModel(historyWith([denied]));
    expect(JSON.stringify(sent.prompt)).not.toContain(HANGING_TOOL_CALL_REASON);
    expect(JSON.stringify(sent.prompt)).toContain("нельзя");

    const waiting = historyWith([call("call-2", { state: "approval-requested", approval: { id: "ap-2" } })]);
    const request = await build(waiting);
    expect(JSON.stringify(request.messages)).not.toContain(HANGING_TOOL_CALL_REASON);
  });
});

describe("buildModelRequest: половинки эмодзи", () => {
  const half = "\ud83d";
  const whole = "😀";

  it("непарные половинки в тексте, рассуждениях и результатах инструментов вырезаны, целые эмодзи на месте", async () => {
    const history: AgentChatMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: `вопрос ${whole}${half}` }] },
      {
        id: "a1",
        role: "assistant",
        metadata: { modelId: mockModelId, providerId: "mock" },
        parts: [
          { type: "reasoning", text: `думаю ${half}${whole}` },
          call("call-1", { state: "output-available", output: { found: `запись \udc00${whole}` } }),
          call("call-2", { state: "output-error", errorText: `сбой ${whole}${half}` }),
          { type: "text", text: `ответ ${whole}\ude00` },
        ],
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "ещё" }] },
    ];
    const request = await build(history);
    const sent = JSON.stringify(request.messages);
    expect(sent).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    expect(sent).toContain(`вопрос ${whole}`);
    expect(sent).toContain(`думаю ${whole}`);
    expect(sent).toContain(`запись ${whole}`);
    expect(sent).toContain(`сбой ${whole}`);
    expect(sent).toContain(`ответ ${whole}`);
  });

  it("история без половинок даёт тот же запрос, что и раньше: части не пересобираются", async () => {
    const history = historyWith([call("call-1", { state: "output-available", output: `ок ${whole}` })]);
    const first = await build(history);
    const second = await build(history);
    expect(JSON.stringify(second.messages)).toBe(JSON.stringify(first.messages));
    expect(JSON.stringify(first.messages)).toContain(`ок ${whole}`);
  });
});
