import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, Ref, RefObject } from "react";
import { Virtualizer } from "virtua";
import type { CustomItemComponentProps, VirtualizerHandle } from "virtua";
import type { AgentChatMessage } from "./chat-types";

/**
 * Подсказка окну ленты, какой высоты сообщение, пока оно не измерено. Без неё библиотека
 * считает каждое сообщение в 40 px и при первом показе рисует 14 сообщений сверху, потом
 * 14 в конце по прикидке: по сравнению с настоящими (ответ — сотни px) это лишние разборы
 * markdown. Ближе к настоящей высоте — меньше сообщений в пробных проходах.
 */
const UNMEASURED_MESSAGE_HEIGHT_PX = 200;

/**
 * Запас окна ленты за краем экрана. Большой рывок пальцем уходит дальше стандартных 200 px,
 * и за краем на кадр-другой видна пустота; запас в экран с лишним её убирает.
 */
const BUFFER_PX = 800;

/**
 * Цель прокрутки «в самый низ» для окна ленты. Браузер ставит прокрутку не дальше низа, а число
 * не стареет: низ, до которого окно ленты доводит, всегда нынешний, сколько бы сообщений ни добавилось.
 */
const BOTTOM_SCROLL_TARGET = Number.MAX_SAFE_INTEGER;
/**
 * Окно ленты доводит прокрутку первого показа, пока замеры идут чаще чем раз в 150 мс (virtua, `observer.ts`).
 * Лента считает доводку живой, пока перестановки разметки идут чаще этого срока: с запасом.
 */
const OPENING_SCROLL_QUIET_MS = 300;

/** Насколько близко к низу надо быть, чтобы лента сама ехала за новым текстом. */
const STICK_TO_BOTTOM_PX = 96;

/** Сколько после нажатия клавиши переноса (End, PageDown…) прыжок вниз считается прыжком читателя. */
const KEY_JUMP_WINDOW_MS = 1_000;
/** Сколько после отпускания мыши на скроллере (полоса прокрутки) прыжок вниз считается прыжком читателя. */
const POINTER_JUMP_WINDOW_MS = 300;
/** Как долго зажатая мышь считается зажатой, если отпускания не пришло. */
const POINTER_HOLD_LIMIT_MS = 10_000;
const JUMP_KEYS = new Set(["End", "PageDown", "ArrowDown", " "]);
/** Клавиши, которыми читатель двигает ленту в любую сторону. */
const SCROLL_KEYS = new Set([...JUMP_KEYS, "PageUp", "ArrowUp", "Home"]);
/** Сколько после колеса, касания или клавиши шаг прокрутки считается делом читателя, а не вёрстки. */
const READER_INPUT_WINDOW_MS = 250;
/** Клавиши, которыми читатель двигает ленту вверх. */
const UP_KEYS = new Set(["PageUp", "ArrowUp", "Home"]);

export interface MessageFeedHandle {
  /** Ставит прилипание и ведёт ленту вниз: после отправки сообщения. */
  scrollToBottom: () => void;
}

export interface MessageFeedProps {
  /** Скроллер скина: элемент, который прокручивается. */
  scrollRef: RefObject<HTMLElement | null>;
  messages: AgentChatMessage[];
  renderMessage: (message: AgentChatMessage, index: number) => ReactElement;
  /** Пока идёт ответ, последнее сообщение остаётся в дереве, даже если окно ленты уехало вверх. */
  keepLastMounted: boolean;
  /** Что показать при первом показе: сообщение с этим id встаёт у верха; по умолчанию лента внизу. */
  openAtMessageId?: string;
  ref?: Ref<MessageFeedHandle>;
}

/** Обёртка сообщения: за неё зацепляются замеры окна ленты и проверки. */
function FeedItem({ style, children, ref }: CustomItemComponentProps) {
  return (
    <div ref={ref} style={style} data-feed-item="">
      {children}
    </div>
  );
}

