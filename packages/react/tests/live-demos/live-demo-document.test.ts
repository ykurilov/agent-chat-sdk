// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  LIVE_DEMO_CSP,
  LIVE_DEMO_HEIGHT_MESSAGE,
  LIVE_DEMO_LEFT_MESSAGE,
  LIVE_DEMO_SANDBOX,
  LIVE_DEMO_SHELL_CSP,
  MAX_LIVE_DEMO_BYTES,
  MAX_LIVE_DEMO_HEIGHT,
  demoHeightOf,
  demoLeftPage,
  liveDemoDocument,
  liveDemoFits,
  liveDemoInnerDocument,
} from "../../src/live-demos/live-demo-document";
import type { LiveDemoColors } from "../../src/skin-contract";

const colors: LiveDemoColors = { background: "#ffffff", surface: "#f0f1ef", text: "#202226", muted: "#6b6e73", border: "#d8dad6", accent: "#0870ab", onAccent: "#ffffff", dark: false };
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const cspOf = (html: string) => parse(html).querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? "";
const directives = (csp: string) => new Map(csp.split(";").map((part) => part.trim().split(/\s+/)).filter((words) => words[0]).map(([name, ...values]) => [name!, values]));

describe("документ живой демонстрации (043 FR-003, FR-008)", () => {
  it("песочница рамки — только скрипты: ни своего источника, ни окон, ни форм, ни перехода страницы", () => {
    expect(LIVE_DEMO_SANDBOX).toBe("allow-scripts");
  });

  it("строгий CSP: ничего по сети, скрипты и стили только встроенные, картинки, шрифты и медиа — data:/blob:", () => {
    const csp = directives(LIVE_DEMO_CSP);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("script-src")).toEqual(["'unsafe-inline'"]);
    expect(csp.get("style-src")).toEqual(["'unsafe-inline'"]);
    expect(csp.get("img-src")).toEqual(["data:", "blob:"]);
    expect(csp.get("font-src")).toEqual(["data:"]);
    expect(csp.get("media-src")).toEqual(["data:", "blob:"]);
    expect(csp.get("form-action")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
    expect(csp.get("frame-src")).toEqual(["'none'"]);
    expect(csp.get("worker-src")).toEqual(["'none'"]);
    expect(csp.has("connect-src")).toBe(false);
    expect(LIVE_DEMO_CSP).not.toMatch(/https?:|\*|'self'/);
  });

  it("CSP стоит в <head> раньше любого скрипта, стиля и кода модели; код модели — в <body> как есть", () => {
    const source = '<style>p{color:red}</style><p id="x">Привет</p><script>document.getElementById("x").textContent="Пока"</script>';
    const html = liveDemoInnerDocument(source, colors);
    const doc = parse(html);
    expect(cspOf(html)).toBe(LIVE_DEMO_CSP);
    const first = doc.querySelector('meta[http-equiv="Content-Security-Policy"], script, style, link');
    expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(doc.body.innerHTML).toContain(source);
    expect(html.indexOf(LIVE_DEMO_CSP)).toBeLessThan(html.indexOf(source));
  });

  it("документ модели целиком (<!doctype>, <html>, <head>) — CSP всё равно первым", () => {
    const html = liveDemoInnerDocument('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><script>1</script></head><body>x</body></html>', colors);
    expect(parse(html).querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toBe(LIVE_DEMO_CSP);
  });

  it("цвета темы — CSS-переменными корня и color-scheme; тёмная тема — dark", () => {
    const light = liveDemoInnerDocument("x", colors);
    for (const [name, value] of [["--bg", "#ffffff"], ["--surface", "#f0f1ef"], ["--text", "#202226"], ["--muted", "#6b6e73"], ["--border", "#d8dad6"], ["--accent", "#0870ab"], ["--on-accent", "#ffffff"]]) {
      expect(light).toContain(`${name}:${value}`);
    }
    expect(light).toContain("color-scheme:light");
    expect(liveDemoInnerDocument("x", { ...colors, background: "#111111", dark: true })).toMatch(/--bg:#111111[\s\S]*color-scheme:dark/);
  });

  it("цвет скина, который вырвался бы из <style>, не попадает в документ", () => {
    const html = liveDemoInnerDocument("x", { ...colors, accent: "red}</style><script>alert(1)</script>" });
    expect(html).not.toContain("alert(1)");
    expect(parse(html).querySelectorAll("script")).toHaveLength(2);
  });

  it("свой скрипт до кода модели: сообщает высоту родителю и не даёт уйти со страницы", () => {
    const html = liveDemoInnerDocument("<p>x</p>", colors);
    const ownScript = parse(html).querySelector("head script")!.textContent!;
    expect(ownScript).toContain(LIVE_DEMO_HEIGHT_MESSAGE);
    expect(ownScript).toContain("ResizeObserver");
    expect(ownScript).toMatch(/navigation[\s\S]*preventDefault/);
  });

  it("внутренний документ: первым в <head> — запрет заранее искать адреса (DNS), затем CSP", () => {
    const head = parse(liveDemoInnerDocument("x", colors)).head;
    const metas = [...head.querySelectorAll("meta[http-equiv]")].map((meta) => meta.getAttribute("http-equiv"));
    expect(metas.slice(0, 2)).toEqual(["x-dns-prefetch-control", "Content-Security-Policy"]);
    expect(head.querySelector('meta[http-equiv="x-dns-prefetch-control"]')?.getAttribute("content")).toBe("off");
  });

  it("WebRTC убран до кода модели: RTCPeerConnection и родня удаляются у окна", () => {
    const window = {
      RTCPeerConnection: 1,
      webkitRTCPeerConnection: 1,
      RTCDataChannel: 1,
      RTCSessionDescription: 1,
      RTCIceCandidate: 1,
      RTCRtpSender: 1,
      fetch: 1,
      navigation: undefined,
    } as Record<string, unknown>;
    const ownScript = parse(liveDemoInnerDocument("x", colors)).querySelector("head script")!.textContent!;
    const stub: Record<string, unknown> & { document: object } = { ...window, addEventListener() {}, document: { documentElement: {} } };
    // Свой скрипт — в окне-заглушке: ResizeObserver и прочее не нужны, проверяется только чистка WebRTC.
    new Function("window", "ResizeObserver", "addEventListener", "document", "parent", `with(window){${ownScript}}`)(
      stub,
      class {
        observe() {}
      },
      () => undefined,
      stub.document,
      { postMessage() {} },
    );
    expect(Object.keys(stub).filter((key) => /RTC/.test(key))).toEqual([]);
    expect(stub.fetch).toBe(1);
  });
});

describe("промежуточный документ (043 FR-003, ревью: уход рамки на чужой адрес)", () => {
  const source = '<p id="x">Привет</p><meta http-equiv="refresh" content="0;url=https://evil.test/">';

  it("код модели не разбирается промежуточным документом: в нём одна рамка, создаваемая своим скриптом", () => {
    const doc = parse(liveDemoDocument(source, colors));
    expect(doc.querySelector("#x")).toBeNull();
    expect(doc.querySelector('meta[http-equiv="refresh"]')).toBeNull();
    expect(doc.querySelectorAll("script")).toHaveLength(1);
  });

  it("CSP промежуточного документа: вложенные рамки — только about: (srcdoc), сети нет; первым в <head>", () => {
    const html = liveDemoDocument(source, colors);
    const doc = parse(html);
    expect(doc.head.querySelector("meta[http-equiv]")?.getAttribute("http-equiv")).toBe("x-dns-prefetch-control");
    expect(cspOf(html)).toBe(LIVE_DEMO_SHELL_CSP);
    const csp = directives(LIVE_DEMO_SHELL_CSP);
    expect(csp.get("default-src")).toEqual(["'none'"]);
    expect(csp.get("frame-src")).toEqual(["about:"]);
    expect(csp.has("connect-src")).toBe(false);
    expect(LIVE_DEMO_SHELL_CSP).not.toMatch(/https?:|\*|'self'/);
  });

  it("свой скрипт кладёт внутренний документ в srcdoc вложенной рамки с той же песочницей и пересылает только высоту", () => {
    const script = parse(liveDemoDocument(source, colors)).querySelector("script")!.textContent!;
    expect(script).toContain("srcdoc");
    expect(script).toContain(LIVE_DEMO_SANDBOX);
    expect(script).toContain("e.source!==f.contentWindow");
    expect(script).toContain(LIVE_DEMO_HEIGHT_MESSAGE);
    expect(script).toContain(LIVE_DEMO_LEFT_MESSAGE);
    expect(script).not.toMatch(/<\/script/i);
    expect(script).toContain(JSON.stringify(liveDemoInnerDocument(source, colors)).replace(/</g, "\\u003c"));
  });
});

describe("предел размера (043 FR-005)", () => {
  it("30 КБ в UTF-8: латиница до предела — помещается, кириллица той же длины — нет", () => {
    expect(MAX_LIVE_DEMO_BYTES).toBe(30 * 1024);
    expect(liveDemoFits("a".repeat(MAX_LIVE_DEMO_BYTES))).toBe(true);
    expect(liveDemoFits("a".repeat(MAX_LIVE_DEMO_BYTES + 1))).toBe(false);
    expect(liveDemoFits("я".repeat(MAX_LIVE_DEMO_BYTES / 2 + 1))).toBe(false);
  });
});

describe("сообщение «ушла со страницы» (043 FR-003)", () => {
  const frame = { name: "рамка" } as unknown as Window;
  it("только от своей рамки и своего вида", () => {
    expect(demoLeftPage({ data: { type: LIVE_DEMO_LEFT_MESSAGE }, source: frame } as MessageEvent, frame)).toBe(true);
    expect(demoLeftPage({ data: { type: LIVE_DEMO_LEFT_MESSAGE }, source: {} as Window } as MessageEvent, frame)).toBe(false);
    expect(demoLeftPage({ data: { type: "другое" }, source: frame } as MessageEvent, frame)).toBe(false);
    expect(demoLeftPage({ data: null, source: frame } as MessageEvent, null)).toBe(false);
  });
});

describe("сообщение высоты из рамки (043 FR-007)", () => {
  const frame = { name: "рамка" } as unknown as Window;
  const other = { name: "чужое окно" } as unknown as Window;
  const event = (data: unknown, source: Window | null = frame) => ({ data, source }) as MessageEvent;
  const valid = { type: LIVE_DEMO_HEIGHT_MESSAGE, height: 240.2 };

  it("от своей рамки, своего вида, конечное число в пределах — высота с округлением вверх", () => {
    expect(demoHeightOf(event(valid), frame)).toBe(241);
    expect(demoHeightOf(event({ ...valid, height: MAX_LIVE_DEMO_HEIGHT }), frame)).toBe(MAX_LIVE_DEMO_HEIGHT);
  });

  it("чужой источник, нет окна рамки, другой вид, не число или вне пределов — не принимается", () => {
    expect(demoHeightOf(event(valid, other), frame)).toBeNull();
    expect(demoHeightOf(event(valid, null), frame)).toBeNull();
    expect(demoHeightOf(event(valid), null)).toBeNull();
    for (const data of [null, "240", 240, { height: 240 }, { type: "другое", height: 240 }, { ...valid, height: "240" }]) {
      expect(demoHeightOf(event(data), frame)).toBeNull();
    }
    for (const height of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0, MAX_LIVE_DEMO_HEIGHT + 1]) {
      expect(demoHeightOf(event({ ...valid, height }), frame)).toBeNull();
    }
  });
});
