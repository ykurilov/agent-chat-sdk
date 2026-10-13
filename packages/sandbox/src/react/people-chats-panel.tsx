import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentChat } from "@ykurilov/agent-chat-react";
import type { AgentChatProps, ChatSkin } from "@ykurilov/agent-chat-react";
import type { Person } from "../types";
import { readOnlyChatSkin } from "./read-only-chat-skin";
import { SandboxRequestError } from "./sandbox-client";
import type { SandboxClient } from "./sandbox-client";
import { usePeopleChatsLabels, useSandboxLabels } from "./sandbox-labels";
import type { PeopleChatsView, SandboxLoadState, SandboxSkin } from "./sandbox-skin";

type ChatItems = Awaited<ReturnType<SandboxClient["personChats"]>>;
/** Что из возможностей чата нужно ленте на чтение: показ файлов, картинок, видео, схем и виджетов. */
export type ReadOnlyChatProps = Pick<AgentChatProps, "attachments" | "widgets" | "diagrams" | "images" | "videos" | "liveness">;

export interface PeopleChatsPanelProps {
  client: SandboxClient;
  skin: ChatSkin;
  sandboxSkin: SandboxSkin;
  chatProps: ReadOnlyChatProps;
  /** Копия создана: открыть её как песочный чат. */
  onCopied: (chatId: string) => void;
}

/**
 * Раздел «Чаты людей»: найти человека (или ввести его id, если приложение не дало поиск), открыть его чат только на
 * чтение и сделать копию в песочнице. Рисует `sandboxSkin.PeopleChats`, без него — простой вид.
 */
export function PeopleChatsPanel({ client, skin, sandboxSkin, chatProps, onCopied }: PeopleChatsPanelProps) {
  const labels = usePeopleChatsLabels();
  const [searchable, setSearchable] = useState(true);
  const [query, setQuery] = useState("");
  const [peopleState, setPeopleState] = useState<PeopleChatsView["peopleState"]>("idle");
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<Person | null>(null);
  const [chatsState, setChatsState] = useState<SandboxLoadState | "empty">("loading");
  const [chats, setChats] = useState<ChatItems>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | undefined>();
  const searchRequest = useRef(0);
  const chatsRequest = useRef(0);

  // Пустой запрос ничего не ищет, но говорит, дало ли приложение поиск.
  useEffect(() => {
    let current = true;
    client.searchPeople("").then(
      (response) => current && setSearchable(response.search),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client]);

  const loadChats = useCallback(
    (personId: string) => {
      const request = ++chatsRequest.current;
      setChatsState("loading");
      setChats([]);
      client.personChats(personId).then(
        (loaded) => {
          if (request !== chatsRequest.current) return;
          setChats(loaded);
          setChatsState(loaded.length > 0 ? "ready" : "empty");
        },
        () => request === chatsRequest.current && setChatsState("failed"),
      );
    },
    [client],
  );

  const selectPerson = useCallback(
    (selected: Person) => {
      setPerson(selected);
      setChatId(null);
      setCopyError(undefined);
      loadChats(selected.id);
    },
    [loadChats],
  );

  const onSearch = useCallback(() => {
    const text = query.trim();
    if (text.length === 0) return;
    if (!searchable) {
      selectPerson({ id: text });
      return;
    }
    const request = ++searchRequest.current;
    setPeopleState("loading");
    client.searchPeople(text).then(
      (response) => {
        if (request !== searchRequest.current) return;
        setPeople(response.people);
        setPeopleState(response.people.length > 0 ? "ready" : "empty");
      },
      () => request === searchRequest.current && setPeopleState("failed"),
    );
  }, [client, query, searchable, selectPerson]);

  const onCopy = useCallback(() => {
    if (!person || chatId === null || copying) return;
    setCopying(true);
    setCopyError(undefined);
    client.copyPersonChat(person.id, chatId).then(
      (copyId) => {
        setCopying(false);
        onCopied(copyId);
      },
      (error: unknown) => {
        setCopying(false);
        setCopyError(error instanceof SandboxRequestError && error.kind === "empty_chat" ? labels.emptyChat : labels.copyFailed);
      },
    );
  }, [chatId, client, copying, labels, onCopied, person]);

  const chatSkin = useMemo(() => readOnlyChatSkin(skin), [skin]);
  const view: PeopleChatsView = {
    searchable,
    query,
    onQueryChange: setQuery,
    onSearch,
    peopleState,
    people: people.map((found) => ({ ...found, selected: found.id === person?.id, onSelect: () => selectPerson(found) })),
    ...(person && { person: { id: person.id, ...(person.name !== undefined && { name: person.name }) } }),
    chatsState,
    chats: chats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt,
      subject: chat.subjectKey !== undefined,
      selected: chat.id === chatId,
      onOpen: () => {
        setChatId(chat.id);
        setCopyError(undefined);
      },
    })),
    onChatsRetry: () => person && loadChats(person.id),
    ...(person &&
      chatId !== null && {
        chat: <AgentChat key={`${person.id}:${chatId}`} {...chatProps} api={client.personChatApi(person.id)} chatId={chatId} skin={chatSkin} />,
        onCopy,
      }),
    copying,
    ...(copyError !== undefined && { copyError }),
  };
  const View = sandboxSkin.PeopleChats ?? PlainPeopleChats;
  return <View {...view} />;
}

