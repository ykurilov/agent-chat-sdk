// @vitest-environment jsdom
import { ChatLabelsProvider, russianLabels } from "@ykurilov/agent-chat-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemCompactionDivider } from "../src/compaction-divider";
import { tandemSkin } from "../src";

afterEach(cleanup);

const summary = "## Цель\nПереезд склада\n\n- адрес: **Тверская, 15**";

describe("разделитель «История сжата»", () => {
  it("картинка с чужого адреса в сводке — ссылка, браузер её не грузит", () => {
    const evil = "https://evil.example/p.png?d=secret";
    const { container } = render(<TandemCompactionDivider summary={`## Цель\n![](${evil})`} open onOpenChange={vi.fn()} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: russianLabels.externalImageLink }).getAttribute("href")).toBe(evil);
  });

  it("свёрнутый — только строка-кнопка; сводки нет", () => {
    render(<TandemCompactionDivider summary={summary} open={false} onOpenChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "История сжата" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Переезд склада")).toBeNull();
  });

  it("нажатие просит раскрыть; раскрытый — сводка Markdown и пояснение, нажатие просит свернуть", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<TandemCompactionDivider summary={summary} open={false} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "История сжата" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);

    rerender(<TandemCompactionDivider summary={summary} open onOpenChange={onOpenChange} />);
    expect(screen.getByRole("heading", { name: "Цель" })).toBeTruthy();
    expect(screen.getByText("Тверская, 15").tagName).toBe("STRONG");
    expect(screen.getByText(russianLabels.historyCompactedHint)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "История сжата" }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("кнопка связана со сводкой (aria-controls) и надписи идут из словаря", () => {
    render(
      <ChatLabelsProvider labels={{ ...russianLabels, historyCompacted: "Сжато" }}>
        <TandemCompactionDivider summary={summary} open onOpenChange={vi.fn()} />
      </ChatLabelsProvider>,
    );
    const button = screen.getByRole("button", { name: "Сжато" });
    expect(document.getElementById(button.getAttribute("aria-controls")!)?.textContent).toContain("Переезд склада");
  });

  it("сводка скрыта правами (пустая) — строка без кнопки, раскрывать нечего", () => {
    render(<TandemCompactionDivider summary="" open={false} onOpenChange={vi.fn()} />);
    expect(screen.getByText("История сжата")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("входит в скин", () => {
    expect(tandemSkin.CompactionDivider).toBe(TandemCompactionDivider);
  });
});
