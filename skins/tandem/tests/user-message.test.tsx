// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { MessageAttachmentsView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it } from "vitest";
import { TandemUserMessage } from "../src/user-message";

afterEach(cleanup);

const view: MessageAttachmentsView = {
  label: "Вложения",
  items: [
    { id: "a", name: "кот.png", kind: "image", url: "/api/chat/c1/attachments/a", mediaType: "image/png" },
    { id: "b", name: "счёт.pdf", kind: "file", url: "/api/chat/c1/attachments/b", mediaType: "application/pdf", caption: "PDF" },
  ],
};

describe("реплика человека Тандема: вложения", () => {
  it("без вложений — только текст, как раньше", () => {
    render(<TandemUserMessage text="Привет" />);
    expect(screen.getByText("Привет")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("картинка — миниатюра-ссылка на файл, файл — плашка со ссылкой на скачивание и подписью", () => {
    render(<TandemUserMessage text="Смотри" attachments={view} />);
    expect(screen.getByRole("list", { name: "Вложения" })).toBeTruthy();
    const picture = screen.getByAltText("кот.png");
    expect(picture.getAttribute("src")).toBe("/api/chat/c1/attachments/a");
    expect(picture.closest("a")?.getAttribute("href")).toBe("/api/chat/c1/attachments/a");
    const file = screen.getByRole("link", { name: /счёт\.pdf/ });
    expect(file.getAttribute("href")).toBe("/api/chat/c1/attachments/b");
    expect(file.textContent).toContain("PDF");
    expect(screen.getByText("Смотри")).toBeTruthy();
  });

  it("только файлы без текста: пустого пузыря нет", () => {
    const { container } = render(<TandemUserMessage text="" attachments={view} />);
    expect(container.querySelector("[data-user-text]")).toBeNull();
    expect(screen.getByAltText("кот.png")).toBeTruthy();
  });
});
