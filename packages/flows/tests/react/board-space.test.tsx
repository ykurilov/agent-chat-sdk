// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBoardSpace, useFullscreenBehavior } from "../../src/react/editor/board-space";
import type { FlowSelection } from "../../src/react/editor/use-flow-editor";

// Место на экране: легенда, мини-карта, панель «Сценарий», полный экран.

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const overview: FlowSelection = { kind: "overview" };
const edit = { selection: overview, mode: "edit" as const };

describe("useBoardSpace", () => {
  it("по умолчанию: легенда свёрнута, мини-карта и панель открыты, шапка полная", () => {
    const { result } = renderHook(() => useBoardSpace({}, edit));
    expect(result.current).toMatchObject({ header: "full", legendOpen: false, minimapOpen: true, inspectorOpen: true, fullscreen: false });
  });

  it("режимы из пропсов; «hidden» убирает совсем", () => {
    const { result } = renderHook(() => useBoardSpace({ legend: "open", minimap: "collapsed" }, edit));
    expect(result.current).toMatchObject({ legendOpen: true, minimapOpen: false });
    const hidden = renderHook(() => useBoardSpace({ legend: "hidden", minimap: "hidden" }, edit));
    expect(hidden.result.current).toMatchObject({ legendHidden: true, legendOpen: false, minimapHidden: true, minimapOpen: false });
  });

  it("свёрнутое запоминается и читается заново после перезагрузки", () => {
    const first = renderHook(() => useBoardSpace({}, edit));
    act(() => first.result.current.toggleMinimap());
    act(() => first.result.current.toggleInspector());
    act(() => first.result.current.toggleLegend());
    expect(first.result.current).toMatchObject({ minimapOpen: false, inspectorOpen: false, legendOpen: true });
    first.unmount();

    const second = renderHook(() => useBoardSpace({}, edit));
    expect(second.result.current).toMatchObject({ minimapOpen: false, inspectorOpen: false, legendOpen: true });
  });

  it("свой ключ хранилища; null — не запоминать; битое значение не ломает", () => {
    const own = renderHook(() => useBoardSpace({ storageKey: "my-app:board" }, edit));
    act(() => own.result.current.toggleMinimap());
    expect(JSON.parse(window.localStorage.getItem("my-app:board")!)).toEqual({ minimap: false });
    own.unmount();

    window.localStorage.setItem("agent-chat-flow-board", "{не json");
    const forgetful = renderHook(() => useBoardSpace({ storageKey: null }, edit));
    act(() => forgetful.result.current.toggleMinimap());
    expect(forgetful.result.current.minimapOpen).toBe(false);
    expect(window.localStorage.getItem("agent-chat-flow-board")).toBe("{не json");
    const broken = renderHook(() => useBoardSpace({}, edit));
    expect(broken.result.current.minimapOpen).toBe(true);
  });

  it("хранилище недоступно — работает без запоминания", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("закрыто"); } });
    try {
      const { result } = renderHook(() => useBoardSpace({}, edit));
      act(() => result.current.toggleMinimap());
      expect(result.current.minimapOpen).toBe(false);
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });

  it("inspector=collapsible: свёрнута, пока ничего не выбрано; выбор раскрывает, клик в пустоту сворачивает", () => {
    let selection: FlowSelection = overview;
    const { result, rerender } = renderHook(() => useBoardSpace({ inspector: "collapsible" }, { selection, mode: "edit" }));
    expect(result.current.inspectorOpen).toBe(false);

    selection = { kind: "state", stateId: "offer" };
    rerender();
    expect(result.current.inspectorOpen).toBe(true);

    act(() => result.current.toggleInspector());
    expect(result.current.inspectorOpen).toBe(false);
    selection = { kind: "state", stateId: "intro" };
    rerender();
    expect(result.current.inspectorOpen).toBe(true);

    selection = overview;
    rerender();
    expect(result.current.inspectorOpen).toBe(false);
    act(() => result.current.toggleInspector());
    expect(result.current.inspectorOpen).toBe(true);
    // Это не запоминается: в хранилище ничего нет.
    expect(window.localStorage.getItem("agent-chat-flow-board")).toBeNull();
  });

  it("проверка и прогон держат панель открытой, даже если свёрнута", () => {
    let mode: "edit" | "check" | "run" = "edit";
    const { result, rerender } = renderHook(() => useBoardSpace({}, { selection: overview, mode }));
    act(() => result.current.toggleInspector());
    expect(result.current.inspectorOpen).toBe(false);
    mode = "check";
    rerender();
    expect(result.current.inspectorOpen).toBe(true);
    mode = "edit";
    rerender();
    expect(result.current.inspectorOpen).toBe(false);
  });

  it("в проверке и прогоне кнопка панели не нужна и выбор не записывается", () => {
    const { result, rerender } = renderHook(({ mode }) => useBoardSpace({}, { selection: overview, mode }), { initialProps: { mode: "check" as "edit" | "check" } });
    expect(result.current.inspectorToggleable).toBe(false);
    act(() => result.current.toggleInspector());
    expect(result.current.inspectorOpen).toBe(true);
    expect(window.localStorage.getItem("agent-chat-flow-board")).toBeNull();
    rerender({ mode: "edit" });
    expect(result.current.inspectorToggleable).toBe(true);
    expect(result.current.inspectorOpen).toBe(true);
  });

  it("полный экран выключили на лету — состояние сбрасывается и не возвращается", () => {
    const { result, rerender } = renderHook(({ on }) => useBoardSpace({ fullscreen: on }, edit), { initialProps: { on: true } });
    act(() => result.current.setFullscreen(true));
    expect(result.current.fullscreen).toBe(true);
    rerender({ on: false });
    rerender({ on: true });
    expect(result.current.fullscreen).toBe(false);
  });

  it("fullscreen=false: кнопки нет и экран не разворачивается", () => {
    const { result } = renderHook(() => useBoardSpace({ fullscreen: false }, edit));
    act(() => result.current.setFullscreen(true));
    expect(result.current).toMatchObject({ fullscreenAllowed: false, fullscreen: false });
  });
});

