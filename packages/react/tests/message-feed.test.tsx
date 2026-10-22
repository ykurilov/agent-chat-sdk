// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createRef, useRef } from "react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentChatMessage } from "../src/chat-types";
import { MessageFeed } from "../src/message-feed";
import type { MessageFeedHandle } from "../src/message-feed";
import { settle, waitForFeedPositioned } from "./support/chat-dom";
import { installFakeLayout } from "./support/fake-layout";

const VIEWPORT_HEIGHT = 600;
const ITEM_HEIGHT = 50;

let layout: ReturnType<typeof installFakeLayout>;

beforeEach(() => {
  layout = installFakeLayout({ viewportHeight: VIEWPORT_HEIGHT, itemHeight: ITEM_HEIGHT });
});

afterEach(() => {
  cleanup();
  layout.uninstall();
});

function makeMessages(count: number): AgentChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `сообщение ${index}` }],
  }));
}

function Harness({
  messages,
  keepLastMounted = false,
  startOffset = 0,
  handleRef,
  openAtMessageId,
}: {
  messages: AgentChatMessage[];
  keepLastMounted?: boolean;
  /** Отступ над лентой внутри скроллера, как у скина с полями. */
  startOffset?: number;
  handleRef?: RefObject<MessageFeedHandle | null>;
  openAtMessageId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollRef} data-test-scroller data-testid="scroller" style={{ overflowY: "auto" }}>
      <div data-test-start-offset={startOffset}>
        <MessageFeed
          {...(handleRef && { ref: handleRef })}
          scrollRef={scrollRef}
          messages={messages}
          keepLastMounted={keepLastMounted}
          {...(openAtMessageId !== undefined && { openAtMessageId })}
          renderMessage={(message) => <p data-message={message.id}>{message.id}</p>}
        />
      </div>
    </div>
  );
}

const scroller = () => document.querySelector<HTMLElement>('[data-testid="scroller"]')!;
const mounted = (id: string) => document.querySelector(`[data-message="${id}"]`);
const mountedCount = () => document.querySelectorAll("[data-message]").length;
const maxScrollTop = () => scroller().scrollHeight - VIEWPORT_HEIGHT;

async function renderFeed(props: Parameters<typeof Harness>[0]) {
  const view = render(<Harness {...props} />);
  await settle();
  await settle();
  await waitForFeedPositioned();
  return view;
}

async function scrollTo(top: number) {
  await act(async () => {
    scroller().scrollTop = top;
  });
  await settle();
}

