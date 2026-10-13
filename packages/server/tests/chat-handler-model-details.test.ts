import { describe, expect, it } from "vitest";
import { createTestChat, message } from "./support/test-chat";
import { parseSse } from "./support/sse";
import { mockModelId } from "./support/mock-catalog";

const FORBIDDEN_TEXT = "Это действие в этом чате недоступно.";

describe("обработчик чата: право modelDetails", () => {
  it("запрет: история и поток без модели, провайдера, расхода и владельца", async () => {
    const { call, createChat } = createTestChat({ chatCapabilities: () => ({ modelDetails: false }) });
    const chatId = await createChat();
    const stream = await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    expect(stream).not.toContain(mockModelId);
    expect(stream).not.toContain('"usage"');
    expect(parseSse(stream).some((chunk) => chunk.type === "text-delta")).toBe(true);
    const history = await (await call("GET", `/${chatId}`)).text();
    for (const leak of [mockModelId, '"providerId"', '"usage"', '"ownerId"', "anna"]) expect(history).not.toContain(leak);
    expect(JSON.parse(history)).toMatchObject({ capabilities: { modelDetails: false, modelChoice: false }, modelAcceptsImages: expect.any(Boolean) });
  });

  it("без запрета — как раньше", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    const stream = await (await call("POST", `/${chatId}/messages`, { body: message("u1", "Привет") })).text();
    expect(stream).toContain(mockModelId);
    const history = (await (await call("GET", `/${chatId}`)).json()) as { chat: Record<string, unknown> };
    expect(history.chat).toMatchObject({ ownerId: "anna", modelId: mockModelId, providerId: "mock" });
  });

  it("GET /models: modelMenu решает по человеку — 403 action_forbidden; без опции меню видно", async () => {
    const { call } = createTestChat({ modelMenu: ({ userId }) => userId !== "visitor" });
    const refused = await call("GET", "/models", { user: "visitor" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: { kind: "action_forbidden", action: "modelDetails", code: "modelDetails", message: FORBIDDEN_TEXT } });
    expect((await call("GET", "/models")).status).toBe(200);
    expect((await createTestChat().call("GET", "/models", { user: "visitor" })).status).toBe(200);
  });
});
