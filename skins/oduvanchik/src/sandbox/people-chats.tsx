import { Badge, cn } from "@tandem/ui";
import { Button, TextField as Input } from "@ykurilov/ds-react";
import type { PeopleChatsView, SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import { usePeopleChatsLabels, useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import { Copy, Search } from "../icons";
import type { ComponentProps } from "react";
import { useScreenQuery } from "../screen-width";

/** С этой ширины списки стоят колонкой слева от чата; уже — над ним. */
const wideScreenQuery = "(min-width: 48rem)";

/** Переключатель «Песочница | Чаты людей» над разделом. */
export function OduvanchikSandboxSections({ section, onSectionChange, children }: ComponentProps<NonNullable<SandboxSkin["SandboxSections"]>>) {
  const labels = usePeopleChatsLabels();
  const tab = (value: typeof section, title: string) => (
    <Button variant={section === value ? "secondary" : "ghost"} size="sm" aria-pressed={section === value} onClick={() => onSectionChange(value)} className="h-8 px-3">
      {title}
    </Button>
  );
  return (
    <div className="oduvanchik-chat oduvanchik-sandbox-sections">
      <nav aria-label={labels.sections} className="flex shrink-0 gap-1 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
        {tab("sandbox", labels.sandboxSection)}
        {tab("people", labels.peopleSection)}
      </nav>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Раздел «Чаты людей»: поиск, люди и их чаты; открытый чат — лента на чтение и «Проверить в копии». */
export function OduvanchikPeopleChats(view: PeopleChatsView) {
  const labels = usePeopleChatsLabels();
  const wide = useScreenQuery(wideScreenQuery, true);
  return (
    <section aria-label={labels.peopleSection} className={cn("oduvanchik-chat flex h-full min-h-0 bg-[var(--canvas)]", wide ? "flex-row" : "flex-col")}>
      <div
        className={cn(
          "flex shrink-0 flex-col gap-3 overflow-y-auto bg-[var(--surface)] p-3 text-sm",
          wide ? "w-[20rem] border-r border-[var(--border)]" : "max-h-[45vh] border-b border-[var(--border)]",
        )}
      >
        <PersonSearch {...view} />
        <PeopleList {...view} />
        {view.person && <PersonChats {...view} />}
      </div>
      <OpenedChat {...view} />
    </section>
  );
}

function PersonSearch({ searchable, query, onQueryChange, onSearch }: PeopleChatsView) {
  const labels = usePeopleChatsLabels();
  const fieldLabel = searchable ? labels.searchPerson : labels.personId;
  return (
    <form
      role="search"
      className="flex gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch();
      }}
    >
      <Input aria-label={fieldLabel} placeholder={fieldLabel} value={query} onChange={(event) => onQueryChange(event.target.value)} className="h-9 min-w-0 flex-1" />
      <Button type="submit" size="sm" className="h-9 shrink-0 gap-1.5 px-3 [&_svg]:size-4">
        <Search aria-hidden="true" />
        {searchable ? labels.search : labels.openPerson}
      </Button>
    </form>
  );
}

function PeopleList({ peopleState, people }: PeopleChatsView) {
  const labels = usePeopleChatsLabels();
  if (peopleState === "loading") return <p aria-live="polite" className="text-[var(--foreground-muted)]">{labels.searching}</p>;
  if (peopleState === "failed") return <p role="alert" className="text-[var(--destructive-text)]">{labels.searchFailed}</p>;
  if (peopleState === "empty") return <p className="text-[var(--foreground-muted)]">{labels.nobodyFound}</p>;
  if (people.length === 0) return null;
  return (
    <ul aria-label={labels.searchPerson} className="flex flex-col gap-1">
      {people.map((person) => (
        <li key={person.id}>
          <button
            type="button"
            aria-pressed={person.selected}
            onClick={person.onSelect}
            className={cn(
              "oduvanchik-focus flex w-full flex-col items-start rounded-[var(--radius-small)] px-2 py-1.5 text-left hover:bg-[var(--surface-muted)]",
              person.selected && "bg-[var(--surface-muted)]",
            )}
          >
            <span className="font-medium text-[var(--foreground)]">{person.name ?? person.id}</span>
            {person.hint && <span className="text-xs text-[var(--foreground-muted)]">{person.hint}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PersonChats({ person, chatsState, chats, onChatsRetry }: PeopleChatsView) {
  const labels = usePeopleChatsLabels();
  const retry = useSandboxLabels().retry;
  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
      <h2 className="text-xs font-semibold text-[var(--foreground-muted)]">{person?.name ?? person?.id}</h2>
      {chatsState === "loading" && <p aria-live="polite" className="text-[var(--foreground-muted)]">{labels.chatsLoading}</p>}
      {chatsState === "failed" && (
        <div role="alert" className="flex items-center gap-2 text-[var(--destructive-text)]">
          {labels.chatsFailed}
          <Button variant="ghost" size="sm" onClick={onChatsRetry} className="h-7 px-2">
            {retry}
          </Button>
        </div>
      )}
      {chatsState === "empty" && <p className="text-[var(--foreground-muted)]">{labels.noChats}</p>}
      {chatsState === "ready" && (
        <ul aria-label={labels.peopleSection} className="flex flex-col gap-1">
          {chats.map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                aria-current={chat.selected || undefined}
                onClick={chat.onOpen}
                className={cn(
                  "oduvanchik-focus flex w-full items-center gap-2 rounded-[var(--radius-small)] px-2 py-1.5 text-left hover:bg-[var(--surface-muted)]",
                  chat.selected && "bg-[var(--surface-muted)]",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{chat.title ?? labels.untitledChat}</span>
                {chat.subject && <Badge variant="cool">{labels.subjectChat}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OpenedChat({ person, chatsState, chat, onCopy, copying, copyError }: PeopleChatsView) {
  const labels = usePeopleChatsLabels();
  if (!chat) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-[var(--foreground-muted)]">
        {person && chatsState === "ready" ? labels.chooseChat : null}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm">
        <Badge variant="neutral">{labels.readOnly}</Badge>
        <span className="flex-1" />
        {onCopy && (
          <Button variant="primary" size="sm" loading={copying} disabled={copying} onClick={onCopy} className="h-8 gap-1.5 px-3 [&_svg]:size-4">
            <Copy aria-hidden="true" />
            {copying ? labels.copying : labels.copy}
          </Button>
        )}
        {copyError && (
          <p role="alert" className="w-full text-[var(--destructive-text)]">
            {copyError}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1">{chat}</div>
    </div>
  );
}
