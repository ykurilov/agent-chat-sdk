// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AgentVideoView } from "@ykurilov/agent-chat-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TandemAgentVideo } from "../src/agent-video";
import { tandemSkin } from "../src/index";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fullscreenEnabled");
});

const view = (fields: Partial<AgentVideoView> = {}): AgentVideoView => ({
  id: "call-1",
  title: "Нейросети за 18 минут",
  provider: "youtube",
  embedUrl: "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0&start=200",
  pageUrl: "https://www.youtube.com/watch?v=aircAruvnKk&t=200s",
  poster: "/posters/neural.jpg",
  duration: "18:40",
  start: "3:20",
  ...fields,
});

const fullscreen = (enabled: boolean) => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: enabled });

describe("видео агента в Тандеме (T010, FR-015)", () => {
  it("скин подключает AgentVideo", () => {
    expect(tandemSkin.AgentVideo).toBe(TandemAgentVideo);
  });

  it("карточка: обложка без referrer, название, длительность, «с 3:20»; 16:9; плеера до нажатия нет", () => {
    const { container } = render(<TandemAgentVideo {...view()} />);
    const button = screen.getByRole("button", { name: /Смотреть видео: Нейросети за 18 минут/ });
    expect(button.getAttribute("type")).toBe("button");
    const poster = button.querySelector("img")!;
    expect(poster.getAttribute("src")).toBe("/posters/neural.jpg");
    expect(poster.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.textContent).toContain("Нейросети за 18 минут");
    expect(container.textContent).toContain("18:40");
    expect(container.textContent).toContain("с 3:20");
    expect(container.querySelector("[data-video-frame]")!.className).toContain("aspect-video");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("без обложки — своя заглушка, без картинок с площадки", () => {
    const { container } = render(<TandemAgentVideo {...view({ poster: undefined, start: undefined, duration: undefined })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-video-placeholder]")).not.toBeNull();
    expect(container.textContent).not.toContain("с ");
  });

  it("нажатие → iframe с адресом плеера, autoplay, полноэкранным режимом и referrerpolicy; карточки больше нет", () => {
    const { container } = render(<TandemAgentVideo {...view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Смотреть видео/ }));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(view().embedUrl);
    expect(frame.getAttribute("title")).toBe("Нейросети за 18 минут");
    expect(frame.getAttribute("allow")).toBe("autoplay; encrypted-media; picture-in-picture; fullscreen");
    expect(frame.hasAttribute("allowfullscreen")).toBe(true);
    expect(frame.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(screen.queryByRole("button", { name: /Смотреть видео/ })).toBeNull();
    expect(container.querySelector("[data-video-frame]")!.className).toContain("aspect-video");
  });

  it("«На весь экран» — только когда браузер умеет, и разворачивает обёртку плеера", () => {
    fullscreen(true);
    const request = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = request;
    const { container } = render(<TandemAgentVideo {...view()} />);
    expect(screen.queryByRole("button", { name: "На весь экран" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Смотреть видео/ }));
    fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(container.querySelector("[data-video-frame]"));
  });

  it("браузер без полноэкранного режима (iPhone) — кнопки нет, у плеера своя", () => {
    fullscreen(false);
    render(<TandemAgentVideo {...view()} />);
    fireEvent.click(screen.getByRole("button", { name: /Смотреть видео/ }));
    expect(screen.queryByRole("button", { name: "На весь экран" })).toBeNull();
  });
});
