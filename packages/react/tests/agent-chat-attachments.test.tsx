// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttachmentsController, AttachmentsPlugin } from "../src/attachments-contract";
import { fakeChatServer, defaultModelMenu } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { AgentChat } from "../src/agent-chat";
import { stubSkin } from "./support/stub-skin";

setupChatDom();

const readyFile = { type: "file" as const, url: "attachment:f1", mediaType: "text/plain", filename: "заметки.txt" };

/** Управляемый вручную контроллер: то, что скажет настоящий, тест задаёт сам. */
function fakePlugin(overrides: Partial<AttachmentsController> = {}) {
  const inputs: Array<{ api: string; chatId: string; modelSeesImages: boolean | undefined }> = [];
  const readFiles = vi.fn(() => [readyFile]);
  const markSent = vi.fn();
  const restoreFiles = vi.fn();
  const controller: AttachmentsController = {
    composer: {
      items: [{ id: "i1", name: "заметки.txt", kind: "file", status: "ready" }],
      onAddFiles: vi.fn(),
      onRemove: vi.fn(),
      accept: ".txt",
      notice: "Пометка",
    },
    ready: true,
    hasFiles: true,
    readFiles,
    markSent,
    restoreFiles,
    describe: (message) =>
      message.parts.some((part) => part.type === "file")
        ? { label: "Вложения", items: [{ id: "f1", name: "заметки.txt", kind: "file", url: "/api/chat/c1/attachments/f1", mediaType: "text/plain" }] }
        : undefined,
    ...overrides,
  };
  const plugin: AttachmentsPlugin = {
    useController: (input) => {
      inputs.push({ api: input.api, chatId: input.chatId, modelSeesImages: input.modelSeesImages });
      return controller;
    },
  };
  return { plugin, inputs, readFiles, markSent, restoreFiles, controller };
}

