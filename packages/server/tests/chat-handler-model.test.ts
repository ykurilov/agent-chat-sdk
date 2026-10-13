import { describe, expect, it } from "vitest";
import { extendCatalog } from "@ykurilov/agent-chat-core";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";
import { createTestChat } from "./support/test-chat";

const withDeepseek = { env: { ...mockEnv, DEEPSEEK_API_KEY: "секрет-deepseek" } };

const put = (chat: ReturnType<typeof createTestChat>, chatId: string, body: unknown, user: string | null = "anna") =>
  chat.call("PUT", `/${chatId}/model`, { body, user });

describe("GET /models", () => {
  it("отдаёт провайдеров с моделями, уровнями и выбор по умолчанию; ключей и имён переменных нет", async () => {
    const chat = createTestChat(withDeepseek);
    const response = await chat.call("GET", "/models");
    expect(response.status).toBe(200);
    const text = await response.text();
    const menu = JSON.parse(text) as { providers: Array<{ id: string; models: Array<{ id: string }> }>; defaultChoice: unknown };
    expect(menu.providers.map((provider) => provider.id)).toEqual(["deepseek", "mock"]);
    expect(menu.providers[0]?.models.map((model) => model.id)).toEqual(["deepseek-4.1-flash"]);
    expect(menu.defaultChoice).toEqual({ modelId: mockModelId, providerId: "mock", reasoning: null });
    expect(text).not.toMatch(/секрет-deepseek|не-настоящий-ключ|_API_KEY|https?:/);
  });

  it("без пользователя — 401", async () => {
    expect((await createTestChat().call("GET", "/models", { user: null })).status).toBe(401);
  });
});

describe("PUT /:chatId/model", () => {
  it("записывает выбор: чат и история показывают его, уровень подставляется по умолчанию", async () => {
    const chat = createTestChat(withDeepseek);
    const chatId = await chat.createChat();
    const response = await put(chat, chatId, { modelId: "deepseek-4.1-flash", providerId: "deepseek" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "on" });

    const history = (await (await chat.call("GET", `/${chatId}`)).json()) as { chat: Record<string, unknown> };
    expect(history.chat).toMatchObject({ modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "on" });
  });

  it("уровень из тела сохраняется", async () => {
    const chat = createTestChat(withDeepseek);
    const chatId = await chat.createChat();
    const response = await put(chat, chatId, { modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "off" });
    expect(await response.json()).toMatchObject({ reasoning: "off" });
  });

  it.each([
    ["модели нет", { modelId: "нет", providerId: "mock" }],
    ["провайдер не даёт модель", { modelId: mockModelId, providerId: "deepseek" }],
    ["уровня нет у модели", { modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "max" }],
    ["тело без модели", { providerId: "mock" }],
    ["поля не строки", { modelId: 1, providerId: {} }],
    ["уровень не строка", { modelId: mockModelId, providerId: "mock", reasoning: 5 }],
  ])("400 invalid и ничего не сохранено: %s", async (_case, body) => {
    const chat = createTestChat(withDeepseek);
    const chatId = await chat.createChat();
    const response = await put(chat, chatId, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect(await chat.storage.getChat(chatId)).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });

  it("нет ключа провайдера на сервере — 400", async () => {
    const chat = createTestChat();
    const chatId = await chat.createChat();
    expect((await put(chat, chatId, { modelId: "deepseek-4.1-flash", providerId: "deepseek" })).status).toBe(400);
  });

  it("не JSON — 400", async () => {
    const chat = createTestChat();
    const chatId = await chat.createChat();
    const response = await chat.handler.fetch(
      new Request(`http://test.local/api/chat/${chatId}/model`, { method: "PUT", headers: { "x-user": "anna" }, body: "не json" }),
    );
    expect(response.status).toBe(400);
  });

  it("чужой чат — 404, без пользователя — 401", async () => {
    const chat = createTestChat(withDeepseek);
    const chatId = await chat.createChat("anna");
    const body = { modelId: mockModelId, providerId: "mock" };
    expect((await put(chat, chatId, body, "boris")).status).toBe(404);
    expect((await put(chat, chatId, body, null)).status).toBe(401);
  });

  it("выбор по умолчанию из настроек обработчика попадает в новый чат", async () => {
    const chat = createTestChat({ ...withDeepseek, defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek", reasoning: "off" } });
    const chatId = await chat.createChat();
    expect(await chat.storage.getChat(chatId)).toMatchObject({ providerId: "deepseek", reasoning: "off" });
  });
});

describe("скрытый провайдер (hiddenFromMenu)", () => {
  const hiddenDeepseek = () => {
    const base = mockCatalog();
    const deepseek = base.providers.find((provider) => provider.id === "deepseek")!;
    return extendCatalog(base, { addProviders: [{ ...deepseek, hiddenFromMenu: true }] });
  };

  it("GET /models: скрытого провайдера и его моделей нет", async () => {
    const chat = createTestChat({ ...withDeepseek, catalog: hiddenDeepseek() });
    const menu = (await (await chat.call("GET", "/models")).json()) as { providers: Array<{ id: string }> };
    expect(menu.providers.map((provider) => provider.id)).toEqual(["mock"]);
  });

  it("PUT /:chatId/model на скрытого — 400 invalid, как на неизвестного", async () => {
    const chat = createTestChat({ ...withDeepseek, catalog: hiddenDeepseek() });
    const chatId = await chat.createChat();
    const response = await put(chat, chatId, { modelId: "deepseek-4.1-flash", providerId: "deepseek" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "invalid" } });
    expect(await chat.storage.getChat(chatId)).toMatchObject({ providerId: "mock" });
  });
});
