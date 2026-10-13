import type { MessageAttachmentsView } from "../attachments-contract";
import type { AgentChatMessage } from "../chat-types";

type DescribeAttachments = (message: AgentChatMessage) => MessageAttachmentsView | undefined;

/**
 * `describe` плагина вложений, у картинок которого есть `onOpen` (договор скина, версия 13): открыть в окне просмотра
 * по id вложения. Нет `open` (у скина нет окна) — `describe` как есть, миниатюры как в 0.15.
 */
export function describeWithViewer(
  describe: DescribeAttachments | undefined,
  open: ((key: string, trigger: HTMLElement) => void) | undefined,
): DescribeAttachments | undefined {
  if (!describe || !open) return describe;
  return (message) => {
    const view = describe(message);
    if (!view?.items.some((item) => item.kind === "image")) return view;
    return {
      ...view,
      items: view.items.map((item) => (item.kind === "image" ? { ...item, onOpen: (trigger: HTMLElement) => open(item.id, trigger) } : item)),
    };
  };
}
