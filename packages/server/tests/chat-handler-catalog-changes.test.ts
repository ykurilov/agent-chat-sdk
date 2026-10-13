import { extendCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";
import { createTestChat } from "./support/test-chat";

const env = { ...mockEnv, DEEPSEEK_API_KEY: "k", FIREWORKS_API_KEY: "k", OPENROUTER_API_KEY: "k" };
const narrowed = (change: Parameters<typeof extendCatalog>[1]) => extendCatalog(mockCatalog(), change);

describe("суженный каталог приложения", () => {
  it("меню не показывает убранных провайдеров и модели без провайдеров", async () => {
    const chat = createTestChat({ env, catalog: narrowed({ removeProviders: ["openrouter"], removeModels: ["glm-5.3-flash"] }) });
    const menu = (await (await chat.call("GET", "/models")).json()) as { providers: Array<{ id: string; models: Array<{ id: string }> }> };
    expect(menu.providers.map((provider) => provider.id)).toEqual(["fireworks", "deepseek", "mock"]);
    const shown = menu.providers.flatMap((provider) => provider.models.map((model) => model.id));
    expect(shown).not.toContain("glm-5.3-flash");
    expect(shown).not.toContain("gpt-6-luna");
  });

  it("PUT на убранного провайдера отвечает 400, чат не меняется", async () => {
    const chat = createTestChat({ env, catalog: narrowed({ removeProviders: ["openrouter"] }) });
    const chatId = await chat.createChat();
    const response = await chat.call("PUT", `/${chatId}/model`, { body: { modelId: "gpt-6-luna", providerId: "openrouter" } });
    expect(response.status).toBe(400);
    expect(await chat.storage.getChat(chatId)).toMatchObject({ modelId: mockModelId, providerId: "mock" });
  });

  it("выбор по умолчанию вне суженного каталога: запись в журнал, берётся первая доступная модель", async () => {
    const errors: string[] = [];
    const chat = createTestChat({
      env,
      catalog: narrowed({ removeProviders: ["mock"] }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      logError: (message) => errors.push(message),
    });
    const chatId = await chat.createChat();
    expect(errors.join("\n")).toMatch(/по умолчанию/);
    expect(await chat.storage.getChat(chatId)).toMatchObject({ providerId: "fireworks" });
  });
});
