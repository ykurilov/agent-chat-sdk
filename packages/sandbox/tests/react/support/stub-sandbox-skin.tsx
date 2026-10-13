import type { ChatSkin } from "@ykurilov/agent-chat-react";
import { stubSkin } from "../../../../react/tests/support/stub-skin";
import { useSandboxLabels } from "../../../src/react/sandbox-labels";
import type { SandboxSkin } from "../../../src/react/sandbox-skin";

/** Скин чата с кнопкой правки ответа и отметками «изменено». */
export const stubSandboxChatSkin: ChatSkin = {
  ...stubSkin,
  AgentMessage: ({ children, onEdit, edited }) => (
    <article data-kind="agent" data-edited={String(edited ?? false)}>
      {children}
      {onEdit && (
        <button type="button" data-action="edit-answer" onClick={onEdit}>
          править
        </button>
      )}
    </article>
  ),
};

/** Скин-заглушка песочницы: пропсы видны в data-атрибутах. */
export const stubSandboxSkin: SandboxSkin = {
  SandboxLayout: ({ header, chat, journal, journalOpen, onJournalOpenChange }) => (
    <div data-testid="sandbox" data-journal-open={String(journalOpen)}>
      <header>{header}</header>
      <section aria-label="чат">{chat}</section>
      <button type="button" data-testid="toggle-journal" onClick={() => onJournalOpenChange(!journalOpen)} />
      <aside aria-label="журнал">{journal}</aside>
    </div>
  ),
  JournalList: function StubJournalList({ state, rows, onRetry, turns, currentTurnId, onTurnChange }) {
    const labels = useSandboxLabels();
    return (
      <div data-testid="journal" data-state={state}>
        <select aria-label="ход" value={currentTurnId ?? ""} onChange={(event) => onTurnChange(event.target.value === "" ? null : event.target.value)}>
          {turns.map((turn) => (
            <option key={turn.id ?? ""} value={turn.id ?? ""}>
              {turn.label}
            </option>
          ))}
        </select>
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
        <ul>
          {rows.map((row) => (
            <li key={row.id} data-row={row.id} data-kind={row.kind} data-source={row.kind === "tool" ? row.source : ""} data-output-edited={row.kind === "tool" ? String(row.outputEdited) : ""}>
              <button type="button" aria-expanded={row.open} onClick={() => row.onOpenChange(!row.open)}>
                {row.kind === "model" ? row.modelId : row.toolName}
              </button>
              {row.details}
            </li>
          ))}
        </ul>
      </div>
    );
  },
  ModelCallDetails: (view) => (
    <div data-testid="model-details" data-state={view.state}>
      {view.state === "ready" &&
        view.messages.map((message, index) => (
          <p key={index} data-new={String(message.isNew)}>
            {message.content}
          </p>
        ))}
      {view.state === "failed" && <button type="button" onClick={view.onRetry} />}
    </div>
  ),
  ToolCallDetails: (view) => (
    <div data-testid="tool-details" data-state={view.state}>
      {view.state === "ready" && `${view.input} → ${view.output ?? ""}`}
    </div>
  ),
  InstructionEditor: ({ value, onValueChange, appInstructions, edited, dirty, onSave, canSave, saving, onReset, error }) => (
    <div data-testid="instructions" data-edited={String(edited)} data-dirty={String(dirty)} data-saving={String(saving)} data-app={appInstructions}>
      <textarea aria-label="инструкция" value={value} onChange={(event) => onValueChange(event.target.value)} />
      <button type="button" data-action="save-instructions" disabled={!canSave} onClick={onSave} />
      {onReset && <button type="button" data-action="reset-instructions" onClick={onReset} />}
      {error && <p role="alert">{error}</p>}
    </div>
  ),
  AnswerEditor: ({ text, onTextChange, textError, toolOutputs, onSave, onCancel, canSave, error }) => (
    <div data-testid="answer-editor">
      <textarea aria-label="текст ответа" value={text} onChange={(event) => onTextChange(event.target.value)} />
      {textError && <p>{textError}</p>}
      {toolOutputs.map((output) => (
        <label key={output.toolCallId} data-tool-call={output.toolCallId} data-edited={String(output.edited)}>
          {output.toolName}
          <textarea aria-label={`результат ${output.toolCallId}`} value={output.value} onChange={(event) => output.onValueChange(event.target.value)} />
          {output.error && <span data-error>{output.error}</span>}
        </label>
      ))}
      <button type="button" data-action="save-answer" disabled={!canSave} onClick={onSave} />
      <button type="button" data-action="cancel-answer" onClick={onCancel} />
      {error && <p role="alert">{error}</p>}
    </div>
  ),
};
