export type ImageLibraryErrorKind = "not_in_catalog" | "catalog_unavailable";

/**
 * Отказ `show_image` и `find_images`. Брошенная ошибка — неудача вызова: лента показывает её текст в строке инструмента, модель получает
 * тот же текст. Поэтому в нём нет адресов и текста исключений приложения.
 */
export class ImageLibraryError extends Error {
  readonly kind: ImageLibraryErrorKind;

  constructor(kind: ImageLibraryErrorKind, message: string) {
    super(message);
    this.name = "ImageLibraryError";
    this.kind = kind;
  }
}
