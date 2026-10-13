// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanSvg } from "../src/clean-svg";

const svg = (inner: string) => `<svg id="m" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">${inner}</svg>`;

/** Чистый SVG разбирается так же, как его положит скин (разметкой в HTML). */
function parsed(markup: string): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = markup;
  const root = host.querySelector("svg");
  if (!root) throw new Error("нет svg");
  return root;
}

describe("cleanSvg: строгая очистка рисунка схемы (FR-027)", () => {
  it("обычный рисунок mermaid остаётся: фигуры, текст, стрелки на свои метки, стили без внешних адресов", () => {
    const clean = cleanSvg(
      svg(
        '<style>#m .node rect{fill:#fff;stroke:#333}</style><defs><marker id="arrow"><path d="M0,0 L10,5"/></marker></defs>' +
          '<g class="node"><rect width="5" height="5" style="fill:#eee"/><text><tspan>Заказ</tspan></text></g>' +
          '<path d="M0 0L5 5" marker-end="url(#arrow)"/><use href="#arrow"/>',
      ),
    );
    const root = parsed(clean);
    expect(root.querySelector("rect")?.getAttribute("style")).toBe("fill:#eee");
    expect(root.querySelector("tspan")?.textContent).toBe("Заказ");
    expect(root.querySelector("path[marker-end]")?.getAttribute("marker-end")).toBe("url(#arrow)");
    expect(root.querySelector("use")?.getAttribute("href")).toBe("#arrow");
    expect(root.querySelector("style")?.textContent).toContain("fill:#fff");
    expect(root.getAttribute("viewBox")).toBe("0 0 10 10");
  });

  const harmful: Array<[string, string, (root: SVGSVGElement, markup: string) => void]> = [
    ["скрипт", '<script>alert(1)</script><g><script href="https://evil.example/x.js"/></g>', (root) => expect(root.querySelector("script")).toBeNull()],
    [
      "HTML внутри foreignObject",
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/><a href="https://evil.example">жми</a></div></foreignObject>',
      (root, markup) => {
        expect(root.querySelector("foreignObject, foreignobject, img, div")).toBeNull();
        expect(markup).not.toMatch(/evil|onerror/);
      },
    ],
    [
      "ссылка: адрес уходит, текст остаётся",
      '<a href="javascript:alert(1)" xlink:href="https://evil.example"><text>Шаг 1</text></a>',
      (root) => {
        expect(root.querySelector("a")).toBeNull();
        expect(root.querySelector("text")?.textContent).toBe("Шаг 1");
      },
    ],
    ["картинка", '<image href="https://evil.example/track.png"/><image xlink:href="data:image/png;base64,AAAA"/>', (root) => expect(root.querySelector("image")).toBeNull()],
    [
      "внешний use",
      '<use href="https://evil.example/sprite.svg#a"/><use xlink:href="//evil.example/s.svg#b"/>',
      (root) => expect(root.querySelector("use")).toBeNull(),
    ],
    [
      "обработчики событий",
      '<g onclick="alert(1)" onmouseover="alert(2)"><rect ONLOAD="alert(3)" width="1"/></g>',
      (root, markup) => {
        expect(markup).not.toMatch(/alert/);
        expect(root.querySelector("rect")?.getAttribute("width")).toBe("1");
      },
    ],
    [
      "href не на свою метку у разрешённых элементов",
      '<textPath href="https://evil.example/p">т</textPath><linearGradient id="g" href="http://evil.example/g"/>',
      (_root, markup) => expect(markup).not.toMatch(/evil/),
    ],
    [
      "style и атрибуты с внешним url(",
      '<rect width="1" style="fill:url(https://evil.example/a)" filter="url(http://evil.example/f)"/><rect width="2" fill="url(#g)"/>',
      (root, markup) => {
        expect(markup).not.toMatch(/evil/);
        expect(root.querySelector('rect[width="2"]')?.getAttribute("fill")).toBe("url(#g)");
      },
    ],
    [
      "внешние адреса и @import в элементе style",
      '<style>@import url("https://evil.example/a.css"); #m .n{background:url(https://evil.example/b.png)} #m .k{fill:red}</style>',
      (root, markup) => {
        expect(markup).not.toMatch(/evil|@import/);
        expect(root.querySelector("style")?.textContent).toContain("#m .k{fill:red}");
      },
    ],
    [
      // Экранирование CSS: «\\75rl(» читается браузером как «url(», «@\\69mport» — как «@import».
      "экранированные url( и @import в элементе style и в атрибуте style",
      '<style>#m .a{background:\\75rl(https://evil.example/x)} @\\69mport "https://evil.example/a.css"; #m .k{fill:red}</style>' +
        '<rect width="1" style="fill:\\75rl(https://evil.example/y)"/><rect width="2" fill="\\75rl(https://evil.example/w)"/>',
      (root, markup) => {
        expect(markup).not.toMatch(/evil/);
        expect(root.querySelector("style")?.textContent).toContain("#m .k{fill:red}");
        expect(root.querySelector('rect[width="2"]')).not.toBeNull();
      },
    ],
    [
      "image-set, @font-face и url( со скобкой в кавычках",
      '<style>#m .b{background:image-set("https://evil.example/z" 1x)} #m .c{background:-webkit-image-set("https://evil.example/c" 1x)}' +
        '@font-face{font-family:x;src:url(https://evil.example/f.woff)} @font-face{font-family:y;src:local("x"), "https://evil.example/g"}' +
        '#m .q{background:url("https://evil.example/q)")} #m .k{fill:red}</style>' +
        '<rect width="1" style="background:image-set(&quot;https://evil.example/s&quot; 1x);fill:#eee"/>',
      (root, markup) => {
        expect(markup).not.toMatch(/evil|font-face/);
        expect(root.querySelector("style")?.textContent).toContain("#m .k{fill:red}");
        expect(root.querySelector("rect")?.getAttribute("style")).toBe("fill:#eee");
      },
    ],
    [
      "анимация, подменяющая адрес",
      '<use href="#a"><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" values="https://evil.example"/></use>',
      (root, markup) => {
        expect(root.querySelector("set, animate")).toBeNull();
        expect(markup).not.toMatch(/javascript|evil/);
      },
    ],
    [
      // embed по правилам HTML закрывает svg: всё после него и так вне рисунка.
      "чужие элементы: iframe, object, feImage, embed",
      '<iframe src="https://evil.example"/><object data="x"/><filter id="f"><feImage href="https://evil.example/i.png"/><feGaussianBlur stdDeviation="2"/></filter><embed src="https://evil.example/e"/>',
      (root, markup) => {
        expect(markup).not.toMatch(/evil|iframe|embed|object|feImage/i);
        expect(root.querySelector("filter")).not.toBeNull();
      },
    ],
  ];

  it.each(harmful)("вредное убрано: %s", (_name, inner, check) => {
    const markup = cleanSvg(svg(inner));
    check(parsed(markup), markup);
  });

  /** Правила таблицы так, как их разберёт браузер: селекторы и типы правил. */
  function pageRules(css: string): Array<{ type: string; selector?: string }> {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    const rules = [...(style.sheet?.cssRules ?? [])].map((rule) => ({
      type: rule.constructor.name,
      ...(rule instanceof CSSStyleRule && { selector: rule.selectorText }),
    }));
    style.remove();
    return rules;
  }

  it("в style остаются только правила внутри самого рисунка: страница вокруг не задевается", () => {
    const clean = cleanSvg(
      svg(
        '<style>body{display:none} #m .ok{fill:red} #m ~ div{display:none} #m + p{color:red} .x, #m .y{fill:blue}' +
          ' @media all{body{display:none}} :root{--a:1} #mx .z{fill:red} #m .s{font-family:"}body{display:none}"}' +
          " #m .n{fill:red; @media all{body{display:none}}} #m{position:fixed;top:0;fill:#333} #m .r{position:relative}</style>",
      ),
    );
    const css = parsed(clean).querySelector("style")?.textContent ?? "";
    const rules = pageRules(css);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.type).toBe("CSSStyleRule");
      expect(rule.selector).toMatch(/^#m(?=$|[\s.:[>])/);
      expect(rule.selector).not.toMatch(/[~+]/);
    }
    expect(rules.map((rule) => rule.selector)).toEqual(expect.arrayContaining(["#m .ok", "#m .y", "#m"]));
    expect(css).not.toMatch(/position:fixed/);
    expect(css).toContain("#m .r{position:relative}");
    expect(css).toContain("fill:#333");
  });

  it.each(["mermaid-flowchart.svg", "mermaid-sequence.svg"])("настоящий рисунок mermaid 12 (%s) сохраняет все свои правила стилей", (file) => {
    const original = readFileSync(join(import.meta.dirname, "fixtures", file), "utf8");
    const styleOf = (markup: string) => parsed(markup).querySelector("style")?.textContent ?? "";
    const declarations = (css: string) =>
      pageRules(css)
        .filter((rule) => rule.type === "CSSStyleRule")
        .map((rule) => rule.selector);
    // `.actorPopupMenu{position:absolute}` — для HTML-меню, в SVG не нужно: absolute вынес бы рисунок поверх страницы.
    const before = declarations(styleOf(original)).filter((selector) => !selector?.endsWith(".actorPopupMenu"));
    expect(before.length).toBeGreaterThan(20);
    expect(declarations(styleOf(cleanSvg(original)))).toEqual(before);
  });

  it("у рисунка без id в style не остаётся ни одного правила", () => {
    const markup = cleanSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>.k{fill:red} svg{fill:red}</style><rect width="1"/></svg>');
    expect(parsed(markup).querySelector("style")?.textContent).toBe("");
  });

  it("всё снаружи корневого svg отбрасывается; без svg — пустая строка", () => {
    const markup = cleanSvg(`<img src=x onerror="alert(1)">${svg("<rect width='1'/>")}<script>alert(2)</script>`);
    expect(markup).not.toMatch(/alert|img/);
    expect(markup.startsWith("<svg")).toBe(true);
    expect(cleanSvg("<div>не схема</div>")).toBe("");
  });
});
