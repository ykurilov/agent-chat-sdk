import { describe, expect, it, vi } from "vitest";
import { CURRENT_FORMAT_VERSION } from "@ykurilov/agent-chat-core";
import { createTestChat } from "./support/test-chat";
import { mockModelId } from "./support/mock-catalog";

/*
 * Адреса HTTP — для людей: права экрана проверяются всегда, даже если в теле пришло `by: "app"`. Выбор модели через
 * `PUT {chat}/model` — выбор человека: зовёт `onModelChosen`.
 */

describe("обработчик чата: действия человека и сервера приложения", () => {
  it("DELETE без права chatList — 403, даже с { by: 'app' } в теле; чат цел", async () => {
    const { call, createChat, storage } = createTestChat({ chatList: true, chatCapabilities: () => ({ chatList: false }) });
    const chatId = await createChat();
    const response = await call("DELETE", `/${chatId}`, { body: { by: "app" } });
    expect(response.status).toBe(403);
    expect(await storage.getChat(chatId)).toBeDefined();
  });

  it("PUT model — выбор человека: onModelChosen с сохранённым выбором", async () => {
    const onModelChosen = vi.fn();
    const { call, createChat } = createTestChat({ onModelChosen });
    const chatId = await createChat();
    const response = await call("PUT", `/${chatId}/model`, { body: { modelId: mockModelId, providerId: "mock" } });
    expect(response.status).toBe(200);
    expect(onModelChosen).toHaveBeenCalledWith({ userId: "anna", chatId, choice: await response.json() });
  });

  it("recoverInterruptedAnswers({ soleServer: true }) прерывает свежий оборванный ответ сразу", async () => {
    const { handler, createChat, storage } = createTestChat();
    const chatId = await createChat();
    // Ответ оборван только что: знак жизни свежий, обычное восстановление его не трогает.
    await storage.insertMessage({
      id: "a1",
      chatId,
      parentId: null,
      role: "assistant",
      parts: [{ type: "text", text: "Начало", state: "streaming" }],
      status: "streaming",
      modelId: mockModelId,
      providerId: "mock",
      formatVersion: CURRENT_FORMAT_VERSION,
      usage: null,
      reasoningDurationsMs: {},
      error: null,
      createdAt: new Date().toISOString(),
    });
    expect(await handler.recoverInterruptedAnswers()).toBe(0);
    expect((await storage.getMessage("a1"))?.status).toBe("streaming");
    expect(await handler.recoverInterruptedAnswers({ soleServer: true })).toBe(1);
    expect((await storage.getMessage("a1"))?.status).toBe("interrupted");
    await handler.flush();
  });
});
