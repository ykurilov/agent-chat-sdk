import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MAX_BODY_CHARS, MAX_WHEN_TO_USE_CHARS } from "../skill-rules";
import type { Skill, SkillLoadStats, SkillStatus, SkillVersion } from "../types";
import { lineDiff } from "./line-diff";
import { createSkillsClient, SkillsRequestError } from "./skills-client";
import type { SkillListEntry, SkillsClient } from "./skills-client";
import { useSkillsLabels } from "./skills-labels";
import type { SkillsLabels } from "./skills-labels";
import type { SkillsLoadState, SkillsSkin, SkillVersionView } from "./skills-skin";

export interface SkillsAdminProps {
  skin: SkillsSkin;
  /** Адрес `createSkillsHandler`; по умолчанию `/api/skills`. */
  basePath?: string;
  /** Тот же предел, что у `createSkills`; по умолчанию 50 000. */
  maxBodyChars?: number;
  /** Свой `fetch` (тесты, заголовки приложения). */
  fetch?: typeof globalThis.fetch;
}

type Selection = { mode: "none" } | { mode: "create" } | { mode: "edit"; name: string };

interface Draft {
  name: string;
  whenToUse: string;
  body: string;
  status: SkillStatus;
}

interface Detail {
  skill: Skill;
  loads: SkillLoadStats;
  versions: SkillVersion[] | null;
}

const emptyDraft: Draft = { name: "", whenToUse: "", body: "", status: "off" };

function errorText(error: unknown, labels: SkillsLabels): string {
  if (error instanceof SkillsRequestError) {
    const key = (error.reason ?? error.kind) as keyof SkillsLabels["errors"] | null;
    if (key && Object.hasOwn(labels.errors, key)) return labels.errors[key];
  }
  return labels.errors.other;
}

const isNotFound = (error: unknown) => error instanceof SkillsRequestError && error.status === 404;
const isConflict = (error: unknown) => error instanceof SkillsRequestError && error.kind === "version_conflict";

/**
 * Экран навыков для админа: список, форма с предпросмотром, статус, история версий с разницей и откатом, удаление,
 * учёт загрузок. Не-админ получает от сервера 404 — экран показывает «не найдено». Рисует только скин.
 */
