import { useChatLabels } from "@ykurilov/agent-chat-react";
import type { ChatSkin } from "@ykurilov/agent-chat-react";

/** Самая простая разметка под договор скина: без дизайн-системы, только чтобы чат работал. */
export const plainSkin: ChatSkin = {
  Layout: ({ feed, composer, notice, scrollRef, announcement }) => (
    <main style={{ display: "flex", flexDirection: "column", height: "100dvh", maxWidth: 720, margin: "0 auto" }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {feed}
      </div>
      <div aria-live="polite" style={{ position: "absolute", left: -9999 }}>
        {announcement}
      </div>
      {notice}
      <div style={{ padding: 16 }}>{composer}</div>
    </main>
  ),
  UserMessage: function UserMessage({ text, branchSwitcher, onEdit }) {
    const labels = useChatLabels();
    return (
      <div style={{ textAlign: "right" }}>
        <p data-role="user" style={{ background: "#eef", padding: 8, borderRadius: 8 }}>
          {text}
        </p>
        {branchSwitcher}
        {onEdit && <button onClick={onEdit}>{labels.editMessage}</button>}
      </div>
    );
  },
  BranchSwitcher: function BranchSwitcher({ position, count, onPrevious, onNext }) {
    const labels = useChatLabels();
    return (
      <span role="group" aria-label={labels.branchPosition(position, count)}>
        <button aria-label={labels.previousBranch} disabled={!onPrevious} onClick={onPrevious}>
          ‹
        </button>
        {position}/{count}
        <button aria-label={labels.nextBranch} disabled={!onNext} onClick={onNext}>
          ›
        </button>
      </span>
    );
  },
  MessageEditor: function MessageEditor({ value, onValueChange, onSave, onCancel, canSave, error }) {
    const labels = useChatLabels();
    return (
      <div>
        <textarea aria-label={labels.editMessage} value={value} onChange={(event) => onValueChange(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <button disabled={!canSave} onClick={onSave}>
          {labels.saveEdit}
        </button>
        <button onClick={onCancel}>{labels.cancelEdit}</button>
      </div>
    );
  },
  AgentMessage: function AgentMessage({ status, children, empty, onRetry, notice, branchSwitcher, onRegenerate }) {
    const labels = useChatLabels();
    return (
      <div data-role="assistant" data-status={status} style={{ padding: 8 }}>
        {children}
        {empty && status === "complete" && <em>{labels.answerEmpty}</em>}
        {status === "stopped" && <em>{labels.answerStopped}</em>}
        {status === "interrupted" && <em>{labels.answerInterrupted}</em>}
        {notice}
        {onRetry && <button onClick={onRetry}>{labels.retry}</button>}
        {branchSwitcher}
        {onRegenerate && <button onClick={onRegenerate}>{labels.regenerate}</button>}
      </div>
    );
  },
  AgentText: ({ markdown }) => <p style={{ whiteSpace: "pre-wrap" }}>{markdown}</p>,
  Reasoning: ({ text, open, onOpenChange }) => (
    <details open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
      <summary>…</summary>
      {text}
    </details>
  ),
  ToolCallRow: function ToolCallRow({ toolName, state }) {
    const labels = useChatLabels();
    const text = state === "running" ? labels.toolRunning(toolName) : state === "done" ? labels.toolDone(toolName) : labels.toolError(toolName);
    return <div>{text}</div>;
  },
  ErrorNotice: function ErrorNotice({ kind, onRetry }) {
    const labels = useChatLabels();
    return (
      <div role="alert">
        {labels.errors[kind]} {onRetry && <button onClick={onRetry}>{labels.retry}</button>}
      </div>
    );
  },
  ConnectionNotice: function ConnectionNotice({ state, onRetry }) {
    const labels = useChatLabels();
    return (
      <div role="status">
        {state === "reconnecting" ? labels.reconnecting : labels.connectionLost}{" "}
        {onRetry && <button onClick={onRetry}>{labels.retry}</button>}
      </div>
    );
  },
  CompactionDivider: function CompactionDivider({ summary, open, onOpenChange }) {
    const labels = useChatLabels();
    return (
      <div>
        <button type="button" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          {labels.historyCompacted}
        </button>
        {open && <pre style={{ whiteSpace: "pre-wrap" }}>{summary}</pre>}
      </div>
    );
  },
  ChatNotFound: function ChatNotFound() {
    return <p>{useChatLabels().chatNotFound}</p>;
  },
  Composer: function Composer({ value, onValueChange, onSubmit, canSubmit, busy, onStop }) {
    const labels = useChatLabels();
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={labels.composerPlaceholder}
          aria-label={labels.composerLabel}
          style={{ flex: 1, padding: 8 }}
        />
        {busy ? (
          <button type="button" onClick={onStop}>
            {labels.stop}
          </button>
        ) : (
          <button type="submit" disabled={!canSubmit}>
            {labels.send}
          </button>
        )}
      </form>
    );
  },
};
