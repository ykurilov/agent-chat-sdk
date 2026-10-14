import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { buildModelRequest } from "../../../src/agent-run/build-model-request";
import { undeliveredRecord, withoutUndelivered } from "../../../src/agent-run/undelivered";
import { appStatePart } from "../../../src/app-state/app-state";
import type { AgentChatMessage } from "../../../src/conversation/types";
import { ChatNotFoundError } from "../../../src/index";
import { AGENT_NOTICE_PART_TYPE } from "../../../src/notices/agent-notice";
import { standardCatalog } from "../../../src/models/standard-catalog";
import { readAll } from "../support/mock-model";
import { doneNotice, noticeService, scriptedModel, textsOf, userMessage } from "../support/notice-chat";

const allTexts = (call: LanguageModelV4CallOptions) => JSON.stringify(call.prompt);

async function chatWithUndeliveredNotice() {
  const model = scriptedModel();
  const { service, storage } = noticeService(model);
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет")));
  const delivered = await service.deliverNotices({
    ownerId: "anna",
    chatId: chat.id,
    notices: [doneNotice("Напоминание", "ВОДА-В-ОБЕД")],
    wakeAgent: true,
    deliveryKey: "k1",
    awaitAnswer: true,
  });
  return { model, service, storage, chat, answerId: delivered.answer!.messageId, noticeId: delivered.messageId! };
}

describe("061 T204: markUndelivered — недоставленный ответ модель не видит", () => {
  it("следующий запрос без ответа и его служебного сообщения; начало запроса то же, что у прошлого хода", async () => {
    const { model, service, chat, answerId } = await chatWithUndeliveredNotice();
    await service.markUndelivered({ ownerId: "anna", chatId: chat.id, messageId: answerId });
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));

    const [first, notice, next] = model.doStreamCalls;
    expect(allTexts(notice!)).toContain("ВОДА-В-ОБЕД");
    expect(allTexts(next!)).not.toContain("ВОДА-В-ОБЕД");
    expect(allTexts(next!)).not.toContain("ответ 2");
    // Кэш: всё до убранных сообщений — побайтно как в запросе хода по служебному сообщению.
    expect(JSON.stringify(next!.prompt.slice(0, 3))).toBe(JSON.stringify(notice!.prompt.slice(0, 3)));
    expect(next!.prompt.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(textsOf(next!.prompt[3])[0]).toBe("ещё");
    expect(first).toBeDefined();
  });

  it("в истории ответ и служебное сообщение остаются, у ответа metadata.undelivered; служебной записи на экране нет", async () => {
    const { service, chat, answerId, noticeId } = await chatWithUndeliveredNotice();
    await service.markUndelivered({ ownerId: "anna", chatId: chat.id, messageId: answerId });
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.map((message) => message.id)).toEqual(["u1", messages[1]!.id, noticeId, answerId]);
    expect(messages[3]!.metadata?.undelivered).toBe(true);
    expect(messages[1]!.metadata?.undelivered).toBeUndefined();
    expect(JSON.stringify(messages)).not.toContain("$undelivered");
  });

  it("повтор пометки ничего не добавляет; чужой чат — ChatNotFoundError; не ответ агента — ошибка", async () => {
    const { service, storage, chat, answerId } = await chatWithUndeliveredNotice();
    await service.markUndelivered({ ownerId: "anna", chatId: chat.id, messageId: answerId });
    const count = (await storage.listMessages(chat.id)).length;
    await service.markUndelivered({ ownerId: "anna", chatId: chat.id, messageId: answerId });
    expect((await storage.listMessages(chat.id)).length).toBe(count);
    await expect(service.markUndelivered({ ownerId: "boris", chatId: chat.id, messageId: answerId })).rejects.toBeInstanceOf(ChatNotFoundError);
    await expect(service.markUndelivered({ ownerId: "anna", chatId: chat.id, messageId: "u1" })).rejects.toThrow(/ответ агента/);
  });

  it("чат занят ходом — пометка ложится после хода, следующий ход ответа не видит", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let gated = false;
    const model = scriptedModel();
    const { service } = noticeService(model, { agent: { prepareTurn: () => (gated ? gate.then(() => undefined) : undefined) } });
    const chat = await service.createChat("anna");
    const delivered = await service.deliverNotices({
      ownerId: "anna",
      chatId: chat.id,
      notices: [doneNotice("Напоминание", "ВОДА-В-ОБЕД")],
      wakeAgent: true,
      deliveryKey: "k1",
      awaitAnswer: true,
    });
    gated = true;
    const sending = service.sendMessage("anna", chat.id, userMessage("u1", "привет"));
    await vi.waitFor(async () => expect((await service.getHistory("anna", chat.id)).running).toBe(true));
    await service.markUndelivered({ ownerId: "anna", chatId: chat.id, messageId: delivered.answer!.messageId });
    gated = false;
    release();
    await readAll(await sending);
    await service.flush();
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё")));
    expect(allTexts(model.doStreamCalls.at(-1)!)).not.toContain("ВОДА-В-ОБЕД");
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.find((message) => message.id === delivered.answer!.messageId)?.metadata?.undelivered).toBe(true);
  });
});

describe("061 T204: сборка запроса пропускает недоставленное (buildModelRequest)", () => {
  const u1: AgentChatMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] };
  const a1: AgentChatMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Здравствуйте" }] };
  const n1: AgentChatMessage = { id: "n1", role: "user", parts: [{ type: AGENT_NOTICE_PART_TYPE, data: { notices: [doneNotice("Отчёт", "ГОТОВО")], deliveryKey: "k", wakeAgent: true } } as never] };
  const a2: AgentChatMessage = { id: "a2", role: "assistant", parts: [{ type: "text", text: "НЕДОШЁЛ" }] };
  const mark: AgentChatMessage = { id: "s1", role: "user", parts: [appStatePart(undeliveredRecord("a2")) as never] };
  const u2: AgentChatMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Как дела?" }] };

  const build = (history: AgentChatMessage[]) =>
    buildModelRequest({
      catalog: standardCatalog,
      modelId: "claude-haiku-5.5",
      providerId: "openrouter",
      chatId: "c1",
      instructions: "Ты помощник.",
      history,
      env: { OPENROUTER_API_KEY: "k" },
    });

  it("тот же запрос, что без недоставленной пары; меток кэша не больше прежнего", async () => {
    const marked = await build([u1, a1, n1, a2, mark, u2]);
    const plain = await build([u1, a1, u2]);
    expect(JSON.stringify(marked.messages)).toBe(JSON.stringify(plain.messages));
    expect(JSON.stringify(marked.instructions)).toBe(JSON.stringify(plain.instructions));
    expect((JSON.stringify(marked).match(/cacheControl/g) ?? []).length).toBeLessThanOrEqual(4);
  });

  it("без пометок — тот же массив истории", () => {
    const history = [u1, a1, n1, a2, u2];
    expect(withoutUndelivered(history)).toBe(history);
  });

  it("ответ на сообщение человека: убирается только ответ", () => {
    const answer: AgentChatMessage = { id: "a3", role: "assistant", parts: [{ type: "text", text: "x" }] };
    const markA3: AgentChatMessage = { id: "s2", role: "user", parts: [appStatePart(undeliveredRecord("a3")) as never] };
    expect(withoutUndelivered([u1, answer, markA3]).map((message) => message.id)).toEqual(["u1", "s2"]);
  });
});
