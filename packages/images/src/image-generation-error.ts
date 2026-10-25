import type { ImageFailureKind } from "./image-failure";

/**
 * Сбой одной задачи картинки. `reason` — короткий текст для модели (без ключа и заголовков), `refusedBeforeWork` —
 * провайдер отказал до работы (неверный ключ, нет денег, неверные параметры): расхода нет.
 */
export class ImageGenerationError extends Error {
  readonly reason: string;
  readonly refusedBeforeWork: boolean;

  readonly kind: ImageFailureKind;
  readonly providerCode?: string;

  constructor(reason: string, options: { refusedBeforeWork: boolean; kind?: ImageFailureKind; providerCode?: string }) {
    super(reason);
    this.name = "ImageGenerationError";
    this.reason = reason;
    this.refusedBeforeWork = options.refusedBeforeWork;
    this.kind = options.kind ?? "unknown";
    this.providerCode = options.providerCode;
  }
}
