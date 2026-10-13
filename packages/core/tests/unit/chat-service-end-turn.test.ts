import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, tool } from "ai";
import type { ToolSet, UIMessageChunk } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { endTurn } from "../../src/index";
import type { AfterTurnHandler, TurnObserver, TurnResult } from "../../src/index";
import { END_TURN_PART_TYPE, TOOL_ENDED_NOTE } from "../../src/agent-run/end-turn";
import { MockLanguageModelV4 } from "ai/test";
import { finishPart, mockCatalog, mockUsage, readAll, streamOf, streamStart } from "./support/mock-model";
import { noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

const calls = (...items: Array<{ name: string; id: string }>): LanguageModelV4StreamPart[] => [
  streamStart,
  ...items.map(({ name, id }): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: name, input: "{}" })),
  finishPart("tool-calls"),
];

const plain = (output: unknown) => tool({ description: "Обычный", inputSchema: z.object({}), execute: async () => output });
const finishing = (output: unknown, text?: string, extra: { needsApproval?: boolean; delayMs?: number } = {}) =>
  tool({
    description: "Последний шаг формы",
    inputSchema: z.object({}),
    ...(extra.needsApproval && { needsApproval: true }),
    execute: async () => {
      if (extra.delayMs) await new Promise((resolve) => setTimeout(resolve, extra.delayMs));
      return endTurn(output, text === undefined ? undefined : { text });
    },
  });

function setup(tools: ToolSet, scripts: LanguageModelV4StreamPart[][], extra: Parameters<typeof noticeService>[1] = {}) {
  const model = scriptedModel(scripts);
  const results: TurnResult[] = [];
  const afterTurn: AfterTurnHandler = (result) => void results.push(result);
  const { service, storage } = noticeService(model, { afterTurn, ...extra, agent: { tools, ...extra.agent } });
  return { model, service, storage, results };
}

const bytes = (prompt: readonly unknown[]) => prompt.map((message) => JSON.stringify(message));
const busy = () =>
  new APICallError({ message: "503", url: "https://p.test", requestBodyValues: {}, statusCode: 503, responseHeaders: { "retry-after-ms": "1" } });

const textOf = (chunks: UIMessageChunk[]) => chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join("");