/** Простой вид раздела для скина без `PeopleChats`. */
function PlainPeopleChats(view: PeopleChatsView) {
  const labels = usePeopleChatsLabels();
  const retryLabel = useSandboxLabels().retry;
  const fieldLabel = view.searchable ? labels.searchPerson : labels.personId;
  return (
    <section aria-label={labels.peopleSection} data-people-chats="">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          view.onSearch();
        }}
      >
        <input aria-label={fieldLabel} placeholder={fieldLabel} value={view.query} onChange={(event) => view.onQueryChange(event.target.value)} />
        <button type="submit">{view.searchable ? labels.search : labels.openPerson}</button>
      </form>
      {view.peopleState === "loading" && <p>{labels.searching}</p>}
      {view.peopleState === "failed" && <p role="alert">{labels.searchFailed}</p>}
      {view.peopleState === "empty" && <p>{labels.nobodyFound}</p>}
      {view.people.length > 0 && (
        <ul aria-label={labels.searchPerson}>
          {view.people.map((found) => (
            <li key={found.id}>
              <button type="button" aria-pressed={found.selected} onClick={found.onSelect}>
                {found.name ?? found.id}
              </button>
              {found.hint && <span> {found.hint}</span>}
            </li>
          ))}
        </ul>
      )}
      {view.person && (
        <>
          <h2>{view.person.name ?? view.person.id}</h2>
          {view.chatsState === "loading" && <p>{labels.chatsLoading}</p>}
          {view.chatsState === "failed" && (
            <p role="alert">
              {labels.chatsFailed}{" "}
              <button type="button" onClick={view.onChatsRetry}>
                {retryLabel}
              </button>
            </p>
          )}
          {view.chatsState === "empty" && <p>{labels.noChats}</p>}
          <ul aria-label={labels.peopleSection}>
            {view.chats.map((chat) => (
              <li key={chat.id}>
                <button type="button" aria-current={chat.selected || undefined} onClick={chat.onOpen}>
                  {chat.title ?? labels.untitledChat}
                </button>
                {chat.subject && <span> · {labels.subjectChat}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {view.chat ? (
        <div>
          <p>{labels.readOnly}</p>
          {view.onCopy && (
            <button type="button" disabled={view.copying} onClick={view.onCopy}>
              {view.copying ? labels.copying : labels.copy}
            </button>
          )}
          {view.copyError && <p role="alert">{view.copyError}</p>}
          {view.chat}
        </div>
      ) : (
        view.person && view.chatsState === "ready" && <p>{labels.chooseChat}</p>
      )}
    </section>
  );
}