describe("окно ленты", () => {
  it("500 сообщений: смонтировано не больше 40, последнее есть, первого нет (FR-001)", async () => {
    await renderFeed({ messages: makeMessages(500) });

    expect(mountedCount()).toBeGreaterThan(0);
    expect(mountedCount()).toBeLessThanOrEqual(40);
    expect(mounted("m499")).not.toBeNull();
    expect(mounted("m0")).toBeNull();
  });

  it.each([false, true])("промежуточный низ после замеров не закрепляет весь остаток истории (keepLastMounted=%s)", async (keepLastMounted) => {
    layout.uninstall();
    layout = installFakeLayout({ viewportHeight: VIEWPORT_HEIGHT, itemHeight: 100 });
    await renderFeed({ messages: makeMessages(500), keepLastMounted });
    await scrollTo(30_000);
    const top = scroller().scrollTop;
    // DOM уже сжался после замеров, а окно ещё хранит оценки/отложенные поправки
    // WebKit. Малый шаг оказывается у текущего низа и включает следование за ним.
    layout.setScrollHeight(top + VIEWPORT_HEIGHT + 40);
    await scrollTo(top + 40);

    expect(mountedCount()).toBeLessThanOrEqual(40);
    // Только растущий ответ закреплён за краем окна, остальные дальние сообщения сняты.
    expect(mounted("m499") !== null).toBe(keepLastMounted);
  });

  it("при открытии скроллер внизу (FR-002)", async () => {
    await renderFeed({ messages: makeMessages(500) });

    expect(scroller().scrollTop).toBeGreaterThan(0);
    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it("прокрутка к началу: первое сообщение смонтировано, последнего уже нет (FR-003)", async () => {
    await renderFeed({ messages: makeMessages(500) });

    await scrollTo(0);

    expect(mounted("m0")).not.toBeNull();
    expect(mounted("m499")).toBeNull();
    expect(mountedCount()).toBeLessThanOrEqual(40);
  });

  it("каждое сообщение лежит в обёртке с data-feed-item", async () => {
    await renderFeed({ messages: makeMessages(500) });

    const messages = document.querySelectorAll("[data-message]");
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message.closest("[data-feed-item]")).not.toBeNull();
    expect(document.querySelectorAll("[data-feed-item]")).toHaveLength(messages.length);
  });

  it.each([
    { keepLastMounted: true, lastStaysMounted: true },
    { keepLastMounted: false, lastStaysMounted: false },
  ])("при keepLastMounted=$keepLastMounted последнее сообщение после прокрутки вверх в дереве: $lastStaysMounted", async ({ keepLastMounted, lastStaysMounted }) => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted });
    await scrollTo(0);

    expect(mounted("m0")).not.toBeNull();
    expect(mounted("m499") !== null).toBe(lastStaysMounted);
  });

  // Проход по всему списку — около 120 шагов с настоящими паузами: в тишине занимает секунду, на холодном старте под нагрузкой
  // не помещается в 5 секунд по умолчанию. А тайм-аут посреди `act` ломает его для всех следующих тестов файла: они падают каскадом.
  it("отступ над лентой внутри скроллера учитывается (research R2)", { timeout: 30_000 }, async () => {
    const firstMountedIndex = () => Math.min(...[...document.querySelectorAll("[data-message]")].map((element) => Number(element.getAttribute("data-message")!.slice(1))));
    const position = 22_000;
    // Сперва проходим весь список сверху вниз: все сообщения измерены, оценки высот не мешают счёту.
    const measureAll = async () => {
      for (let top = 0; top <= maxScrollTop(); top += 400) await scrollTo(top);
    };

    const withoutOffset = await renderFeed({ messages: makeMessages(500) });
    await measureAll();
    await scrollTo(position);
    const firstWithoutOffset = firstMountedIndex();
    withoutOffset.unmount();

    await renderFeed({ messages: makeMessages(500), startOffset: 300 });
    await measureAll();
    await scrollTo(position);
    const firstWithOffset = firstMountedIndex();

    // Список начинается на 300 px ниже верха скроллера: на той же прокрутке в окне сообщения на 300 px раньше.
    expect(firstWithOffset).toBeLessThan(firstWithoutOffset);
    expect(firstWithoutOffset - firstWithOffset).toBeGreaterThanOrEqual(300 / ITEM_HEIGHT - 1);
  });
});

