// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImagesClient } from "../src/agent-chat-extensions";
import type { AttachmentsController, AttachmentsPlugin, MessageAttachmentsView } from "../src/attachments-contract";
import type { AgentChatMessage } from "../src/chat-types";
import type { ChatSkin, GeneratedImagesView, MediaViewerProps } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import { leaveViewerHistory } from "./support/viewer-history";

setupChatDom();

// Окно, открытое прошлым тестом, уходит из истории «назад» не мгновенно: следующий тест ждёт возврата к странице.
beforeEach(leaveViewerHistory);

/** Поддельный клиент картинок: экран не зависит от пакета картинок (FR-034), договор тот же. */
const describeCall = vi.fn<ImagesClient["describe"]>(({ part, api, chatId, openImage }) => {
  const output = part.state === "output-available" ? (part.output as { ids: string[] }) : undefined;
  return {
    ordered: 2,
    aspectRatio: "16:9",
    items: output
      ? output.ids.map((id) => ({ state: "ready" as const, key: id, src: `${api}/${chatId}/attachments/${id}`, alt: `картинка ${id}`, width: 1088, height: 608, onOpen: (trigger: HTMLElement) => openImage(id, trigger) }))
      : [{ state: "loading" as const, key: `${part.toolCallId}:1` }],
    stopped: false,
  };
});
const images: ImagesClient = { toolName: "generate_images", describe: describeCall };

const imagesCall = (toolCallId: string, ids: string[]) => ({ type: "tool-generate_images", toolCallId, state: "output-available", input: { prompt: "маяк" }, output: { ids } });
const answer = (id: string, parts: Array<Record<string, unknown>>): HistoryMessage => ({ id, role: "assistant", parts: [...parts, { type: "text", text: `ответ ${id}`, state: "done" }], metadata: { status: "complete" } });
const file = (id: string) => ({ type: "file", url: `attachment:${id}`, filename: `${id}.png`, mediaType: "image/png" });
const question = (id: string, files: Array<Record<string, unknown>> = []): HistoryMessage => ({ id, role: "user", parts: [...files, { type: "text", text: `вопрос ${id}` }] });

/** Лента: картинка человека, картинки агента x и y, другой инструмент, картинка человека. */
const feed = [
  question("u1", [file("a")]),
  answer("m1", [imagesCall("g1", ["x", "y"]), { type: "tool-search", toolCallId: "s1", state: "output-available", input: {}, output: "найдено" }]),
  question("u2", [file("c")]),
  answer("m2", []),
];

const attachments: AttachmentsPlugin = {
  useController: (): AttachmentsController => ({
    composer: { items: [], onAddFiles: () => undefined, onRemove: () => undefined, accept: "*" },
    ready: true,
    hasFiles: false,
    readFiles: () => [],
    markSent: () => undefined,
    restoreFiles: () => undefined,
    describe: (message: AgentChatMessage): MessageAttachmentsView | undefined => {
      const items = message.parts.flatMap((part) =>
        part.type === "file"
          ? [{ id: part.url.slice("attachment:".length), name: part.filename ?? "", kind: "image" as const, url: `/api/chat/c1/attachments/${part.url.slice("attachment:".length)}`, mediaType: part.mediaType }]
          : [],
      );
      return items.length > 0 ? { label: "Вложения", items } : undefined;
    },
  }),
};

function GeneratedImages({ items, aspectRatio }: GeneratedImagesView) {
  return (
    <div data-kind="images" data-ratio={aspectRatio}>
      {items.map((item) =>
        item.state === "ready" ? (
          <button key={item.key} type="button" data-image={item.key} data-src={item.src} onClick={(event) => item.onOpen(event.currentTarget)}>
            {item.alt}
          </button>
        ) : (
          <span key={item.key} data-state={item.state} />
        ),
      )}
    </div>
  );
}
function MediaViewer({ items, index }: MediaViewerProps) {
  return <div role="dialog" data-index={index} data-keys={items.map((item) => item.key).join(",")} data-sizes={items.map((item) => (item.kind === "image" ? `${item.width ?? ""}x${item.height ?? ""}` : "")).join(",")} />;
}
const fullSkin: ChatSkin = { ...stubSkin, GeneratedImages, MediaViewer };

const toolRows = () => [...document.querySelectorAll<HTMLElement>('[data-kind="tool"]')].map((row) => row.dataset.tool);

