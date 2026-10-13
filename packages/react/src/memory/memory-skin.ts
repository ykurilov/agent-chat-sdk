import type { ComponentType, ReactNode } from "react";
import type { MemoryCounts, MemoryStatus } from "./memory-types";

/** Ошибки полей формы записи готовыми надписями; `form` — отказ сервера или другое, что не про одно поле. */
export interface MemoryNoteEditorErrors {
  path?: string;
  content?: string;
  form?: string;
}

/** Что подтверждает окно: удаление одной записи или стирание всей памяти. */
export type MemoryConfirmTarget = { kind: "note"; content: string } | { kind: "all"; total: number };

/** Одна склейка для экрана: тексты записей «было» (скрытые оригиналы) и «стало» (результат в списке). */
export interface MemoryMergeGroupView {
  before: string[];
  after: string;
}

/**
 * Договор скина, версия 11: отдельный интерфейс для экрана памяти `AgentMemory` (договор чата `ChatSkin`
 * и договор списка чатов `ChatListSkin` не менялись). Слой поведения решает, что показать, и хранит черновики; скин рисует
 * готовые данные и зовёт колбэки. Надписи компоненты берут из `useChatLabels()`; ширина — любая, вплоть до телефона,
 * без горизонтальной прокрутки.
 */
export interface MemorySkin {
  /**
   * Экран целиком: заголовок, счётчик, кнопки и состояния. `status`: `loading` и `error` (тогда `onRetry`) — записей нет,
   * рисовать надпись состояния; `empty` — надпись «память пуста»; `unavailable` — памяти в приложении нет; `ready` — `children`.
   * `counts` нет, пока список не загружен; если `shown < total` — показать подсказку `memoryShownHint`.
   * Нет `onAdd` — форма новой записи уже открыта или памяти нет, кнопку не рисовать; нет `onClearAll` — стирать нечего.
   * `error` — сообщение о том, что не вышло, готовой надписью (`role="alert"`). `newNoteEditor` — форма новой записи
   * (над списком), `confirm` — окно подтверждения. `merges` — блок «Объединено» (карточки `MemoryMerge`); есть, только
   * когда склейки есть; скин рисует его под списком записей со своим заголовком `memoryMergesHeading`.
   */
  MemoryScreen: ComponentType<{
    status: MemoryStatus;
    counts?: MemoryCounts;
    onAdd?: () => void;
    onClearAll?: () => void;
    onRetry?: () => void;
    error?: string;
    newNoteEditor?: ReactNode;
    merges?: ReactNode;
    confirm?: ReactNode;
    children: ReactNode;
  }>;
  /**
   * Раздел дерева. `depth` — 0 для верхнего; `count` — записей в разделе, вместе с вложенными. В `children` сначала записи
   * раздела, потом вложенные разделы.
   */
  MemoryGroup: ComponentType<{ name: string; depth: number; count: number; children: ReactNode }>;
  /** Запись. Нет обработчика — действие сейчас недоступно (идёт другое действие): кнопку показать неактивной. */
  MemoryNoteRow: ComponentType<{ content: string; onEdit?: () => void; onDelete?: () => void }>;
  /**
   * Форма записи. Слой поведения хранит черновик: скин рисует поля с `path` (разделы через «/», например
   * «О себе / Работа») и `content`. `canSave` — `false` для пустых полей; `pending` — запись уходит на сервер.
   * Enter в поле раздела и кнопка «Сохранить» зовут `onSave`, Escape — `onCancel`.
   */
  MemoryNoteEditor: ComponentType<{
    mode: "create" | "edit";
    path: string;
    content: string;
    onPathChange: (value: string) => void;
    onContentChange: (value: string) => void;
    onSave: () => void;
    onCancel: () => void;
    canSave: boolean;
    pending: boolean;
    errors: MemoryNoteEditorErrors;
  }>;
  /**
   * Одно слияние в блоке «Объединено»: для каждой склейки — «было» (тексты оригиналов) и «стало» (результат).
   * `finishedAt` — время слияния (ISO 8601); человеку его показывает `labels.memoryMergeDate(new Date(finishedAt))`.
   * `revertible: false` — записи с тех пор менялись, вернуть нельзя: кнопки нет, вместо неё `memoryMergeNotRevertible`.
   * `revertible: true` и нет `onRevert` — идёт другое действие: кнопку «Вернуть как было» показать неактивной.
   */
  MemoryMerge: ComponentType<{
    finishedAt: string;
    groups: MemoryMergeGroupView[];
    revertible: boolean;
    onRevert?: () => void;
  }>;
  /** Подтверждение: удалить можно только через `onConfirm`. `error` — почему не вышло (окно остаётся, можно повторить). */
  MemoryConfirm: ComponentType<{
    target: MemoryConfirmTarget;
    pending: boolean;
    error?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>;
}
