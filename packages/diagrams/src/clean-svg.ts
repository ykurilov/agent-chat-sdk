/*
 * Рисунок схемы скин кладёт в страницу разметкой, как есть: так схема остаётся векторной. Поэтому всё, что может
 * исполниться или куда-то сходить, вычищается здесь (FR-027). Разрешён короткий список элементов SVG, которыми рисует
 * mermaid; остальное удаляется вместе с содержимым. Ссылка `<a>` снимается, а её текст остаётся.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** Элементы, которыми рисует mermaid, в нижнем регистре. `a` сюда не входит: она снимается отдельно. */
const ALLOWED_ELEMENTS = new Set([
  "svg", "g", "defs", "style", "title", "desc", "symbol", "use", "marker", "clippath", "mask", "pattern",
  "lineargradient", "radialgradient", "stop", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "textpath", "filter", "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite",
  "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr", "fegaussianblur", "femerge", "femergenode",
  "femorphology", "feoffset",
]);

/*
 * CSS чистится белым списком. Остаются только правила вида «#<id корня> …{свойство:значение}» без вложенных блоков;
 * любые @-правила (@import, @font-face, @media, @keyframes) уходят целиком. Объявление или селектор с обратной косой
 * чертой (экранирование: «\\75rl(» браузер читает как «url(»), кавычкой без пары, скобкой или комментарием
 * отбрасывается: в рисунке mermaid таких нет, а собранная заново таблица читается браузером ровно так, как здесь.
 */

/** `url(` не на свою метку `#…` — после нормализации, в нижнем регистре. */
const OUTSIDE_URL = /url\(\s*(?!['"]?\s*#)/;
/** Функции CSS, которые сами грузят адрес: `image-set("…")`, `-webkit-image-set`, `image()`, `cross-fade()`, `src()`. */
const LOADING_FUNCTION = /(?:^|[^a-z0-9_-])(?:-[a-z]+-)?(?:image-set|image|cross-fade|element|src)\s*\(/;
/** Свойства, которые исполнили бы код. */
const BLOCKED_PROPERTIES = new Set(["behavior", "-moz-binding"]);
/** `position: absolute | fixed | sticky` вынес бы рисунок из его рамки поверх страницы. */
const escapesFrame = (property: string, value: string) => property === "position" && !/^(?:static|relative)$/i.test(value);
const PROPERTY_NAME = /^(?:--|-)?[a-z][a-z0-9-]*$/;

/** Значение, как его прочтёт браузер: экранирование раскрыто, комментарии убраны. Только для проверок. */
function decodeCss(value: string): string {
  return value
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_whole, hex: string) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff) || 0xfffd))
    .replace(/\\([\s\S])/g, "$1")
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
}

/** Может ли значение что-то загрузить или исполнить. */
function loadsOutside(value: string): boolean {
  const plain = decodeCss(value).toLowerCase();
  return OUTSIDE_URL.test(plain) || LOADING_FUNCTION.test(plain) || /expression\(|javascript:|@import/.test(plain);
}

/** Части строки, разделённые `separator` вне кавычек и скобок. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote || char === "\n") quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Блоки верхнего уровня таблицы: `prelude{body}`; у правила без блока (`@import …;`) `body` — null. */
function cssBlocks(css: string): Array<{ prelude: string; body: string | null }> {
  const blocks: Array<{ prelude: string; body: string | null }> = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  let bodyStart = 0;
  let prelude = "";
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (quote) {
      if (char === quote || char === "\n") quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "{") {
      if (depth++ === 0) {
        prelude = css.slice(start, index).trim();
        bodyStart = index + 1;
      }
    } else if (char === "}") {
      if (depth === 0) start = index + 1;
      else if (--depth === 0) {
        blocks.push({ prelude, body: css.slice(bodyStart, index) });
        start = index + 1;
      }
    } else if (char === ";" && depth === 0) {
      blocks.push({ prelude: css.slice(start, index).trim(), body: null });
      start = index + 1;
    }
  }
  return blocks;
}

