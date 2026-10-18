import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { messageText } from "../chat-types";
import type { AgentChatMessage } from "../chat-types";

/**
 * Открытое поле правки сообщения человека. Набранный текст живёт здесь, а не в самом поле: поле пересоздаётся, когда
 * окно ленты убирает его за краем экрана, когда лента открывается заново (переход ветки) или сообщение приходит с
 * новым id, — и появляется снова с тем, что человек набрал.
 */
export interface MessageEditing {
  /** id сообщения с открытым полем правки; `null` — поле закрыто. */
  id: string | null;
  /** Номер попытки сохранения: после отказа поле открывается заново с ошибкой. */
  attempt: number;
  /** Отказ сервера на последнюю попытку. */
  error?: string;
  /** С каким текстом открыть поле: набранное раньше или текст сообщения. */
  draftOf: (message: AgentChatMessage) => string;
  open: (messageId: string) => void;
  /** Человек набирает: перерисовки ленты это не вызывает. */
  type: (text: string) => void;
  close: () => void;
  /** Сервер отказал правке: поле открывается снова с отправленным текстом и ошибкой. */
  refuse: (messageId: string, text: string, error: string) => void;
}

interface OpenEditor {
  id: string;
  attempt: number;
  error?: string;
  /** Текст и место сообщения при открытии: по ним находится то же сообщение, пришедшее с новым id. */
  original: string;
  index: number;
}

/**
 * Состояние правки по ленте `messages`. Сообщение пришло с новым id (перечитанная история) — поле остаётся у него.
 * Сообщения больше нет — поле закрывается, а набранный текст отдаётся `onDraftLost` (чат кладёт его в поле ввода).
 * Пока идёт сохранение (`saving`), лента меняется самой правкой: это не пропажа.
 */
export function useMessageEditing(
  messages: readonly AgentChatMessage[],
  { saving, onDraftLost }: { saving: RefObject<boolean>; onDraftLost: (text: string) => void },
): MessageEditing {
  const [editor, setEditor] = useState<OpenEditor | null>(null);
  const draft = useRef<string | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const reportLost = useRef(onDraftLost);
  reportLost.current = onDraftLost;

  useLayoutEffect(() => {
    if (!editor || saving.current || messages.some((message) => message.id === editor.id)) return;
    const same = sameMessage(messages, editor);
    if (same) {
      setEditor({ ...editor, id: same.id });
      return;
    }
    const typed = draft.current;
    draft.current = null;
    setEditor(null);
    if (typed !== null && typed.trim().length > 0 && typed !== editor.original) reportLost.current(typed);
  }, [editor, messages, saving]);

  const open = useCallback((messageId: string) => {
    const index = messagesRef.current.findIndex((message) => message.id === messageId);
    const message = messagesRef.current[index];
    if (!message) return;
    draft.current = null;
    setEditor({ id: messageId, attempt: 0, original: messageText(message), index });
  }, []);
  const close = useCallback(() => {
    draft.current = null;
    setEditor(null);
  }, []);
  const type = useCallback((text: string) => {
    draft.current = text;
  }, []);
  const refuse = useCallback((messageId: string, text: string, error: string) => {
    draft.current = text;
    setEditor((current) => current && { ...current, id: messageId, attempt: current.attempt + 1, error });
  }, []);
  const draftOf = useCallback((message: AgentChatMessage) => draft.current ?? messageText(message), []);

  return useMemo(
    () => ({
      id: editor?.id ?? null,
      attempt: editor?.attempt ?? 0,
      ...(editor?.error !== undefined && { error: editor.error }),
      draftOf,
      open,
      type,
      close,
      refuse,
    }),
    [close, draftOf, editor, open, refuse, type],
  );
}

/** То же сообщение под новым id: сообщение человека с тем же текстом на прежнем месте, иначе единственное такое. */
function sameMessage(messages: readonly AgentChatMessage[], editor: OpenEditor): AgentChatMessage | undefined {
  const isSame = (message: AgentChatMessage | undefined) => message?.role === "user" && messageText(message) === editor.original;
  const atPlace = messages[editor.index];
  if (isSame(atPlace)) return atPlace;
  const matches = messages.filter(isSame);
  return matches.length === 1 ? matches[0] : undefined;
}