describe("useFullscreenBehavior", () => {
  function setup(active: boolean, blocked = false) {
    const root = document.createElement("div");
    root.innerHTML = '<button id="a">a</button><button id="b" data-flow-fullscreen-toggle>b</button><button id="c">c</button>';
    document.body.append(root);
    const exits: number[] = [];
    const hook = renderHook(({ on, block }) => useFullscreenBehavior(on, () => exits.push(1), block, root), { initialProps: { on: active, block: blocked } });
    return { root, exits, hook };
  }

  it("Esc выходит и возвращает фокус на кнопку; с открытым окном поверх — нет", () => {
    const { root, exits, hook } = setup(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(exits).toHaveLength(1);
    expect(document.activeElement).toBe(root.querySelector("#b"));
    hook.rerender({ on: true, block: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(exits).toHaveLength(1);
    hook.rerender({ on: false, block: false });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(exits).toHaveLength(1);
    root.remove();
  });

  it("страница под редактором не прокручивается, пока он на весь экран", () => {
    document.body.style.overflow = "auto";
    const { root, hook } = setup(true);
    expect(document.body.style.overflow).toBe("hidden");
    hook.rerender({ on: false, block: false });
    expect(document.body.style.overflow).toBe("auto");
    root.remove();
    document.body.style.overflow = "";
  });

  it("Tab по кругу внутри редактора", () => {
    const { root, hook } = setup(true);
    // jsdom не считает вёрстку: делаем кнопки «видимыми».
    root.querySelectorAll("button").forEach((button) => (button.getClientRects = () => [{}] as unknown as DOMRectList));
    const prevented: string[] = [];
    const event = (shiftKey: boolean, target: EventTarget = document.activeElement!) => ({ key: "Tab", shiftKey, target, preventDefault: () => prevented.push("x") });
    (root.querySelector("#c") as HTMLElement).focus();
    hook.result.current(event(false));
    expect(document.activeElement).toBe(root.querySelector("#a"));
    hook.result.current(event(true));
    expect(document.activeElement).toBe(root.querySelector("#c"));
    expect(prevented).toHaveLength(2);
    root.remove();
  });

  it("Tab из окна поверх (портал в body, вне редактора) не трогаем", () => {
    const { root, hook } = setup(true);
    root.querySelectorAll("button").forEach((button) => (button.getClientRects = () => [{}] as unknown as DOMRectList));
    const outside = document.createElement("textarea");
    document.body.append(outside);
    outside.focus();
    const prevented: string[] = [];
    hook.result.current({ key: "Tab", shiftKey: false, target: outside, preventDefault: () => prevented.push("x") });
    expect(prevented).toHaveLength(0);
    expect(document.activeElement).toBe(outside);
    outside.remove();
    root.remove();
  });

  it("Esc в поле ввода внутри редактора только снимает фокус; вне поля — выход", () => {
    const { root, exits } = setup(true);
    const input = document.createElement("input");
    root.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(exits).toHaveLength(0);
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(root.querySelector("#a")!, { key: "Escape" });
    expect(exits).toHaveLength(1);
    root.remove();
  });
});
