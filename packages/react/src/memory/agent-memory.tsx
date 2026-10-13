import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useChatLabels } from "../labels";
import type { ChatLabels } from "../labels";
import type { MemoryConfirmTarget, MemoryNoteEditorErrors, MemorySkin } from "./memory-skin";
import { buildMemoryTree } from "./memory-tree";
import type { MemoryTreeGroup } from "./memory-tree";
import { memoryNoteLimits } from "./memory-types";
import type { MemoryActionResult, MemoryApi, MemoryFailure, MemoryNote, MemoryNoteInput } from "./memory-types";
import { useMemoryNotes } from "./use-memory-notes";

export interface AgentMemoryProps {
  /** Обмен с сервером: `createMemoryApi({ api: "/api/chat" })`. Создайте один раз — при смене объекта список грузится заново. */
  api: MemoryApi;
  /** Скин экрана памяти (договор 11), например `tandemMemorySkin`. */
  skin: MemorySkin;
}

interface Draft {
  /** `null` — новая запись. */
  id: string | null;
  path: string;
  content: string;
}

type Confirm = { kind: "note"; id: string; content: string } | { kind: "all" };

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/** Форма черновика → ввод для сервера либо ошибки полей. Пределы те же, что у пакета памяти. */
function readDraft(draft: Draft, labels: ChatLabels): { input: MemoryNoteInput } | { errors: MemoryNoteEditorErrors } {
  const errors: MemoryNoteEditorErrors = {};
  const categories = draft.path.split("/").map(squeeze).filter((part) => part !== "");
  if (categories.length === 0) errors.path = labels.memoryFieldErrors.pathRequired;
  else if (categories.length > memoryNoteLimits.maxCategories) errors.path = labels.memoryFieldErrors.pathTooMany;
  else if (categories.some((part) => part.length > memoryNoteLimits.maxCategoryChars)) errors.path = labels.memoryFieldErrors.pathTooLong;
  const content = squeeze(draft.content);
  if (content === "") errors.content = labels.memoryFieldErrors.contentRequired;
  else if (content.length > memoryNoteLimits.maxContentChars) errors.content = labels.memoryFieldErrors.contentTooLong;
  return errors.path || errors.content ? { errors } : { input: { categories, content } };
}

/**
 * Экран памяти агента: записи по разделам, добавление, правка, удаление, «Стереть всю память» и блок «Объединено» с кнопкой «Вернуть как было».
 * Всё видимое рисует скин; здесь — состояние, черновики и проверка ввода.
 */
