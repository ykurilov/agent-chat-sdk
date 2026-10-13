/**
 * Сбой одной задачи картинки. `reason` — короткий текст для модели (без ключа и заголовков), `refusedBeforeWork` —
 * провайдер отказал до работы (неверный ключ, нет денег, неверные параметры): расхода нет.
 */
export class ImageGenerationError extends Error {
  readonly reason: string;
  readonly refusedBeforeWork: boolean;

  constructor(reason: string, options: { refusedBeforeWork: boolean }) {
    super(reason);
    this.name = "ImageGenerationError";
    this.reason = reason;
    this.refusedBeforeWork = options.refusedBeforeWork;
  }
}
