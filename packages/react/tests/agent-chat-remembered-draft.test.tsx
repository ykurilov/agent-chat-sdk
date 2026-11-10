// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { draftKey, DRAFT_MAX_AGE_MS, readDraft, writeDraft } from "../src/chat-drafts/remembered-draft";
import { ChatWorkspace } from "../src/chat-list/chat-workspace";
import { fakeChatListServer } from "./support/fake-chat-list-server";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubWorkspaceSkin } from "./support/stub-chat-list-skin";

setupChatDom();

const field = async () => (await screen.findByLabelText("поле")) as HTMLTextAreaElement;

/** Перезагрузка страницы: экран снят, localStorage остался. */
function reload() {
  cleanup();
}

describe("rememberDraft: черновик переживает перезагрузку страницы", () => {
  it("набранный текст возвращается в поле того же чата после перезагрузки", async () => {
    renderAgentChat(fakeChatServer());
    fireEvent.change(await field(), { target: { value: "Хочу узнать про тариф" } });
    reload();
    renderAgentChat(fakeChatServer());
    await waitFor(async () => expect((await field()).value).toBe("Хочу узнать про тариф"));
  });

  it("у каждого чата свой черновик", async () => {
    renderAgentChat(fakeChatServer(), { chatId: "c1" });
    fireEvent.change(await field(), { target: { value: "Для первого" } });
    reload();
    renderAgentChat(fakeChatServer(), { chatId: "c2" });
    expect((await field()).value).toBe("");
    expect(readDraft(draftKey("/api/chat", "c1"))).toBe("Для первого");
  });

  it("стёртый текст стирает и черновик", async () => {
    renderAgentChat(fakeChatServer());
    const input = await field();
    fireEvent.change(input, { target: { value: "Черновик" } });
    fireEvent.change(input, { target: { value: "" } });
    expect(readDraft(draftKey("/api/chat", "c1"))).toBeNull();
  });

  it("rememberDraft={false} — не пишет и не восстанавливает", async () => {
    writeDraft(draftKey("/api/chat", "c1"), "Старый");
    renderAgentChat(fakeChatServer(), { rememberDraft: false });
    const input = await field();
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "Новый" } });
    expect(readDraft(draftKey("/api/chat", "c1"))).toBe("Старый");
  });

  it("свой initialDraft приложения важнее запомненного", async () => {
    writeDraft(draftKey("/api/chat", "c1"), "Запомненный");
    renderAgentChat(fakeChatServer(), { initialDraft: "От приложения" });
    expect((await field()).value).toBe("От приложения");
  });

  it("черновик старше 30 дней не возвращается и удаляется", () => {
    const key = draftKey("/api/chat", "c1");
    writeDraft(key, "Давний", 1_000);
    expect(readDraft(key, 1_000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("закрытое хранилище не ломает чат", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderAgentChat(fakeChatServer());
    const input = await field();
    fireEvent.change(input, { target: { value: "Текст" } });
    expect(input.value).toBe("Текст");
    spy.mockRestore();
  });

  it("ChatWorkspace: черновик открытого чата возвращается после перезагрузки", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    vi.stubGlobal("fetch", server.fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} initialChatId="c1" />);
    fireEvent.change(await field(), { target: { value: "В рабочей области" } });
    reload();
    vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }]).fetch);
    render(<ChatWorkspace api="/api/chat" skin={stubWorkspaceSkin} initialChatId="c1" />);
    await waitFor(async () => expect((await field()).value).toBe("В рабочей области"));
  });
});
