// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaViewerItem } from "../../src/media-viewer/media-viewer-types";
import { useMediaViewer } from "../../src/media-viewer/use-media-viewer";
import { leaveViewerHistory } from "../support/viewer-history";

const picture = (key: string): MediaViewerItem => ({ kind: "image", key, src: `/${key}.png`, alt: `${key}.png` });
const threePictures = [picture("a"), picture("b"), picture("c")];

let trigger: HTMLButtonElement;
beforeEach(() => {
  trigger = document.createElement("button");
  document.body.append(trigger);
});
afterEach(async () => {
  cleanup();
  trigger.remove();
  // Записи окна, оставшиеся от теста, не должны путать следующий.
  await leaveViewerHistory();
});

function renderViewer(initial: { items?: MediaViewerItem[]; resetKey?: string } = {}) {
  return renderHook(
    ({ items, resetKey }: { items: MediaViewerItem[]; resetKey: string }) => useMediaViewer({ getItems: () => items, resetKey }),
    { initialProps: { items: initial.items ?? threePictures, resetKey: initial.resetKey ?? "c1" } },
  );
}

const viewerEntry = () => (history.state as { agentChatViewer?: unknown } | null)?.agentChatViewer;

describe("useMediaViewer", () => {
  it("закрыто, пока не открыли", () => {
    const { result } = renderViewer();
    expect(result.current.viewer).toBeNull();
  });

  it("open(key) открывает карусель на этой картинке; onIndexChange листает", () => {
    const { result } = renderViewer();
    act(() => result.current.open("b", trigger));
    expect(result.current.viewer?.items).toEqual(threePictures);
    expect(result.current.viewer?.index).toBe(1);
    act(() => result.current.viewer!.onIndexChange(2));
    expect(result.current.viewer?.index).toBe(2);
  });

  it("неизвестный key окна не открывает", () => {
    const { result } = renderViewer();
    act(() => result.current.open("нет", trigger));
    expect(result.current.viewer).toBeNull();
  });

  it("свои элементы (схема) открываются одни, без карусели чата", () => {
    const { result } = renderViewer();
    const diagram: MediaViewerItem = { kind: "diagram", key: "m1:0", svg: "<svg></svg>", source: "graph TD; A-->B" };
    act(() => result.current.open("m1:0", trigger, [diagram]));
    expect(result.current.viewer?.items).toEqual([diagram]);
    expect(result.current.viewer?.index).toBe(0);
  });

  it("при открытии — запись в истории браузера; прежнее состояние истории (роутер приложения) сохраняется в ней", async () => {
    history.replaceState({ router: "своё" }, "");
    const { result } = renderViewer();
    act(() => result.current.open("a", trigger));
    expect(viewerEntry()).toBeDefined();
    expect((history.state as { router?: string }).router).toBe("своё");
    // Запись своя, а не подмена прежней: «назад» возвращает к состоянию роутера.
    act(() => history.back());
    await waitFor(() => expect(viewerEntry()).toBeUndefined());
    expect(history.state).toEqual({ router: "своё" });
  });

  it("«назад» закрывает окно без ухода со страницы, фокус — на элементе-источнике", async () => {
    const { result } = renderViewer();
    const address = location.href;
    act(() => result.current.open("a", trigger));
    act(() => history.back());
    await waitFor(() => expect(result.current.viewer).toBeNull());
    expect(location.href).toBe(address);
    expect(document.activeElement).toBe(trigger);
  });

  it("закрытие кнопкой убирает свою запись из истории и возвращает фокус", async () => {
    history.replaceState({ router: "своё" }, "");
    const { result } = renderViewer();
    act(() => result.current.open("b", trigger));
    const opened = history.length;
    act(() => result.current.viewer!.onClose());
    expect(result.current.viewer).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await waitFor(() => expect(viewerEntry()).toBeUndefined());
    expect(history.state).toEqual({ router: "своё" });
    // Запись ушла назад: следующее открытие встаёт на её место, а не копит записи.
    act(() => result.current.open("b", trigger));
    expect(history.length).toBe(opened);
  });

  it("закрытие кнопкой: «назад», который убирает запись, окно заново не трогает", async () => {
    const { result } = renderViewer();
    act(() => result.current.open("a", trigger));
    act(() => result.current.viewer!.onClose());
    await waitFor(() => expect(viewerEntry()).toBeUndefined());
    act(() => result.current.open("c", trigger));
    expect(result.current.viewer?.index).toBe(2);
  });

  it("новая картинка в ленте до открытой: окно остаётся на той же картинке", () => {
    const { result, rerender } = renderViewer();
    act(() => result.current.open("b", trigger));
    rerender({ items: [picture("z"), ...threePictures], resetKey: "c1" });
    expect(result.current.viewer?.index).toBe(2);
    expect(result.current.viewer?.items[2]?.key).toBe("b");
  });

  it("открытая картинка пропала из ленты — окно закрывается", () => {
    const { result, rerender } = renderViewer();
    act(() => result.current.open("b", trigger));
    rerender({ items: [picture("a")], resetKey: "c1" });
    expect(result.current.viewer).toBeNull();
  });

  it("смена ветки или чата (resetKey) закрывает окно и убирает запись", async () => {
    const { result, rerender } = renderViewer();
    act(() => result.current.open("a", trigger));
    rerender({ items: threePictures, resetKey: "c2" });
    expect(result.current.viewer).toBeNull();
    await waitFor(() => expect(viewerEntry()).toBeUndefined());
  });

  it("open стабилен между отрисовками: строки ленты с ним не перерисовываются", () => {
    const { result, rerender } = renderViewer();
    const first = result.current.open;
    rerender({ items: [picture("a")], resetKey: "c1" });
    expect(result.current.open).toBe(first);
  });
});
