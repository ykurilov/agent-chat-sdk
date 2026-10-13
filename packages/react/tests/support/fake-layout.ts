/*
 * В jsdom у элементов нет размеров, а окно ленты (virtua) строит список только по замерам:
 * без них оно рисует ноль сообщений, а без `ResizeObserver` падает. Помощница подставляет
 * замеры и даёт тесту двигать скроллер и менять высоты (research R13).
 *
 * - Высота элемента — атрибут `data-test-height`, иначе `itemHeight`.
 * - Скроллер — элемент с атрибутом `data-test-scroller`: его высота — `viewportHeight`.
 * - Верх элемента от верха скроллера (`getBoundingClientRect`) — сумма `data-test-start-offset`
 *   элемента и его предков до скроллера минус прокрутка скроллера.
 * - `scrollHeight` скроллера — высота самого высокого элемента с высотой в `style`
 *   (контейнер окна ленты ставит туда полную высоту списка), если тест не задал свою.
 * - `scrollTop` присваивается и читается как в браузере; каждое присваивание порождает
 *   событие `scroll`.
 */

/**
 * Окно ленты доводит прокрутку «к последнему сообщению», пока идут замеры, и заканчивает через
 * 150 мс после последнего (virtua, `observer.ts`). Пока оно не закончило, прокрутка тестом
 * перебивается. Настоящий читатель так быстро не прокручивает, тест ждёт с запасом.
 */
export const SCROLL_TO_END_SETTLE_MS = 250;

export interface FakeLayoutOptions {
  viewportHeight?: number;
  itemHeight?: number;
}

export interface FakeLayout {
  viewportHeight: number;
  /** Сообщить наблюдателям, что размеры элемента изменились (после правки `data-test-height`). */
  notifyResize: (element: Element) => void;
  /** Сообщить о размерах всех наблюдаемых элементов заново. */
  notifyResizeAll: () => void;
  /** Задать `scrollHeight` скроллера; `null` — считать по содержимому. */
  setScrollHeight: (height: number | null) => void;
  uninstall: () => void;
}

const SCROLLER_ATTRIBUTE = "data-test-scroller";
const HEIGHT_ATTRIBUTE = "data-test-height";

export function installFakeLayout({ viewportHeight = 600, itemHeight = 50 }: FakeLayoutOptions = {}): FakeLayout {
  const layout: { viewportHeight: number } = { viewportHeight };
  const observed = new Set<Element>();
  let scrollHeightOverride: number | null = null;

  const heightOf = (element: Element): number => {
    if (element.hasAttribute(SCROLLER_ATTRIBUTE)) return layout.viewportHeight;
    const own = element.getAttribute(HEIGHT_ATTRIBUTE);
    return own === null ? itemHeight : Number(own);
  };

  const entryFor = (target: Element): ResizeObserverEntry => {
    const height = heightOf(target);
    return { target, contentRect: { width: 400, height, top: 0, left: 0, right: 400, bottom: height, x: 0, y: 0 } } as ResizeObserverEntry;
  };

  const observers = new Set<FakeResizeObserver>();
  class FakeResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(target: Element) {
      this.targets.add(target);
      observed.add(target);
      queueMicrotask(() => {
        if (this.targets.has(target)) this.callback([entryFor(target)], this as unknown as ResizeObserver);
      });
    }
    unobserve(target: Element) {
      this.targets.delete(target);
      observed.delete(target);
    }
    disconnect() {
      for (const target of this.targets) observed.delete(target);
      this.targets.clear();
    }
    report(targets: Iterable<Element>) {
      const entries = [...targets].filter((target) => this.targets.has(target)).map(entryFor);
      if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
    }
  }

  // Всё, что подменяется ниже: на уборке каждое свойство возвращается к прежнему виду.
  const patched: Array<[object, string]> = [
    [window, "ResizeObserver"],
    [globalThis, "ResizeObserver"],
    [HTMLElement.prototype, "offsetParent"],
    ...["clientHeight", "scrollHeight", "scrollTop", "scrollTo", "scrollBy", "getBoundingClientRect"].map(
      (key): [object, string] => [Element.prototype, key],
    ),
  ];
  const saved = patched.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));

  Object.defineProperty(window, "ResizeObserver", { configurable: true, writable: true, value: FakeResizeObserver });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, writable: true, value: FakeResizeObserver });
  // Окно ленты учитывает только видимые элементы; в jsdom `offsetParent` всегда `null`.
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement ?? document.body;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute(SCROLLER_ATTRIBUTE) ? layout.viewportHeight : heightOf(this);
    },
  });

  const contentHeight = (scroller: Element): number => {
    let tallest = 0;
    for (const element of scroller.querySelectorAll<HTMLElement>("*")) {
      const height = element.style.height;
      if (height.endsWith("px")) tallest = Math.max(tallest, Number.parseFloat(height));
    }
    return tallest;
  };
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get(this: Element) {
      if (!this.hasAttribute(SCROLLER_ATTRIBUTE)) return heightOf(this);
      return Math.max(layout.viewportHeight, scrollHeightOverride ?? contentHeight(this));
    },
  });

  const scrollOffsets = new WeakMap<Element, number>();
  const setScrollTop = (element: Element, value: number) => {
    const limit = Math.max(0, element.scrollHeight - layout.viewportHeight);
    const next = Math.min(Math.max(0, value), limit);
    const changed = scrollOffsets.get(element) !== next;
    scrollOffsets.set(element, next);
    if (changed) element.dispatchEvent(new Event("scroll"));
  };
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return scrollOffsets.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      if (this.hasAttribute(SCROLLER_ATTRIBUTE)) setScrollTop(this, value);
    },
  });
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value(this: Element, options?: ScrollToOptions | number) {
      const top = typeof options === "number" ? options : options?.top;
      if (top !== undefined) setScrollTop(this, top);
    },
  });
  Object.defineProperty(Element.prototype, "scrollBy", {
    configurable: true,
    value(this: Element, options?: ScrollToOptions | number) {
      const top = typeof options === "number" ? options : options?.top;
      if (top !== undefined) setScrollTop(this, this.scrollTop + top);
    },
  });

  // Верх элемента от верха скроллера: сумма `data-test-start-offset` элемента и его предков
  // до скроллера. Так тест «ставит отступ над лентой», не зная внутренних элементов.
  // Как в браузере, верх сдвигается на прокрутку скроллера: прокрутили вниз — элементы поднялись.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    let top = 0;
    let element: Element | null = this;
    for (; element && !element.hasAttribute(SCROLLER_ATTRIBUTE); element = element.parentElement) {
      top += Number(element.getAttribute("data-test-start-offset") ?? 0);
    }
    if (element && element !== this) top -= element.scrollTop;
    const height = heightOf(this);
    return { x: 0, y: top, top, left: 0, right: 400, bottom: top + height, width: 400, height, toJSON: () => ({}) } as DOMRect;
  };

  return {
    get viewportHeight() {
      return layout.viewportHeight;
    },
    set viewportHeight(height: number) {
      layout.viewportHeight = height;
    },
    notifyResize: (element) => {
      for (const observer of observers) observer.report([element]);
    },
    notifyResizeAll: () => {
      for (const observer of observers) observer.report(observed);
    },
    setScrollHeight: (height) => {
      scrollHeightOverride = height;
    },
    uninstall: () => {
      patched.forEach(([target, key], index) => {
        const descriptor = saved[index];
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else Reflect.deleteProperty(target, key);
      });
      observers.clear();
      observed.clear();
    },
  };
}
