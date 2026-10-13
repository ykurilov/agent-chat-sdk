// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { AttachmentsController, AttachmentsPlugin, MessageAttachmentsView } from "../src/attachments-contract";
import type { AgentChatMessage } from "../src/chat-types";
import type { ChatSkin, MediaViewerProps } from "../src/skin-contract";
import { fakeChatServer } from "./support/fake-chat-server";
import type { HistoryMessage } from "./support/fake-chat-server";
import { renderAgentChat, setupChatDom } from "./support/chat-dom";
import { stubSkin } from "./support/stub-skin";
import { leaveViewerHistory, viewerEntry } from "./support/viewer-history";

setupChatDom();

// Окно, открытое прошлым тестом, при уборке уходит из истории «назад»: следующий тест ждёт возврата к странице.
beforeEach(leaveViewerHistory);

const file = (id: string, filename: string, mediaType: string) => ({ type: "file", url: `attachment:${id}`, filename, mediaType });
const question = (id: string, files: Array<Record<string, unknown>>): HistoryMessage => ({
  id,
  role: "user",
  parts: [...files, { type: "text", text: `вопрос ${id}` }],
});
const answer = (id: string): HistoryMessage => ({ id, role: "assistant", parts: [{ type: "text", text: `ответ ${id}`, state: "done" }], metadata: { status: "complete" } });

/** Лента: кот и счёт, ответ, пёс, ответ. */
const feed = [
  question("u1", [file("a", "кот.png", "image/png"), file("b", "счёт.pdf", "application/pdf")]),
  answer("m1"),
  question("u2", [file("c", "пёс.jpg", "image/jpeg")]),
  answer("m2"),
];

function describeAttachments(message: AgentChatMessage): MessageAttachmentsView | undefined {
  const items = message.parts.flatMap((part) =>
    part.type === "file"
      ? [
          {
            id: part.url.slice("attachment:".length),
            name: part.filename ?? "файл",
            kind: part.mediaType.startsWith("image/") ? ("image" as const) : ("file" as const),
            url: `/api/chat/c1/attachments/${part.url.slice("attachment:".length)}`,
            mediaType: part.mediaType,
          },
        ]
      : [],
  );
  return items.length > 0 ? { label: "Вложения", items } : undefined;
}

const attachments: AttachmentsPlugin = {
  useController: (): AttachmentsController => ({
    composer: { items: [], onAddFiles: () => undefined, onRemove: () => undefined, accept: "*" },
    ready: true,
    hasFiles: false,
    readFiles: () => [],
    markSent: () => undefined,
    restoreFiles: () => undefined,
    describe: describeAttachments,
  }),
};

/** Пробный скин: миниатюра с `onOpen` — кнопка, без него — просто имя; окно показывает свои свойства. */
const UserMessage: ChatSkin["UserMessage"] = ({ text, attachments: files }) => (
  <div>
    {files?.items.map((item) =>
      item.onOpen ? (
        <button key={item.id} type="button" data-open={item.id} onClick={(event) => item.onOpen!(event.currentTarget)}>
          {item.name}
        </button>
      ) : (
        <span key={item.id} data-plain={item.id}>
          {item.name}
        </span>
      ),
    )}
    <p data-kind="user">{text}</p>
  </div>
);
function MediaViewer({ items, index, onIndexChange, onClose }: MediaViewerProps) {
  return (
    <div role="dialog" data-index={index} data-keys={items.map((item) => item.key).join(",")}>
      <button type="button" onClick={() => onIndexChange(index + 1)}>
        дальше
      </button>
      <button type="button" onClick={onClose}>
        закрыть
      </button>
    </div>
  );
}
const skinWithViewer: ChatSkin = { ...stubSkin, UserMessage, MediaViewer };
const skinWithoutViewer: ChatSkin = { ...stubSkin, UserMessage };

const opener = (id: string) => document.querySelector<HTMLButtonElement>(`[data-open="${id}"]`);

/** Окно ленты дорисовывает сообщения выше последнего не сразу: ждать оба вопроса, а не только последний. */
async function feedShown() {
  await screen.findByText("вопрос u1");
  await screen.findByText("вопрос u2");
}

describe("AgentChat: окно просмотра", () => {
  it("скин без MediaViewer: у миниатюр нет onOpen, окна нет — всё как в 0.15", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: skinWithoutViewer, attachments });
    await feedShown();
    expect(document.querySelector("[data-open]")).toBeNull();
    expect(document.querySelector('[data-plain="a"]')).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("onOpen есть только у картинок; клик открывает карусель всех картинок ветки на этой картинке", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: skinWithViewer, attachments });
    await feedShown();
    expect(opener("b")).toBeNull();
    expect(document.querySelector('[data-plain="b"]')).not.toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(opener("c")!);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-keys")).toBe("a,c");
    expect(dialog.getAttribute("data-index")).toBe("1");
  });

  it("листание и закрытие: фокус возвращается на миниатюру, с которой открыли", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: skinWithViewer, attachments });
    await feedShown();
    fireEvent.click(opener("a")!);
    fireEvent.click(screen.getByText("дальше"));
    expect(screen.getByRole("dialog").getAttribute("data-index")).toBe("1");
    fireEvent.click(screen.getByText("закрыть"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener("a"));
    await waitFor(() => expect(viewerEntry()).toBeUndefined());
  });

  it("жест «назад» закрывает окно, страница остаётся", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: skinWithViewer, attachments });
    await feedShown();
    const address = location.href;
    fireEvent.click(opener("a")!);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(location.href).toBe(address);
    expect(document.activeElement).toBe(opener("a"));
  });

  it("без плагина вложений картинок нет: окно не открывается и не мешает", async () => {
    renderAgentChat(fakeChatServer({ history: feed }), { skin: skinWithViewer });
    await feedShown();
    expect(document.querySelector("[data-open]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
