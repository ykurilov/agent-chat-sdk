import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../src/agent-run/run-agent-turn";
import { createChatService } from "../../src/chat-service";
import type { ChatService } from "../../src/chat-service";
import type { ChatEvent } from "../../src/chat-events/chat-events";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { PrepareTurnContext } from "../../src/turn-hooks/prepare-turn";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

/*
 * Ход по поправке продолжает ответ, закрытый ради неё: приложение узнаёт это по `continuedAnswerIds` — в модели
 * инструментов, в `prepareTurn` и в событии `turn-started`. Так результаты инструментов закрытого ответа приложение
 * считает своими для нового хода (например, показывает модели картинку крупно, как в ходе просмотра).
 */

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const call = (name: string, id: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolCallId: id, toolName: name, input: "{}" });
const step = (...calls: LanguageModelV4StreamPart[]): LanguageModelV4StreamPart[] => [streamStart, ...calls, finishPart("tool-calls")];
const saying = (text: string): LanguageModelV4StreamPart[] => [streamStart, ...textParts([text]), finishPart()];

/**
 * Инструмент `look`: идёт, пока тест его не отпустит, и запоминает ход, в котором смотрел. Модели результат уходит
 * «крупно», если просмотр сделан в этом ходе или в ответе, который ход продолжает, иначе «мелко».
 */
function setup(scripts: LanguageModelV4StreamPart[][]) {
  const gates: Array<() => void> = [];
  const started: Array<() => void> = [];
  const lookStarted = (index: number) => new Promise<void>((resolve) => (started[index] = resolve));
  let looks = 0;
  const seenModels: AgentToolsModel[] = [];
  const contexts: PrepareTurnContext[] = [];
  const events: ChatEvent[] = [];
  let next = 0;
  const model = mockModel(() => streamOf(scripts[next++] ?? saying("Готово")));
  const tools = (toolsModel: AgentToolsModel) => {
    seenModels.push(toolsModel);
    const fresh = new Set([toolsModel.turnId, ...(toolsModel.continuedAnswerIds ?? [])]);
    return {
      look: tool({
        description: "Посмотреть работу",
        inputSchema: z.object({}),
        execute: async () => {
          const index = looks++;
          started[index]?.();
          await new Promise<void>((resolve) => (gates[index] = resolve));
          return { turnId: toolsModel.turnId };
        },
        toModelOutput: ({ output }) => ({ type: "text", value: fresh.has((output as { turnId?: string }).turnId) ? "крупно" : "мелко" }),
      }),
      confirm: tool({ description: "Подтвердить", inputSchema: z.object({}), needsApproval: true, execute: async () => "подтверждено" }),
    };
  };
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", tools, prepareTurn: (context) => void contexts.push(context) },
    env: mockEnv,
  });
  service.subscribeEvents((event) => events.push(event));
  const release = (index: number) => gates[index]?.();
  return { model, service, seenModels, contexts, events, release, lookStarted };
}

async function nextTurn(service: ChatService, chatId: string) {
  const stream = await service.subscribe("anna", chatId);
  expect(stream).not.toBeNull();
  return readAll(stream!);
}

const toolTexts = (prompt: unknown) => JSON.stringify(prompt).match(/крупно|мелко/g) ?? [];

