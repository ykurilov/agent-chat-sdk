// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MessageAttachmentsView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemMessageEditor } from "../src/message-editor";
import { TandemUserMessage } from "../src/user-message";

afterEach(cleanup);

function viewWithOpen(onOpen: (trigger: HTMLElement) => void): MessageAttachmentsView {
  return {
    label: "Вложения",
    items: [
      { id: "a", name: "кот.png", kind: "image", url: "/api/chat/c1/attachments/a", mediaType: "image/png", onOpen },
      { id: "b", name: "счёт.pdf", kind: "file", url: "/api/chat/c1/attachments/b", mediaType: "application/pdf", caption: "PDF" },
    ],
  };
}

describe("миниатюры Тандема с окном просмотра", () => {
  it("картинка с onOpen — кнопка «Открыть картинку» с курсором-лупой; нажатие отдаёт кнопку как источник", () => {
    const onOpen = vi.fn();
    render(<TandemUserMessage text="Смотри" attachments={viewWithOpen(onOpen)} />);
    const opener = screen.getByRole("button", { name: /Открыть картинку/ });
    expect(opener.getAttribute("aria-label")).toContain("кот.png");
    expect(opener.className).toContain("cursor-zoom-in");
    expect(opener.querySelector("img")?.getAttribute("src")).toBe("/api/chat/c1/attachments/a");
    expect(screen.queryByRole("link", { name: /кот/ })).toBeNull();
    fireEvent.click(opener);
    expect(onOpen).toHaveBeenCalledWith(opener);
  });

  it("файл остаётся ссылкой на скачивание", () => {
    render(<TandemUserMessage text="" attachments={viewWithOpen(vi.fn())} />);
    expect(screen.getByRole("link", { name: /счёт\.pdf/ }).getAttribute("href")).toBe("/api/chat/c1/attachments/b");
  });

  it("в поле правки картинка тоже открывается", () => {
    const onOpen = vi.fn();
    render(
      <TandemMessageEditor
        value="Смотри"
        onValueChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        canSave
        attachments={viewWithOpen(onOpen)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Открыть картинку/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
