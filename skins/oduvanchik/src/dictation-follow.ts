import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

const textareaOf = (wrapperRef: RefObject<HTMLDivElement | null>) => wrapperRef.current?.querySelector("textarea") ?? null;

/**
 * Пока идёт диктовка, слова дописываются в конец, а браузер поле не прокручивает: держим последние слова на виду.
 * Но если человек сам прокрутил вверх, чтобы перечитать, его не тянем вниз, пока он не вернётся к концу.
 */
export function useFollowDictation(wrapperRef: RefObject<HTMLDivElement | null>, value: string, dictating: boolean) {
  // Человек сейчас у конца поля (или ещё ничего не прокручивал): значит, поле ведём за словами.
  const atBottom = useRef(true);

  useLayoutEffect(() => {
    if (dictating) atBottom.current = true;
  }, [dictating]);

  useLayoutEffect(() => {
    const textarea = textareaOf(wrapperRef);
    if (!textarea) return;
    const onScroll = () => {
      atBottom.current = textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight <= 2;
    };
    textarea.addEventListener("scroll", onScroll);
    return () => textarea.removeEventListener("scroll", onScroll);
  }, [wrapperRef]);

  useLayoutEffect(() => {
    if (!dictating || !atBottom.current) return;
    const textarea = textareaOf(wrapperRef);
    if (textarea) textarea.scrollTop = textarea.scrollHeight;
  }, [wrapperRef, value, dictating]);
}

interface Caret {
  value: string;
  start: number;
  end: number;
}

/** Куда переехал знак старой строки, если заменён только один кусок посередине: общее начало и общий конец остаются на месте. */
function movedPosition(position: number, before: string, after: string): number {
  let prefix = 0;
  const shortest = Math.min(before.length, after.length);
  while (prefix < shortest && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;

  if (position <= prefix) return position;
  const replacedEnd = before.length - suffix;
  // Внутри заменённого куска прежнего места уже нет: ставим в конец нового куска.
  if (position < replacedEnd) return after.length - suffix;
  return position + (after.length - before.length);
}

/**
 * Пока идёт чистка, надиктованный кусок в поле заменяется исправленным, и браузер бросает курсор в конец.
 * Запоминаем, где курсор был в прежнем тексте, и ставим его на то же место нового: в хвосте — с учётом разницы длин,
 * до куска — как был, внутри куска — в его конец. Печать руками курсор не трогает: там текст поля уже совпадает с новым.
 */
export function useKeepCaretWhilePolishing(wrapperRef: RefObject<HTMLDivElement | null>, value: string, polishing: boolean) {
  const known = useRef<Caret | null>(null);
  const wasPolishing = useRef(false);

  useLayoutEffect(() => {
    const textarea = textareaOf(wrapperRef);
    if (!textarea) return;
    const remember = () => {
      known.current = { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
    };
    const onSelectionChange = () => {
      if (document.activeElement === textarea) remember();
    };
    const events = ["select", "input", "keyup", "click", "focus"] as const;
    for (const name of events) textarea.addEventListener(name, remember);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      for (const name of events) textarea.removeEventListener(name, remember);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [wrapperRef]);

  useLayoutEffect(() => {
    const textarea = textareaOf(wrapperRef);
    if (!textarea) return;
    const previous = known.current;
    // Замену и конец диктовки React может показать одним обновлением: чистка шла в прошлый раз.
    if (previous && previous.value !== value && (polishing || wasPolishing.current)) {
      textarea.setSelectionRange(
        movedPosition(previous.start, previous.value, value),
        movedPosition(previous.end, previous.value, value),
      );
    }
    wasPolishing.current = polishing;
    known.current = { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd };
  }, [wrapperRef, value, polishing]);
}
