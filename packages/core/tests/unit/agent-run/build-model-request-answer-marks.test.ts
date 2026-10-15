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

describe("buildModelRequest: реплика сотрудника после вопроса без ответа агента", () => {
  const staff = (id: string, text: string): AgentChatMessage => ({
    id,
    role: "user",
    parts: [{ type: "data-agent-notice", data: { notices: [{ kind: "staff", title: text, staffName: "Ольга" }], deliveryKey: id, wakeAgent: false } } as Part],
  });
  const question: AgentChatMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Где запись эфира?" }] };

  it("хода не было — пометки «ход оборвался» нет: реплика сотрудника идёт за вопросом в том же сообщении, через пустую строку", async () => {
    const request = await build([question, staff("s1", "Вот запись")]);
    expect(JSON.stringify(request.messages)).not.toContain(UNANSWERED_NOTE);
    expect(request.messages.map((message) => message.role)).toEqual(["user"]);
    const [first, second] = texts(request.messages[0]!);
    expect(first).toBe("Где запись эфира?");
    expect(second).toMatch(/^\n\nЖивой сотрудник «Ольга» ответил человеку вместо тебя: «Вот запись»/);
  });

  it("две реплики сотрудника подряд — тоже без пометки", async () => {
    const request = await build([question, staff("s1", "Сейчас найду"), staff("s2", "Вот запись")]);
    expect(JSON.stringify(request.messages)).not.toContain(UNANSWERED_NOTE);
    expect(request.messages.map((message) => message.role)).toEqual(["user"]);
  });

  it("человек отвечает после реплики сотрудника — без пометки: его слова идут в том же сообщении", async () => {
    const thanks: AgentChatMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Спасибо" }] };
    const request = await build([question, staff("s1", "Вот запись"), thanks]);
    expect(JSON.stringify(request.messages)).not.toContain(UNANSWERED_NOTE);
    expect(request.messages.map((message) => message.role)).toEqual(["user"]);
    expect(texts(request.messages[0]!).at(-1)).toBe("\n\nСпасибо");
  });

  it("после ответа агента: реплика сотрудника и следующий вопрос — одно сообщение, без пометки", async () => {
    const answer: AgentChatMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Ищу", state: "done" }] };
    const thanks: AgentChatMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Спасибо" }] };
    const request = await build([question, answer, staff("s1", "Вот запись"), thanks]);
    expect(JSON.stringify(request.messages)).not.toContain(UNANSWERED_NOTE);
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(texts(request.messages[2]!)[0]).toMatch(/^Живой сотрудник/);
  });

  it("кэш: следующие ход и вопрос не меняют уже отправленное начало запроса", async () => {
    const thanks: AgentChatMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Спасибо" }] };
    const first = await build([question, staff("s1", "Вот запись"), thanks]);
    const next = await build([
      question,
      staff("s1", "Вот запись"),
      thanks,
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Пожалуйста", state: "done" }] },
      { id: "u3", role: "user", parts: [{ type: "text", text: "Пока" }] },
    ]);
    expect(next.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(next.messages[0])).toBe(JSON.stringify(first.messages[0]));
  });

  it("кэш: следующее сообщение человека после реплики сотрудника только дописывает части — отправленные не меняются", async () => {
    const before = await build([question, staff("s1", "Вот запись")]);
    const after = await build([question, staff("s1", "Вот запись"), { id: "u2", role: "user", parts: [{ type: "text", text: "Спасибо" }] }]);
    expect(before.messages).toHaveLength(1);
    expect(after.messages).toHaveLength(1);
    const sent = before.messages[0]!.content as unknown[];
    expect(JSON.stringify((after.messages[0]!.content as unknown[]).slice(0, sent.length))).toBe(JSON.stringify(sent));
    expect(texts(after.messages[0]!).at(-1)).toContain("Спасибо");
  });

  it("склеивается только соседний вопрос: следующий вопрос без ответа агента — снова с пометкой", async () => {
    const request = await build([
      question,
      staff("s1", "Вот запись"),
      { id: "u2", role: "user", parts: [{ type: "text", text: "Спасибо" }] },
      { id: "u3", role: "user", parts: [{ type: "text", text: "Алло?" }] },
    ]);
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(request.messages[1]!.content).toEqual([{ type: "text", text: UNANSWERED_NOTE }]);
  });

  it("вопрос без ответа после сбоя (без сотрудника) — пометка остаётся", async () => {
    const request = await build([question, { id: "u2", role: "user", parts: [{ type: "text", text: "Алло?" }] }]);
    expect(request.messages[1]!.content).toEqual([{ type: "text", text: UNANSWERED_NOTE }]);
  });

  it("реплика сотрудника после ответа агента — отдельным сообщением, как раньше", async () => {
    const request = await build([question, { id: "a1", role: "assistant", parts: [{ type: "text", text: "Ищу", state: "done" }] }, staff("s1", "Вот запись")]);
    expect(request.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(texts(request.messages[2]!)[0]).toMatch(/^Живой сотрудник/);
  });
});