describe("AgentChat с вложениями", () => {
  it("без плагина поле ввода получает attachments: undefined, а лента — сообщения как раньше", async () => {
    renderAgentChat(fakeChatServer());
    await screen.findByLabelText("поле");
    expect(document.querySelector('[data-kind="composer-attachments"]')).toBeNull();
  });

  it("поле ввода получает вид вложений из плагина; контроллер знает api, чат и видит ли модель картинки", async () => {
    const server = fakeChatServer();
    server.state.menu = {
      ...defaultModelMenu,
      providers: [{ ...defaultModelMenu.providers[0]!, models: [{ ...defaultModelMenu.providers[0]!.models[0]!, acceptsImages: false }] }],
    };
    const { plugin, inputs } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    const composer = await waitFor(() => {
      const found = document.querySelector('[data-kind="composer-attachments"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(composer.getAttribute("data-accept")).toBe(".txt");
    expect(screen.getByRole("alert").textContent).toBe("Пометка");
    await waitFor(() => expect(inputs.at(-1)).toEqual({ api: "/api/chat", chatId: "c1", modelSeesImages: false }));
    expect(inputs[0]!.modelSeesImages).toBeUndefined();
  });

  it("отправка только с файлами (текст пуст) доступна; уходит то, что вернул readFiles, поле очищается после принятия", async () => {
    const server = fakeChatServer();
    const { plugin, readFiles, markSent } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    const field = await screen.findByLabelText("поле");
    const send = screen.getByRole("button", { name: "послать" });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(readFiles).toHaveBeenCalled();
    expect(markSent).toHaveBeenCalledOnce();
    expect((server.requestsTo("messages")[0]!.body as { message: { parts: unknown[] } }).message.parts).toEqual([readyFile]);
  });

  it("пока файлы не готовы (грузятся или с ошибкой), отправка недоступна даже с текстом", async () => {
    const { plugin, readFiles, markSent } = fakePlugin({ ready: false });
    renderAgentChat(fakeChatServer(), { attachments: plugin });
    const field = await screen.findByLabelText("поле");
    fireEvent.change(field, { target: { value: "Текст" } });
    expect((screen.getByRole("button", { name: "послать" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(field.closest("form")!);
    expect(readFiles).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("двойной щелчок «послать»: сообщение одно, поле очищается один раз", async () => {
    const server = fakeChatServer();
    const { plugin, markSent } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    const field = await screen.findByLabelText("поле");
    await waitFor(() => expect((screen.getByRole("button", { name: "послать" }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
      fireEvent.submit(field.closest("form")!);
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(server.requestsTo("messages")).toHaveLength(1);
    expect(markSent).toHaveBeenCalledOnce();
  });

  it("сервер не принял файлы: плагин получает причину и возвращает файлы в поле, сообщение не остаётся в ленте", async () => {
    const server = fakeChatServer();
    server.state.refuse.messages = { status: 400, kind: "attachment_expired" };
    const { plugin, restoreFiles } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    const field = await screen.findByLabelText("поле");
    await waitFor(() => expect((screen.getByRole("button", { name: "послать" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(field, { target: { value: "Смотри" } });
    await act(async () => {
      fireEvent.submit(field.closest("form")!);
    });
    await waitFor(() => expect(restoreFiles).toHaveBeenCalledWith("attachment_expired"));
    expect((screen.getByLabelText("поле") as HTMLTextAreaElement).value).toBe("Смотри");
    expect(document.querySelector('[data-kind="user"]')).toBeNull();
  });

  it("без файлов и без текста отправка недоступна", async () => {
    const { plugin } = fakePlugin({ hasFiles: false });
    renderAgentChat(fakeChatServer(), { attachments: plugin });
    await screen.findByLabelText("поле");
    expect((screen.getByRole("button", { name: "послать" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("в ленте у сообщения с файлами — плашки из describe плагина", async () => {
    const server = fakeChatServer({
      history: [{ id: "u1", role: "user", parts: [readyFile, { type: "text", text: "Смотри" }] }],
    });
    const { plugin } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    const list = await screen.findByLabelText("Вложения");
    expect(list.querySelector("li")?.getAttribute("data-url")).toBe("/api/chat/c1/attachments/f1");
    expect(document.querySelector('[data-kind="user"]')?.textContent).toBe("Смотри");
  });
});

describe("AgentChat: меню моделей только когда оно нужно (modelDetails, modelChoice)", () => {
  it("меню моделей не запрашивается; видит ли модель картинки — из истории", async () => {
    const server = fakeChatServer();
    server.state.capabilities = { modelDetails: false, modelChoice: false };
    server.state.modelAcceptsImages = false;
    const { plugin, inputs } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    await waitFor(() => expect(inputs.at(-1)?.modelSeesImages).toBe(false));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(server.requests.some((request) => request.url.endsWith("/models"))).toBe(false);
  });

  it("modelChoice: false — меню не показывается и не запрашивается; картинки — по истории", async () => {
    const server = fakeChatServer();
    server.state.capabilities = { modelChoice: false };
    server.state.modelAcceptsImages = true;
    const { plugin, inputs } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    await waitFor(() => expect(inputs.at(-1)?.modelSeesImages).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(server.requests.some((request) => request.url.endsWith("/models"))).toBe(false);
  });

  it("modelChoice: false без вложений — меню не запрашивается, даже если сервер не прислал modelAcceptsImages", async () => {
    const server = fakeChatServer();
    server.state.capabilities = { modelChoice: false };
    renderAgentChat(server);
    await screen.findByLabelText("поле");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(server.requests.some((request) => request.url.endsWith("/models"))).toBe(false);
  });

  it("modelChoice: false, старый сервер без modelAcceptsImages и есть вложения — меню нужно ради картинок: один запрос", async () => {
    const server = fakeChatServer();
    server.state.capabilities = { modelChoice: false };
    const { plugin } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    await waitFor(() => expect(server.requests.filter((request) => request.url.endsWith("/models"))).toHaveLength(1));
  });

  for (const change of ["смена чата", "перечитанная история (reloadKey)"] as const) {
    it(`${change}: выбор модели выключен — зрение модели из истории, а не из меню прошлого чата`, async () => {
      const server = fakeChatServer();
      server.state.menu = {
        ...defaultModelMenu,
        providers: defaultModelMenu.providers.map((provider) => ({ ...provider, models: provider.models.map((model) => ({ ...model, acceptsImages: true })) })),
      };
      const { plugin, inputs } = fakePlugin();
      const view = renderAgentChat(server, { attachments: plugin });
      await waitFor(() => expect(inputs.at(-1)?.modelSeesImages).toBe(true));
      server.state.capabilities = { modelChoice: false };
      server.state.modelAcceptsImages = false;
      view.rerender(
        <AgentChat api="/api/chat" chatId={change === "смена чата" ? "c2" : "c1"} skin={stubSkin} attachments={plugin} {...(change !== "смена чата" && { reloadKey: 1 })} />,
      );
      await waitFor(() => expect(inputs.at(-1)?.modelSeesImages).toBe(false));
    });
  }

  it("без скрытия меню запрашивается после истории: права приходят с ней", async () => {
    const server = fakeChatServer();
    const { plugin, inputs } = fakePlugin();
    renderAgentChat(server, { attachments: plugin });
    await waitFor(() => expect(server.requests.some((request) => request.url.endsWith("/models"))).toBe(true));
    const order = server.requests.map((request) => (request.url.endsWith("/models") ? "models" : request.url.endsWith("/c1") ? "history" : "other"));
    expect(order.indexOf("history")).toBeLessThan(order.indexOf("models"));
    expect(inputs.length).toBeGreaterThan(0);
  });
});
