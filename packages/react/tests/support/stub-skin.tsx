import type { ChatSkin } from "../../src/skin-contract";
import { useChatLabels } from "../../src/labels";

/**
 * Скин-заглушка для тестов слоя поведения: пропсы компонентов видны в data-атрибутах,
 * надписи — из словаря. Один на все тесты, чтобы договор скина менялся в одном месте.
 */
export const stubSkin: ChatSkin = {
  Layout: ({ feed, composer, notice, scrollRef, announcement }) => (
    <main>
      <div ref={scrollRef} data-test-scroller data-testid="scroller" style={{ overflowY: "auto" }}>
        <section data-testid="feed" role="log" aria-live="off">
          {feed}
        </section>
      </div>
      {notice && <aside data-testid="notice">{notice}</aside>}
      <div data-testid="announcement" aria-live="polite">
        {announcement}
      </div>
      {composer}
    </main>
  ),
  UserMessage: function StubUserMessage({ text, attachments, branchSwitcher, onEdit, pending }) {
    const labels = useChatLabels();
    return (
      <div>
        {attachments && (
          <ul data-kind="user-attachments" aria-label={attachments.label}>
            {attachments.items.map((item) => (
              <li key={item.id} data-attachment-kind={item.kind} data-url={item.url} data-caption={item.caption ?? ""}>
                {item.name}
              </li>
            ))}
          </ul>
        )}
        <p data-kind="user">{text}</p>
        {pending && <span data-kind="steering-pending">{labels.steeringPending}</span>}
        {branchSwitcher}
        {onEdit && (
          <button type="button" data-action="edit" onClick={onEdit}>
            {labels.editMessage}
          </button>
        )}
      </div>
    );
  },
  BranchSwitcher: function StubBranchSwitcher({ position, count, onPrevious, onNext }) {
    const labels = useChatLabels();
    return (
      <div data-kind="branch-switcher" data-position={position} data-count={count} aria-label={labels.branchPosition(position, count)}>
        <button type="button" aria-label={labels.previousBranch} disabled={!onPrevious} onClick={onPrevious} />
        {`${position}/${count}`}
        <button type="button" aria-label={labels.nextBranch} disabled={!onNext} onClick={onNext} />
      </div>
    );
  },
  MessageEditor: function StubMessageEditor({ value, onValueChange, onSave, onCancel, canSave, error, attachments }) {
    const labels = useChatLabels();
    return (
      <form
        data-kind="message-editor"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {attachments && (
          <ul data-kind="editor-attachments" aria-label={attachments.label}>
            {attachments.items.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        )}
        <textarea aria-label={labels.editMessage} value={value} onChange={(event) => onValueChange(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={!canSave}>
          {labels.saveEdit}
        </button>
        <button type="button" onClick={onCancel}>
          {labels.cancelEdit}
        </button>
      </form>
    );
  },
  AgentMessage: function StubAgentMessage({ status, children, empty, onCopy, onRetry, notice, branchSwitcher, onRegenerate, voiceInterrupted, cutByLength }) {
    const labels = useChatLabels();
    return (
      <article
        data-kind="agent"
        data-status={status}
        data-empty={String(empty)}
        {...(voiceInterrupted && { "data-voice-interrupted": voiceInterrupted.spokenTail })}
        {...(cutByLength && { "data-cut-by-length": "true" })}
      >
        {children}
        {notice}
        {branchSwitcher}
        <button type="button" data-action="copy" onClick={onCopy} />
        {onRegenerate && (
          <button type="button" data-action="regenerate" onClick={onRegenerate}>
            {labels.regenerate}
          </button>
        )}
        {onRetry && (
          <button type="button" data-kind="answer-retry" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
      </article>
    );
  },
  AgentText: ({ markdown, streaming }) => (
    <div data-kind="text" data-streaming={String(streaming)}>
      {markdown}
    </div>
  ),
  Reasoning: ({ text, streaming, durationMs, open, onOpenChange }) => (
    <div data-kind="reasoning" data-streaming={String(streaming)} data-duration={String(durationMs)} data-open={String(open)}>
      <button type="button" aria-label="рассуждение" aria-expanded={open} onClick={() => onOpenChange(!open)} />
      {text}
    </div>
  ),
  ToolCallRow: ({ toolName, title, approval, state, input, output, errorText, open, onOpenChange }) => (
    <div
      data-kind="tool"
      data-tool={toolName}
      data-title={title ?? ""}
      data-approval={approval?.state ?? ""}
      data-approval-pending={approval?.state === "requested" ? String(approval.pending) : ""}
      data-approval-failed={approval?.state === "requested" ? String(approval.failed) : ""}
      data-approval-failure={approval?.state === "requested" ? (approval.failureText ?? "") : ""}
      data-approval-can-always={approval?.state === "requested" ? String(approval.canAlways) : ""}
      data-state={state}
      data-open={String(open)}
      data-input={JSON.stringify(input) ?? ""}
      data-output={JSON.stringify(output) ?? ""}
      data-error={errorText ?? ""}
    >
      <button type="button" aria-label="вызов" aria-expanded={open} onClick={() => onOpenChange(!open)} />
      {approval?.state === "requested" &&
        (["allow", "deny", "always"] as const)
          .filter((decision) => decision !== "always" || approval.canAlways)
          .map((decision) => (
          <button key={decision} type="button" aria-label={decision} onClick={() => approval.onDecide(decision)} />
        ))}
      {toolName}
    </div>
  ),
  ConnectionNotice: function StubConnectionNotice({ state, onRetry }) {
    const labels = useChatLabels();
    return (
      <div data-kind="connection-notice" data-state={state}>
        <p>{state === "reconnecting" ? labels.reconnecting : labels.connectionLost}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
      </div>
    );
  },
  SpendingNotice: ({ id, state, text }) => (
    <div id={id} data-kind="spending-notice" data-state={state} role="status" tabIndex={-1}>
      {text}
    </div>
  ),
  ErrorNotice: function StubErrorNotice({ kind, text, onRetry }) {
    const labels = useChatLabels();
    return (
      <div data-kind="error-notice" data-error-kind={kind}>
        <p>{text ?? labels.errors[kind]}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
      </div>
    );
  },
  CompactionDivider: function StubCompactionDivider({ summary, open, onOpenChange }) {
    const labels = useChatLabels();
    return (
      <div data-kind="compaction-divider" data-open={String(open)}>
        <button type="button" aria-label="сжатие" aria-expanded={open} onClick={() => onOpenChange(!open)}>
          {labels.historyCompacted}
        </button>
        {open && <div data-kind="compaction-summary">{summary}</div>}
      </div>
    );
  },
  ChatNotFound: function StubChatNotFound() {
    return <p data-kind="chat-not-found">{useChatLabels().chatNotFound}</p>;
  },
  Composer: function StubComposer({ value, onValueChange, onSubmit, canSubmit, canSteer, busy, onStop, modelChoice, attachments, voice, dialog, sendingBlocked, sendingBlockedReasonId, actions }) {
    const labels = useChatLabels();
    return (
      <form
        data-busy={String(busy)}
        {...(canSteer !== undefined && { "data-can-steer": String(canSteer) })}
        data-sending-blocked={String(sendingBlocked === true)}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <textarea
          aria-label="поле"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          {...(sendingBlockedReasonId && { "aria-describedby": sendingBlockedReasonId })}
        />
        {modelChoice && modelChoice.providers.length > 0 && (
          <>
            <select
              aria-label="модель"
              value={`${modelChoice.current.providerId}/${modelChoice.current.modelId}`}
              onChange={(event) => {
                const [providerId, modelId] = event.target.value.split("/");
                modelChoice.onChange({ providerId: providerId!, modelId: modelId! });
              }}
            >
              {modelChoice.providers.flatMap((provider) =>
                provider.models.map((model) => (
                  <option key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>
                    {`${provider.name}: ${model.name}`}
                  </option>
                )),
              )}
            </select>
            {modelChoice.reasoningLevels.length > 0 && (
              <select
                aria-label="рассуждения"
                value={modelChoice.reasoning}
                onChange={(event) => modelChoice.onReasoningChange(event.target.value)}
              >
                {modelChoice.reasoningLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        {modelChoice?.error && <p role="status">{modelChoice.error}</p>}
        {attachments && (
          <div data-kind="composer-attachments" data-accept={attachments.accept}>
            <input
              type="file"
              multiple
              aria-label="файлы"
              onChange={(event) => attachments.onAddFiles([...(event.target.files ?? [])])}
            />
            {attachments.items.map((item) => (
              <span key={item.id} data-attachment={item.id} data-status={item.status} data-attachment-kind={item.kind}>
                {item.name}
                <button type="button" aria-label={`убрать ${item.name}`} onClick={() => attachments.onRemove(item.id)} />
              </span>
            ))}
            {attachments.notice && <p role="alert">{attachments.notice}</p>}
          </div>
        )}
        {voice && (
          <>
            <button
              type="button"
              data-voice
              data-state={voice.state}
              data-polishing={voice.polishing ? "true" : "false"}
              aria-label={
                voice.state === "idle" ? labels.voiceStart : voice.state === "connecting" ? labels.voiceConnecting : labels.voiceStop
              }
              onClick={voice.onToggle}
            />
            {voice.error && <p role="status">{voice.error}</p>}
          </>
        )}
        {dialog && (
          <button
            type="button"
            data-kind="voice-dialog"
            data-state={dialog.state}
            data-error={dialog.error ?? ""}
            aria-label="голосовой режим"
            onClick={dialog.onToggle}
          />
        )}
        {actions && <div data-kind="composer-actions">{actions}</div>}
        <button type="submit" disabled={!canSubmit && canSteer !== true} data-busy={String(busy)}>
          послать
        </button>
        {busy && (
          <button type="button" data-action="stop" onClick={onStop}>
            {labels.stop}
          </button>
        )}
      </form>
    );
  },
};

/** Та же заглушка, но скин рисует поправки на лету (договор 21: `Composer.canSteer`, `UserMessage.pending`). */
export const steeringStubSkin: ChatSkin = { ...stubSkin, steering: true };
