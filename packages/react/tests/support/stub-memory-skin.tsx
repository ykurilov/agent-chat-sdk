import { useChatLabels } from "../../src/labels";
import type { MemorySkin } from "../../src/memory/memory-skin";

/** Скин-заглушка экрана памяти: пропсы видны в data-атрибутах, надписи — из словаря. */
export const stubMemorySkin: MemorySkin = {
  MemoryScreen: ({ status, counts, onAdd, onClearAll, onRetry, error, newNoteEditor, merges, confirm, children }) => {
    const labels = useChatLabels();
    return (
      <div
        data-testid="memory"
        data-status={status}
        data-total={counts?.total}
        data-limit={counts?.limit}
        data-shown={counts?.shown}
      >
        <h2>{labels.memoryHeading}</h2>
        {counts && <p data-testid="count">{labels.memoryCount(counts.total, counts.limit)}</p>}
        {counts && counts.shown < counts.total && <p data-testid="hint">{labels.memoryShownHint(counts.shown, counts.total)}</p>}
        {status === "loading" && <p>{labels.memoryLoading}</p>}
        {status === "empty" && <p>{labels.memoryEmpty}</p>}
        {status === "unavailable" && <p>{labels.memoryUnavailable}</p>}
        {status === "error" && <p>{labels.memoryLoadFailed}</p>}
        {onAdd && (
          <button type="button" onClick={onAdd}>
            {labels.memoryAdd}
          </button>
        )}
        {onClearAll && (
          <button type="button" onClick={onClearAll}>
            {labels.memoryClearAll}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
        {onRetry && (
          <button type="button" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
        {newNoteEditor}
        {children}
        {merges && (
          <section data-testid="merges">
            <h3>{labels.memoryMergesHeading}</h3>
            {merges}
          </section>
        )}
        {confirm}
      </div>
    );
  },
  MemoryGroup: ({ name, depth, count, children }) => (
    <section data-group={name} data-depth={depth} data-count={count}>
      <h3>{name}</h3>
      {children}
    </section>
  ),
  MemoryNoteRow: function StubNoteRow({ content, onEdit, onDelete }) {
    const labels = useChatLabels();
    return (
      <div data-note={content}>
        <span>{content}</span>
        <button type="button" aria-label={labels.memoryEditNote(content)} disabled={!onEdit} onClick={onEdit}>
          {labels.memoryEdit}
        </button>
        <button type="button" aria-label={labels.memoryDeleteNote(content)} disabled={!onDelete} onClick={onDelete}>
          {labels.memoryDelete}
        </button>
      </div>
    );
  },
  MemoryNoteEditor: function StubNoteEditor({ mode, path, content, onPathChange, onContentChange, onSave, onCancel, canSave, pending, errors }) {
    const labels = useChatLabels();
    return (
      <form
        data-testid="note-editor"
        data-mode={mode}
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <label>
          {labels.memoryPathField}
          <input value={path} onChange={(event) => onPathChange(event.target.value)} />
        </label>
        {errors.path && <p role="alert" data-field="path">{errors.path}</p>}
        <label>
          {labels.memoryContentField}
          <textarea value={content} onChange={(event) => onContentChange(event.target.value)} />
        </label>
        {errors.content && <p role="alert" data-field="content">{errors.content}</p>}
        {errors.form && <p role="alert" data-field="form">{errors.form}</p>}
        <button type="submit" disabled={!canSave || pending}>
          {labels.memorySave}
        </button>
        <button type="button" onClick={onCancel}>
          {labels.memoryCancel}
        </button>
      </form>
    );
  },
  MemoryMerge: function StubMerge({ finishedAt, groups, revertible, onRevert }) {
    const labels = useChatLabels();
    return (
      <article data-merge-at={finishedAt} data-revertible={revertible}>
        {groups.map((group) => (
          <div key={group.after} data-merge-group={group.after}>
            <p>{labels.memoryMergeBefore}</p>
            <ul>
              {group.before.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p>{labels.memoryMergeAfter}</p>
            <p data-merge-after>{group.after}</p>
          </div>
        ))}
        {revertible ? (
          <button type="button" disabled={!onRevert} onClick={onRevert}>
            {labels.memoryMergeRevert}
          </button>
        ) : (
          <p>{labels.memoryMergeNotRevertible}</p>
        )}
      </article>
    );
  },
  MemoryConfirm: ({ target, pending, error, onConfirm, onCancel }) => {
    const labels = useChatLabels();
    return (
      <div role="dialog" data-testid="memory-confirm" data-kind={target.kind}>
        <p>{target.kind === "note" ? labels.memoryDeleteBody(target.content) : labels.memoryClearBody(target.total)}</p>
        {error && <p role="alert">{error}</p>}
        <button type="button" disabled={pending} onClick={onConfirm}>
          {target.kind === "note" ? labels.memoryConfirmDelete : labels.memoryConfirmClear}
        </button>
        <button type="button" onClick={onCancel}>
          {labels.memoryConfirmCancel}
        </button>
      </div>
    );
  },
};
