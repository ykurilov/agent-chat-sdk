import type { ComponentType, ReactNode } from "react";
import type { SkillStatus } from "../types";
import type { DiffLine } from "./line-diff";

/** Что со списком или карточкой: грузится, готово, не загрузилось (тогда `onRetry`). */
export type SkillsLoadState = "loading" | "ready" | "failed";

/** Экран: список слева, карточка справа (на узком экране — друг под другом). */
export interface SkillsLayoutProps {
  list: ReactNode;
  detail: ReactNode;
}

/** Навык в списке. Время — готовой надписью. */
export interface SkillListItemView {
  name: string;
  whenToUse: string;
  status: SkillStatus;
  version: number;
  updatedAt: string;
  loads: number;
  selected: boolean;
  onSelect(): void;
}

export interface SkillListProps {
  state: SkillsLoadState;
  items: SkillListItemView[];
  /** Открыта форма нового навыка: кнопку «Новый навык» показать выбранной. */
  creating: boolean;
  onCreate(): void;
  onRetry(): void;
}

/** Карточка: пусто (ничего не выбрано), грузится, не загрузилась, готова (тогда части уже собраны). */
export interface SkillPanelProps {
  state: "empty" | SkillsLoadState;
  onRetry(): void;
  editor?: ReactNode;
  versions?: ReactNode;
  loads?: ReactNode;
}

/**
 * Форма навыка. Предпросмотр тела рисует скин; HTML в нём не исполняется (`<script>`, `<img onerror>`, ссылки
 * `javascript:` — текстом или вырезаны).
 */
export interface SkillEditorProps {
  mode: "create" | "edit";
  name: string;
  /** Только у нового навыка: имя потом не меняется. */
  onNameChange?(value: string): void;
  whenToUse: string;
  onWhenToUseChange(value: string): void;
  body: string;
  onBodyChange(value: string): void;
  maxWhenToUseChars: number;
  maxBodyChars: number;
  preview: boolean;
  onPreviewChange(preview: boolean): void;
  status: SkillStatus;
  onStatusChange(status: SkillStatus): void;
  /** Статус сохраняется (у существующего навыка — сразу при выборе). */
  statusBusy: boolean;
  /** У существующего навыка: версия и кто последним правил (готовой надписью). */
  version?: number;
  updated?: string;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  onSave(): void;
  /** Только у нового навыка: закрыть форму. */
  onCancel?(): void;
  /** Ошибка готовым текстом. */
  error: string | null;
  /** Навык успели изменить: показать `labels.conflict` и кнопку `onReloadLatest`. */
  conflict: boolean;
  onReloadLatest?(): void;
  /** Только у существующего навыка. */
  onDelete?(): void;
  confirmingDelete: boolean;
  onConfirmDelete(): void;
  onCancelDelete(): void;
  deleting: boolean;
  /** Есть несохранённые правки, а админ уходит (другой навык, «Новый», откат): показать `labels.discardWarning`. */
  discardingDraft: boolean;
  onConfirmDiscard(): void;
  onCancelDiscard(): void;
}

export interface SkillVersionView {
  version: number;
  author: string;
  createdAt: string;
  current: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Раскрытая версия: что она изменила против предыдущей. */
  whenToUseDiff?: DiffLine[];
  bodyDiff?: DiffLine[];
  /** Нет у текущей версии. */
  onRollback?(): void;
}

export interface SkillVersionsProps {
  state: SkillsLoadState;
  versions: SkillVersionView[];
  rollingBack: boolean;
  onRetry(): void;
}

export interface SkillLoadView {
  chatId: string;
  ownerId: string;
  version: number;
  loadedAt: string;
}

export interface SkillLoadsProps {
  total: number;
  recent: SkillLoadView[];
}

/**
 * Договор скина навыков, версия 1. Слой поведения (`SkillsAdmin`) собирает экран только из этих частей и ничего
 * своего не рисует. Надписи компоненты берут из `useSkillsLabels()`.
 */
export interface SkillsSkin {
  SkillsLayout: ComponentType<SkillsLayoutProps>;
  SkillList: ComponentType<SkillListProps>;
  SkillPanel: ComponentType<SkillPanelProps>;
  SkillEditor: ComponentType<SkillEditorProps>;
  SkillVersions: ComponentType<SkillVersionsProps>;
  SkillLoads: ComponentType<SkillLoadsProps>;
  /** Не-админ: сервер ответил 404 — «не найдено», будто экрана нет. */
  SkillsNotFound: ComponentType<Record<string, never>>;
}
