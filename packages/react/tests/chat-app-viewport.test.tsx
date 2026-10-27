// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatAppViewport, useChatViewport } from "../src/viewport/chat-app-viewport";

let viewport: EventTarget & { width: number; height: number; scale: number; offsetTop: number; offsetLeft: number };
const safe = "--agent-chat-safe-area-bottom";
function tick() { act(() => { vi.advanceTimersByTime(20); }); }
function resize(values: Partial<typeof viewport>) { Object.assign(viewport, values); viewport.dispatchEvent(new Event("resize")); tick(); }
function Fixture() { return <ChatAppViewport header={<nav>Navigation</nav>}><textarea aria-label="draft" defaultValue="retained" /></ChatAppViewport>; }
function Embedded({cap = 600}: {cap?: number | string}) {
  const ref = useRef<HTMLDivElement>(null); useChatViewport(ref);
  return <div ref={ref} data-testid="embedded" style={{ maxHeight: cap }}><textarea aria-label="embedded draft"/></div>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("innerWidth", 400); vi.stubGlobal("innerHeight", 800);
  viewport = Object.assign(new EventTarget(), { width:400, height:800, scale:1, offsetTop:0, offsetLeft:0 });
  vi.stubGlobal("visualViewport", viewport);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this:HTMLElement) {
    const top = this.hasAttribute("data-agent-chat-app-viewport") ? Number.parseFloat(this.style.top) || 0 : 50;
    return { top, left:0, width:400, height:800, right:400, bottom:top+800, x:0, y:top, toJSON(){} };
  });
});
afterEach(() => {cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();document.body.removeAttribute("style");document.documentElement.removeAttribute("style");});
const shell = () => document.querySelector<HTMLElement>("[data-agent-chat-app-viewport]")!;
describe("ChatAppViewport", () => {
  it("fits visual-only keyboard and pan; keeps draft/focus and restores after closing", () => {
    render(<Fixture/>); const root=shell(), field=screen.getByLabelText("draft");field.focus();tick();
    resize({height:450,offsetTop:100});
    expect(root.style.height).toBe("450px");expect(root.style.top).toBe("100px");expect(root.style.getPropertyValue(safe)).toBe("0px");
    expect(document.activeElement).toBe(field);expect((field as HTMLTextAreaElement).value).toBe("retained");
    field.blur();tick();expect(root.style.getPropertyValue(safe)).toContain("safe-area-inset-bottom");
    resize({height:800,offsetTop:80}); // stale offset on WebKit keyboard dismissal
    expect(root.style.top).toBe("0px");expect(root.style.height).toBe("800px");expect(root.style.getPropertyValue(safe)).toContain("safe-area-inset-bottom");
  });
  it("does not treat pinch zoom or hardware keyboard focus as an OS keyboard", () => {
    render(<Fixture/>);screen.getByLabelText("draft").focus();tick();expect(shell().style.getPropertyValue(safe)).not.toBe("0px");
    resize({height:400,width:200,scale:2,offsetTop:150});
    expect(shell().style.height).toBe("800px");expect(shell().style.width).toBe("400px");expect(shell().style.top).toBe("0px");
    resize({height:800,width:400,scale:1,offsetTop:0});expect(shell().style.height).toBe("800px");
  });
  it("also handles resize-content and a missing visualViewport", () => {
    vi.stubGlobal("visualViewport", undefined);render(<Fixture/>);screen.getByLabelText("draft").focus();tick();
    vi.stubGlobal("innerHeight",450);window.dispatchEvent(new Event("resize"));tick();
    expect(shell().style.height).toBe("450px");expect(shell().style.getPropertyValue(safe)).toBe("0px");
    vi.stubGlobal("innerHeight",800);window.dispatchEvent(new Event("resize"));tick();expect(shell().style.height).toBe("800px");
  });
  it("releases only owned document styles and reference-counts multiple shells", () => {
    document.body.style.setProperty("position","relative","important");document.body.style.color="red";document.body.style.overflow="auto";document.body.style.margin="18px";document.body.style.padding="5px";document.body.style.setProperty("padding-left","11px","important");
    document.documentElement.style.overflow="scroll";
    const one=render(<Fixture/>),two=render(<Fixture/>);
    expect(document.body.style.position).toBe("relative");expect(document.body.style.margin).toBe("0px");expect(document.body.style.paddingTop).toBe("0px");expect(document.body.style.paddingLeft).toBe("0px");expect(document.body.style.overflow).toBe("auto");
    one.unmount();expect(document.documentElement.style.overflow).toBe("hidden");two.unmount();
    expect(document.body.style.position).toBe("relative");expect(document.body.style.getPropertyPriority("position")).toBe("important");
    expect(document.body.style.margin).toBe("18px");expect(document.body.style.paddingTop).toBe("5px");expect(document.body.style.paddingLeft).toBe("11px");expect(document.body.style.getPropertyPriority("padding-left")).toBe("important");
    expect(document.body.style.color).toBe("red");expect(document.documentElement.style.overflow).toBe("scroll");expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });
  it("disconnects listeners and queued frames on unmount, and can remount", () => {
    const remove=vi.spyOn(viewport,"removeEventListener");const app=render(<Fixture/>);
    viewport.dispatchEvent(new Event("resize"));app.unmount();tick();expect(remove).toHaveBeenCalledWith("resize",expect.any(Function));
    render(<Fixture/>);screen.getByLabelText("draft").focus();tick();resize({height:460});expect(shell().style.height).toBe("460px");
  });
  it("renders on the server without acquiring global ownership", () => {
    const html=renderToString(<Fixture/>);expect(html).toContain("data-agent-chat-app-content");expect(document.body.style.position).toBe("");
  });
  it("resets rotation baseline and restores after a landscape keyboard", () => {
    render(<Fixture/>);screen.getByLabelText("draft").focus();tick();resize({height:450});
    vi.stubGlobal("innerWidth",800);vi.stubGlobal("innerHeight",400);resize({width:800,height:400,offsetTop:0});
    expect(shell().style.height).toBe("400px");expect(shell().style.getPropertyValue(safe)).not.toBe("0px");
    resize({height:220});expect(shell().style.getPropertyValue(safe)).toBe("0px");
  });
  it("embedded fitting does not own body scrolling and restores its inline cap", () => {
    const app=render(<Embedded/>);const root=screen.getByTestId("embedded");
    screen.getByLabelText("embedded draft").focus();tick();resize({height:450});
    expect(root.style.maxHeight).toBe("400px");expect(document.body.style.position).toBe("");
    resize({height:800});expect(root.style.maxHeight).toBe("600px");expect(root.style.getPropertyValue(safe)).toBe("");
    app.unmount();
  });
  it("corrects an offset containing block on repeated viewport events", () => {
    let pan=0;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement) {
      const top=(Number.parseFloat(this.style.top)||0)+pan;
      return {top,left:0,width:400,height:800,right:400,bottom:top+800,x:0,y:top,toJSON(){}};
    });
    render(<Fixture/>);screen.getByLabelText("draft").focus();tick();
    pan=-35;resize({height:450,offsetTop:90});expect(shell().getBoundingClientRect().top).toBe(90);
    pan=-55;resize({height:450,offsetTop:90});expect(shell().getBoundingClientRect().top).toBe(90);
  });
  it("does not latch keyboard mode on Safari browser chrome after blur", () => {
    render(<Fixture/>);resize({height:650});
    const field=screen.getByLabelText("draft");field.focus();tick();
    expect(shell().style.getPropertyValue(safe)).not.toBe("0px");
    resize({height:350});expect(shell().style.getPropertyValue(safe)).toBe("0px");
    field.blur();tick();resize({height:650});
    expect(shell().style.getPropertyValue(safe)).toContain("safe-area-inset-bottom");
  });
  it("keeps keyboard mode while focus moves between text entries", () => {
    render(<ChatAppViewport><input aria-label="one"/><textarea aria-label="two"/></ChatAppViewport>);
    screen.getByLabelText("one").focus();tick();resize({height:450});
    screen.getByLabelText("two").focus();tick();expect(shell().style.getPropertyValue(safe)).toBe("0px");
    resize({height:0,width:0});expect(shell().style.height).toBe("800px");
  });
  it("does not count WebKit keyboard pan twice when pageTop and scrollY agree", () => {
    vi.stubGlobal("scrollY",337);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement) {
      const top=(Number.parseFloat(this.style.top)||0)-window.scrollY;
      return {top,left:0,width:400,height:800,right:400,bottom:top+800,x:0,y:top,toJSON(){}};
    });
    render(<Fixture/>);screen.getByLabelText("draft").focus();tick();
    Object.assign(viewport,{pageTop:337,pageLeft:0});
    resize({height:377,offsetTop:337});
    expect(shell().style.top).toBe("337px");expect(shell().getBoundingClientRect().top).toBe(0);
  });
  it("anchors in document coordinates without moving the document", () => {
    vi.stubGlobal("scrollY",240);
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function(this:HTMLElement) {
      const top=(Number.parseFloat(this.style.top)||0)-window.scrollY;
      return {top,left:0,width:400,height:800,right:400,bottom:top+800,x:0,y:top,toJSON(){}};
    });
    render(<Fixture/>);screen.getByLabelText("draft").focus();tick();resize({height:450,offsetTop:100});
    expect(shell().style.position).toBe("absolute");expect(shell().getBoundingClientRect().top).toBe(100);
    expect(window.scrollY).toBe(240);expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it("preserves percentage max-height rather than reading 80% as 80 pixels", () => {
    render(<Embedded cap="80%"/>);screen.getByLabelText("embedded draft").focus();tick();resize({height:450});
    expect(screen.getByTestId("embedded").style.maxHeight).toBe("min(80%, 400px)");
    resize({height:800});expect(screen.getByTestId("embedded").style.maxHeight).toBe("80%");
  });
  it("does not subtract twice inside the ready application shell", () => {
    render(<ChatAppViewport><Embedded/></ChatAppViewport>);screen.getByLabelText("embedded draft").focus();tick();resize({height:450});
    expect(shell().style.height).toBe("450px");expect(screen.getByTestId("embedded").style.maxHeight).toBe("400px");
  });
});
