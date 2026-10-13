// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { FALLBACK_DEMO_COLORS, liveDemoInnerDocument } from "../../src/live-demos/live-demo-document";

/*
 * Ревью 2 фичи 043: вложенные рамки и `<link>` с заблаговременным соединением запрещены в документе демонстрации.
 * Хост вырезает их из разметки модели, а свой скрипт внутреннего документа не даёт создать их кодом.
 */

const colors = FALLBACK_DEMO_COLORS.light;
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const nested = "iframe, frame, object, embed";
const earlyLinks = (root: ParentNode) => [...root.querySelectorAll("link")].filter((link) => /preconnect|prefetch|preload|prerender/.test(link.rel));

describe("хост: разметка модели без вложенных рамок и заблаговременных соединений", () => {
  it("iframe (и в <template>), frame, object, embed и link preconnect/prefetch/dns-prefetch/preload/modulepreload/prerender вырезаны; остальное на месте", () => {
    const source =
      '<p id="ok">Привет</p><iframe srcdoc="<script>1</script>"></iframe><object data="x"></object><embed src="x"><frameset><frame></frameset>' +
      '<template><iframe></iframe></template><link rel="preconnect" href="http://a"><link rel="dns-prefetch" href="http://a"><link rel="prefetch" href="http://a">' +
      '<link rel="preload" href="http://a"><link rel="modulepreload" href="http://a"><link rel="prerender" href="http://a"><link rel="stylesheet" href="s.css">' +
      "<script>document.body.dataset.x=1</script>";
    const doc = parse(liveDemoInnerDocument(source, colors));
    expect(doc.querySelectorAll(nested)).toHaveLength(0);
    expect(doc.querySelector("template")!.content.querySelectorAll(nested)).toHaveLength(0);
    expect(earlyLinks(doc)).toEqual([]);
    expect(doc.getElementById("ok")?.textContent).toBe("Привет");
    expect(doc.querySelector('link[rel="stylesheet"]')).not.toBeNull();
    expect(doc.body.querySelector("script")?.textContent).toBe("document.body.dataset.x=1");
  });

  it("разметка без запрещённого — как есть, байт в байт", () => {
    const source = "<style>p{color:red}</style><p class=a>x</p><script>if(a<b){}</script>";
    expect(liveDemoInnerDocument(source, colors)).toContain(`<body>${source}</body>`);
  });
});

describe("внутренний документ: свой скрипт не даёт коду создать вложенную рамку или заблаговременное соединение", () => {
  // Исходные write/writeln заменены записью: сам документ jsdom не переписывается.
  const written: string[] = [];
  beforeAll(() => {
    Document.prototype.write = (...text: string[]) => void written.push(text.join(""));
    Document.prototype.writeln = (...text: string[]) => void written.push(text.join(""));
    const scripts = [...parse(liveDemoInnerDocument("x", colors)).querySelectorAll("head script")].map((script) => script.textContent ?? "");
    const guard = scripts.find((script) => script.includes("createElement"));
    if (!guard) throw new Error("нет своего скрипта-запрета");
    new Function(guard)();
  });

  it("createElement и createElementNS: iframe, frame, object, embed и link не получаются", () => {
    for (const name of ["iframe", "IFRAME", "frame", "object", "embed", "link"]) expect(document.createElement(name).localName).not.toBe(name.toLowerCase());
    expect(document.createElementNS("http://www.w3.org/1999/xhtml", "iframe").localName).not.toBe("iframe");
    expect(document.createElement("div").localName).toBe("div");
  });

  const markup = '<p>a</p><iframe srcdoc="x"></iframe><object></object><embed><link rel="preconnect" href="http://a"><link rel="stylesheet" href="s.css">';
  const expectClean = (root: ParentNode) => {
    expect(root.querySelectorAll(nested)).toHaveLength(0);
    expect(earlyLinks(root)).toEqual([]);
    expect(root.querySelector("p")?.textContent).toBe("a");
    expect(root.querySelector('link[rel="stylesheet"]')).not.toBeNull();
  };

  it("innerHTML, outerHTML, insertAdjacentHTML", () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.innerHTML = markup;
    expectClean(host);
    host.innerHTML = "<span></span>";
    host.firstElementChild!.outerHTML = markup;
    expectClean(host);
    host.innerHTML = "";
    host.insertAdjacentHTML("beforeend", markup);
    expectClean(host);
  });

  it("Range.createContextualFragment и setHTMLUnsafe", () => {
    expectClean(document.createRange().createContextualFragment(markup));
    const host = document.createElement("div") as HTMLDivElement & { setHTMLUnsafe?: (html: string) => void };
    if (host.setHTMLUnsafe) {
      host.setHTMLUnsafe(markup);
      expectClean(host);
    }
  });

  it("document.write и writeln: исходный метод получает разметку без запрещённого", () => {
    for (const write of [() => document.write(markup), () => document.writeln(markup)]) {
      written.length = 0;
      write();
      const box = document.createElement("div");
      box.innerHTML = written.join("");
      expectClean(box);
    }
  });

  it("текст скриптов и стилей не трогается: «a<b» остаётся текстом", () => {
    const script = document.createElement("script");
    script.innerHTML = "if(a<b){}";
    expect(script.textContent).toBe("if(a<b){}");
  });
});
