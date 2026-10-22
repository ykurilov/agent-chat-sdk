// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckIcon, CopyIcon, XIcon, InfoIcon, CheckCircleIcon, WarningIcon, XCircleIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Alert as TandemAlert, Markdown as TandemMarkdown } from "@tandem/ui";
import { SafeMarkdown } from "../src/safe-markdown";
import { Alert } from "../src/primitives/alert";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "../src/primitives/dialog";
import { Menu, MenuTrigger, MenuContent, MenuRadioGroup, MenuRadioItem, MenuSub, MenuSubTrigger, MenuSubContent, MenuItem } from "../src/primitives/menu";
import type { Icon } from "@phosphor-icons/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function expectIcon(element: Element | null, IconComponent: Icon) {
  expect(element).not.toBeNull();
  const expected = document.createElement("div");
  expected.innerHTML = renderToStaticMarkup(<IconComponent weight="regular" />);
  expect(element!.getAttribute("viewBox")).toBe("0 0 256 256");
  expect([...element!.querySelectorAll("path")].map(p => p.getAttribute("d"))).toEqual([...expected.querySelectorAll("path")].map(p => p.getAttribute("d")));
  expect(document.querySelector("svg.lucide")).toBeNull();
}

describe("Phosphor inside the official skin", () => {
  it("copies fenced code with Phosphor Copy, acknowledges with Check, and handles clipboard rejection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const view = render(<SafeMarkdown markdown={'```ts\nconst answer = 42;\n```'} />);
    const copy = screen.getByRole("button", { name: "Скопировать код" });
    expectIcon(copy.querySelector("svg"), CopyIcon);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("const answer = 42;"));
    await waitFor(() => expectIcon(screen.getByRole("button", { name: "Скопировано" }).querySelector("svg"), CheckIcon));
    view.unmount();
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<SafeMarkdown markdown={'```\nprivate\n```'} />);
    fireEvent.click(screen.getByRole("button", { name: "Скопировать код" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expectIcon(screen.getByRole("button", { name: "Скопировать код" }).querySelector("svg"), CopyIcon);
  });

  it("keeps Markdown safe, labelled and navigable without unsolicited external images", () => {
    const { container } = render(<SafeMarkdown markdown={'<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n[external](https://example.com)\n\n![secret](https://evil.example/pixel)\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n- [ ] todo'} />);
    expect(container.querySelector("script, img")).toBeNull();
    const bad = screen.getByText("bad");
    expect(bad.getAttribute("href") ?? "").not.toMatch(/javascript/i);
    expect(fireEvent.click(bad)).toBe(false);
    expect(fireEvent(bad, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
    const external = screen.getByText("external");
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("region").getAttribute("tabindex")).toBe("0");
    expect(screen.getAllByRole("checkbox").every(el => el.hasAttribute("aria-label"))).toBe(true);
  });

  it.each([["info", InfoIcon], ["success", CheckCircleIcon], ["warm", WarningIcon], ["danger", XCircleIcon]] as const)("renders %s notice with a Phosphor icon and status semantics", (variant, IconComponent) => {
    const action = vi.fn();
    render(<Alert variant={variant} title="Notice" action={<button onClick={action}>Retry</button>}>Details</Alert>);
    expectIcon(screen.getByRole("status").querySelector("svg"), IconComponent);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(action).toHaveBeenCalledOnce();
  });

  it("retains dialog labelling, focus restoration and close-button/Escape behaviour", async () => {
    render(<Dialog><DialogTrigger>Open dialog</DialogTrigger><DialogContent><DialogTitle>Confirm</DialogTitle><DialogDescription>Details</DialogDescription><button>Keep</button></DialogContent></Dialog>);
    const trigger = screen.getByRole("button", { name: "Open dialog" });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Confirm" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Закрыть" });
    expectIcon(close.querySelector("svg"), XIcon);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("retains keyboard radio selection and Phosphor checked/submenu indicators", async () => {
    const change = vi.fn();
    render(<Menu><MenuTrigger>Voices</MenuTrigger><MenuContent><MenuRadioGroup value="a" onValueChange={change}><MenuRadioItem value="a">Alice</MenuRadioItem><MenuRadioItem value="b">Bob</MenuRadioItem></MenuRadioGroup><MenuSub><MenuSubTrigger>More</MenuSubTrigger><MenuSubContent><MenuItem>Third</MenuItem></MenuSubContent></MenuSub></MenuContent></Menu>);
    const trigger = screen.getByRole("button", { name: "Voices" });
    trigger.focus(); fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const alice = await screen.findByRole("menuitemradio", { name: "Alice" });
    expect(alice.getAttribute("aria-checked")).toBe("true");
    expectIcon(alice.querySelector("svg"), CheckIcon);
    expectIcon(screen.getByRole("menuitem", { name: "More" }).querySelector("svg"), CaretRightIcon);
    const bob = screen.getByRole("menuitemradio", { name: "Bob" });
    bob.focus(); fireEvent.keyDown(bob, { key: "Enter" });
    await waitFor(() => expect(change).toHaveBeenCalledWith("b"));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("has no upstream icon-bearing imports anywhere in the skin; Tandem itself keeps its original icons", () => {
    const root = join(import.meta.dirname, "../src");
    for (const file of readdirSync(root, { recursive: true }).map(String).filter(f => /\.tsx?$/.test(f))) {
      const code = readFileSync(join(root, file), "utf8");
      expect(code, file).not.toMatch(/from\s+["']lucide-react["']/);
      for (const match of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@tandem\/ui["']/g)) {
        const runtimeNames = match[1]!.split(",").map(name => name.trim()).filter(name => !name.startsWith("type ")).join(",");
        expect(runtimeNames, file).not.toMatch(/\b(Markdown|Alert|AgentMessage|Dialog\w*|Menu\w*)\b/);
      }
    }
    const upstream = render(<><TandemAlert title="Upstream" /><TandemMarkdown>{'```\ncode\n```'}</TandemMarkdown></>);
    expect(upstream.container.querySelectorAll("svg.lucide").length).toBeGreaterThan(0);
  });
});