/** Поле ввода или элемент внутри редактируемого блока: нажатия в нём ленту не листают. */
function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("textarea, input, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

/**
 * Лента сообщений окном: в дереве только сообщения у экрана и небольшой запас. Правило
 * прокрутки живёт здесь, а не в скине: при первом показе истории лента внизу, у низа она едет
 * за растущим ответом, а после шага читателя вверх (колесо, касание, клавиша) стоит на месте.
 * Снова прилипает, когда читатель вернулся к низу ближе чем на 96 px.
 */
function MessageFeedView({ scrollRef, messages, renderMessage, keepLastMounted, openAtMessageId, ref }: MessageFeedProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  const stuck = useRef(true);
  // Высота списка при прошлой проверке: рост и прокрутка приходят в одном кадре, и отход от низа
  // надо мерить и по новой высоте, и по прежней, иначе рост сам «отодвигает» читателя от низа.
  const lastHeight = useRef(0);
  const lastTop = useRef(0);
  // На сколько px список сжимался с прошлого события прокрутки: сообщения, добавленные с оценкой высоты, измерены ниже.
  const shrunkSinceScroll = useRef(0);
  const openedAtBottom = useRef(false);
  // До какого момента прыжок вниз больше экрана считается действием читателя (клавиша, полоса прокрутки).
  const userJumpUntil = useRef(0);
  // До какого момента шаг вверх считается делом читателя (колесо, касание, клавиша), даже если он мал.
  const readerInputUntil = useRef(0);
  // До какого момента читатель двигает ленту вверх: пока он ведёт, низ не доводится.
  const readerUpUntil = useRef(0);
  // Высота списка и скроллера при последнем доведении низа: низ доводится, только если список вырос или скроллер стал ниже.
  const settledHeight = useRef(0);
  const settledClientHeight = useRef(Infinity);
  const lastTouchY = useRef<number | null>(null);
  const cancelSettle = useRef<(() => void) | null>(null);
  // До какого момента может быть жива доводка первого показа к сообщению: срок продлевает каждая перестановка разметки.
  const openingScrollUntil = useRef(0);
  // Скроллер скина попадает в `scrollRef` только после монтирования; окно ленты строится после него.
  const [scrollerReady, setScrollerReady] = useState(false);
  const [startMargin, setStartMargin] = useState(0);
  // Пока лента не встала на низ, окно рисует только экран без запаса: первый проход разбирает
  // сообщения с самого верха истории, и чем их меньше, тем меньше работа, которая тут же пропадёт.
  // Запас добавляется, когда лента встала на низ.
  const [positioned, setPositioned] = useState(false);
  const lastIndex = messages.length - 1;

  useEffect(() => setScrollerReady(true), []);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const root = rootRef.current;
    if (!scrollerReady || !scroller || !root) return;
    const measure = () => {
      const offset = root.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setStartMargin(Math.max(0, Math.round(offset)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, scrollerReady]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scrollerReady || !scroller) return;
    lastHeight.current = scroller.scrollHeight;
    lastTop.current = scroller.scrollTop;
    const onScroll = () => {
      const height = scroller.scrollHeight;
      const top = scroller.scrollTop;
      const near = Math.min(height, lastHeight.current) - top - scroller.clientHeight < STICK_TO_BOTTOM_PX;
      const shrunk = shrunkSinceScroll.current + Math.max(0, lastHeight.current - height);
      shrunkSinceScroll.current = 0;
      // Прилипание снимает движение вверх дальше порога. Вниз ленту двигает и окно ленты, когда доводит
      // положение после замеров: такой прыжок больше экрана, это не читатель, и прилипания он не ставит.
      // Исключение: прыжок, которому предшествовали клавиша End/PageDown или мышь на полосе прокрутки.
      const step = top - lastTop.current;
      // Вверх ленту двигает и сама вёрстка. Сообщения, что окно ленты считало по прикидке, измерены ниже, список
      // сжался: браузер поджал прокрутку на всё сжатие, а окно ленты, сохраняя место на экране, подвинуло ещё
      // на столько же. Шаг вверх не больше двух сжатий — не читатель: прилипание остаётся, низ доводится.
      // Если перед шагом был ввод читателя, вёрстка ни при чём: иначе читатель боролся бы с лентой.
      const now = performance.now();
      const readerActed = now < readerInputUntil.current || now < userJumpUntil.current;
      const movedByLayout = step < 0 && -step <= 2 * shrunk && !readerActed;
      lastTop.current = top;
      lastHeight.current = height;
      if (movedByLayout) {
        if (stuck.current) scroller.scrollTop = height;
        return;
      }
      // Шаг вверх после ввода читателя снимает прилипание сразу, без порога: медленный тачпад шагает мельче 96 px,
      // а каждый шаг окно ленты встречает перестановкой разметки, и прилипание, оставшееся стоять, возвращало бы читателя вниз.
      if (step < 0) stuck.current = readerActed ? false : near;
      else if (step > 0) {
        // Читатель повернул вниз: вверх он больше не ведёт.
        readerUpUntil.current = 0;
        if (near && (step <= scroller.clientHeight || performance.now() < userJumpUntil.current)) stuck.current = true;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // Клавиши из поля ввода двигают курсор и текст, а не ленту: набор не должен снимать прилипание.
      if (isTextField(event.composedPath()[0] ?? event.target)) return;
      if (JUMP_KEYS.has(event.key)) userJumpUntil.current = performance.now() + KEY_JUMP_WINDOW_MS;
      if (SCROLL_KEYS.has(event.key)) readerInputUntil.current = performance.now() + READER_INPUT_WINDOW_MS;
      if (UP_KEYS.has(event.key)) readerUpUntil.current = performance.now() + READER_INPUT_WINDOW_MS;
    };
    const onWheel = (event: WheelEvent) => {
      readerInputUntil.current = performance.now() + READER_INPUT_WINDOW_MS;
      if (event.deltaY < 0) readerUpUntil.current = performance.now() + READER_INPUT_WINDOW_MS;
    };
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY.current = event.touches?.[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      readerInputUntil.current = performance.now() + READER_INPUT_WINDOW_MS;
      // Палец идёт вниз — лента едет вверх. Если направление неизвестно, считаем, что вверх.
      const y = event.touches?.[0]?.clientY;
      const up = y === undefined || lastTouchY.current === null || y >= lastTouchY.current;
      lastTouchY.current = y ?? null;
      if (up) readerUpUntil.current = performance.now() + READER_INPUT_WINDOW_MS;
    };
    const onPointerDown = () => {
      userJumpUntil.current = performance.now() + POINTER_HOLD_LIMIT_MS;
    };
    const onPointerUp = () => {
      if (userJumpUntil.current > performance.now() + POINTER_JUMP_WINDOW_MS) userJumpUntil.current = performance.now() + POINTER_JUMP_WINDOW_MS;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("wheel", onWheel, { passive: true });
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      document.removeEventListener("keydown", onKeyDown);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("wheel", onWheel);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [scrollRef, scrollerReady]);

  // Лента выросла или скроллер стал ниже, а читатель у низа: довести низ до края.
  useEffect(() => {
    const scroller = scrollRef.current;
    const root = rootRef.current;
    if (!scrollerReady || !scroller || !root) return;
    const settleAtBottom = () => {
      const height = scroller.scrollHeight;
      const clientHeight = scroller.clientHeight;
      shrunkSinceScroll.current += Math.max(0, lastHeight.current - height);
      lastHeight.current = height;
      // Любая перестановка разметки окном ленты (шаг прокрутки уводит одни сообщения и приводит другие) сюда доходит,
      // но низ нужен только после роста списка или когда скроллер стал ниже. И не пока читатель ведёт ленту вверх.
      const needed = height > settledHeight.current || clientHeight < settledClientHeight.current;
      settledHeight.current = height;
      settledClientHeight.current = clientHeight;
      if (stuck.current && needed && performance.now() >= readerUpUntil.current) scroller.scrollTop = height;
    };
    // Окно ленты подправляет положение после замеров уже после наблюдателя: в следующем кадре низ доводится ещё раз.
    let followUp = 0;
    const follow = () => {
      if (openingScrollUntil.current > 0) openingScrollUntil.current = performance.now() + OPENING_SCROLL_QUIET_MS;
      settleAtBottom();
      if (followUp === 0)
        followUp = requestAnimationFrame(() => {
          followUp = 0;
          settleAtBottom();
        });
    };
    // Высоту списка меняет окно ленты, когда дописывается ответ: по наблюдателю за разметкой низ
    // доводится в том же кадре. Наблюдатель за размером корня здесь не годится: окно ленты меняет
    // корень изнутри собственной проверки размеров, и браузер переносит доставку на следующий кадр
    // с жалобой «ResizeObserver loop completed with undelivered notifications».
    const listObserver = new MutationObserver(follow);
    listObserver.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
    // Скроллер стал ниже (экранная клавиатура, выросло поле ввода): низ тоже надо довести до края.
    const scrollerObserver = new ResizeObserver(follow);
    scrollerObserver.observe(scroller);
    return () => {
      listObserver.disconnect();
      scrollerObserver.disconnect();
      cancelAnimationFrame(followUp);
    };
  }, [scrollRef, scrollerReady]);

  // Первый показ истории: сразу внизу.
  useLayoutEffect(() => {
    if (messages.length === 0) {
      openedAtBottom.current = false;
      openingScrollUntil.current = 0;
      cancelSettle.current?.();
      setPositioned(false);
      return;
    }
    const scroller = scrollRef.current;
    if (!scrollerReady || !scroller || openedAtBottom.current) return;
    openedAtBottom.current = true;
    const focusIndex = openAtMessageId === undefined ? -1 : messages.findIndex((message) => message.id === openAtMessageId);
    stuck.current = focusIndex < 0 || focusIndex === lastIndex;
    // Доводка окна ленты переживает первый показ, если замеры не затихают: ответ пришёл и сразу отправлен
    // следующий вопрос. Цель «низ» не стареет; цель «сообщение» заменяет отправка (`scrollToBottom`).
    if (focusIndex >= 0 && focusIndex < lastIndex) {
      virtualizerRef.current?.scrollToIndex(focusIndex, { align: "start" });
      openingScrollUntil.current = performance.now() + OPENING_SCROLL_QUIET_MS;
    } else {
      virtualizerRef.current?.scrollTo(BOTTOM_SCROLL_TARGET);
      openingScrollUntil.current = 0;
    }
    // Прыжок вниз видно по событию прокрутки; в короткой ленте прыжка нет, и хватает пары кадров.
    let frame = 0;
    const cancel = () => {
      scroller.removeEventListener("scroll", settle);
      cancelAnimationFrame(frame);
      cancelSettle.current = null;
    };
    const settle = () => {
      cancel();
      setPositioned(true);
    };
    cancelSettle.current = cancel;
    scroller.addEventListener("scroll", settle, { once: true });
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(settle);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- открытие один раз: id и сообщения читаются в этот момент
  }, [scrollRef, scrollerReady, messages.length, lastIndex]);

  // Пары кадров и слушателя первого показа не должны пережить ленту.
  useEffect(() => () => cancelSettle.current?.(), []);

  // Без `scrollToIndex` окна ленты: оно держит цель, пока идут замеры, а ответ дописывается сплошным
  // потоком замеров, и читателя, ушедшего вверх, тянуло бы обратно. Лента сама доезжает до низа:
  // высота списка меняется по мере замеров, и наблюдатель за ней (выше) снова опускает низ, пока
  // прилипание стоит.
  // Исключение — ещё живая доводка первого показа к сообщению: она тянула бы ленту обратно к нему.
  // Её можно только заменить новой, и цель новой — низ.
  const scrollToBottom = useCallback(() => {
    stuck.current = true;
    if (performance.now() < openingScrollUntil.current) virtualizerRef.current?.scrollTo(BOTTOM_SCROLL_TARGET);
    openingScrollUntil.current = 0;
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [scrollRef]);
  useImperativeHandle(ref, () => ({ scrollToBottom }), [scrollToBottom]);

  const keepMounted = useMemo(() => (keepLastMounted && lastIndex >= 0 ? [lastIndex] : []), [keepLastMounted, lastIndex]);

  return (
    <div ref={rootRef}>
      {scrollerReady && (
        <Virtualizer
          ref={virtualizerRef}
          scrollRef={scrollRef}
          data={messages}
          itemSize={UNMEASURED_MESSAGE_HEIGHT_PX}
          bufferSize={positioned ? BUFFER_PX : 0}
          item={FeedItem}
          keepMounted={keepMounted}
          startMargin={startMargin}
        >
          {(message, index) => renderMessage(message, index)}
        </Virtualizer>
      )}
    </div>
  );
}

/** `memo`: ввод в поле и другие перерисовки чата, не меняющие ленту, её не трогают. */
export const MessageFeed = memo(MessageFeedView);
