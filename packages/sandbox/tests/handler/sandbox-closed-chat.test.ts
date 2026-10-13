import { jsonSchema, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import { setupSandbox } from "./support/sandbox-setup";

const CLOSURE = { code: "form_completed", message: "Заявка отправлена." };

/** Песочница, где инструмент `finish_form` закрывает чат, как в приложении. */
function withClosingTool(extra: Parameters<typeof setupSandbox>[0] = {}) {
  return setupSandbox({
    ...extra,
    steps: [{ toolCall: { id: "c1", name: "finish_form", input: {} } }, { text: "Готово" }],
    chat: {
      ...extra.chat,
      agent: {
        instructions: "Ты помощник.",
        tools: (model: AgentToolsModel) => ({
          finish_form: tool({
            description: "Отправить заявку.",
            inputSchema: jsonSchema({ type: "object", properties: {} }),
            execute: async () => {
              model.closeChat!(CLOSURE);
              return "отправлено";
            },
          }),
        }),
      },
    },
  });
}

describe("песочница: закрытый чат", () => {
  it("инструмент закрывает песочный чат, как в бою: дальше 409 chat_closed", async () => {
    const setup = withClosingTool();
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "Отправь");
    const history = (await (await setup.call("GET", `/${chatId}`)).json()) as { chat: { closed?: unknown } };
    expect(history.chat.closed).toEqual(CLOSURE);
    const refused = await setup.call("POST", `/${chatId}/messages`, { body: { message: { id: "u2", role: "user", parts: [{ type: "text", text: "Ещё" }] } } });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: { kind: "chat_closed", ...CLOSURE } });
  });

  it("админ открывает чат снова: 204, чат открыт, ход идёт", async () => {
    const setup = withClosingTool();
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "Отправь");
    const reopened = await setup.call("POST", `/chats/${chatId}/reopen`);
    expect(reopened.status).toBe(204);
    expect((await setup.storage.getChat(chatId))!.closed).toBeUndefined();
    await setup.send(chatId, "Продолжаю тест");
  });

  it("открыть снова чужой песочный чат нельзя: 404", async () => {
    const setup = withClosingTool();
    const chatId = await setup.createChat("anna");
    await setup.send(chatId, "Отправь");
    const response = await setup.call("POST", `/chats/${chatId}/reopen`, { user: "boris" });
    expect(response.status).toBe(404);
    expect((await setup.storage.getChat(chatId))!.closed).toEqual(CLOSURE);
  });

  it("новый песочный чат после закрытого — даже если приложение запрещает новые чаты (beforeCreateChat не переходит)", async () => {
    const beforeCreateChat = vi.fn(() => ({ code: "one_chat_only", message: "У вас уже есть чат." }));
    const setup = withClosingTool({ chat: { beforeCreateChat } });
    const first = await setup.createChat("anna");
    await setup.send(first, "Отправь");
    const second = await setup.createChat("anna");
    await setup.send(second, "Новый тест");
    expect(beforeCreateChat).not.toHaveBeenCalled();
  });
});
