import { useCallback, useEffect, useRef, useState } from "react";
import type { AppRefusal } from "../app-refusal";
import { defaultRememberKey, readRememberedChat, rememberChat } from "./active-chat-memory";
import {
  ChatCreationRefusedError,
  createChatOnServer,
  deleteChatOnServer,
  fetchChatList,
  renameChatOnServer,
} from "./chat-list-client";
import type { ChatListEntry } from "./chat-list-client";

export type ChatListStatus = "loading" | "ready" | "error";

/** Какое действие не удалось; сам список не загрузился — `status: "error"`. */
export type ChatListActionError = "create" | "rename" | "delete";

export interface UseChatListOptions {
  /** Адрес обработчика чата, например `/api/chat`. */
  api: string;
  /** Какой чат открыть первым (например, из адреса страницы). Главнее запомненного; чата нет в списке — откроется «Чат не найден». */
  initialChatId?: string;
  /** Свой `fetch` — для тестов и особых сред. */
  fetch?: typeof globalThis.fetch;
  /** Ключ запомненного чата. По умолчанию `agent-chat:active-chat:${api}`; у панели агента свой, на человека. Смена ключа — список загружается заново, прежний открытый чат не переносится. */
  rememberKey?: string;
  /** Приложение не дало создать чат (`chat_creation_refused`): та же весть, что `onTurnRefused` у чата. Текст отказа список показывает сам. */
  onCreateRefused?: (refusal: AppRefusal) => void;
}

export interface ChatListState {
  status: ChatListStatus;
  items: ChatListEntry[];
  /** Открытый чат; `null`, пока список грузится или не загрузился. */
  activeChatId: string | null;
  error: ChatListActionError | null;
  /** Отказ приложения, из-за которого `error` — `create`: его слова показываются вместо общего «Не удалось создать чат». */
  creationRefusal: AppRefusal | null;
  creating: boolean;
  /** Чат, удаление которого ждёт подтверждения. Удаляет только `confirmDelete`. */
  deleteRequest: { id: string; title: string | null } | null;
  deleting: boolean;
  select(chatId: string): void;
  /** Открывает пустой чат (без названия и без сообщений), если он уже есть, иначе создаёт новый. `false` — не вышло (`error` — `create`). */
  create(): Promise<boolean>;
  /** Пустое или прежнее название — ничего не делает. Не вышло — прежнее название возвращается. */
  rename(chatId: string, title: string): Promise<void>;
  requestDelete(chatId: string): void;
  cancelDelete(): void;
  confirmDelete(): Promise<void>;
  /** Тихо обновляет список (название появилось, порядок сменился); отказ не показывается. */
  refresh(): Promise<void>;
  /** Загружает список заново после отказа. */
  reload(): void;
}

/**
 * Чат без названия и без сообщений; старый чат с одними файлами тоже без названия, но время его активности позже создания.
 * Чат объекта (урок) пустым не считается: «Новый чат» не должен открывать урок, даже если в нём одно приветствие.
 * Обычный чат с одним приветствием (дата приветствия — дата чата) пустой: его и откроет «Новый чат».
 */
const isEmptyChat = (item: ChatListEntry) => item.title === null && item.updatedAt === item.createdAt && item.subjectKey === undefined;

/** Список нового человека, пока он не загружен: ничего от прежнего. */
const NOTHING_LOADED = {
  status: "loading",
  items: [],
  activeChatId: null,
  error: null,
  creationRefusal: null,
  creating: false,
  deleteRequest: null,
  deleting: false,
} satisfies Partial<ChatListState>;

const collapse = (title: string) => title.trim().replace(/\s+/g, " ");

