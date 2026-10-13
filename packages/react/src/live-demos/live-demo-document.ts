import type { LiveDemoColors } from "../skin-contract";

/*
 * Документ живой демонстрации (docs/live-demos.md). Код пишет модель, а модель можно подтолкнуть словами человека
 * или чужой страницы. Поэтому код идёт в рамку без своего источника (`sandbox="allow-scripts"`): ни страницы, ни куки,
 * ни хранилища. Первым в документе — строгий CSP: ничего по сети. Наружу — только высота.
 *
 * CSP не мешает рамке самой уйти на чужой адрес (meta refresh, `location`, клик по ссылке) и унести данные в адресе.
 * Поэтому рамок две: внешняя получает промежуточный документ, чей CSP пускает вложенные рамки только на `about:`,
 * а код модели живёт во вложенной. Любой её переход наружу браузер блокирует правилом промежуточного документа.
 */

/** Предел кода в байтах UTF-8: больше — показывается код, а не запуск. */
export const MAX_LIVE_DEMO_BYTES = 30 * 1024;
/** Выше рамка не бывает: сообщение с большей высотой не принимается. */
export const MAX_LIVE_DEMO_HEIGHT = 10_000;
/** Песочница рамки: скрипты, и только. Без своего источника, окон, форм, диалогов и перехода страницы. */
export const LIVE_DEMO_SANDBOX = "allow-scripts";
/** Вид сообщения высоты из рамки. */
export const LIVE_DEMO_HEIGHT_MESSAGE = "agent-chat-live-demo:height";
/** Вид сообщения «код ушёл со своей страницы»: его шлёт только промежуточный документ, демонстрация погашена. */
export const LIVE_DEMO_LEFT_MESSAGE = "agent-chat-live-demo:left";
/** Кусок потока сервера: в чат попал чужой текст, демонстрации в нём больше не запускаются. */
export const EXTERNAL_CONTENT_PART_TYPE = "data-external-content";

/** Ничего по сети: скрипты и стили только встроенные, картинки, шрифты и медиа — из самого кода. */
export const LIVE_DEMO_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");
/**
 * CSP промежуточного документа. Вложенный документ наследует его вдобавок к своему, поэтому картинки, шрифты, медиа и
 * стили тут те же. Главное — `frame-src about:`: вложенная рамка не уйдёт ни на какой адрес, кроме `about:`.
 */
export const LIVE_DEMO_SHELL_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "frame-src about:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** Цвета, если скин своих не дал. */
export const FALLBACK_DEMO_COLORS: Record<"light" | "dark", LiveDemoColors> = {
  light: { background: "#ffffff", surface: "#f3f4f6", text: "#1f2328", muted: "#59636e", border: "#d1d9e0", accent: "#0969da", onAccent: "#ffffff", dark: false },
  dark: { background: "#16181b", surface: "#24282d", text: "#e6e8eb", muted: "#9198a1", border: "#3d444d", accent: "#58a6ff", onAccent: "#0d1117", dark: true },
};

const VARIABLES: Array<[string, keyof Omit<LiveDemoColors, "dark">]> = [
  ["--bg", "background"],
  ["--surface", "surface"],
  ["--text", "text"],
  ["--muted", "muted"],
  ["--border", "border"],
  ["--accent", "accent"],
  ["--on-accent", "onAccent"],
];