export function AgentMemory({ api, skin }: AgentMemoryProps) {
  const labels = useChatLabels();
  const memory = useMemoryNotes(api);
  const { notes, edit: editNote, add: addNote, remove: removeNote, clear: clearNotes, revertMerge } = memory;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MemoryNoteEditorErrors>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  // Правка записи, которой уже нет в списке (её удалили в другом месте), закрывается сама.
  const editorOpen = draft !== null && (draft.id === null || notes.some((item) => item.id === draft.id));
  const failureText = (failure: MemoryFailure) => labels.memoryErrors[failure];

  const run = useCallback(async (action: () => Promise<MemoryActionResult>): Promise<MemoryActionResult> => {
    setPending(true);
    try {
      return await action();
    } finally {
      setPending(false);
    }
  }, []);

  const openAdd = () => {
    setNotice(undefined);
    setFieldErrors({});
    setDraft({ id: null, path: "", content: "" });
  };
  const openEdit = (note: MemoryNote) => {
    setNotice(undefined);
    setFieldErrors({});
    setDraft({ id: note.id, path: note.categories.join(" / "), content: note.content });
  };
  const closeEditor = () => {
    setDraft(null);
    setFieldErrors({});
  };
  const changeDraft = (change: Partial<Pick<Draft, "path" | "content">>) => {
    setDraft((current) => current && { ...current, ...change });
    setFieldErrors({});
  };

  const save = async () => {
    if (!draft) return;
    const read = readDraft(draft, labels);
    if ("errors" in read) {
      setFieldErrors(read.errors);
      return;
    }
    setFieldErrors({});
    const result = await run(() => (draft.id === null ? addNote(read.input) : editNote(draft.id, read.input)));
    if (result.ok) {
      setDraft(null);
    } else if (result.failure === "not_found" && draft.id !== null) {
      // Записи нет: форму закрываем, причину говорим на экране.
      setDraft(null);
      setNotice(failureText("not_found"));
    } else {
      setFieldErrors({ form: failureText(result.failure) });
    }
  };

  const revert = async (runId: string) => {
    setNotice(undefined);
    const result = await run(() => revertMerge(runId));
    if (result.ok) return;
    const { failure } = result;
    setNotice(failure === "limit_reached" || failure === "duplicate" ? labels.memoryRevertErrors[failure] : failureText(failure));
  };

  const openConfirm = (next: Confirm) => {
    setNotice(undefined);
    setConfirmError(undefined);
    setConfirm(next);
  };
  const closeConfirm = () => {
    setConfirm(null);
    setConfirmError(undefined);
  };
  const confirmAction = async () => {
    if (!confirm) return;
    const result = await run(() => (confirm.kind === "note" ? removeNote(confirm.id) : clearNotes()));
    if (result.ok) {
      closeConfirm();
    } else if (result.failure === "stale_version" || result.failure === "not_found") {
      // Запись уже другая или её нет: список обновлён, человек решает заново.
      closeConfirm();
      setNotice(failureText(result.failure));
    } else {
      setConfirmError(failureText(result.failure));
    }
  };

  const confirmTarget: MemoryConfirmTarget | null =
    confirm === null ? null : confirm.kind === "note" ? { kind: "note", content: confirm.content } : { kind: "all", total: notes.length };

  const canChange = !pending;
  const renderEditor = (mode: "create" | "edit"): ReactNode =>
    draft && (
      <skin.MemoryNoteEditor
        mode={mode}
        path={draft.path}
        content={draft.content}
        onPathChange={(path) => changeDraft({ path })}
        onContentChange={(content) => changeDraft({ content })}
        onSave={() => void save()}
        onCancel={closeEditor}
        canSave={draft.path.trim() !== "" && draft.content.trim() !== ""}
        pending={pending}
        errors={fieldErrors}
      />
    );

  const renderNote = (note: MemoryNote): ReactNode =>
    editorOpen && draft?.id === note.id ? (
      <div key={note.id}>{renderEditor("edit")}</div>
    ) : (
      <skin.MemoryNoteRow
        key={note.id}
        content={note.content}
        {...(canChange && { onEdit: () => openEdit(note), onDelete: () => openConfirm({ kind: "note", id: note.id, content: note.content }) })}
      />
    );

  const renderGroup = (group: MemoryTreeGroup, depth: number): ReactNode => (
    <skin.MemoryGroup key={group.key} name={group.name} depth={depth} count={group.count}>
      {group.notes.map(renderNote)}
      {group.groups.map((inner) => renderGroup(inner, depth + 1))}
    </skin.MemoryGroup>
  );

  const renderMerges = (): ReactNode =>
    memory.merges.map((merge) => (
      <skin.MemoryMerge
        key={merge.runId}
        finishedAt={merge.finishedAt}
        groups={merge.groups.map((item) => ({ before: item.originals.map((original) => original.content), after: item.result.content }))}
        revertible={merge.revertible}
        {...(merge.revertible && canChange && { onRevert: () => void revert(merge.runId) })}
      />
    ));

  const usable = memory.state === "ready" || memory.state === "empty";
  return (
    <skin.MemoryScreen
      status={memory.state}
      {...(memory.counts && { counts: memory.counts })}
      {...(usable && !editorOpen && { onAdd: openAdd })}
      {...(memory.state === "ready" && canChange && { onClearAll: () => openConfirm({ kind: "all" }) })}
      {...((memory.state === "error") && { onRetry: memory.reload })}
      {...(notice && { error: notice })}
      {...(editorOpen && draft?.id === null && { newNoteEditor: renderEditor("create") })}
      {...(memory.state === "ready" && memory.merges.length > 0 && { merges: renderMerges() })}
      {...(confirmTarget && {
        confirm: (
          <skin.MemoryConfirm
            target={confirmTarget}
            pending={pending}
            {...(confirmError && { error: confirmError })}
            onConfirm={() => void confirmAction()}
            onCancel={closeConfirm}
          />
        ),
      })}
    >
      {memory.state === "ready" && buildMemoryTree(notes).map((group) => renderGroup(group, 0))}
    </skin.MemoryScreen>
  );
}
