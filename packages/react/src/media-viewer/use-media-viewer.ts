import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MediaViewerProps } from "../skin-contract";
import type { MediaViewerItem } from "./media-viewer-types";

export interface UseMediaViewerOptions {
  /** Карусель чата на сейчас; зовётся, только пока окно открыто. Новая функция — карусель пересобирается. */
  getItems: () => readonly MediaViewerItem[];
  /** Смена значения (другой чат, другая ветка) закрывает окно. */
  resetKey: string;
}

export interface MediaViewerController {
  /**
   * Открыть элемент `key`. `items` — свой набор (схема открывается одна); без него — карусель чата.
   * Функция стабильна: строки ленты, которые её держат, не перерисовываются.
   */
  open: (key: string, trigger: HTMLElement, items?: readonly MediaViewerItem[]) => void;
  /** Свойства для `skin.MediaViewer`; `null` — окно закрыто. */
  viewer: MediaViewerProps | null;
}

/** Отметка своей записи в истории браузера: по ней «назад» узнаёт, что закрыть надо окно, а не уйти со страницы. */
const ENTRY_FIELD = "agentChatViewer";
let entryCounter = 0;

interface OpenViewer {
  key: string;
  items?: readonly MediaViewerItem[];
  entry: number;
}

const currentEntry = (): unknown => (history.state as Record<string, unknown> | null)?.[ENTRY_FIELD];

/**
 * Окно просмотра со стороны поведения: какой элемент открыт, запись в истории браузера (жест «назад» закрывает окно)
 * и возврат фокуса на элемент, с которого открыли. Открытый элемент помнится по `key`: новые картинки в ленте
 * окно не сдвигают, а пропавший элемент окно закрывает.
 */
export function useMediaViewer({ getItems, resetKey }: UseMediaViewerOptions): MediaViewerController {
  const [opened, setOpened] = useState<OpenViewer | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const openedRef = useRef(opened);
  openedRef.current = opened;
  const getItemsRef = useRef(getItems);
  getItemsRef.current = getItems;

  const items = useMemo(() => (opened ? (opened.items ?? getItems()) : []), [opened, getItems]);
  const index = opened ? items.findIndex((item) => item.key === opened.key) : -1;

  /** Закрыть; `fromHistory` — запись уже ушла сама («назад»), иначе убрать её. */
  const close = useCallback((fromHistory: boolean, returnFocus: boolean) => {
    const current = openedRef.current;
    if (!current) return;
    openedRef.current = null;
    setOpened(null);
    if (!fromHistory && currentEntry() === current.entry) history.back();
    const source = trigger.current;
    trigger.current = null;
    if (returnFocus && source?.isConnected) source.focus();
  }, []);

  const open = useCallback(
    (key: string, source: HTMLElement, own?: readonly MediaViewerItem[]) => {
      if (!(own ?? getItemsRef.current()).some((item) => item.key === key)) return;
      trigger.current = source;
      const current = openedRef.current;
      const entry = current?.entry ?? ++entryCounter;
      if (!current) history.pushState({ ...(history.state as Record<string, unknown> | null), [ENTRY_FIELD]: entry }, "");
      const next: OpenViewer = { key, entry, ...(own && { items: own }) };
      openedRef.current = next;
      setOpened(next);
    },
    [],
  );

  // «Назад» (кнопка браузера, жест на телефоне) ушёл с записи окна: окно закрывается, страница остаётся.
  const isOpen = opened !== null;
  useEffect(() => {
    if (!isOpen) return;
    const onPopState = () => {
      if (currentEntry() !== openedRef.current?.entry) close(true, true);
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, [isOpen, close]);

  // Открытый элемент пропал из ленты.
  const gone = opened !== null && index < 0;
  useEffect(() => {
    if (gone) close(false, true);
  }, [gone, close]);

  // Другой чат или ветка: прежняя карусель к ним не относится, а элемента-источника уже нет.
  const shownFor = useRef(resetKey);
  useEffect(() => {
    if (shownFor.current === resetKey) return;
    shownFor.current = resetKey;
    close(false, false);
  }, [resetKey, close]);

  // Чат ушёл со страницы с открытым окном: своя запись в истории не остаётся.
  useEffect(() => () => close(false, false), [close]);

  const onIndexChange = useCallback(
    (next: number) => {
      const item = items[next];
      const current = openedRef.current;
      if (!item || !current) return;
      const moved = { ...current, key: item.key };
      openedRef.current = moved;
      setOpened(moved);
    },
    [items],
  );
  const onClose = useCallback(() => close(false, true), [close]);

  const viewer = useMemo<MediaViewerProps | null>(
    () => (opened && index >= 0 ? { items: items as MediaViewerItem[], index, onIndexChange, onClose } : null),
    [opened, index, items, onIndexChange, onClose],
  );
  return { open, viewer };
}
