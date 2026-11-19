// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AttachmentsController, AttachmentsPlugin, ComposerAttachmentItem } from "../src/attachments-contract";
import { englishLabels, russianLabels } from "../src/labels";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderAgentChat, sendQuestion, setupChatDom } from "./support/chat-dom";
import { steeringStubSkin } from "./support/stub-skin";

setupChatDom();

const shotFile = { type: "file" as const, url: "attachment:f1", mediaType: "image/png", filename: "скрин.png" };
const uploading: ComposerAttachmentItem = { id: "i1", name: "скрин.png", kind: "image", status: "uploading" };

interface UploadState {
  items: ComposerAttachmentItem[];
  ready: boolean;
  notice?: string;
}

/** Вложения, чью загрузку тест ведёт сам: `set` меняет состояние и перерисовывает чат. */
function controllablePlugin(initial: UploadState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const markSent = vi.fn(() => set({ items: [], ready: true }));
  const readFiles = vi.fn(() => (state.items.some((item) => item.status === "ready") ? [shotFile] : []));
  function set(next: UploadState) {
    state = next;
    for (const listener of listeners) listener();
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const plugin: AttachmentsPlugin = {
    useController: () => {
      const current = useSyncExternalStore(subscribe, () => state);
      const controller: AttachmentsController = {
        composer: {
          items: current.items,
          onAddFiles: vi.fn(),
          onRemove: (id) => set({ ...state, items: state.items.filter((item) => item.id !== id), ready: true }),
          accept: "image/*",
          ...(current.notice && { notice: current.notice }),
        },
        ready: current.ready,
        hasFiles: current.items.length > 0,
        readFiles,
        markSent,
        restoreFiles: vi.fn(),
        describe: () => undefined,
      };
      return controller;
    },
  };
  return { plugin, set, markSent };
}

const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const form = () => field().closest("form")!;
const sendButton = () => screen.getByRole("button", { name: "послать" }) as HTMLButtonElement;
const pendingLine = () => document.querySelector('[data-kind="pending-send"]');
const pause = () => new Promise((resolve) => setTimeout(resolve, 20));
const finishUpload = (set: (state: UploadState) => void) =>
  act(() => set({ items: [{ ...uploading, status: "ready" }], ready: true }));

describe("AgentChat: «Отправить», нажатое во время загрузки файла", () => {
  it("нажатие запоминается: пока файл грузится, запроса нет и видно ожидание; загрузка закончилась — уходит одно сообщение с текстом и файлом", async () => {
    const server = fakeChatServer();
    const { plugin, set, markSent } = controllablePlugin({ items: [uploading], ready: false });
    renderAgentChat(server, { attachments: plugin });
    await screen.findByLabelText("поле");
    fireEvent.change(field(), { target: { value: "Что на скрине?" } });
    // Кнопка не мёртвая: скин пропускает нажатие к слою поведения.
    await waitFor(() => expect(sendButton().disabled).toBe(false));

    fireEvent.submit(form());
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(0);
    expect(pendingLine()?.textContent).toContain(russianLabels.sendAfterUpload!.waiting);

    // Повторное нажатие и Enter во время ожидания второго сообщения не добавляют.
    fireEvent.submit(form());
    fireEvent.submit(form());
    await finishUpload(set);

    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(1);
    expect(markSent).toHaveBeenCalledOnce();
    const parts = (server.requestsTo("messages")[0]!.body as { message: { parts: unknown[] } }).message.parts;
    expect(parts).toEqual(expect.arrayContaining([shotFile, expect.objectContaining({ type: "text", text: "Что на скрине?" })]));
    expect(pendingLine()).toBeNull();
  });

  it("уходит то, что в поле на момент конца загрузки: текст, дописанный во время ожидания, тоже", async () => {
    const server = fakeChatServer();
    const { plugin, set } = controllablePlugin({ items: [uploading], ready: false });
    renderAgentChat(server, { attachments: plugin });
    await screen.findByLabelText("поле");
    fireEvent.submit(form());
    await waitFor(() => expect(pendingLine()).not.toBeNull());
    fireEvent.change(field(), { target: { value: "Посмотри внимательно" } });
    await finishUpload(set);
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    const parts = (server.requestsTo("messages")[0]!.body as { message: { parts: unknown[] } }).message.parts;
    expect(parts).toEqual(expect.arrayContaining([shotFile, expect.objectContaining({ type: "text", text: "Посмотри внимательно" })]));
  });

  it("загрузка упала: сообщение не уходит, ожидание снято, у поля сказано, что сообщение не отправлено и почему", async () => {
    const server = fakeChatServer();
    const { plugin, set } = controllablePlugin({ items: [uploading], ready: false });
    renderAgentChat(server, { attachments: plugin });
    await screen.findByLabelText("поле");
    fireEvent.change(field(), { target: { value: "Смотри" } });
    fireEvent.submit(form());
    await waitFor(() => expect(pendingLine()).not.toBeNull());

    act(() => set({ items: [{ ...uploading, status: "error" }], ready: false, notice: "Файл «скрин.png»: не удалось загрузить." }));

    await waitFor(() => expect(pendingLine()).toBeNull());
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toBe(`${russianLabels.sendAfterUpload!.notSent} Файл «скрин.png»: не удалось загрузить.`);
    expect(field().value).toBe("Смотри");
    expect(sendButton().disabled).toBe(true);
  });

  it("человек передумал: «не отправлять» снимает ожидание, после загрузки ничего не уходит, отправить можно вручную", async () => {
    const server = fakeChatServer();
    const { plugin, set } = controllablePlugin({ items: [uploading], ready: false });
    renderAgentChat(server, { attachments: plugin });
    await screen.findByLabelText("поле");
    fireEvent.submit(form());
    await waitFor(() => expect(pendingLine()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: russianLabels.sendAfterUpload!.cancel }));
    expect(pendingLine()).toBeNull();
    await finishUpload(set);
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(0);

    fireEvent.submit(form());
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
  });

  it("человек убрал все файлы во время ожидания: ожидание снято, текст сам не уходит, отправить можно вручную", async () => {
    const server = fakeChatServer();
    const { plugin } = controllablePlugin({ items: [uploading], ready: false });
    renderAgentChat(server, { attachments: plugin });
    await screen.findByLabelText("поле");
    fireEvent.change(field(), { target: { value: "Что на скрине?" } });
    fireEvent.submit(form());
    await waitFor(() => expect(pendingLine()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "убрать скрин.png" }));
    await waitFor(() => expect(pendingLine()).toBeNull());
    await pause();
    expect(server.requestsTo("messages")).toHaveLength(0);
    expect(field().value).toBe("Что на скрине?");

    fireEvent.submit(form());
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
  });

  it("файл с ошибкой: нажатие не запоминается, даже пока другой ещё грузится", async () => {
    const server = fakeChatServer();
    const { plugin } = controllablePlugin({ items: [uploading, { id: "i2", name: "битый.png", kind: "image", status: "error" }], ready: false });
    renderAgentChat(server, { attachments: plugin });
    await screen.findByLabelText("поле");
    expect(sendButton().disabled).toBe(true);
    fireEvent.submit(form());
    await pause();
    expect(pendingLine()).toBeNull();
  });

  it("поправка во время ответа: нажатие во время загрузки запоминается и уходит поправкой, когда файл загрузился", async () => {
    const server = fakeChatServer();
    const { plugin, set } = controllablePlugin({ items: [], ready: true });
    renderAgentChat(server, { attachments: plugin, skin: steeringStubSkin });
    const stream = await sendQuestion(server, "Нарисуй кнопку");
    stream.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(form().getAttribute("data-busy")).toBe("true"));

    act(() => set({ items: [uploading], ready: false }));
    fireEvent.change(field(), { target: { value: "Вот образец" } });
    await waitFor(() => expect(form().getAttribute("data-can-steer")).toBe("true"));
    fireEvent.submit(form());
    await pause();
    expect(server.requestsTo("steer")).toHaveLength(0);
    expect(pendingLine()).not.toBeNull();

    await finishUpload(set);
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    expect(server.requestsTo("messages")).toHaveLength(1);
  });

  it("английские надписи ожидания есть в englishLabels", () => {
    expect(englishLabels.sendAfterUpload).toEqual({
      waiting: expect.any(String),
      cancel: expect.any(String),
      notSent: expect.any(String),
    });
    expect(englishLabels.sendAfterUpload!.waiting).not.toBe(russianLabels.sendAfterUpload!.waiting);
  });
});
