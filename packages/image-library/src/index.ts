// Библиотека готовых картинок агента: инструменты `find_images` и `show_image` поверх каталога приложения.
export { createImageLibrary } from "./create-image-library";
export type { CreateImageLibraryOptions, ImageContext, ImageLibrary, ImageLibraryModel, ImageSource, ShownImage } from "./create-image-library";
export { checkImageCatalog, checkImageEntry, searchImages } from "./image-catalog";
export type { ImageEntry } from "./image-catalog";
export { ImageLibraryError } from "./image-library-error";
export type { ImageLibraryErrorKind } from "./image-library-error";
export { isImageAddress } from "./image-address";