describe("AgentChat: картинки агента (T046, FR-033, FR-043, FR-046)", () => {
  it("вызов generate_images рисуется скином GeneratedImages с видом клиента; другие инструменты — строкой", async () => {
    describeCall.mockClear();
    renderAgentChat(fakeChatServer({ history: feed }), { skin: fullSkin, images });
    await screen.findByText("ответ m2");
    expect(document.querySelector('[data-kind="images"]')?.getAttribute("data-ratio")).toBe("16:9");
    expect(document.querySelector('[data-image="y"]')?.getAttribute("data-src")).toBe("/api/chat/c1/attachments/y");
    expect(toolRows()).toEqual(["search"]);
    expect(describeCall).toHaveBeenCalledWith(expect.objectContaining({ api: "/api/chat", chatId: "c1" }));
    expect(describeCall.mock.calls.every(([call]) => call.part.toolCallId === "g1")).toBe(true);
  });

  it("без images или без GeneratedImages в скине — обычная строка инструмента", async () => {
    const first = renderAgentChat(fakeChatServer({ history: feed }), { skin: fullSkin });
    await screen.findByText("ответ m2");
    expect(toolRows()).toEqual(["generate_images", "search"]);
    first.unmount();

    renderAgentChat(fakeChatServer({ history: feed }), { skin: { ...stubSkin, MediaViewer }, images });
    await screen.findByText("ответ m2");
    expect(toolRows()).toEqual(["generate_images", "search"]);
    expect(document.querySelector('[data-kind="images"]')).toBeNull();
  });

  it("клик по картинке агента открывает карусель всех картинок ветки по порядку ленты", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: fullSkin, images, attachments });
    await screen.findByText("ответ m2");
    fireEvent.click(document.querySelector('[data-image="y"]')!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog?.getAttribute("data-keys")).toBe("a,x,y,c");
    expect(dialog?.getAttribute("data-index")).toBe("2");
    expect(dialog.dataset.sizes!.split(",")[1]).toBe("1088x608");
  });

  it("скин без окна просмотра: клик по картинке ничего не ломает", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: { ...stubSkin, GeneratedImages }, images });
    await screen.findByText("ответ m2");
    fireEvent.click(document.querySelector('[data-image="x"]')!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("AgentChat: несколько источников картинок в одном чате (генерация + библиотека)", () => {
  const library: ImagesClient = {
    toolName: "show_image",
    describe: ({ part, openImage }) =>
      part.state === "output-available"
        ? {
            ordered: 1,
            aspectRatio: "3:2",
            wide: true,
            items: [{ state: "ready", key: part.toolCallId, src: "/library/cell.png", alt: "Схема клетки", caption: "Строение клетки", width: 1200, height: 800, onOpen: (trigger) => openImage(part.toolCallId, trigger) }],
            stopped: false,
          }
        : undefined,
  };
  const libraryCall = (toolCallId: string) => ({ type: "tool-show_image", toolCallId, state: "output-available", input: { id: "cell" }, output: { картинка: {} } });
  const mixed = [question("u1", [file("a")]), answer("m1", [imagesCall("g1", ["x"]), libraryCall("l1"), { type: "tool-search", toolCallId: "s1", state: "output-available", input: {}, output: "найдено" }])];

  it("images списком: каждый вызов рисует свой клиент, вид с подписью доходит до скина", async () => {
    let seen: GeneratedImagesView | undefined;
    const Spy = (view: GeneratedImagesView) => {
      if (view.wide) seen = view;
      return <GeneratedImages {...view} />;
    };
    renderAgentChat(fakeChatServer({ history: mixed }), { skin: { ...fullSkin, GeneratedImages: Spy }, images: [images, library] });
    await screen.findByText("ответ m1");
    expect(document.querySelector('[data-image="x"]')).not.toBeNull();
    expect(document.querySelector('[data-image="l1"]')?.getAttribute("data-src")).toBe("/library/cell.png");
    expect(toolRows()).toEqual(["search"]);
    expect(seen?.items[0]).toMatchObject({ caption: "Строение клетки" });
  });

  it("окно просмотра листает картинки обоих источников по порядку ответа", async () => {
    renderAgentChat(fakeChatServer({ history: mixed }), { skin: fullSkin, images: [images, library], attachments });
    await screen.findByText("ответ m1");
    fireEvent.click(document.querySelector('[data-image="l1"]')!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("data-keys")).toBe("a,x,l1");
    expect(dialog.getAttribute("data-index")).toBe("2");
    expect(dialog.dataset.sizes!.split(",")[2]).toBe("1200x800");
  });

  it("один клиент, как раньше, работает без изменений; библиотека без генерации — тоже", async () => {
    renderAgentChat(fakeChatServer({ history: mixed }), { skin: fullSkin, images: library });
    await screen.findByText("ответ m1");
    expect(document.querySelector('[data-image="l1"]')).not.toBeNull();
    expect(toolRows()).toEqual(["generate_images", "search"]);
  });
});
