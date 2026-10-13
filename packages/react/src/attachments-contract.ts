import type { FileUIPart } from "ai";
import type { AgentChatMessage } from "./chat-types";

/** Файл в поле ввода до отправки. */
export interface ComposerAttachmentItem {
  id: string;
  name: string;
  kind: "image" | "file";
  /** Адрес для миниатюры картинки (локальный, пока файл не отправлен). */
  previewUrl?: string;
  status: "uploading" | "ready" | "error";
}

/** Вложения в поле ввода (договор скина, версия 5): скрепка, перетаскивание, вставка, превью с удалением. */
export interface ComposerAttachments {
  items: ComposerAttachmentItem[];
  /** Выбранные, перетащенные или вставленные файлы. */
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** Значение для `accept` поля выбора файла. */
  accept: string;
  /** Что сказать человеку до отправки, готовой надписью: отказ по файлу, лимит, «модель не видит картинки». */
  notice?: string;
}

/** Вложение в ленте у сообщения человека. */
export interface MessageAttachmentItem {
  id: string;
  /**
   * Адрес части `file` сообщения, из которой этот элемент (`attachment:…`). По нему файл в ответе агента встаёт на место
   * своей части. Нет — в ответе агента элемент не узнаётся, часть показывается ссылкой без адреса.
   */
  partUrl?: string;
  name: string;
  kind: "image" | "file";
  /** Адрес файла на сервере: миниатюра картинки или ссылка на скачивание. */
  url: string;
  mediaType: string;
  /** Подпись, если нужна (например, «PDF»). */
  caption?: string;
  /**
   * Открыть картинку в окне просмотра (версия 13). Есть только у картинки, когда у скина есть `MediaViewer`:
   * миниатюру сделать кнопкой с подписью `labels.images.open`. Нет — миниатюра как раньше.
   */
  onOpen?: (trigger: HTMLElement) => void;
}

/** Вложения сообщения для ленты (договор скина, версия 5). */
export interface MessageAttachmentsView {
  /** Подпись группы для экранного диктора. */
  label: string;
  items: MessageAttachmentItem[];
}

/** Состояние вложений в открытом чате: его ведёт плагин, слой поведения только связывает с полем ввода и лентой. */
export interface AttachmentsController {
  composer: ComposerAttachments;
  /** Все файлы загружены без ошибок и вложений не больше допустимого: можно отправлять. */
  ready: boolean;
  /** В поле ввода есть хотя бы один файл. */
  hasFiles: boolean;
  /** Готовые файлы для отправки; поле не трогает. */
  readFiles: () => FileUIPart[];
  /**
   * Файлы ушли с сообщением: поле очищается, но файлы помнятся, пока их можно вернуть (`restoreFiles`).
   * Следующая отправка забывает прежние.
   */
  markSent: () => void;
  /**
   * Сервер не принял сообщение: помнящиеся файлы возвращаются в поле. `kind` — причина от сервера; если файл
   * устарел и удалён, он возвращается с пометкой «загрузите снова».
   */
  restoreFiles: (kind: string | undefined) => void;
  /** Вложения сообщения для ленты; `undefined` — у сообщения нет файлов. Функция стабильна, пока чат тот же. */
  describe: (message: AgentChatMessage) => MessageAttachmentsView | undefined;
}

/** Расширение вложений для `AgentChat` (пакет `@ykurilov/agent-chat-attachments/react`). */
export interface AttachmentsPlugin {
  /** Хук: вызывается один раз за отрисовку, всегда в одном и том же порядке. */
  useController: (input: {
    api: string;
    chatId: string;
    /** Видит ли выбранная модель картинки; `undefined` — пока неизвестно. */
    modelSeesImages: boolean | undefined;
    fetch?: typeof globalThis.fetch;
  }) => AttachmentsController;
}