/** Каждая кавычка закрыта на той же строке. */
function quotesClosed(text: string): boolean {
  let quote: string | null = null;
  for (const char of text) {
    if (quote) {
      if (char === "\n") return false;
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
  }
  return quote === null;
}

/** Знаки, после которых собранная заново таблица прочиталась бы браузером иначе, чем здесь. */
const AMBIGUOUS_CSS = /[\\{};<@]|\/\*|\*\//;

/**
 * Селекторы правила, ограниченные корнем рисунка: каждый начинается с `#<id>`, без соседей (`+`, `~`), которые
 * дотянулись бы до страницы рядом. Не ограниченные отбрасываются; не осталось ни одного — null.
 */
function scopedSelectors(prelude: string, rootId: string): string | null {
  const scope = `#${rootId}`;
  const kept = splitTopLevel(prelude, ",")
    .map((selector) => selector.trim())
    .filter(
      (selector) =>
        selector.startsWith(scope) &&
        /^(?:$|[\s.:[>])/.test(selector.slice(scope.length)) &&
        !/[~+]/.test(selector) &&
        quotesClosed(selector) &&
        !AMBIGUOUS_CSS.test(selector),
    );
  return kept.length > 0 ? kept.join(",") : null;
}

/** Объявления `свойство:значение` без загрузок, вложенных блоков и опасных свойств. */
function cleanDeclarations(body: string): string {
  return splitTopLevel(body, ";")
    .flatMap((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon < 0) return [];
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1).trim();
      const safe =
        PROPERTY_NAME.test(property) &&
        !BLOCKED_PROPERTIES.has(property) &&
        !escapesFrame(property, value) &&
        value.length > 0 &&
        !AMBIGUOUS_CSS.test(value) &&
        quotesClosed(value) &&
        !loadsOutside(value);
      return safe ? [`${declaration.slice(0, colon).trim()}:${value}`] : [];
    })
    .join(";");
}

/** Таблица стилей рисунка: только простые правила внутри корня `#<rootId>`; нет id — пусто. */
function cleanCss(css: string, rootId: string | null): string {
  if (!rootId || !/^[\w-]+$/.test(rootId)) return "";
  const kept: string[] = [];
  for (const { prelude, body } of cssBlocks(css)) {
    if (body === null || prelude.includes("@")) continue;
    const selectors = scopedSelectors(prelude, rootId);
    const declarations = selectors && cleanDeclarations(body);
    if (selectors && declarations) kept.push(`${selectors}{${declarations}}`);
  }
  return kept.join("");
}

function isUnsafeAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) return true;
  if (lower === "href" || lower.endsWith(":href")) return !value.trim().startsWith("#");
  if (lower === "src" || lower === "xml:base" || lower === "formaction" || lower === "action") return true;
  return /javascript:/i.test(value) || loadsOutside(value);
}

/** `<use>` с чужим адресом удаляется целиком: без адреса он ничего не рисует. */
function usesOutside(element: Element): boolean {
  return [...element.attributes].some(({ name, value }) => (name === "href" || name.endsWith(":href")) && !value.trim().startsWith("#"));
}

function cleanAttributes(element: Element): void {
  for (const { name, value } of [...element.attributes]) {
    if (name.toLowerCase() === "style") element.setAttribute(name, cleanDeclarations(value));
    else if (isUnsafeAttribute(name, value)) element.removeAttribute(name);
  }
}

/** Снять ссылку: её содержимое встаёт на её место. */
function unwrap(element: Element): void {
  element.replaceWith(...element.childNodes);
}

/**
 * Чистая разметка корневого `<svg>` из ответа рисовальщика. Всё вне корневого `<svg>` отбрасывается; нет `<svg>` —
 * пустая строка. Разбор — без исполнения: у документа `DOMParser` нет окна, скрипты и картинки в нём не грузятся.
 */
export function cleanSvg(markup: string): string {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const root = doc.querySelector("svg");
  if (!root || root.namespaceURI !== SVG_NS) return "";
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (!root.contains(element)) continue;
    const name = element.localName.toLowerCase();
    if (element.namespaceURI === SVG_NS && name === "a") {
      unwrap(element);
      continue;
    }
    if (element.namespaceURI !== SVG_NS || !ALLOWED_ELEMENTS.has(name) || (name === "use" && usesOutside(element))) {
      element.remove();
      continue;
    }
    cleanAttributes(element);
    if (name === "style") element.textContent = cleanCss(element.textContent ?? "", root.getAttribute("id"));
  }
  return root.outerHTML;
}