export function SkillsAdmin({ skin, basePath, maxBodyChars = DEFAULT_MAX_BODY_CHARS, fetch }: SkillsAdminProps) {
  const labels = useSkillsLabels();
  const client: SkillsClient = useMemo(() => createSkillsClient({ basePath, fetch }), [basePath, fetch]);
  const [listState, setListState] = useState<SkillsLoadState>("loading");
  const [skills, setSkills] = useState<SkillListEntry[]>([]);
  const [hidden, setHidden] = useState(false);
  const [selection, setSelection] = useState<Selection>({ mode: "none" });
  const [detailState, setDetailState] = useState<SkillsLoadState>("loading");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [openVersion, setOpenVersion] = useState<number | null>(null);
  const [rollingBack, setRollingBack] = useState(false);
  // Действие, которое ждёт согласия потерять несохранённые правки.
  const [pendingLeave, setPendingLeave] = useState<{ run: () => void } | null>(null);
  // Ответ на старый выбор не должен лечь в карточку нового.
  const opened = useRef(0);

  const loadList = useCallback(async () => {
    setListState("loading");
    try {
      setSkills(await client.list());
      setListState("ready");
    } catch (failure) {
      if (isNotFound(failure)) setHidden(true);
      setListState("failed");
    }
  }, [client]);

  const resetForm = () => {
    setPreview(false);
    setError(null);
    setConflict(false);
    setConfirmingDelete(false);
    setOpenVersion(null);
    setPendingLeave(null);
  };

  const loadDetail = useCallback(
    async (name: string) => {
      const ticket = ++opened.current;
      setDetailState("loading");
      try {
        const [card, versions] = await Promise.all([client.get(name), client.versions(name)]);
        if (ticket !== opened.current) return;
        setDetail({ ...card, versions });
        setDraft({ name: card.skill.name, whenToUse: card.skill.whenToUse, body: card.skill.body, status: card.skill.status });
        setDetailState("ready");
      } catch (failure) {
        if (ticket !== opened.current) return;
        if (isNotFound(failure)) {
          // Навык удалили в другой вкладке: убрать из списка и закрыть карточку.
          setSelection({ mode: "none" });
          void loadList();
          return;
        }
        setDetailState("failed");
      }
    },
    [client, loadList],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const select = (next: Selection) => {
    resetForm();
    setSelection(next);
    if (next.mode === "edit") {
      void loadDetail(next.name);
      return;
    }
    opened.current++;
    setDetail(null);
    setDraft(emptyDraft);
  };

  const applySaved = (skill: Skill) => {
    setDetail((current) => (current ? { ...current, skill } : current));
    setDraft({ name: skill.name, whenToUse: skill.whenToUse, body: skill.body, status: skill.status });
    void loadList();
  };

  async function save() {
    setSaving(true);
    setError(null);
    setConflict(false);
    try {
      if (selection.mode === "create") {
        const created = await client.create(draft);
        await loadList();
        select({ mode: "edit", name: created.name });
      } else if (selection.mode === "edit" && detail) {
        applySaved(await client.update(detail.skill.name, { whenToUse: draft.whenToUse, body: draft.body, expectedVersion: detail.skill.version }));
        await refreshVersions(detail.skill.name);
      }
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      else setError(errorText(failure, labels));
    } finally {
      setSaving(false);
    }
  }

  async function refreshVersions(name: string) {
    try {
      const versions = await client.versions(name);
      setDetail((current) => (current && current.skill.name === name ? { ...current, versions } : current));
    } catch {
      setDetail((current) => (current ? { ...current, versions: null } : current));
    }
  }

  async function changeStatus(status: SkillStatus) {
    if (selection.mode !== "edit" || !detail) {
      setDraft((current) => ({ ...current, status }));
      return;
    }
    setStatusBusy(true);
    setError(null);
    try {
      const skill = await client.setStatus(detail.skill.name, status);
      setDetail((current) => (current ? { ...current, skill: { ...current.skill, status: skill.status, updatedAt: skill.updatedAt, updatedBy: skill.updatedBy } } : current));
      setDraft((current) => ({ ...current, status: skill.status }));
      void loadList();
    } catch (failure) {
      setError(errorText(failure, labels));
    } finally {
      setStatusBusy(false);
    }
  }

  async function remove() {
    if (!detail) return;
    setDeleting(true);
    try {
      await client.remove(detail.skill.name);
      select({ mode: "none" });
      await loadList();
    } catch (failure) {
      setError(errorText(failure, labels));
    } finally {
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  async function rollback(version: number) {
    if (!detail) return;
    setRollingBack(true);
    setError(null);
    setConflict(false);
    try {
      applySaved(await client.rollback(detail.skill.name, version, detail.skill.version));
      setOpenVersion(null);
      await refreshVersions(detail.skill.name);
    } catch (failure) {
      if (isConflict(failure)) setConflict(true);
      else setError(errorText(failure, labels));
    } finally {
      setRollingBack(false);
    }
  }

  const editing = selection.mode === "edit" ? detail?.skill : undefined;
  const dirty = editing ? draft.whenToUse !== editing.whenToUse || draft.body !== editing.body : draft.name !== "" || draft.whenToUse !== "" || draft.body !== "";

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Уход от несохранённых правок — сперва спросить. */
  const leaveDraft = (run: () => void) => (dirty ? setPendingLeave({ run }) : run());

  if (hidden) return <skin.SkillsNotFound />;

  const list = (
    <skin.SkillList
      state={listState}
      creating={selection.mode === "create"}
      onCreate={() => leaveDraft(() => select({ mode: "create" }))}
      onRetry={() => void loadList()}
      items={skills.map((skill) => ({
        name: skill.name,
        whenToUse: skill.whenToUse,
        status: skill.status,
        version: skill.version,
        updatedAt: labels.formatTime(skill.updatedAt),
        loads: skill.loads,
        selected: selection.mode === "edit" && selection.name === skill.name,
        onSelect: () => leaveDraft(() => select({ mode: "edit", name: skill.name })),
      }))}
    />
  );

  const canSave =
    draft.whenToUse.trim() !== "" &&
    draft.whenToUse.length <= MAX_WHEN_TO_USE_CHARS &&
    draft.body.trim() !== "" &&
    draft.body.length <= maxBodyChars &&
    (selection.mode !== "create" || draft.name !== "");

  const editor = (
    <skin.SkillEditor
      mode={selection.mode === "create" ? "create" : "edit"}
      name={draft.name}
      onNameChange={selection.mode === "create" ? (name) => setDraft((current) => ({ ...current, name })) : undefined}
      whenToUse={draft.whenToUse}
      onWhenToUseChange={(whenToUse) => setDraft((current) => ({ ...current, whenToUse }))}
      body={draft.body}
      onBodyChange={(body) => setDraft((current) => ({ ...current, body }))}
      maxWhenToUseChars={MAX_WHEN_TO_USE_CHARS}
      maxBodyChars={maxBodyChars}
      preview={preview}
      onPreviewChange={setPreview}
      status={draft.status}
      onStatusChange={(status) => void changeStatus(status)}
      statusBusy={statusBusy}
      version={editing?.version}
      updated={editing ? labels.updatedBy(editing.updatedBy, labels.formatTime(editing.updatedAt)) : undefined}
      dirty={dirty}
      canSave={canSave}
      saving={saving}
      onSave={() => void save()}
      onCancel={selection.mode === "create" ? () => select({ mode: "none" }) : undefined}
      error={error}
      conflict={conflict}
      onReloadLatest={editing ? () => select({ mode: "edit", name: editing.name }) : undefined}
      onDelete={editing ? () => setConfirmingDelete(true) : undefined}
      confirmingDelete={confirmingDelete}
      onConfirmDelete={() => void remove()}
      onCancelDelete={() => setConfirmingDelete(false)}
      deleting={deleting}
      discardingDraft={pendingLeave !== null}
      onConfirmDiscard={() => {
        setPendingLeave(null);
        pendingLeave?.run();
      }}
      onCancelDiscard={() => setPendingLeave(null)}
    />
  );

  let panel;
  if (selection.mode === "none") panel = <skin.SkillPanel state="empty" onRetry={() => {}} />;
  else if (selection.mode === "create") panel = <skin.SkillPanel state="ready" onRetry={() => {}} editor={editor} />;
  else if (detailState !== "ready" || !detail) panel = <skin.SkillPanel state={detailState} onRetry={() => void loadDetail(selection.name)} />;
  else {
    const versions = detail.versions ?? [];
    const versionViews: SkillVersionView[] = versions.map((version, index) => {
      const previous = versions[index + 1];
      const open = openVersion === version.version;
      return {
        version: version.version,
        author: version.author,
        createdAt: labels.formatTime(version.createdAt),
        current: version.version === detail.skill.version,
        open,
        onOpenChange: (next) => setOpenVersion(next ? version.version : null),
        ...(open && {
          whenToUseDiff: lineDiff(previous?.whenToUse ?? "", version.whenToUse),
          bodyDiff: lineDiff(previous?.body ?? "", version.body),
        }),
        ...(version.version !== detail.skill.version && { onRollback: () => leaveDraft(() => void rollback(version.version)) }),
      };
    });
    panel = (
      <skin.SkillPanel
        state="ready"
        onRetry={() => void loadDetail(selection.name)}
        editor={editor}
        versions={
          <skin.SkillVersions
            state={detail.versions ? "ready" : "failed"}
            versions={versionViews}
            rollingBack={rollingBack}
            onRetry={() => void refreshVersions(detail.skill.name)}
          />
        }
        loads={
          <skin.SkillLoads
            total={detail.loads.total}
            recent={detail.loads.recent.map((load) => ({ chatId: load.chatId, ownerId: load.ownerId, version: load.version, loadedAt: labels.formatTime(load.loadedAt) }))}
          />
        }
      />
    );
  }

  return <skin.SkillsLayout list={list} detail={panel} />;
}
