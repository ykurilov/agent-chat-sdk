export type VideoLibraryErrorKind = "not_in_catalog" | "catalog_unavailable" | "start_after_end";

/**
 * Отказ `show_video` и `find_videos`. Брошенная ошибка — неудача вызова: лента показывает её текст в строке инструмента, модель получает
 * тот же текст. Поэтому в нём нет ссылок и текста исключений приложения.
 */
export class VideoLibraryError extends Error {
  readonly kind: VideoLibraryErrorKind;

  constructor(kind: VideoLibraryErrorKind, message: string) {
    super(message);
    this.name = "VideoLibraryError";
    this.kind = kind;
  }
}
