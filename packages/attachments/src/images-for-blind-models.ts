/** Картинка для плашки: только неизменные поля записи вложения, поэтому плашка одна и та же на каждом ходе. */
export interface BlindImageMarkerInput {
  /** Номер вложения (UUID): по нему инструмент приложения читает картинку (`attachments.readChatImage`). */
  id: string;
  /** Имя файла, очищенное от кавычек, скобок и управляющих символов. */
  name: string;
  mediaType: string;
  /** Кто загрузил картинку (`userId` загрузки). */
  authorId: string;
}

/**
 * Модель без зрения смотрит картинки инструментом приложения: вместо картинки в сообщении — постоянная плашка
 * с номером вложения.
 */
export interface ImagesForBlindModels {
  /** Имя инструмента приложения, который смотрит картинку по номеру вложения: оно в плашке и в инструкции. */
  toolName: string;
  /**
   * Свой текст плашки. Должен зависеть только от входа (без дат и счётчиков): плашка — часть истории, и другой текст
   * на следующем ходе сбивает кэш модели. По умолчанию `[Картинка «shot.png», вложение <id>. Посмотреть: <toolName>.]`.
   */
  marker?: (image: BlindImageMarkerInput) => string;
  /** Плашка и моделям со зрением: картинка не уходит главной модели никогда. По умолчанию — только моделям без зрения. */
  always?: boolean;
}

export interface ResolvedImagesForBlindModels {
  marker: (image: BlindImageMarkerInput) => string;
  always: boolean;
  instructions: string;
}

export function resolveImagesForBlindModels(options: ImagesForBlindModels): ResolvedImagesForBlindModels {
  const toolName = options.toolName.trim();
  if (!toolName) throw new TypeError("imagesForBlindModels.toolName: нужно имя инструмента, который смотрит картинку");
  const custom = options.marker;
  return {
    marker: custom ? (image) => String(custom(image)) : (image) => `[Картинка «${image.name}», вложение ${image.id}. Посмотреть: ${toolName}.]`,
    always: options.always === true,
    instructions: `Картинку, которую ты не видишь, заменяет плашка с номером вложения: чтобы посмотреть картинку, вызови инструмент ${toolName} с этим номером.`,
  };
}
