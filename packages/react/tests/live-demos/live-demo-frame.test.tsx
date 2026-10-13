// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_DEMO_HEIGHT_MESSAGE } from "../../src/live-demos/live-demo-document";
import { LiveDemoFrame } from "../../src/live-demos/live-demo-frame";
import type { LiveDemoColors } from "../../src/skin-contract";

afterEach(cleanup);

const colors: LiveDemoColors = { background: "#fff", surface: "#eee", text: "#111", muted: "#666", border: "#ccc", accent: "#06c", onAccent: "#fff", dark: false };
const frameOf = (container: HTMLElement) => container.querySelector("iframe")!;
const post = (source: MessageEventSource | null, data: unknown) => act(() => void window.dispatchEvent(new MessageEvent("message", { data, source })));

describe("рамка живой демонстрации (043 FR-003, FR-004, FR-007)", () => {
  it("атрибуты: только allow-scripts, документ через srcdoc, без src, без адреса-источника, подпись", () => {
    const { container } = render(<LiveDemoFrame source="<p>Привет</p>" colors={colors} title="Живая демонстрация" onLeftPage={() => undefined} />);
    const frame = frameOf(container);
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.hasAttribute("src")).toBe(false);
    // Внешняя рамка — промежуточный документ: код модели в нём строкой, вложенная рамка создаётся его скриптом.
    expect(frame.getAttribute("srcdoc")).toContain("frame-src about:");
    expect(frame.getAttribute("srcdoc")).toContain("\\u003cp>Привет\\u003c/p>");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("title")).toBe("Живая демонстрация");
    expect(frame.style.width).toBe("100%");
  });

  it("высота — из сообщения своей рамки, не выше 2/3 экрана; чужое окно и неверные сообщения не меняют её", () => {
    vi.stubGlobal("innerHeight", 900);
    const { container } = render(<LiveDemoFrame source="x" colors={colors} title="t" onLeftPage={() => undefined} />);
    const frame = frameOf(container);
    const before = frame.style.height;
    post(window, { type: LIVE_DEMO_HEIGHT_MESSAGE, height: 300 });
    post(frame.contentWindow, { type: LIVE_DEMO_HEIGHT_MESSAGE, height: "300" });
    post(frame.contentWindow, { type: LIVE_DEMO_HEIGHT_MESSAGE, height: 99_999 });
    expect(frame.style.height).toBe(before);
    post(frame.contentWindow, { type: LIVE_DEMO_HEIGHT_MESSAGE, height: 300 });
    expect(frame.style.height).toBe("300px");
    post(frame.contentWindow, { type: LIVE_DEMO_HEIGHT_MESSAGE, height: 2000 });
    expect(frame.style.height).toBe("600px");
    vi.unstubAllGlobals();
  });

  it("новые цвета — новый документ рамки (смена темы перерисовывает)", () => {
    const { container, rerender } = render(<LiveDemoFrame source="x" colors={colors} title="t" onLeftPage={() => undefined} />);
    expect(frameOf(container).getAttribute("srcdoc")).toContain("--bg:#fff");
    rerender(<LiveDemoFrame source="x" colors={{ ...colors, background: "#000", dark: true }} title="t" onLeftPage={() => undefined} />);
    expect(frameOf(container).getAttribute("srcdoc")).toContain("--bg:#000");
  });

  it("сообщение «ушла со страницы» от своей рамки — onLeftPage; от чужого окна — нет", () => {
    const onLeftPage = vi.fn();
    const { container } = render(<LiveDemoFrame source="x" colors={colors} title="t" onLeftPage={onLeftPage} />);
    const frame = frameOf(container);
    window.dispatchEvent(new MessageEvent("message", { data: { type: "agent-chat-live-demo:left" }, source: window }));
    expect(onLeftPage).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "agent-chat-live-demo:left" }, source: frame.contentWindow }));
    expect(onLeftPage).toHaveBeenCalledTimes(1);
  });

  it("вторая загрузка рамки — документ ушёл со страницы: onLeftPage", () => {
    const onLeftPage = vi.fn();
    const { container } = render(<LiveDemoFrame source="x" colors={colors} title="t" onLeftPage={onLeftPage} />);
    const frame = frameOf(container);
    const calls = onLeftPage.mock.calls.length;
    fireEvent.load(frame);
    fireEvent.load(frame);
    expect(onLeftPage.mock.calls.length).toBeGreaterThan(calls);
  });
});
