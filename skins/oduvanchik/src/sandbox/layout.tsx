import { Button, Dialog, ScrollArea, Sheet, Sphere, StudioLayout } from "@ykurilov/ds-react";
import { ListIcon, ScrollIcon, XIcon } from "@phosphor-icons/react";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatListSkin } from "@ykurilov/agent-chat-react";
import { useSandboxLabels } from "@ykurilov/agent-chat-sandbox/react";
import type { SandboxSkin } from "@ykurilov/agent-chat-sandbox/react";
import type { ComponentProps } from "react";
import { useScreenQuery } from "../screen-width";
import { OduvanchikJournalList } from "./journal";

export function OduvanchikSandboxLayout({ header, chat, journal, busy, journalOpen, onJournalOpenChange }: ComponentProps<SandboxSkin["SandboxLayout"]>) {
  const labels = useSandboxLabels();
  const chatLabels = useChatLabels();
  return <StudioLayout className="oduvanchik-chat oduvanchik-studio" contentLabel={labels.chatPanel}
    header={<><div className="oduvanchik-studio-title"><Sphere size={24} /><span>{labels.title}</span>{busy && <span role="status" className="oduvanchik-label">{chatLabels.reasoningRunning}</span>}</div>
      <div className="oduvanchik-studio-controls">{header}<Button className="oduvanchik-journal-trigger" variant="ghost" size="sm" icon={ScrollIcon} aria-expanded={journalOpen} onClick={() => onJournalOpenChange(true)}>{labels.openJournal}</Button></div></>}
    inspector={{ title: labels.journalPanel, open: journalOpen, onClose: () => onJournalOpenChange(false), content: <div className="oduvanchik-studio-journal"><Button className="oduvanchik-journal-close" variant="ghost" size="sm" icon={XIcon} onClick={() => onJournalOpenChange(false)}>{labels.closeJournal}</Button>{journal || <OduvanchikJournalList state="empty" rows={[]} turns={[]} currentTurnId={null} onTurnChange={() => undefined} />}</div> }}>
    {chat}
  </StudioLayout>;
}

/** History is available without sacrificing the studio thread width. No second chat scroll root. */
export function OduvanchikStudioWorkspace({ list, children, activeTitle, listOpen, onListOpenChange }: ComponentProps<ChatListSkin["ChatWorkspace"]>) {
  const labels = useChatLabels();
  const compact = useScreenQuery("(max-width: 700px)", false);
  const history = <div className="oduvanchik-chat oduvanchik-studio-history"><ScrollArea label={labels.chatListHeading}>{list}</ScrollArea><Button variant="ghost" onClick={() => onListOpenChange(false)}>{labels.composerSettings.done}</Button></div>;
  const close = () => onListOpenChange(false);
  return <div className="oduvanchik-chat oduvanchik-studio-workspace">
    {list !== undefined && <div className="oduvanchik-studio-thread-heading"><Button variant="ghost" size="sm" icon={ListIcon} aria-expanded={listOpen} onClick={() => onListOpenChange(true)}>{labels.chatListHeading}</Button><span>{activeTitle}</span></div>}
    <div className="oduvanchik-studio-chat">{children}</div>
    {compact ? <Sheet title={labels.chatListHeading} open={listOpen && list !== undefined} onClose={close}>{history}</Sheet> : <Dialog title={labels.chatListHeading} open={listOpen && list !== undefined} onClose={close}>{history}</Dialog>}
  </div>;
}
