import { AttachmentRejectedError } from "@ykurilov/agent-chat-core";
import { describe, expect, it, vi } from "vitest";
import type { ChatAttachments } from "../src/chat-handler";
import { createTestChat } from "./support/test-chat";

function fakeAttachments(overrides: Partial<ChatAttachments> = {}) {
  const handle = vi.fn(async (_input: { userId: string; chatId: string; segments: string[]; request: Request }) =>
    Response.json({ ok: true }, { status: 201 }),
  );
  const attachments: ChatAttachments = {
    acceptUserParts: vi.fn(async ({ parts }: Parameters<ChatAttachments["acceptUserParts"]>[0]) => parts.map((part) => ({ type: "file" as const, url: part.url, mediaType: "text/plain", filename: "a.txt" }))),
    confirmUserParts: vi.fn(async () => undefined),
    prepareHistory: vi.fn(async ({ history }: Parameters<ChatAttachments["prepareHistory"]>[0]) => [...history]),
    settings: () => Response.json({ maxFiles: 10 }),
    handle,
    ...overrides,
  };
  return { attachments, handle };
}

describe("обработчик чата: вложения", () => {
  it("без вложений адреса /attachments не существуют", async () => {
    const { call, createChat } = createTestChat();
    const chatId = await createChat();
    expect((await call("POST", `/${chatId}/attachments`)).status).toBe(404);
    expect((await call("GET", "/attachments/settings")).status).toBe(404);
  });

  it("GET /attachments/settings — настройки для клиента; без входа 401", async () => {
    const { attachments } = fakeAttachments();
    const { call } = createTestChat({ attachments });
    const response = await call("GET", "/attachments/settings");
    expect(await response.json()).toEqual({ maxFiles: 10 });
    expect((await call("GET", "/attachments/settings", { user: null })).status).toBe(401);
  });

  it("адреса чата передаются расширению с человеком, чатом и остатком пути", async () => {
    const { attachments, handle } = fakeAttachments();
    const { call, createChat } = createTestChat({ attachments });
    const chatId = await createChat();
    const upload = await call("POST", `/${chatId}/attachments`);
    expect(upload.status).toBe(201);
    await call("GET", `/${chatId}/attachments/file-1`);
    await call("DELETE", `/${chatId}/attachments/file-1`);
    expect(handle.mock.calls.map(([input]) => [input.request.method, input.userId, input.chatId, input.segments])).toEqual([
      ["POST", "anna", chatId, []],
      ["GET", "anna", chatId, ["file-1"]],
      ["DELETE", "anna", chatId, ["file-1"]],
    ]);
  });

  it("чужой чат и несуществующий — 404, расширение не вызывается", async () => {
    const { attachments, handle } = fakeAttachments();
    const { call, createChat } = createTestChat({ attachments });
    const chatId = await createChat();
    const foreign = await call("GET", `/${chatId}/attachments/file-1`, { user: "boris" });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: { kind: "not_found" } });
    expect((await call("POST", "/нет-такого/attachments")).status).toBe(404);
    expect(handle).not.toHaveBeenCalled();
  });

  it("сообщение с вложением доходит до расширения; отклонённые вложения — 400 с видом отказа", async () => {
    const { attachments } = fakeAttachments();
    const { call, createChat, history } = createTestChat({ attachments });
    const chatId = await createChat();
    const body = { message: { id: "u1", role: "user", parts: [{ type: "file", url: "attachment:1" }] } };
    const sent = await call("POST", `/${chatId}/messages`, { body });
    expect(sent.status).toBe(200);
    await sent.text();
    expect((await history(chatId)).messages[0]!.parts).toEqual([{ type: "file", url: "attachment:1", mediaType: "text/plain", filename: "a.txt" }]);

    const rejecting = fakeAttachments({
      acceptUserParts: async () => {
        throw new AttachmentRejectedError("too_many", "Слишком много");
      },
    });
    const other = createTestChat({ attachments: rejecting.attachments });
    const otherChat = await other.createChat();
    const response = await other.call("POST", `/${otherChat}/messages`, { body: { message: { ...body.message, id: "u2" } } });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { kind: "too_many" } });
  });
});
