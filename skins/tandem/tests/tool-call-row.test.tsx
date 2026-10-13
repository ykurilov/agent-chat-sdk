// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemToolCallRow } from "../src/tool-call-row";

afterEach(cleanup);

type Props = Parameters<typeof TandemToolCallRow>[0];

const renderRow = (props: Partial<Props>) =>
  render(<TandemToolCallRow toolName="web_search" state="done" open onOpenChange={vi.fn()} {...props} />);

describe("ссылки в результате инструмента", () => {
  it("адреса http и https кликабельны, открываются в новой вкладке без передачи окна", () => {
    renderRow({ output: "1. [Node.js](https://nodejs.org/releases)\n   Текущая версия\n2. http://example.com/a?b=1" });

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://nodejs.org/releases", "http://example.com/a?b=1"]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("текст вокруг ссылок остаётся на месте, лишние знаки в конец адреса не попадают", () => {
    const { container } = renderRow({ output: "Смотри https://a.example/x, потом (https://b.example/y)." });

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["https://a.example/x", "https://b.example/y"]);
    expect(container.textContent).toContain("Смотри https://a.example/x, потом (https://b.example/y).");
  });

  it.each(["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://a.example/x", "vbscript:x"])(
    "%s ссылкой не становится",
    (address) => {
      renderRow({ output: `Адрес: ${address}` });
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("строка с разметкой не превращается в разметку страницы", () => {
    const { container } = renderRow({ output: '<img src=x onerror="alert(1)"> https://a.example' });
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("ссылки видны только в развёрнутой строке", () => {
    renderRow({ output: "https://a.example", open: false });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("при ошибке инструмента текст ошибки без ссылок-ловушек не ломается", () => {
    renderRow({ state: "error", errorText: "Не открылось", output: undefined });
    expect(screen.getByText("Не открылось")).toBeTruthy();
  });
});

describe("снимок страницы", () => {
  const output = { pageUrl: "https://example.com/page", screenshotUrl: "https://storage.example/shots/1.png" };

  it("рисуется картинкой: ленивая загрузка, ограниченный размер, безопасная передача источника", () => {
    renderRow({ toolName: "page_screenshot", output });

    const image = screen.getByRole("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("https://storage.example/shots/1.png");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image.className).toMatch(/max-h-/);
    expect(image.className).toMatch(/max-w-full|w-full/);
    expect(image.getAttribute("alt")).toBeTruthy();
  });

  it("рядом ссылка на страницу", () => {
    renderRow({ toolName: "page_screenshot", output });
    expect(screen.getByRole("link", { name: /example\.com\/page/ }).getAttribute("href")).toBe("https://example.com/page");
  });

  it("картинка в виде data:image тоже рисуется", () => {
    renderRow({ toolName: "page_screenshot", output: { pageUrl: "https://example.com", screenshotUrl: "data:image/png;base64,AAAA" } });
    expect(screen.getByRole("img").getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });

  it("не загрузилась — вместо картинки текст со ссылкой на страницу", () => {
    renderRow({ toolName: "page_screenshot", output });

    fireEvent.error(screen.getByRole("img"));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/не загрузился|недоступен/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /example\.com\/page/ }).getAttribute("href")).toBe("https://example.com/page");
  });

  it.each(["javascript:alert(1)", "data:text/html;base64,AAAA", "file:///etc/passwd", "blob:https://a.example/x"])(
    "адрес снимка %s картинкой не рисуется",
    (screenshotUrl) => {
      renderRow({ toolName: "page_screenshot", output: { pageUrl: "https://example.com", screenshotUrl } });
      expect(screen.queryByRole("img")).toBeNull();
    },
  );

  it("адрес страницы не http — ссылки на страницу нет", () => {
    renderRow({ toolName: "page_screenshot", output: { pageUrl: "javascript:alert(1)", screenshotUrl: "https://storage.example/1.png" } });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("любой другой объект показывается как раньше — текстом", () => {
    renderRow({ toolName: "calculator", output: { total: 42 } });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText(/"total": 42/)).toBeTruthy();
  });
});
