import { availableParallelism } from "node:os";

/** Лимиты вложений. Все настраиваются в `createAttachments({ limits })`. */
export interface AttachmentLimits {
  /** Файлов в одном сообщении. */
  maxFiles: number;
  /** Размер одного файла в байтах. */
  maxFileBytes: number;
  /** Токенов извлечённого текста одного файла; лишнее обрезается с пометкой. */
  maxFileTextTokens: number;
  /** Токенов извлечённого текста во всех файлах одного сообщения; больше — сообщение не принимается. */
  maxMessageTextTokens: number;
  /** Неотправленных файлов на человека (во всех его чатах). Больше — новая загрузка отклоняется. */
  maxUnsentFiles: number;
  /** Общий размер неотправленных файлов на человека, байт. */
  maxUnsentBytes: number;
  /** Одновременных загрузок на весь сервер: их разбор занимает память и время. */
  maxParallelUploads: number;
  /** Одновременных загрузок одного человека. */
  maxParallelUploadsPerUser: number;
  /**
   * Память сервера под уменьшенные копии старых картинок (загруженных до уменьшения при загрузке), байт: копия
   * готовится один раз, а не на каждом шаге хода. Сверх предела уходят давно не нужные. `0` — копии не хранятся.
   */
  imageCacheBytes: number;
  /** Одновременных ужатий картинок при загрузке; остальные ждут очереди. По умолчанию — половина ядер, не меньше одного. */
  maxParallelImageFits: number;
}

export const defaultAttachmentLimits: AttachmentLimits = {
  maxFiles: 10,
  maxFileBytes: 20 * 1024 * 1024,
  maxFileTextTokens: 25_000,
  maxMessageTextTokens: 100_000,
  maxUnsentFiles: 30,
  maxUnsentBytes: 200 * 1024 * 1024,
  maxParallelUploads: 8,
  maxParallelUploadsPerUser: 3,
  imageCacheBytes: 128 * 1024 * 1024,
  maxParallelImageFits: Math.max(1, Math.floor(availableParallelism() / 2)),
};

export function resolveAttachmentLimits(limits: Partial<AttachmentLimits> | undefined): AttachmentLimits {
  return { ...defaultAttachmentLimits, ...limits };
}