describe("endTurn: ход кончается сразу после инструмента", () => {
  it("с готовым текстом: модель больше не спрашивается, текст — в потоке и в записи, результат инструмента — как есть", async () => {
    const { model, service, storage, results } = setup({ submit: finishing({ saved: true }, "Заявка принята.") }, [calls({ name: "submit", id: "c1" })]);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(textOf(chunks)).toBe("Заявка принята.");
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-submit")).toMatchObject({ state: "output-available", output: { saved: true } });
    const textParts = answer.parts.filter((part) => part.type === "text");
    expect(textParts).toEqual([expect.objectContaining({ type: "text", text: "Заявка принята." })]);
    // Текст — после результата инструмента, отдельным шагом.
    const types = answer.parts.map((part) => part.type);
    expect(types.lastIndexOf("step-start")).toBeGreaterThan(types.indexOf("tool-submit"));
    expect(results[0]).toMatchObject({ status: "complete", text: "Заявка принята.", trigger: "send" });
  });

  it("расход: только настоящий шаг модели; наблюдатель видит один вызов модели", async () => {
    const modelCall = vi.fn();
    const observer: TurnObserver = { modelCall, toolCall: () => {} };
    const { service, results } = setup({ submit: finishing("ok", "Готово.") }, [calls({ name: "submit", id: "c1" })], { turnObserver: observer });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(results[0]!.usage).toMatchObject({ inputTokens: mockUsage.inputTokens.total, outputTokens: mockUsage.outputTokens.total });
    expect(results[0]!.usage).not.toHaveProperty("estimated");
    expect(modelCall).toHaveBeenCalledTimes(1);
  });

  it("без текста: ответ — только вызов; следующий ход видит результат инструмента как обычно", async () => {
    const { model, service, storage, results } = setup({ submit: finishing({ saved: true }) }, [calls({ name: "submit", id: "c1" }), saying("Слушаю")]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(model.doStreamCalls).toHaveLength(1);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.some((part) => part.type === "text")).toBe(false);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "А дальше?")));
    const prompt = model.doStreamCalls[1]!.prompt;
    const toolIndex = prompt.findIndex((message) => message.role === "tool");
    expect(JSON.stringify(prompt[toolIndex])).toContain('"saved":true');
    expect(JSON.stringify(prompt)).not.toContain("endTurn");
    // Строгие провайдеры не принимают «результат → вопрос»: между ними постоянная пометка ответа, не из хранилища.
    expect(prompt[toolIndex + 1]).toEqual({ role: "assistant", content: [{ type: "text", text: TOOL_ENDED_NOTE }] });
    expect(prompt[toolIndex + 2]!.role).toBe("user");
    // В записи — служебная отметка, не текст пометки; клиенту и в итог хода не идёт.
    expect(JSON.stringify(await storage.listMessages(chat.id))).not.toContain(TOOL_ENDED_NOTE);
    expect(answer.parts.at(-1)).toMatchObject({ type: END_TURN_PART_TYPE });
    expect(JSON.stringify((await service.getHistory("anna", chat.id)).messages)).not.toContain(END_TURN_PART_TYPE);
    expect(JSON.stringify(results[0]!.parts)).not.toContain(END_TURN_PART_TYPE);
    // Те же байты на следующем ходе: начало запроса не меняется.
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "Ещё")));
    expect(bytes(model.doStreamCalls[2]!.prompt).slice(0, prompt.length)).toEqual(bytes(prompt));
  });

  it("несколько инструментов в шаге: доделываются все, тексты — по порядку вызовов", async () => {
    const other = vi.fn(async () => "справка");
    const { model, service, storage } = setup(
      {
        first: finishing("1", "Первое.", { delayMs: 20 }),
        lookup: tool({ description: "Справка", inputSchema: z.object({}), execute: other }),
        second: finishing("2", "Второе."),
      },
      [calls({ name: "first", id: "c1" }, { name: "lookup", id: "c2" }, { name: "second", id: "c3" })],
    );
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(other).toHaveBeenCalledTimes(1);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual(["Первое.\n\nВторое."]);
  });

  it("подтверждение: одобренный инструмент кончает ход — модель после него не спрашивается, текст на месте", async () => {
    const { model, service, storage } = setup({ submit: finishing("ok", "Отправлено.", { needsApproval: true }) }, [calls({ name: "submit", id: "c1" })]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    const waiting = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    const approvalId = (waiting.parts.find((part) => part.type === "tool-submit") as { approval: { id: string } }).approval.id;
    await service.answerApproval("anna", chat.id, approvalId, "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(model.doStreamCalls).toHaveLength(1);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-submit")).toMatchObject({ state: "output-available", output: "ok" });
    expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual(["Отправлено."]);
  });

  it("последний разрешённый шаг: готовый текст всё равно доходит", async () => {
    const { model, service, storage } = setup({ submit: finishing("ok", "Готово.") }, [calls({ name: "submit", id: "c1" })], { agent: { maxSteps: 1 } });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(model.doStreamCalls).toHaveLength(1);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual(["Готово."]);
  });

  it("обычный инструмент — как раньше: модель делает следующий шаг", async () => {
    const { model, service } = setup({ lookup: plain("справка") }, [calls({ name: "lookup", id: "c1" })]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Найди")));
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("одобрение без текста: модель не спрашивается, ответ закончен, следующий ход идёт как обычно", async () => {
    const { model, service, storage } = setup({ submit: finishing("ok", undefined, { needsApproval: true }) }, [calls({ name: "submit", id: "c1" })]);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    const waiting = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    const approvalId = (waiting.parts.find((part) => part.type === "tool-submit") as { approval: { id: string } }).approval.id;
    await service.answerApproval("anna", chat.id, approvalId, "allow");
    await readAll((await service.subscribe("anna", chat.id))!);
    expect(model.doStreamCalls).toHaveLength(1);
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-submit")).toMatchObject({ state: "output-available", output: "ok" });
    expect(answer.parts.some((part) => part.type === "text")).toBe(false);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Дальше")));
    const prompt = model.doStreamCalls[1]!.prompt;
    expect(prompt.filter((message) => message.role === "assistant").every((message) => message.content.length > 0)).toBe(true);
    expect(prompt.slice(-3).map((message) => message.role)).toEqual(["tool", "assistant", "user"]);
    expect(prompt.at(-2)).toEqual({ role: "assistant", content: [{ type: "text", text: TOOL_ENDED_NOTE }] });
  });

  it("смешанный шаг: другой инструмент ждёт подтверждения — потерянный готовый текст пишется в журнал", async () => {
    const logError = vi.fn();
    const removing = tool({ description: "Удалить", inputSchema: z.object({}), needsApproval: true, execute: async () => "удалено" });
    const { model, service } = setup({ submit: finishing("ok", "Готово."), remove: removing }, [calls({ name: "submit", id: "c1" }, { name: "remove", id: "c2" })], {
      logError,
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь и удали")));
    expect(model.doStreamCalls).toHaveLength(1);
    expect(logError).toHaveBeenCalledWith(expect.stringMatching(/\[endTurn\].*готовый текст не показан/));
  });

  it("сбой связи посреди шага с вызовом: инструмент не выполнялся, метки нет — ответ дописывает модель, текст один", async () => {
    // Поток шага падает после вызова: инструменты шага запускаются только после конца потока, до них дело не доходит.
    let primaryCalls = 0;
    const primary = new MockLanguageModelV4({
      doStream: async () => ({
        stream:
          primaryCalls++ > 0
            ? streamOf(saying("Продолжаю."))
            : new ReadableStream<LanguageModelV4StreamPart>({
                async start(controller) {
                  for (const part of calls({ name: "submit", id: "c1" }).slice(0, 2)) controller.enqueue(part);
                  await new Promise((resolve) => setTimeout(resolve, 20));
                  controller.enqueue({ type: "error", error: busy() });
                  controller.close();
                },
              }),
      }),
    });
    const submitted = vi.fn(async () => endTurn({ saved: true }, { text: "Заявка принята." }));
    const { service, storage } = setup({ submit: tool({ description: "Отправить", inputSchema: z.object({}), execute: submitted }) }, [], {
      catalog: mockCatalog({ mock: primary, "mock-backup": scriptedModel([]) }),
    });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(submitted).not.toHaveBeenCalled();
    expect(textOf(chunks)).toBe("Продолжаю.");
    const answer = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;
    expect(answer.status).toBe("complete");
    expect(answer.parts.find((part) => part.type === "tool-submit")).toMatchObject({ state: "output-error" });
  });

  it("toolDetails: false, инструмент без showOnScreen: вызов скрыт, готовый текст клиент видит", async () => {
    const { service } = setup({ submit: finishing({ saved: true }, "Заявка принята.") }, [calls({ name: "submit", id: "c1" })], {
      chatCapabilities: () => ({ toolDetails: false }),
    });
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь")));
    expect(JSON.stringify(chunks)).not.toContain('"c1"');
    expect(textOf(chunks)).toBe("Заявка принята.");
    const shown = (await service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(shown.parts.filter((part) => part.type === "text").map((part) => (part as { text: string }).text)).toEqual(["Заявка принята."]);
  });

  describe("застывающий контекст", () => {
    afterEach(() => vi.useRealTimers());

    it("ответ с готовым текстом: следующий ход начинается побайтно с запроса шага, вызвавшего инструмент", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 0, 1, 12));
      const { model, service } = setup({ submit: finishing({ saved: true }, "Заявка принята.") }, [calls({ name: "submit", id: "c1" })]);
      const chat = await service.createChat("anna");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Отправь"), { page: { place: { description: "Форма заявки" } } }));
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Спасибо"), { page: { place: { description: "Форма заявки" } } }));
      const [first, second] = model.doStreamCalls.map((call) => call.prompt);
      expect(bytes(second!).slice(0, first!.length)).toEqual(bytes(first!));
      // Дальше — вызов, результат и готовый текст как ответ модели, затем вопрос без приписок.
      expect(second!.slice(first!.length).map((message) => message.role)).toEqual(["assistant", "tool", "assistant", "user"]);
      expect(JSON.stringify(second!.at(-2))).toContain("Заявка принята.");
      await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "Ещё"), { page: { place: { description: "Форма заявки" } } }));
      expect(bytes(model.doStreamCalls[2]!.prompt).slice(0, second!.length)).toEqual(bytes(second!));
    });
  });

  it("текст не строка — TypeError в самом вызове", () => {
    expect(() => endTurn("ok", { text: 5 as unknown as string })).toThrow(TypeError);
  });
});
