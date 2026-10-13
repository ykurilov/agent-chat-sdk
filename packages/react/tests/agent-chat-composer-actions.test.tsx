// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { AgentChatProps } from "../src/agent-chat";
import type { AgentPanelProps } from "../src/agent-panel/agent-panel";
import type { ChatWorkspaceProps } from "../src/chat-list/chat-workspace";
import type { AttachmentsController, AttachmentsPlugin } from "../src/attachments-contract";
import type { ComposerHelper } from "../src/composer-actions";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";

setupChatDom();

const field = () => screen.getByLabelText<HTMLTextAreaElement>("поле");
const userTexts = (server: ReturnType<typeof fakeChatServer>) =>
  server.requestsTo("messages").map((request) => JSON.stringify(request.body));

/** Кнопка приложения, которая отдаёт помощника наружу: тест зовёт его методы напрямую. */
function captureHelper() {
  const seen: { helper?: ComposerHelper } = {};
  const actions = (helper: ComposerHelper) => {
    seen.helper = helper;
    return <button type="button" data-testid="check">Проверить работу</button>;
  };
  return { seen, actions };
}

describe("AgentChat: свои кнопки у поля ввода (composerActions)", () => {
  it("без composerActions скин узла не получает", async () => {
    renderAgentChat(fakeChatServer());
    await screen.findByLabelText("поле");
    expect(document.querySelector('[data-kind="composer-actions"]')).toBeNull();
  });

  it("готовый узел кладётся в скин как есть", async () => {
    renderAgentChat(fakeChatServer(), { composerActions: <button type="button">Подсказка</button> });
    const slot = await waitFor(() => {
      const found = document.querySelector('[data-kind="composer-actions"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(slot.textContent).toBe("Подсказка");
  });

  it("функция получает помощника с текущим значением поля, busy и blocked", async () => {
    const { seen, actions } = captureHelper();
    renderAgentChat(fakeChatServer(), { composerActions: actions });
    await screen.findByTestId("check");
    expect(seen.helper).toMatchObject({ value: "", busy: false, blocked: false });
    fireEvent.change(field(), { target: { value: "черновик" } });
    await waitFor(() => expect(seen.helper!.value).toBe("черновик"));
  });

  it("setValue меняет поле ввода", async () => {
    const { seen, actions } = captureHelper();
    renderAgentChat(fakeChatServer(), { composerActions: actions });
    await screen.findByTestId("check");
    act(() => seen.helper!.setValue("из кнопки"));
    await waitFor(() => expect(field().value).toBe("из кнопки"));
  });

  it("send(text) отправляет сообщение с этим текстом, не трогая поле", async () => {
    const server = fakeChatServer();
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions });
    await screen.findByTestId("check");
    fireEvent.change(field(), { target: { value: "черновик" } });
    act(() => seen.helper!.send("Проверь мою работу"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(userTexts(server).join("")).toContain("Проверь мою работу");
    expect(field().value).toBe("черновик");
  });

  it("send() без текста отправляет то, что в поле, и очищает поле", async () => {
    const server = fakeChatServer();
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions });
    await screen.findByTestId("check");
    fireEvent.change(field(), { target: { value: "вопрос из поля" } });
    await waitFor(() => expect(seen.helper!.value).toBe("вопрос из поля"));
    act(() => seen.helper!.send());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(userTexts(server).join("")).toContain("вопрос из поля");
    expect(field().value).toBe("");
  });

  it("send не отправляет во время ответа: busy стоит, второй запрос не уходит", async () => {
    const server = fakeChatServer();
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions });
    await screen.findByTestId("check");
    act(() => seen.helper!.send("первый"));
    await waitFor(() => expect(server.streams).toHaveLength(1));
    await waitFor(() => expect(seen.helper!.busy).toBe(true));
    act(() => seen.helper!.send("второй"));
    expect(server.streams).toHaveLength(1);
    expect(userTexts(server).join("")).not.toContain("второй");
  });

  it("send() без текста с файлом в поле отправляет файл", async () => {
    const server = fakeChatServer();
    const readyFile = { type: "file" as const, url: "attachment:f1", mediaType: "text/plain", filename: "заметки.txt" };
    const controller: AttachmentsController = {
      composer: { items: [{ id: "i1", name: "заметки.txt", kind: "file", status: "ready" }], onAddFiles: vi.fn(), onRemove: vi.fn(), accept: "" },
      ready: true,
      hasFiles: true,
      readFiles: () => [readyFile],
      markSent: vi.fn(),
      restoreFiles: vi.fn(),
      describe: () => undefined,
    };
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions, attachments: { useController: () => controller } });
    await screen.findByTestId("check");
    await waitFor(() => expect(seen.helper!.canSend).toBe(true));
    act(() => seen.helper!.send());
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(userTexts(server).join("")).toContain("attachment:f1");
    expect(controller.markSent).toHaveBeenCalled();
  });

  it("canSend: до загрузки истории ложно, оба вида send отказывают; после загрузки истинно, во время ответа снова ложно", async () => {
    const server = fakeChatServer();
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions });
    // Сразу после первого рендера история ещё грузится.
    expect(seen.helper!.canSend).toBe(false);
    act(() => seen.helper!.send("рано"));
    act(() => seen.helper!.send());
    expect(server.requestsTo("messages")).toHaveLength(0);
    await waitFor(() => expect(seen.helper!.canSend).toBe(true));
    act(() => seen.helper!.send("ответь"));
    await waitFor(() => expect(seen.helper!.canSend).toBe(false));
  });

  it("send отказал — диктовка не отменяется и поле не трогается", async () => {
    const server = fakeChatServer();
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions });
    await screen.findByTestId("check");
    act(() => seen.helper!.send("первый"));
    await waitFor(() => expect(seen.helper!.busy).toBe(true));
    fireEvent.change(field(), { target: { value: "набираю" } });
    act(() => seen.helper!.send("второй"));
    expect(field().value).toBe("набираю");
  });

  it("send с пустым текстом и пустым полем ничего не отправляет", async () => {
    const server = fakeChatServer();
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions });
    await screen.findByTestId("check");
    act(() => seen.helper!.send("   "));
    act(() => seen.helper!.send());
    expect(server.requestsTo("messages")).toHaveLength(0);
  });

  it("addFiles отдаёт файлы контроллеру вложений; без вложений — тихо ничего", async () => {
    const onAddFiles = vi.fn();
    const controller: AttachmentsController = {
      composer: { items: [], onAddFiles, onRemove: vi.fn(), accept: "" },
      ready: true,
      hasFiles: false,
      readFiles: () => [],
      markSent: vi.fn(),
      restoreFiles: vi.fn(),
      describe: () => undefined,
    };
    const plugin: AttachmentsPlugin = { useController: () => controller };
    const withFiles = captureHelper();
    const { unmount } = renderAgentChat(fakeChatServer(), { composerActions: withFiles.actions, attachments: plugin });
    await screen.findByTestId("check");
    const file = new File(["x"], "снимок.png", { type: "image/png" });
    act(() => withFiles.seen.helper!.addFiles([file]));
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    unmount();

    const plain = captureHelper();
    renderAgentChat(fakeChatServer(), { composerActions: plain.actions });
    await screen.findByTestId("check");
    expect(() => act(() => plain.seen.helper!.addFiles([file]))).not.toThrow();
  });

  it("лимит расходов исчерпан: blocked стоит, send ничего не шлёт", async () => {
    const server = fakeChatServer();
    server.state.spending = { state: "exhausted", scope: "user", period: "month", share: 1.02, resetsAt: "2026-11-01T00:00:00.000Z" };
    const { seen, actions } = captureHelper();
    renderAgentChat(server, { composerActions: actions, spendingLimits: true });
    await screen.findByTestId("check");
    await waitFor(() => expect(seen.helper!.blocked).toBe(true));
    act(() => seen.helper!.send("текст"));
    expect(server.requestsTo("messages")).toHaveLength(0);
  });
});

describe("composerActions доходит до всех входов чата (типы проверяет typecheck)", () => {
  it("ChatWorkspace и AgentPanel принимают то же свойство, что AgentChat", () => {
    expectTypeOf<ChatWorkspaceProps["composerActions"]>().toEqualTypeOf<AgentChatProps["composerActions"]>();
    expectTypeOf<AgentPanelProps["composerActions"]>().toEqualTypeOf<AgentChatProps["composerActions"]>();
    expect(true).toBe(true);
  });
});
