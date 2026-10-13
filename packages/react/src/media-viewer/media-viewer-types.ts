/**
 * Один элемент окна просмотра (договор скина, версия 13). `key` — id вложения или `<messageId>:<номер блока>` у схемы:
 * по нему слой поведения возвращает фокус на элемент-источник.
 */
export type MediaViewerItem =
  | { kind: "image"; key: string; src: string; alt: string; width?: number; height?: number }
  | { kind: "diagram"; key: string; svg: string; source: string };