describe("ход по поправке знает, какой ответ он продолжает", () => {
  it("модель инструментов, prepareTurn и turn-started: id закрытого ответа; у обычного хода поля нет", async () => {
    const t = setup([step(call("look", "c1"), call("look", "c2"))]);
    const chat = await t.service.createChat("anna");
    const lookedFirst = t.lookStarted(0);
    const first = readAll(await t.service.sendMessage("anna", chat.id, userMessage("u1", "посмотри обе")));
    await lookedFirst;
    await t.service.steer("anna", chat.id, userMessage("p1", "и сделай ярче"));
    t.release(0);
    t.release(1);
    await first;
    await nextTurn(t.service, chat.id);

    const { messages } = await t.service.getHistory("anna", chat.id);
    const closed = messages[1]!;
    const continuation = messages[3]!;
    expect(closed.role).toBe("assistant");
    expect(continuation.role).toBe("assistant");

    const firstModel = t.seenModels.find((seen) => seen.turnId === closed.id)!;
    const nextModel = t.seenModels.find((seen) => seen.turnId === continuation.id)!;
    expect(firstModel.continuedAnswerIds).toBeUndefined();
    expect(nextModel.continuedAnswerIds).toEqual([closed.id]);

    expect(t.contexts.map((context) => [context.messageId, context.continuedAnswerIds])).toEqual([
      [closed.id, undefined],
      [continuation.id, [closed.id]],
    ]);
    const started = t.events.filter((event): event is Extract<ChatEvent, { type: "turn-started" }> => event.type === "turn-started");
    expect(started.map((event) => [event.messageId, event.continuedAnswerIds])).toEqual([
      [closed.id, undefined],
      [continuation.id, [closed.id]],
    ]);
  });

  it("результаты закрытого ответа приложение считает свежими: модель нового хода видит их «крупно»", async () => {
    const t = setup([step(call("look", "c1"), call("look", "c2"))]);
    const chat = await t.service.createChat("anna");
    const lookedFirst = t.lookStarted(0);
    const first = readAll(await t.service.sendMessage("anna", chat.id, userMessage("u1", "посмотри обе")));
    await lookedFirst;
    await t.service.steer("anna", chat.id, userMessage("p1", "и сделай ярче"));
    t.release(0);
    t.release(1);
    await first;
    await nextTurn(t.service, chat.id);
    // Следующий обычный вопрос: просмотр был в прошлом ответе — уже «мелко».
    await readAll(await t.service.sendMessage("anna", chat.id, userMessage("u2", "спасибо")));

    expect(t.model.doStreamCalls).toHaveLength(3);
    expect(toolTexts(t.model.doStreamCalls[1]!.prompt)).toEqual(["крупно", "крупно"]);
    expect(toolTexts(t.model.doStreamCalls[2]!.prompt)).toEqual(["мелко", "мелко"]);
  });

  it("«Переделать» ответа на поправку — тоже продолжение закрытого ответа", async () => {
    const t = setup([step(call("look", "c1"))]);
    const chat = await t.service.createChat("anna");
    const looked = t.lookStarted(0);
    const first = readAll(await t.service.sendMessage("anna", chat.id, userMessage("u1", "посмотри")));
    await looked;
    await t.service.steer("anna", chat.id, userMessage("p1", "ярче"));
    t.release(0);
    await first;
    await nextTurn(t.service, chat.id);
    const before = await t.service.getHistory("anna", chat.id);
    const closedId = before.messages[1]!.id;
    await readAll(await t.service.regenerate("anna", chat.id, before.messages[3]!.id));

    const after = await t.service.getHistory("anna", chat.id);
    const regenerated = after.messages.at(-1)!;
    expect(regenerated.id).not.toBe(before.messages[3]!.id);
    expect(t.contexts.find((context) => context.messageId === regenerated.id)?.continuedAnswerIds).toEqual([closedId]);
  });

  it("«Повторить» пустого ответа на поправку — тоже продолжение закрытого ответа", async () => {
    const t = setup([step(call("look", "c1")), [streamStart, finishPart()]]);
    const chat = await t.service.createChat("anna");
    const looked = t.lookStarted(0);
    const first = readAll(await t.service.sendMessage("anna", chat.id, userMessage("u1", "посмотри")));
    await looked;
    await t.service.steer("anna", chat.id, userMessage("p1", "ярче"));
    t.release(0);
    await first;
    await nextTurn(t.service, chat.id);
    const before = await t.service.getHistory("anna", chat.id);
    const closedId = before.messages[1]!.id;
    await readAll(await t.service.retry("anna", chat.id));

    const retried = (await t.service.getHistory("anna", chat.id)).messages.at(-1)!;
    expect(retried.id).not.toBe(before.messages[3]!.id);
    expect(t.contexts.find((context) => context.messageId === retried.id)?.continuedAnswerIds).toEqual([closedId]);
  });

  it("подтверждение в ответе на поправку: продолжение после «Разрешить» знает закрытый ответ", async () => {
    const t = setup([step(call("look", "c1")), step(call("confirm", "k1"))]);
    const chat = await t.service.createChat("anna");
    const looked = t.lookStarted(0);
    const first = readAll(await t.service.sendMessage("anna", chat.id, userMessage("u1", "посмотри")));
    await looked;
    await t.service.steer("anna", chat.id, userMessage("p1", "ярче"));
    t.release(0);
    await first;
    await nextTurn(t.service, chat.id);
    const paused = (await t.service.getHistory("anna", chat.id)).messages[3]!;
    const closedId = (await t.service.getHistory("anna", chat.id)).messages[1]!.id;
    expect(paused.metadata?.status).toBe("awaiting_approval");
    const approval = (paused.parts.find((part) => part.type === "tool-confirm") as { approval: { id: string } }).approval.id;
    await t.service.answerApproval("anna", chat.id, approval, "allow");
    await nextTurn(t.service, chat.id);

    const resumed = t.contexts.filter((context) => context.messageId === paused.id);
    expect(resumed).toHaveLength(2);
    expect(resumed.map((context) => [context.resumed, context.continuedAnswerIds])).toEqual([
      [false, [closedId]],
      [true, [closedId]],
    ]);
  });

  it("поправка к ответу, который сам продолжал закрытый: цепочка от ближнего к дальнему", async () => {
    const t = setup([step(call("look", "c1")), step(call("look", "c2"))]);
    const chat = await t.service.createChat("anna");
    const lookedFirst = t.lookStarted(0);
    const first = readAll(await t.service.sendMessage("anna", chat.id, userMessage("u1", "посмотри")));
    await lookedFirst;
    await t.service.steer("anna", chat.id, userMessage("p1", "ярче"));
    const lookedSecond = t.lookStarted(1);
    t.release(0);
    await first;
    const second = nextTurn(t.service, chat.id);
    await lookedSecond;
    await t.service.steer("anna", chat.id, userMessage("p2", "и крупнее"));
    t.release(1);
    await second;
    await nextTurn(t.service, chat.id);

    const { messages } = await t.service.getHistory("anna", chat.id);
    const answers = messages.filter((message) => message.role === "assistant").map((message) => message.id);
    expect(answers).toHaveLength(3);
    expect(t.contexts.map((context) => context.continuedAnswerIds)).toEqual([undefined, [answers[0]], [answers[1], answers[0]]]);
  });
});