describe("прилипание к низу", () => {
  /** Растёт последнее сообщение: как дописывающийся ответ. */
  async function growLastMessage(height: number, messageId = "m499") {
    const item = mounted(messageId)!.closest<HTMLElement>("[data-feed-item]")!;
    item.setAttribute("data-test-height", String(height));
    await act(async () => layout.notifyResize(item));
    await settle();
    // Браузер сообщает и о смене высоты самой ленты.
    await act(async () => layout.notifyResizeAll());
    await settle();
  }

  it("у низа рост последнего сообщения ведёт скроллер в самый низ (FR-004)", async () => {
    await renderFeed({ messages: makeMessages(500) });
    const before = scroller().scrollHeight;

    await growLastMessage(250);

    expect(scroller().scrollHeight).toBeGreaterThan(before);
    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it("после прокрутки вверх больше чем на 96 px рост не двигает скроллер (FR-004)", async () => {
    // Ответ растёт, пока идёт, и тогда он всегда в дереве (keepLastMounted).
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    await scrollTo(maxScrollTop() - 200);
    const position = scroller().scrollTop;

    await growLastMessage(250);

    expect(scroller().scrollTop).toBe(position);
  });

  it("небольшой отход от низа (меньше 96 px) не снимает прилипание", async () => {
    await renderFeed({ messages: makeMessages(500) });
    await scrollTo(maxScrollTop() - 40);

    await growLastMessage(250);

    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it("рост высоты и событие прокрутки в одном кадре не снимают прилипание", async () => {
    await renderFeed({ messages: makeMessages(500) });

    // Список вырос, а скроллер ещё не догнал: событие прокрутки приходит уже с новой высотой
    // (так бывает после сдвига, который библиотека делает при замере сообщений над экраном).
    layout.setScrollHeight(scroller().scrollHeight + 400);
    await act(async () => {
      scroller().dispatchEvent(new Event("scroll"));
    });
    await growLastMessage(250);

    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it.each([
    { movement: 200, growth: 400, anchorShift: 0, follows: false },
    { movement: 104, growth: 400, anchorShift: -104, follows: true },
    { movement: 272, growth: -140, anchorShift: 0, follows: true },
    { movement: 112, growth: 400, anchorShift: -104, follows: false },
  ])("рост перед доставкой отложенного события scroll: movement=$movement growth=$growth follows=$follows", async ({ movement, growth, anchorShift, follows }) => {
    // Все строки измерены до гонки: отложенное событие не смешивается с
    // первичными оценками высот длинной истории (её лимит проверяется отдельно).
    await renderFeed({ messages: makeMessages(20), keepLastMounted: true });
    const element = scroller();
    const height = element.scrollHeight;
    const bottom = element.scrollTop;
    const target = bottom - movement;
    const anchor = mounted("m19")!.closest<HTMLElement>("[data-feed-item]")!;
    anchor.setAttribute("data-test-start-offset", String(bottom + 200));
    await act(async () => element.dispatchEvent(new Event("scroll")));
    const dispatch = element.dispatchEvent;
    const pending: Event[] = [];
    // Браузер меняет scrollTop сразу, а native scroll доставляет позже.
    element.dispatchEvent = (event) => {
      if (event.type === "scroll") { pending.push(event); return true; }
      return dispatch.call(element, event);
    };
    try {
      await act(async () => {
        anchor.setAttribute("data-test-start-offset", String(bottom + 200 + anchorShift));
        layout.setScrollHeight(height + growth);
        element.scrollTop = target;
        anchor.style.outlineWidth = "0px";
      });
      expect(element.scrollTop).toBe(follows ? maxScrollTop() : target);
      element.dispatchEvent = dispatch;
      await act(async () => { for (const event of pending) dispatch.call(element, event); });
      await settle();
      // После замеров virtua вправе компенсировать логический offset.
      // Читатель остаётся выше низа, а следующий рост сохраняет его место.
      const position = element.scrollTop;
      if (!follows) expect(maxScrollTop() - position).toBeGreaterThan(96);
      layout.setScrollHeight(element.scrollHeight + 400);
      await growLastMessage(250, "m19");
      if (follows) expect(Math.abs(element.scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
      else expect(element.scrollTop).toBe(position);
    } finally {
      element.dispatchEvent = dispatch;
    }
  });

  it("прокрутка вверх больше чем на 96 px в кадре роста снимает прилипание", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    const bottom = scroller().scrollTop;

    // Список вырос на 400 px, и в том же кадре читатель ушёл от низа больше чем на 96 px.
    layout.setScrollHeight(scroller().scrollHeight + 400);
    await scrollTo(bottom - 200);
    const position = scroller().scrollTop;
    await growLastMessage(250);

    expect(scroller().scrollTop).toBe(position);
  });

  it("сообщения оказались ниже оценки: браузер поджимает прокрутку, окно ленты сдвигает ещё раз — это не читатель, прилипание остаётся (FR-004)", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    const height = scroller().scrollHeight;
    const bottom = scroller().scrollTop;

    // Только что добавленные сообщения окно ленты считало по 200 px, измерило меньше: список сжался на 140 px.
    // Браузер поджал прокрутку на те же 140 px, а окно ленты, компенсируя сдвиг над экраном, подвинуло ещё
    // на 132 px вверх. Читателя тут нет: событие прокрутки приходит одно, с шагом вверх больше 96 px.
    layout.setScrollHeight(height - 140);
    let topRightAfter = -1;
    act(() => {
      scroller().scrollTop = bottom - 272;
      topRightAfter = scroller().scrollTop;
    });

    // Низ доведён сразу, не дожидаясь следующего куска ответа.
    expect(topRightAfter).toBe(maxScrollTop());
  });

  it.each([
    { readerUp: false, movement: 104, follows: true },
    { readerUp: true, movement: 104, follows: false },
    { readerUp: false, movement: 112, follows: false },
    { readerUp: false, movement: 304, follows: false },
  ])("поправка якоря при росте списка: movement=$movement readerUp=$readerUp follows=$follows", async ({ readerUp, movement, follows }) => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    const bottom = scroller().scrollTop;
    const height = scroller().scrollHeight;
    const anchor = mounted("m499")!.closest<HTMLElement>("[data-feed-item]")!;
    // Существующее сообщение в экране. После замера его координата в списке
    // сдвигается на -104 px, хотя добавленное сообщение увеличило общую высоту.
    anchor.setAttribute("data-test-start-offset", String(bottom + 200));
    await act(async () => scroller().dispatchEvent(new Event("scroll")));
    anchor.setAttribute("data-test-start-offset", String(bottom + 200 - 104));
    layout.setScrollHeight(height + 400);
    let actual = -1;
    act(() => {
      if (readerUp) scroller().dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -104 }));
      scroller().scrollTop = bottom - movement;
      actual = scroller().scrollTop;
    });
    expect(actual).toBe(follows ? maxScrollTop() : bottom - movement);
    // Проверяем и следующий рост после доставки очереди scroll/observer/rAF:
    // компенсация не снимает следование, а читателя назад вниз не возвращает.
    await settle();
    const position = scroller().scrollTop;
    layout.setScrollHeight(scroller().scrollHeight + 400);
    await growLastMessage(250);
    if (follows) expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
    else expect(scroller().scrollTop).toBe(position);
  });

  describe("клавиши, нажатые в поле ввода, ленту не трогают", () => {
    const keys = [" ", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];

    /** Сдвиг вверх от пересчёта высот сразу после клавиши; возвращает, куда встала прокрутка сразу после сдвига. */
    async function pressThenLayoutShift(target: () => EventTarget, key: string) {
      await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
      const height = scroller().scrollHeight;
      const bottom = scroller().scrollTop;
      layout.setScrollHeight(height - 140);
      let topRightAfter = -1;
      act(() => {
        target().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        scroller().scrollTop = bottom - 272;
        topRightAfter = scroller().scrollTop;
      });
      return topRightAfter;
    }

    const fields: Array<[string, () => HTMLElement]> = [
      ["textarea", () => document.createElement("textarea")],
      ["input", () => document.createElement("input")],
      ["select", () => document.createElement("select")],
      [
        "contenteditable",
        () => {
          const editor = document.createElement("div");
          editor.setAttribute("contenteditable", "true");
          return editor;
        },
      ],
    ];

    for (const [fieldName, makeField] of fields) {
      it.each(keys)(`${fieldName}: клавиша «%s» не снимает прилипание, низ доводится`, async (key) => {
        const field = makeField();
        document.body.append(field);
        const topRightAfter = await pressThenLayoutShift(() => field, key);
        field.remove();
        expect(topRightAfter).toBe(maxScrollTop());
      });
    }

    it("вложенный элемент внутри contenteditable тоже поле ввода", async () => {
      const editor = document.createElement("div");
      editor.setAttribute("contenteditable", "true");
      const inner = document.createElement("span");
      editor.append(inner);
      document.body.append(editor);
      const topRightAfter = await pressThenLayoutShift(() => inner, " ");
      editor.remove();
      expect(topRightAfter).toBe(maxScrollTop());
    });

    it.each(keys)("та же клавиша «%s» на самой ленте снимает прилипание, как раньше", async (key) => {
      const topRightAfter = await pressThenLayoutShift(() => scroller(), key);
      // Прилипание снято: низ не доводится, прокрутка остаётся там, куда её сдвинул пересчёт высот.
      expect(topRightAfter).toBeLessThan(maxScrollTop());
    });
  });

  it("шаг вверх, который сжатие списка не объясняет, снимает прилипание", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    const height = scroller().scrollHeight;
    const bottom = scroller().scrollTop;

    // Список сжался на 20 px, а прокрутка ушла вверх на 300 px: так может только читатель.
    layout.setScrollHeight(height - 20);
    await scrollTo(bottom - 300);
    const position = scroller().scrollTop;
    await growLastMessage(250);

    expect(scroller().scrollTop).toBe(position);
  });

  describe("малый шаг читателя рядом со сжатием списка снимает прилипание", () => {
    const inputs: Array<[string, () => Event]> = [
      ["колесо", () => new WheelEvent("wheel", { bubbles: true, deltaY: -30 })],
      ["касание", () => new Event("touchmove", { bubbles: true })],
      ["клавиша «стрелка вверх»", () => new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })],
    ];

    it.each(inputs)("%s", async (_name, makeInput) => {
      await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
      const height = scroller().scrollHeight;
      const bottom = scroller().scrollTop;

      // Список сжался на 40 px (браузер поджал прокрутку на них), и в том же кадре читатель ушёл вверх ещё на 30 px:
      // общий шаг вверх 70 px меньше двух сжатий, но перед ним был ввод читателя.
      layout.setScrollHeight(height - 40);
      let topRightAfter = -1;
      act(() => {
        const input = makeInput();
        (input.type === "keydown" ? document : scroller()).dispatchEvent(input);
        scroller().scrollTop = bottom - 70;
        topRightAfter = scroller().scrollTop;
      });

      // Читателя не вернули к низу силой сразу же.
      expect(topRightAfter).toBe(bottom - 70);
    });
  });

  describe("медленный шаг читателя вверх у низа снимает прилипание сразу, без порога 96 px", () => {
    const inputs: Array<[string, () => Event]> = [
      ["колесо", () => new WheelEvent("wheel", { bubbles: true, deltaY: -8 })],
      ["касание", () => new Event("touchmove", { bubbles: true })],
      ["клавиша «стрелка вверх»", () => new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })],
    ];

    /** Окно ленты перестраивается на каждый шаг: меняется style элемента — наблюдатель за разметкой это видит. */
    const shuffleWindow = async () => {
      const item = document.querySelector<HTMLElement>("[data-feed-item]")!;
      await act(async () => item.setAttribute("style", `${item.getAttribute("style") ?? ""} `));
      await settle();
    };

    it.each(inputs)("%s: перестановка окна ленты не возвращает читателя вниз", async (_name, makeInput) => {
      await renderFeed({ messages: makeMessages(500), keepLastMounted: true });

      for (let step = 1; step <= 5; step++) {
        await act(async () => {
          const input = makeInput();
          (input.type === "keydown" ? document : scroller()).dispatchEvent(input);
          scroller().scrollTop -= 8;
        });
        await shuffleWindow();
        // Окно ленты, измерив сообщения над экраном, само двигает прокрутку, поэтому считаем от текущего низа списка.
        expect(maxScrollTop() - scroller().scrollTop, `после шага ${step} читатель остаётся выше низа`).toBeGreaterThanOrEqual(8);
      }
    });

    it("перестановка окна ленты без ввода читателя и без роста списка низ не двигает", async () => {
      await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
      // Читатель в 40 px от низа (прилипание стоит), список не растёт: низ доводить незачем.
      await scrollTo(maxScrollTop() - 40);
      const position = scroller().scrollTop;

      await shuffleWindow();

      expect(scroller().scrollTop).toBe(position);
    });

    it("после медленного шага вверх читатель вернулся вниз: прилипание ставится снова", async () => {
      await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
      const bottom = scroller().scrollTop;
      await act(async () => {
        scroller().dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -8 }));
        scroller().scrollTop = bottom - 8;
      });
      await settle();
      await scrollTo(maxScrollTop());

      await growLastMessage(250);

      expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
    });
  });

  it("возврат к низу шагом меньше экрана снова ставит прилипание", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    await scrollTo(maxScrollTop() - 300);
    await scrollTo(maxScrollTop());

    await growLastMessage(250);

    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it("прыжок вниз больше экрана прилипания не ставит: так окно ленты доводит положение после замеров", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    await scrollTo(maxScrollTop() - 3000);
    const bottom = maxScrollTop();
    await scrollTo(bottom);
    const position = scroller().scrollTop;

    await growLastMessage(250);

    expect(scroller().scrollTop).toBe(position);
  });

  it("прыжок вниз клавишей End ставит прилипание: это читатель, а не окно ленты", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    await scrollTo(maxScrollTop() - 3000);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    });
    await scrollTo(maxScrollTop());
    await growLastMessage(250);

    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it("прыжок вниз по полосе прокрутки (мышь зажата на скроллере) ставит прилипание", async () => {
    await renderFeed({ messages: makeMessages(500), keepLastMounted: true });
    await scrollTo(maxScrollTop() - 3000);

    await act(async () => {
      scroller().dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    await scrollTo(maxScrollTop());
    await act(async () => {
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });
    await growLastMessage(250);

    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  it("скроллер стал ниже (экранная клавиатура), пока читатель у низа: низ остаётся у края", async () => {
    await renderFeed({ messages: makeMessages(500) });

    layout.viewportHeight = 300;
    await act(async () => layout.notifyResize(scroller()));
    await settle();

    expect(Math.abs(scroller().scrollTop - (scroller().scrollHeight - 300))).toBeLessThanOrEqual(1);
  });

  it("scrollToBottom() ставит прилипание и ведёт вниз", async () => {
    const handle = createRef<MessageFeedHandle>();
    await renderFeed({ messages: makeMessages(500), handleRef: handle });
    await scrollTo(0);

    await act(async () => handle.current!.scrollToBottom());
    await settle();
    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);

    await growLastMessage(250);
    expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
  });

  // Окно ленты доводит прокрутку первого показа, пока замеры идут чаще чем раз в 150 мс. Быстрая
  // отправка сразу после ответа не даёт им затихнуть: доводка живёт и тянет ленту к прежнему концу.
  describe("отправка, пока не затихла доводка первого показа", () => {
    /** Новый ход без пауз: вопрос и ответ, ответ дописывается кусками. */
    async function quickTurn(view: ReturnType<typeof render>, handle: RefObject<MessageFeedHandle | null>, messages: AgentChatMessage[], props: Partial<Parameters<typeof Harness>[0]> = {}) {
      const next = makeMessages(messages.length + 2);
      view.rerender(<Harness messages={next} keepLastMounted handleRef={handle} {...props} />);
      await act(async () => handle.current!.scrollToBottom());
      await settle();
      const answer = () => mounted(next.at(-1)!.id)!.closest<HTMLElement>("[data-feed-item]")!;
      for (const height of [150, 300, 450, 600]) {
        answer().setAttribute("data-test-height", String(height));
        await act(async () => layout.notifyResize(answer()));
        await settle();
      }
      return next;
    }

    it("читатель ушёл вверх сразу после отправки: дальнейшие замеры не возвращают его к низу", async () => {
      const handle = createRef<MessageFeedHandle>();
      const messages = makeMessages(40);
      const view = render(<Harness messages={messages} keepLastMounted handleRef={handle} />);
      await settle();
      await settle();
      const next = await quickTurn(view, handle, messages);

      // Не ждём 150 мс тишины virtua: начальная доводка ещё может быть жива.
      await act(async () => { scroller().scrollTop -= 3 * scroller().clientHeight; });
      const position = scroller().scrollTop;
      expect(maxScrollTop() - position).toBeGreaterThan(96);

      await growLastMessage(900, next.at(-1)!.id);

      expect(scroller().scrollTop).toBe(position);
      expect(maxScrollTop() - scroller().scrollTop).toBeGreaterThan(96);
      await growLastMessage(1_200, next.at(-1)!.id);
      expect(scroller().scrollTop).toBe(position);
    });

    it("лента открыта внизу: новый ответ остаётся у низа", async () => {
      const handle = createRef<MessageFeedHandle>();
      const messages = makeMessages(40);
      const view = render(<Harness messages={messages} keepLastMounted handleRef={handle} />);
      await settle();
      await settle();

      await quickTurn(view, handle, messages);

      expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
    });

    it("лента открыта на сообщении: после отправки новый ответ остаётся у низа", async () => {
      const handle = createRef<MessageFeedHandle>();
      const messages = makeMessages(40);
      const view = render(<Harness messages={messages} keepLastMounted handleRef={handle} openAtMessageId="m30" />);
      await settle();
      await settle();

      await quickTurn(view, handle, messages, { openAtMessageId: "m30" });

      expect(Math.abs(scroller().scrollTop - maxScrollTop())).toBeLessThanOrEqual(1);
    });
  });
});
