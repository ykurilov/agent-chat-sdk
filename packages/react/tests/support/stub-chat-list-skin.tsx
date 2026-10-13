import { useState } from "react";
import type { ChatListSkin } from "../../src/chat-list/chat-list-skin";
import { useChatLabels } from "../../src/labels";
import type { ChatSkin } from "../../src/skin-contract";
import { stubSkin } from "./stub-skin";

/** Скин-заглушка списка чатов: пропсы видны в data-атрибутах, надписи — из словаря. */
export const stubChatListSkin: ChatListSkin = {
  ChatWorkspace: ({ list, children, activeTitle, listOpen, onListOpenChange }) => (
    <div data-testid="workspace" data-list-open={String(listOpen)}>
      <button type="button" data-testid="open-list" onClick={() => onListOpenChange(!listOpen)}>
        {activeTitle}
      </button>
      <nav data-testid="list-panel">{list}</nav>
      <section data-testid="chat-area">{children}</section>
    </div>
  ),
  ChatList: function StubChatList({ status, items, onSelect, onCreate, creating, onRename, onRequestDelete, deleteRequest, error, onRetry }) {
    const labels = useChatLabels();
    const [renaming, setRenaming] = useState<string | null>(null);
    return (
      <div data-testid="chat-list" data-status={status}>
        <button type="button" onClick={onCreate} disabled={creating}>
          {labels.chatListNewChat}
        </button>
        {status === "loading" && <p>{labels.chatListLoading}</p>}
        <ul>
          {items.map((item) => (
            <li key={item.id} data-chat-id={item.id} data-untitled={String(item.title === null)} data-origin={item.origin ?? ""} aria-current={item.active ? "true" : undefined}>
              {renaming === item.id ? (
                <input
                  aria-label={labels.chatListRenameField}
                  defaultValue={item.title ?? ""}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      onRename(item.id, event.currentTarget.value);
                      setRenaming(null);
                    }
                  }}
                />
              ) : (
                <button type="button" data-action="select" onClick={() => onSelect(item.id)}>
                  {item.title ?? labels.chatListUntitled}
                </button>
              )}
              {item.closed && (
                <span data-testid="closed-mark" data-code={item.closed.code} title={item.closed.message}>
                  {labels.chatListClosed}
                </span>
              )}
              <button type="button" data-action="rename" onClick={() => setRenaming(item.id)}>
                {labels.chatListRename}
              </button>
              <button type="button" data-action="delete" onClick={() => onRequestDelete(item.id)}>
                {labels.chatListDelete}
              </button>
            </li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
        {deleteRequest && (
          <div role="dialog" data-testid="delete-dialog">
            <p>{labels.chatListDeleteBody(deleteRequest.title)}</p>
            <button type="button" data-action="confirm-delete" disabled={deleteRequest.pending} onClick={deleteRequest.onConfirm}>
              {labels.chatListDeleteConfirm}
            </button>
            <button type="button" data-action="cancel-delete" onClick={deleteRequest.onCancel}>
              {labels.chatListDeleteCancel}
            </button>
          </div>
        )}
      </div>
    );
  },
};

/** Скин чата и списка вместе: то, что принимает `ChatWorkspace`. */
export const stubWorkspaceSkin: ChatSkin & ChatListSkin = { ...stubSkin, ...stubChatListSkin };
