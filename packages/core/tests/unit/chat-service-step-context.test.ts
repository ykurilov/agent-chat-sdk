import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import type { StepContextInput } from "../../src/agent-run/step-context";
import { createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { standardCatalog } from "../../src/models/standard-catalog";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

const scripts: LanguageModelV4StreamPart[][] = [
  [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "write", input: JSON.stringify({ value: "a@x.ru" }) }, finishPart("tool-calls")],
];

describe("agent.stepContext в службе", () => {
  it("доходит до хода: снимок со состоянием ветки и данными чата в конце каждого запроса", async () => {
    let next = 0;
    const model = mockModel(() => streamOf(scripts[next++] ?? [streamStart, ...textParts(["Готово"]), finishPart()]));
    const seen: StepContextInput[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        tools: (toolsModel: AgentToolsModel) => ({
          write: tool({
            description: "Записать почту",
            inputSchema: z.object({ value: z.string() }),
            execute: async ({ value }) => {
              toolsModel.state!.set("fields.email", value);
              return "записано";
            },
          }),
        }),
        stepContext: (input) => {
          seen.push(input);
          return `Служебный снимок: ${JSON.stringify(input.state)}`;
        },
      },
      env: mockEnv,
    });
    const chat = await service.createChat("anna", { data: { formId: "f1" } });
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "почта a@x.ru" }] }));

    const prompts = model.doStreamCalls.map((call) => JSON.stringify(call.prompt.at(-1)));
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Служебный снимок: {}");
    expect(prompts[1]).toContain('Служебный снимок: {\\"fields\\":{\\"email\\":\\"a@x.ru\\"}}');
    expect(seen.map((input) => [input.stepNumber, input.chat])).toEqual([
      [0, { data: { formId: "f1" } }],
      [1, { data: { formId: "f1" } }],
    ]);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(JSON.stringify(messages)).not.toContain("Служебный снимок");
  });
});

describe("agent.stepContext в службе: подтверждение и срок", () => {
  it("продолжение после подтверждения: номер шага идёт по всему ходу, а не с нуля", async () => {
    const calls: LanguageModelV4StreamPart[][] = [
      [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "remove", input: JSON.stringify({ path: "a" }) }, finishPart("tool-calls")],
      [streamStart, { type: "tool-call", toolCallId: "c2", toolName: "remove", input: JSON.stringify({ path: "b" }) }, finishPart("tool-calls")],
    ];
    const model = mockModel(() => streamOf(calls.shift() ?? [streamStart, ...textParts(["Готово"]), finishPart()]));
    const seen: number[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: {
        instructions: "Ты помощник.",
        tools: {
          remove: tool({
            description: "Удалить",
            inputSchema: z.object({ path: z.string() }),
            needsApproval: ({ path }) => path === "b",
            execute: async ({ path }) => `удалено ${path}`,
          }),
        },
        stepContext: ({ stepNumber }) => {
          seen.push(stepNumber);
          return `Снимок шага ${stepNumber}`;
        },
      },
      env: mockEnv,
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "удали a и b" }] }));
    expect(seen).toEqual([0, 1]);
    const { messages } = await service.getHistory("anna", chat.id);
    const part = messages.at(-1)!.parts.find((p) => p.type === "tool-remove" && (p as { approval?: unknown }).approval) as { approval: { id: string } };
    await service.answerApproval("anna", chat.id, part.approval.id, "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    // До паузы были шаги 0 и 1: продолжение начинается с шага 2.
    expect(seen).toEqual([0, 1, 2]);
    expect(JSON.stringify(model.doStreamCalls.at(-1)!.prompt)).toContain("Снимок шага 2");
  });

  it("agent.stepContextTimeoutMs: неверный срок — ошибка при создании службы; 0 и Infinity — без срока", () => {
    const build = (stepContextTimeoutMs: number) =>
      createChatService({
        storage: createInMemoryChatStorage(),
        catalog: mockCatalog({ mock: mockModel(() => streamOf([])) }),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: { instructions: "Ты помощник.", stepContext: () => null, stepContextTimeoutMs },
        env: mockEnv,
      });
    expect(() => build(500)).toThrow(/agent\.stepContextTimeoutMs/);
    expect(() => build(-1)).toThrow(/agent\.stepContextTimeoutMs/);
    expect(() => build(0)).not.toThrow();
    expect(() => build(Number.POSITIVE_INFINITY)).not.toThrow();
    expect(() => build(2_000)).not.toThrow();
  });

  it("agent.stepContextTimeoutMs доходит до хода: зависшая функция не держит ход", async () => {
    const model = mockModel(() => streamOf([streamStart, ...textParts(["Готово"]), finishPart()]));
    const logged: string[] = [];
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", stepContext: () => new Promise<string>(() => {}), stepContextTimeoutMs: 1_000 },
      env: mockEnv,
      logError: (line) => void logged.push(String(line)),
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "привет" }] }));
    expect(logged).toContain(`[снимок шага] чат=${chat.id} шаг=0 не ответил за 1000 мс`);
    expect((await service.getHistory("anna", chat.id)).messages.at(-1)!.metadata?.status).toBe("complete");
  });
});

