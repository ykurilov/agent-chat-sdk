import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChatWorkspace } from "@ykurilov/agent-chat-react";
import type { AgentChatMessage, AgentChatProps, ChatAccess, ChatListSkin, ChatSkin, ChatWorkspaceProps } from "@ykurilov/agent-chat-react";
import type { AnswerEditMark } from "../types";
import { AnswerEditorHost } from "./answer-editor-host";
import { ChatReopenControl } from "./chat-reopen";
import { InstructionHeader } from "./instruction-header";
import { useJournalPanel } from "./journal-panel";
import { PeopleChatsPanel } from "./people-chats-panel";
import type { ReadOnlyChatProps } from "./people-chats-panel";
import { createSandboxClient, DEFAULT_SANDBOX_BASE_PATH } from "./sandbox-client";
import { usePeopleChatsLabels } from "./sandbox-labels";
import type { SandboxSection, SandboxSkin } from "./sandbox-skin";

type AnswerEditing = NonNullable<AgentChatProps["answerEditing"]>;
type Feed = { messages: AgentChatMessage[]; busy: boolean };

export interface AgentSandboxProps {
  /** Адрес обработчика песочницы; по умолчанию `/api/sandbox`. */
  basePath?: string;
  skin: ChatSkin;
  sandboxSkin: SandboxSkin;
  chatListSkin: ChatListSkin;
  /**
   * Те же возможности чата, что у боевой страницы: вложения, картинки, видео, схемы, виджеты, голос. Без них агент
   * в песочнице отвечает, но файлы и картинки в ленте не показываются. Остальным экран песочницы управляет сам.
   */
  chatProps?: Omit<ChatWorkspaceProps, "api" | "skin" | "initialChatId" | "onChatChange" | "onFeedChange" | "answerEditing" | "reloadKey">;
  /**
   * Раздел «Чаты людей» и переключатель разделов. Ставить, только если у обработчика песочницы есть опция `people`;
   * нет — экран песочницы прежний, без полосы разделов.
   */
  people?: boolean;
}

/**
 * Песочница для админа: песочные чаты списком, чат с правкой ответов, инструкция чата и журнал обращений к модели
 * и вызовов инструментов рядом. С `people` второй раздел — «Чаты людей»: чат человека на чтение и «Проверить в копии»; копия
 * открывается здесь же как обычный песочный чат. Всё видимое рисуют скины.
 */