/** Состояние списка чатов: загрузка, выбор открытого чата, создание, переименование и удаление. Ничего не рисует. */
export function useChatList({ api, initialChatId, fetch: customFetch, rememberKey, onCreateRefused }: UseChatListOptions): ChatListState {
  const memoryKey = rememberKey ?? defaultRememberKey(api);
  const [status, setStatus] = useState<ChatListStatus>("loading");
  const [items, setItems] = useState<ChatListEntry[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [error, setError] = useState<ChatListActionError | null>(null);
  const [creationRefusal, setCreationRefusal] = useState<AppRefusal | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<ChatListState["deleteRequest"]>(null);
  const [deleting, setDeleting] = useState(false);

  // Сменился человек: в этом же кадре — ни списка, ни открытого чата, ни действий прежнего.
  const [stateKey, setStateKey] = useState(memoryKey);
  const keyChanged = stateKey !== memoryKey;
  if (keyChanged) {
    setStateKey(memoryKey);
    setStatus("loading");
    setItems([]);
    setActiveChatId(null);
    setError(null);
    setCreationRefusal(null);
    setCreating(false);
    setDeleteRequest(null);
    setDeleting(false);
  }
  /** Ключ, под которым список сейчас на экране: ответ, пришедший после смены человека, к новому не относится. */
  const keyRef = useRef(memoryKey);
  keyRef.current = memoryKey;

  const fetchRef = useRef(customFetch);
  fetchRef.current = customFetch;
  const refusedRef = useRef(onCreateRefused);
  refusedRef.current = onCreateRefused;
  const send: typeof globalThis.fetch = useCallback((input, init) => (fetchRef.current ?? globalThis.fetch)(input, init), []);
  const itemsRef = useRef(items);
  itemsRef.current = keyChanged ? [] : items;
  const activeRef = useRef(activeChatId);
  activeRef.current = keyChanged ? null : activeChatId;
  const initialRef = useRef(initialChatId);
  /** Номер последней полной загрузки: ответы более ранних игнорируются. */
  const loadRequest = useRef(0);
  /** Номер последнего запроса списка (загрузка или тихое обновление): устаревшее обновление не затирает свежее. */
  const listRequest = useRef(0);
  /** Ключ, под который загружен список: другой ключ — другой человек, его список и его запомненный чат. */
  const loadedKey = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  /** Ответ на запрос, начатый для человека `key`, ещё нужен: компонент жив и человек тот же. */
  const stillFor = useCallback((key: string) => alive.current && keyRef.current === key, []);

  /** Создать чат не вышло: ошибка `create`, со словами приложения, если оно отказало само. */
  const failCreate = useCallback(
    (cause: unknown) => {
      const refusal = cause instanceof ChatCreationRefusedError ? cause.refusal : null;
      setCreationRefusal(refusal);
      setError("create");
      if (refusal) refusedRef.current?.(refusal);
    },
    [],
  );

  const activate = useCallback(
    (chatId: string) => {
      activeRef.current = chatId;
      setActiveChatId(chatId);
      rememberChat(memoryKey, chatId);
    },
    [memoryKey],
  );

  /** Новый пустой чат на сервере: первым в списке и открытым. `false` — человек сменился, пока чат создавался. */
  const createAndOpen = useCallback(async () => {
    const id = await createChatOnServer(api, send);
    if (!stillFor(memoryKey)) return false;
    const now = new Date().toISOString();
    setItems((current) => [{ id, title: null, createdAt: now, updatedAt: now }, ...current.filter((item) => item.id !== id)]);
    activate(id);
    return true;
  }, [activate, api, memoryKey, send, stillFor]);

  const load = useCallback(async () => {
    if (loadedKey.current !== memoryKey) {
      // Сменился человек: начальный чат из адреса к нему не относится (список и открытый чат сброшены при отрисовке).
      if (loadedKey.current !== null) initialRef.current = undefined;
      loadedKey.current = memoryKey;
    }
    const request = ++loadRequest.current;
    listRequest.current += 1;
    setStatus("loading");
    try {
      const loaded = await fetchChatList(api, send);
      if (!alive.current || request !== loadRequest.current) return;
      setItems(loaded);
      setStatus("ready");
      if (activeRef.current !== null) return;
      const remembered = readRememberedChat(memoryKey);
      const chosen =
        initialRef.current ??
        (remembered !== null && loaded.some((item) => item.id === remembered) ? remembered : loaded[0]?.id);
      if (chosen !== undefined) activate(chosen);
      else
        try {
          await createAndOpen();
        } catch (cause) {
          // Приложение отказало в первом чате: список загружен, отказ показывается в нём, а не «список не загрузился».
          if (!(cause instanceof ChatCreationRefusedError)) throw cause;
          if (stillFor(memoryKey) && request === loadRequest.current) failCreate(cause);
        }
    } catch {
      if (!alive.current || request !== loadRequest.current) return;
      setStatus("error");
      // Адрес чата известен: открываем его и без списка, пусть чат сам скажет, что с ним (история не грузится, чата нет).
      if (activeRef.current === null && initialRef.current !== undefined) activate(initialRef.current);
    }
  }, [activate, api, createAndOpen, failCreate, memoryKey, send, stillFor]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    const request = ++listRequest.current;
    try {
      const loaded = await fetchChatList(api, send);
      if (stillFor(memoryKey) && request === listRequest.current) setItems(loaded);
    } catch {
      // Тихое обновление: устаревший список лучше сообщения об ошибке.
    }
  }, [api, memoryKey, send, stillFor]);

  const create = useCallback(async () => {
    setError(null);
    setCreating(true);
    try {
      // Пустой чат ищем по свежим данным: в открытом могли написать, а список ещё не знает.
      // Пустой — без названия и без сообщений: у чата с сообщениями время последней активности позже создания.
      const fresh = await fetchChatList(api, send).catch(() => null);
      if (!stillFor(memoryKey)) return false;
      if (fresh) setItems(fresh);
      const empty = (fresh ?? itemsRef.current).find(isEmptyChat);
      if (!empty) return await createAndOpen();
      activate(empty.id);
      return true;
    } catch (cause) {
      if (stillFor(memoryKey)) failCreate(cause);
      return false;
    } finally {
      if (stillFor(memoryKey)) setCreating(false);
    }
  }, [activate, api, createAndOpen, failCreate, memoryKey, send, stillFor]);

  const select = useCallback(
    (chatId: string) => {
      setError(null);
      activate(chatId);
    },
    [activate],
  );

  const rename = useCallback(
    async (chatId: string, title: string) => {
      const normalized = collapse(title);
      const current = itemsRef.current.find((item) => item.id === chatId);
      if (!current || normalized === "" || normalized === current.title) return;
      setError(null);
      const setTitle = (value: string | null) =>
        setItems((list) => list.map((item) => (item.id === chatId ? { ...item, title: value } : item)));
      setTitle(normalized);
      try {
        const saved = await renameChatOnServer(api, send, chatId, normalized);
        if (stillFor(memoryKey)) setTitle(saved);
      } catch {
        if (!stillFor(memoryKey)) return;
        setTitle(current.title);
        setError("rename");
      }
    },
    [api, memoryKey, send, stillFor],
  );

  const requestDelete = useCallback((chatId: string) => {
    const item = itemsRef.current.find((entry) => entry.id === chatId);
    if (item) setDeleteRequest({ id: item.id, title: item.title });
  }, []);

  const cancelDelete = useCallback(() => setDeleteRequest(null), []);

  const confirmDelete = useCallback(async () => {
    if (!deleteRequest) return;
    const { id } = deleteRequest;
    setError(null);
    setDeleting(true);
    try {
      await deleteChatOnServer(api, send, id);
    } catch {
      if (stillFor(memoryKey)) {
        setError("delete");
        setDeleteRequest(null);
        setDeleting(false);
      }
      return;
    }
    if (!stillFor(memoryKey)) return;
    const before = itemsRef.current;
    const index = before.findIndex((item) => item.id === id);
    const rest = before.filter((item) => item.id !== id);
    setItems(rest);
    setDeleteRequest(null);
    setDeleting(false);
    if (activeRef.current !== id) return;
    // Открытый чат исчез: соседний по списку, а если чатов не осталось — новый пустой.
    const next = rest[index] ?? rest[index - 1];
    if (next) {
      activate(next.id);
      return;
    }
    activeRef.current = null;
    setActiveChatId(null);
    try {
      await createAndOpen();
    } catch (cause) {
      if (stillFor(memoryKey)) failCreate(cause);
    }
  }, [activate, api, createAndOpen, deleteRequest, failCreate, memoryKey, send, stillFor]);

  const reload = useCallback(() => void load(), [load]);

  return {
    ...(keyChanged ? NOTHING_LOADED : { status, items, activeChatId, error, creationRefusal, creating, deleteRequest, deleting }),
    select,
    create,
    rename,
    requestDelete,
    cancelDelete,
    confirmDelete,
    refresh,
    reload,
  };
}