/** Ответ OpenRouter потоком: вызов инструмента или текст. */
function openRouterStream(delta: Record<string, unknown>, finishReason: string): Response {
  const chunk = { id: "gen-1", object: "chat.completion.chunk", created: 1, model: "m", provider: "p" };
  const lines = [
    { ...chunk, choices: [{ index: 0, delta: { role: "assistant", ...delta } }] },
    { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map((piece) => `data: ${JSON.stringify(piece)}\n\n`);
  return new Response([...lines, "data: [DONE]\n\n"].join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("agent.stepContext на настоящем OpenRouter (сеть подменена)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cache_control — на последнем сообщении истории, снимок после него и без метки; второй шаг начинается с байтов первого", async () => {
    type Body = { messages: Array<{ role: string; content?: unknown }> };
    const bodies: Body[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        if (!String(url).endsWith("/chat/completions")) return new Response("{}", { status: 404 });
        bodies.push(JSON.parse(String(init?.body)) as Body);
        return bodies.length === 1
          ? openRouterStream({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "save_email", arguments: JSON.stringify({ email: "a@x.ru" }) } }] }, "tool_calls")
          : openRouterStream({ content: "Сохранил." }, "stop");
      }),
    );
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: standardCatalog,
      defaultChoice: { modelId: "gemini-3.8-flash", providerId: "openrouter" },
      agent: {
        instructions: "Ты помощник.",
        tools: (toolsModel: AgentToolsModel) => ({
          save_email: tool({
            description: "Сохранить почту",
            inputSchema: z.object({ email: z.string() }),
            execute: async ({ email }) => {
              toolsModel.state!.set("fields.email", email);
              return "сохранено";
            },
          }),
        }),
        stepContext: ({ state, stepNumber }) => `Снимок шага ${stepNumber}: ${JSON.stringify(state)}`,
      },
      env: { OPENROUTER_API_KEY: "test-key" },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "почта a@x.ru" }] }));

    expect(bodies).toHaveLength(2);
    for (const [step, body] of bodies.entries()) {
      const snapshot = body.messages.at(-1)!;
      expect(snapshot.role).toBe("user");
      expect(JSON.stringify(snapshot)).toContain(`Снимок шага ${step}`);
      expect(JSON.stringify(snapshot)).not.toContain("cache_control");
    }
    // Шаг 0: метка конца истории — на вопросе человека прямо перед снимком.
    const first = bodies[0]!.messages;
    expect(JSON.stringify(first.at(-2))).toContain("почта a@x.ru");
    expect(JSON.stringify(first.at(-2))).toContain("cache_control");
    // Шаг 1: всё, что ушло на шаге 0 до снимка, — те же байты в начале.
    const sent = first.slice(0, -1);
    expect(JSON.stringify(bodies[1]!.messages.slice(0, sent.length))).toBe(JSON.stringify(sent));
    expect(JSON.stringify(bodies[1]!.messages.at(-1))).toContain('Снимок шага 1: {\\"fields\\":{\\"email\\":\\"a@x.ru\\"}}');
  });
});
