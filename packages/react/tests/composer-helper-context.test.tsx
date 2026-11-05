// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ComposerHelperProvider, PanelComposerBindingContext, ComposerRegistryContext, createComposerRegistry, useComposerHelper } from "../src/composer-helper-context";
import type { ComposerHelper } from "../src/composer-actions";
afterEach(cleanup);
const helper = (): ComposerHelper => ({ value: "draft", setValue: vi.fn(), send: vi.fn(), addFiles: vi.fn(), addServerFiles: vi.fn(), canSend: true, busy: false, blocked: false });
let seen: ComposerHelper | null;
function Read() { seen = useComposerHelper(); return <output>{seen?.value ?? "none"}</output>; }
it("outside a chat returns null", () => { render(<Read />); expect(screen.getByText("none")).toBeTruthy(); });
it("local helper updates and retained commands cannot target a different chat or unmounted field", () => {
  const first = helper();
  const { rerender, unmount } = render(<ComposerHelperProvider api="/chat" chatId="one" helper={first} enabled><Read /></ComposerHelperProvider>);
  const old = seen!;
  act(() => old.addServerFiles([])); expect(first.addServerFiles).toHaveBeenCalledOnce();
  const second = helper(); second.value = "next";
  rerender(<ComposerHelperProvider api="/chat" chatId="two" helper={second} enabled><Read /></ComposerHelperProvider>);
  act(() => { old.setValue("bad"); old.addFiles([]); old.addServerFiles([]); old.send(); });
  expect(second.setValue).not.toHaveBeenCalled(); expect(first.setValue).not.toHaveBeenCalled();
  expect(screen.getByText("next")).toBeTruthy();
  const current = seen!;
  unmount(); act(() => current.addFiles([])); expect(second.addFiles).not.toHaveBeenCalled();
});
it("panel ancestor sees the field, reacts to busy and detaches on close/list/chat change", () => {
  const store = createComposerRegistry();
  const field = helper();
  const draw = (chatId: string, available: boolean) => {
    const target = { api: "/chat", chatId, available }; store.target = target;
    return <ComposerRegistryContext.Provider value={{ store, target }}><Read /><PanelComposerBindingContext.Provider value={true}><ComposerHelperProvider api="/chat" chatId="one" helper={field} enabled><span /></ComposerHelperProvider></PanelComposerBindingContext.Provider></ComposerRegistryContext.Provider>;
  };
  const { rerender } = render(draw("one", true));
  expect(screen.getByText("draft")).toBeTruthy(); const old = seen!;
  field.busy = true; field.canSend = false; rerender(draw("one", true));
  expect(seen!.busy).toBe(true); act(() => seen!.addFiles([])); expect(field.addFiles).not.toHaveBeenCalled();
  rerender(draw("one", false)); expect(seen).toBeNull();
  act(() => old.setValue("hidden")); expect(field.setValue).not.toHaveBeenCalled();
  rerender(draw("two", true)); expect(seen).toBeNull();
});
it("without attachments exposes no helper", () => { render(<ComposerHelperProvider api="/chat" chatId="one" helper={helper()} enabled={false}><Read /></ComposerHelperProvider>); expect(seen).toBeNull(); });

it("an embedded standalone chat under a panel provider keeps its own local helper", () => {
  const store = createComposerRegistry(); const target = { api: "/panel", chatId: "panel", available: false }; store.target = target;
  const field = helper();
  render(<ComposerRegistryContext.Provider value={{ store, target }}><ComposerHelperProvider api="/embedded" chatId="other" helper={field} enabled><Read /></ComposerHelperProvider></ComposerRegistryContext.Provider>);
  act(() => seen!.setValue("local")); expect(field.setValue).toHaveBeenCalledWith("local"); expect(store.getSnapshot()).toBeNull();
});