export function AgentSandbox({ basePath = DEFAULT_SANDBOX_BASE_PATH, skin, sandboxSkin, chatListSkin, chatProps, people = false }: AgentSandboxProps) {
  const client = useMemo(() => createSandboxClient({ basePath }), [basePath]);
  const workspaceSkin = useMemo(() => ({ ...skin, ...chatListSkin }), [skin, chatListSkin]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [feed, setFeed] = useState<Feed>({ messages: [], busy: false });
  const [edits, setEdits] = useState<ReadonlyMap<string, AnswerEditMark>>(new Map());
  const [journalOpen, setJournalOpen] = useState(false);
  /** Открытый песочный чат закрыт инструментом: админу нужна кнопка «Открыть чат снова». */
  const [chatClosed, setChatClosed] = useState(false);
  /** Растёт после «Открыть чат снова»: экран чата перечитывает историю и снова принимает ходы. */
  const [reloadKey, setReloadKey] = useState(0);
  const passedAccessChange = chatProps?.onChatAccessChange;
  const onChatAccessChange = useCallback(
    (access: ChatAccess) => {
      setChatClosed(access.closed !== null);
      passedAccessChange?.(access);
    },
    [passedAccessChange],
  );
  const onChatReopened = useCallback(() => {
    setChatClosed(false);
    setReloadKey((key) => key + 1);
  }, []);
  const [section, setSection] = useState<SandboxSection>("sandbox");
  /** Только что созданная копия чата человека: песочный раздел открывается на ней, а не на запомненном чате. */
  const [openedCopyId, setOpenedCopyId] = useState<string | null>(null);
  const changeSection = useCallback((next: SandboxSection) => {
    setOpenedCopyId(null);
    setSection(next);
  }, []);
  const readOnlyChatProps = useMemo<ReadOnlyChatProps>(() => readOnlyPropsOf(chatProps), [chatProps]);
  const onCopied = useCallback((copyId: string) => {
    setOpenedCopyId(copyId);
    setSection("sandbox");
  }, []);

  /** Права нового чата приходят с его историей; пока их нет, закрытость прежнего чата не переносится. Первый чат не в счёт: его права могли прийти раньше. */
  const previousChatId = useRef<string | null>(null);
  useEffect(() => {
    if (previousChatId.current !== null && previousChatId.current !== chatId) setChatClosed(false);
    previousChatId.current = chatId;
  }, [chatId]);

  useEffect(() => {
    setEdits(new Map());
    if (chatId === null) return;
    let current = true;
    client.answerEdits(chatId).then(
      (loaded) => current && setEdits(loaded),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, chatId]);

  // Пока идёт ответ, куски потока журналу не нужны: экран не перерисовывается на каждый кусок.
  const onFeedChange = useCallback((next: Feed) => setFeed((current) => (current.busy && next.busy ? current : next)), []);

  const answerEditing = useMemo<AnswerEditing | undefined>(
    () =>
      chatId === null
        ? undefined
        : {
            edits,
            renderEditor: ({ message, onSaved, onCancel }) => (
              <AnswerEditorHost
                key={message.id}
                skin={sandboxSkin}
                client={client}
                chatId={chatId}
                message={message}
                onSaved={(newMessageId, mark) => {
                  setEdits((current) => new Map(current).set(newMessageId, mark));
                  onSaved(newMessageId);
                }}
                onCancel={onCancel}
              />
            ),
          },
    [chatId, client, edits, sandboxSkin],
  );

  // State belongs above the layout: a responsive inspector may remount its renderer.
  const journal = useJournalPanel({ skin: sandboxSkin, client, chatId, messages: feed.messages, busy: feed.busy, edits });
  const Sections = sandboxSkin.SandboxSections ?? PlainSandboxSections;
  const sandboxView = (
    <sandboxSkin.SandboxLayout
      busy={feed.busy}
      header={
        chatId !== null && (
          <>
            <InstructionHeader key={chatId} skin={sandboxSkin} client={client} chatId={chatId} />
            {chatClosed && <ChatReopenControl key={chatId} skin={sandboxSkin} client={client} chatId={chatId} onReopened={onChatReopened} />}
          </>
        )
      }
      chat={
        <ChatWorkspace
          {...chatProps}
          {...(openedCopyId !== null && { initialChatId: openedCopyId })}
          api={basePath}
          skin={workspaceSkin}
          onChatChange={setChatId}
          onFeedChange={onFeedChange}
          onChatAccessChange={onChatAccessChange}
          reloadKey={reloadKey}
          {...(answerEditing && { answerEditing })}
        />
      }
      journal={
        chatId !== null && journal
      }
      journalOpen={journalOpen}
      onJournalOpenChange={setJournalOpen}
    />
  );
  if (!people) return sandboxView;
  return (
    <Sections section={section} onSectionChange={changeSection}>
      {section === "people" ? (
        <PeopleChatsPanel client={client} skin={skin} sandboxSkin={sandboxSkin} chatProps={readOnlyChatProps} onCopied={onCopied} />
      ) : (
        sandboxView
      )}
    </Sections>
  );
}

function readOnlyPropsOf(chatProps: AgentSandboxProps["chatProps"]): ReadOnlyChatProps {
  if (!chatProps) return {};
  const { attachments, widgets, diagrams, images, videos, liveness } = chatProps;
  return {
    ...(attachments && { attachments }),
    ...(widgets && { widgets }),
    ...(diagrams && { diagrams }),
    ...(images && { images }),
    ...(videos && { videos }),
    ...(liveness && { liveness }),
  };
}

/** Простой переключатель разделов для скина без `SandboxSections`. */
function PlainSandboxSections({ section, onSectionChange, children }: { section: SandboxSection; onSectionChange: (section: SandboxSection) => void; children: ReactNode }) {
  const labels = usePeopleChatsLabels();
  return (
    <>
      <nav aria-label={labels.sections}>
        <button type="button" aria-pressed={section === "sandbox"} onClick={() => onSectionChange("sandbox")}>
          {labels.sandboxSection}
        </button>
        <button type="button" aria-pressed={section === "people"} onClick={() => onSectionChange("people")}>
          {labels.peopleSection}
        </button>
      </nav>
      {children}
    </>
  );
}
