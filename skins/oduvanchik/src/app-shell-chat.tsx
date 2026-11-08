import { useState } from "react";
import { ListBulletsIcon, NotePencilIcon } from "@phosphor-icons/react";
import { AppShell, Button } from "@ykurilov/ds-react";
import type { AppNavigationGroup, AppPrimaryAction, AppShellProps } from "@ykurilov/ds-react";
import { ChatWorkspace, useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatWorkspaceView } from "@ykurilov/agent-chat-react";
import type { ChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatWorkspaceProps } from "./chat";
import { oduvanchikSkin } from "./index";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody } from "./primitives/dialog";
import { OduvanchikSkinLabels } from "./tandem-labels";
import { OduvanchikChatList } from "./chat-list";

export interface AppShellChatWorkspaceProps extends Omit<ChatWorkspaceProps, "renderWorkspace"> {
  /** Application navigation, identity and settings. Chat history and New chat are provided by the SDK. */
  shell: Omit<AppShellProps, "children" | "primaryAction">;
  /** History rows visible before More. AppShell also reveals an active row below this limit. */
  historyVisibleCount?: number;
}

/** Reusable mapping for an application's own AppShell; no additional fetching or state. */
export function appShellChatNavigation(view: ChatWorkspaceView, labels: ChatLabels, visibleCount = 20): {
  groups: AppNavigationGroup[];
  primaryAction?: AppPrimaryAction;
} {
  if (!view.list) return { groups: [] };
  const list = view.list;
  return {
    groups: [{ id: "agent-chat-history", label: labels.chatListHeading, visibleCount,
      items: list.items.map(item => ({ id: item.id, label: item.title ?? labels.chatListUntitled, active: item.active, onSelect: () => list.onSelect(item.id) })) }],
    // Keep the action inert while creation is pending; the SDK reuses an existing empty chat.
    primaryAction: { label: labels.chatListNewChat, icon: NotePencilIcon, onSelect: () => { if (!list.creating) list.onCreate(); } },
  };
}

/** Standard Oduvanchik application shell, with one main landmark and one navigation. */
export function AppShellChatWorkspace({ shell, historyVisibleCount, skin = oduvanchikSkin, ...props }: AppShellChatWorkspaceProps) {
  return <ChatWorkspace {...props} skin={skin} renderWorkspace={view => <ShellFrame view={view} shell={shell} {...(historyVisibleCount !== undefined && { visibleCount: historyVisibleCount })} />} />;
}

function ShellFrame({ view, shell, visibleCount }: { view: ChatWorkspaceView; shell: AppShellChatWorkspaceProps["shell"]; visibleCount?: number }) {
  const labels = useChatLabels();
  const [managing, setManaging] = useState(false);
  const navigation = appShellChatNavigation(view, labels, visibleCount);
  return <div data-agent-chat-oduvanchik="" style={{ height: "100%", minHeight: 0 }}>
    <AppShell {...shell} groups={[...(shell.groups ?? []), ...navigation.groups]} {...(navigation.primaryAction && { primaryAction: navigation.primaryAction })}
      header={<>{shell.header}{view.list && <Button variant="ghost" icon={ListBulletsIcon} aria-label={labels.chatListHeading} title={labels.chatListHeading} onClick={() => setManaging(true)} />}</>}>
      {view.list?.error && <div role="alert">{view.list.error}{view.list.onRetry && <Button onClick={view.list.onRetry}>{labels.retry}</Button>}</div>}
      {view.children}
    </AppShell>
    <OduvanchikSkinLabels><Dialog open={managing && view.list !== undefined} onOpenChange={setManaging}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{labels.chatListHeading}</DialogTitle></DialogHeader>
        <DialogBody>{view.list && <OduvanchikChatList {...view.list} onSelect={id => { view.list!.onSelect(id); setManaging(false); }} onCreate={() => { view.list!.onCreate(); setManaging(false); }} />}</DialogBody>
      </DialogContent>
    </Dialog></OduvanchikSkinLabels>
  </div>;
}