/** Цвет, который не вырвется из правила `<style>`: `#hex`, имя, `rgb(…)`, `oklch(…)` и подобные. */
const SAFE_COLOR = /^[#\w\s(),.%/-]+$/;

function themeCss(colors: LiveDemoColors): string {
  const fallback = FALLBACK_DEMO_COLORS[colors.dark ? "dark" : "light"];
  const variables = VARIABLES.map(([name, key]) => {
    const value = colors[key];
    return `${name}:${SAFE_COLOR.test(value) && !value.includes("/*") ? value : fallback[key]}`;
  }).join(";");
  return (
    `:root{${variables};color-scheme:${colors.dark ? "dark" : "light"}}` +
    "*,*::before,*::after{box-sizing:border-box}" +
    "html,body{margin:0}" +
    "body{padding:12px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere}"
  );
}

/*
 * Свой скрипт, до кода модели. WebRTC убирается: соединение STUN идёт мимо CSP. Новую рамку со своим WebRTC код не
 * создаст: см. `NESTED_CONTENT_GUARD`. Высота документа — родителю, при каждой смене размера. Переход
 * на другой адрес отменяется ещё и тут (Navigation API); переходы по якорю внутри — можно.
 */
const OWN_SCRIPT = `(()=>{for(const k of Object.getOwnPropertyNames(window))if(/^(webkit|moz)?RTC/.test(k))try{delete window[k]}catch(e){}const n=window.navigation;if(n)n.addEventListener("navigate",e=>{if(!e.hashChange&&e.cancelable)e.preventDefault()});let last=0;const send=()=>{const h=Math.min(${MAX_LIVE_DEMO_HEIGHT},Math.ceil(document.documentElement.getBoundingClientRect().height));if(h<1||h===last)return;last=h;parent.postMessage({type:"${LIVE_DEMO_HEIGHT_MESSAGE}",height:h},"*")};new ResizeObserver(send).observe(document.documentElement);addEventListener("load",send)})();`;

/*
 * Вложенные рамки и `<link>` с заблаговременным соединением. CSP их не держит: у вложенной рамки свой WebRTC, а
 * preconnect в WebKit открывает соединение мимо политики. Хост вырезает их из разметки, свой скрипт не даёт создать.
 */
const NESTED_TAGS = ["iframe", "frame", "object", "embed"];
const EARLY_LINK_RELS = ["preconnect", "prefetch", "dns-prefetch", "preload", "modulepreload", "prerender"];

/*
 * Запрет до кода модели: `createElement`/`createElementNS` вместо такого элемента (и любого `<link>`) дают пустой
 * `<agent-chat-blocked>`; разметка из `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`, `document.write`
 * и `createContextualFragment` проходит чистку в отдельном `<template>`. Текст скриптов и стилей не трогается.
 */
const NESTED_CONTENT_GUARD =
  `(()=>{const tags=${JSON.stringify(NESTED_TAGS)},rels=${JSON.stringify(EARLY_LINK_RELS)};` +
  `const D=Document.prototype,E=Element.prototype,make=D.createElement,makeNS=D.createElementNS;` +
  `const banned=n=>{n=String(n).toLowerCase().split(":").pop();return n==="link"||tags.includes(n)};` +
  `D.createElement=function(n,o){return make.call(this,banned(n)?"agent-chat-blocked":n,o)};` +
  `D.createElementNS=function(ns,n,o){return banned(n)?make.call(this,"agent-chat-blocked"):makeNS.call(this,ns,n,o)};` +
  `const html=Object.getOwnPropertyDescriptor(E,"innerHTML"),risky=/<\\s*\\/?\\s*(iframe|frame|object|embed|link)/i;` +
  `const strip=root=>{for(const el of root.querySelectorAll(tags.join(",")))el.remove();` +
  `for(const el of root.querySelectorAll("link"))if((el.getAttribute("rel")||"").toLowerCase().split(/\\s+/).some(r=>rels.includes(r)))el.remove();` +
  `for(const t of root.querySelectorAll("template"))strip(t.content)};` +
  `const clean=v=>{const s=String(v);if(!risky.test(s))return s;const t=make.call(document,"template");html.set.call(t,s);strip(t.content);return html.get.call(t)};` +
  `const text=/^(script|style|textarea|title|xmp|noembed|noframes|noscript|plaintext)$/;` +
  `const cleanFor=(el,v)=>el&&text.test(el.localName)?v:clean(v);` +
  `const setter=(P,k,ctx)=>{const d=P&&Object.getOwnPropertyDescriptor(P,k);if(d&&d.set)Object.defineProperty(P,k,{...d,set(v){d.set.call(this,ctx?cleanFor(ctx(this),v):clean(v))}})};` +
  `setter(E,"innerHTML",el=>el);setter(E,"outerHTML",el=>el.parentElement);setter(window.ShadowRoot&&ShadowRoot.prototype,"innerHTML");` +
  `const method=(P,k,i)=>{const f=P&&P[k];if(typeof f==="function")P[k]=function(...a){if(a.length>i)a[i]=clean(a[i]);return f.apply(this,a)}};` +
  `method(E,"insertAdjacentHTML",1);method(E,"setHTMLUnsafe",0);method(window.ShadowRoot&&ShadowRoot.prototype,"setHTMLUnsafe",0);method(Range.prototype,"createContextualFragment",0);` +
  `for(const k of ["write","writeln"]){const f=D[k];D[k]=function(...a){return f.call(this,clean(a.join("")))}}})();`;

/** Разметка модели без вложенных рамок и заблаговременных соединений. Нечего вырезать или нет DOMParser — как есть. */
function withoutNestedContent(documentHtml: string): string {
  if (typeof DOMParser === "undefined" || !/<\s*\/?\s*(iframe|frame|object|embed|link)/i.test(documentHtml)) return documentHtml;
  const parsed = new DOMParser().parseFromString(documentHtml, "text/html");
  let removed = false;
  const strip = (root: ParentNode) => {
    for (const element of root.querySelectorAll(NESTED_TAGS.join(","))) {
      element.remove();
      removed = true;
    }
    for (const link of root.querySelectorAll("link")) {
      if (!(link.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).some((rel) => EARLY_LINK_RELS.includes(rel))) continue;
      link.remove();
      removed = true;
    }
    for (const template of root.querySelectorAll("template")) strip(template.content);
  };
  strip(parsed);
  return removed ? `<!doctype html>${parsed.documentElement.outerHTML}` : documentHtml;
}

const NO_DNS_PREFETCH = '<meta http-equiv="x-dns-prefetch-control" content="off">';

/*
 * Свой скрипт промежуточного документа: создаёт вложенную рамку с кодом и пересылает наверх только высоту от неё.
 * Вторая загрузка вложенной рамки — код ушёл со своей страницы: рамка убирается, наверх — «ушла».
 */
function shellScript(inner: string): string {
  const message = (type: string, extra = "") => `parent.postMessage({type:"${type}"${extra}},"*")`;
  return (
    `(()=>{const f=document.createElement("iframe");f.setAttribute("sandbox","${LIVE_DEMO_SANDBOX}");f.setAttribute("referrerpolicy","no-referrer");` +
    `let loads=0,left=false;f.addEventListener("load",()=>{if(++loads>1&&!left){left=true;f.remove();${message(LIVE_DEMO_LEFT_MESSAGE)}}});` +
    `addEventListener("message",e=>{if(left||e.source!==f.contentWindow)return;const d=e.data;` +
    `if(d&&typeof d==="object"&&d.type==="${LIVE_DEMO_HEIGHT_MESSAGE}"&&typeof d.height==="number")${message(LIVE_DEMO_HEIGHT_MESSAGE, ",height:d.height")}});` +
    // `<` экранирован: строка не закроет `<script>` промежуточного документа.
    `f.srcdoc=${JSON.stringify(inner).replace(/</g, "\\u003c")};document.body.append(f)})();`
  );
}

/**
 * Документ внешней рамки для `srcdoc` — промежуточный: CSP с `frame-src about:`, свой скрипт и вложенная рамка, в
 * которой `liveDemoInnerDocument`. Код модели этот документ не разбирает: он лежит строкой внутри скрипта.
 */
export function liveDemoDocument(source: string, colors: LiveDemoColors): string {
  const scheme = colors.dark ? "dark" : "light";
  return (
    `<!doctype html><html><head><meta charset="utf-8">${NO_DNS_PREFETCH}<meta http-equiv="Content-Security-Policy" content="${LIVE_DEMO_SHELL_CSP}">` +
    `<style>:root{color-scheme:${scheme}}html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>` +
    `</head><body><script>${shellScript(liveDemoInnerDocument(source, colors))}</script></body></html>`
  );
}

/**
 * Документ вложенной рамки: запрет искать адреса заранее, CSP, цвета темы CSS-переменными и свои скрипты — в `<head>`,
 * код модели — в `<body>` без вложенных рамок и заблаговременных соединений. Документ модели целиком (`<html>`, `<head>`) парсер вливает в `<body>`: `<meta>`
 * с CSP там не действует, поэтому ослабить политику код не может.
 */
export function liveDemoInnerDocument(source: string, colors: LiveDemoColors): string {
  return withoutNestedContent(
    `<!doctype html><html><head><meta charset="utf-8">${NO_DNS_PREFETCH}<meta http-equiv="Content-Security-Policy" content="${LIVE_DEMO_CSP}">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><style>${themeCss(colors)}</style><script>${OWN_SCRIPT}</script>` +
      `<script>${NESTED_CONTENT_GUARD}</script></head><body>${source}</body></html>`,
  );
}

/** Помещается ли код в предел `MAX_LIVE_DEMO_BYTES`. */
export function liveDemoFits(source: string): boolean {
  return source.length <= MAX_LIVE_DEMO_BYTES / 3 || new TextEncoder().encode(source).length <= MAX_LIVE_DEMO_BYTES;
}

/** Сообщение «код ушёл со своей страницы» — только от своей рамки. */
export function demoLeftPage(event: Pick<MessageEvent, "data" | "source">, frameWindow: Window | null | undefined): boolean {
  if (!frameWindow || event.source !== frameWindow) return false;
  const data: unknown = event.data;
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === LIVE_DEMO_LEFT_MESSAGE;
}

/**
 * Высота из сообщения рамки: только от её окна (`event.source`), только `{ type, height }` с конечным числом в пределах
 * 1…`MAX_LIVE_DEMO_HEIGHT`, с округлением вверх. Иначе — `null`.
 */
export function demoHeightOf(event: Pick<MessageEvent, "data" | "source">, frameWindow: Window | null | undefined): number | null {
  if (!frameWindow || event.source !== frameWindow) return null;
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null) return null;
  const { type, height } = data as { type?: unknown; height?: unknown };
  if (type !== LIVE_DEMO_HEIGHT_MESSAGE || typeof height !== "number" || !Number.isFinite(height)) return null;
  return height > 0 && height <= MAX_LIVE_DEMO_HEIGHT ? Math.ceil(height) : null;
}
