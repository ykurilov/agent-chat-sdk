// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SafeMarkdown } from "../src/safe-markdown";

afterEach(cleanup);

describe("ссылки в тексте модели", () => {
  it("клик по обезвреженной ссылке ничего не делает; обычные ссылки не трогаются", () => {
    render(<SafeMarkdown markdown={["[жми](javascript:alert(1))", "[внутрь](/chat)", "[наружу](https://example.com)"].join("\n\n")} />);
    const disarmed = screen.getByText("жми");
    expect(disarmed.getAttribute("href") ?? "").not.toMatch(/javascript/i);
    // `fireEvent.click` возвращает false, если переход отменён.
    expect(fireEvent.click(disarmed)).toBe(false);
    expect(fireEvent.click(screen.getByText("внутрь"))).toBe(true);
    expect(fireEvent.click(screen.getByText("наружу"))).toBe(true);
    const middleClick = (target: Element) => fireEvent(target, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(middleClick(disarmed)).toBe(false);
    expect(middleClick(screen.getByText("наружу"))).toBe(true);
  });
});
