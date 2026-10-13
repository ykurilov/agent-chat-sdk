/** Ошибки загрузки: те же виды, что отдаёт сервер вложений, плюс `other` — сеть и всё непонятное. */
export type AttachmentErrorKind = "unsupported_type" | "too_large" | "empty" | "no_text" | "unreadable" | "too_many_unsent" | "busy" | "expired" | "other";

/** Надписи вложений. Свой словарь передаётся в `createAttachmentsClient`. */
export interface AttachmentsLabels {
  /** Подпись группы вложений у сообщения для экранного диктора. */
  messageAttachments: string;
  unnamedFile: string;
  modelBlind: string;
  tooMuchText: string;
  /** Сервер не принял сообщение с файлами, файлы вернулись в поле. */
  sendRejected: string;
  tooManyFiles: (maxFiles: number) => string;
  fileTooLarge: (name: string, maxBytes: number) => string;
  fileProblem: (name: string, reason: string) => string;
  errors: Record<AttachmentErrorKind, string>;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

/** Размер файла по-английски: «512 B», «12 KB», «3 MB». */
function englishFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const russianAttachmentsLabels: AttachmentsLabels = {
  messageAttachments: "Вложения",
  unnamedFile: "Файл",
  modelBlind: "Эта модель не видит картинки: она получит только подпись. Выберите другую модель, чтобы она разглядела картинку.",
  tooMuchText: "В файлах слишком много текста для одного сообщения. Уберите часть файлов.",
  sendRejected: "Сообщение не отправлено: сервер не принял файлы. Проверьте их и отправьте ещё раз.",
  tooManyFiles: (maxFiles) => `К одному сообщению можно приложить не больше ${maxFiles} файлов.`,
  fileTooLarge: (name, maxBytes) => `Файл «${name}» больше ${formatFileSize(maxBytes)}, такой не примем.`,
  fileProblem: (name, reason) => `Файл «${name}»: ${reason}`,
  errors: {
    unsupported_type: "такой тип файла не поддерживается. Подойдут картинки, PDF и текстовые файлы.",
    too_large: "файл слишком большой.",
    empty: "файл пустой.",
    no_text: "в файле нет текста, который можно прочитать (возможно, это скан).",
    unreadable: "не получилось прочитать файл: он повреждён или защищён.",
    too_many_unsent: "слишком много неотправленных файлов. Отправьте сообщение или уберите лишние.",
    busy: "сервер занят загрузками. Подождите немного и попробуйте ещё раз.",
    expired: "файл хранился слишком долго и удалён с сервера. Загрузите его снова.",
    other: "не удалось загрузить. Проверьте связь и попробуйте ещё раз.",
  },
};

/** Английские надписи вложений: `createAttachmentsClient(englishAttachmentsLabels)`. */
export const englishAttachmentsLabels: AttachmentsLabels = {
  messageAttachments: "Attachments",
  unnamedFile: "File",
  modelBlind: "This model can’t see images: it only gets the caption. Pick another model so it can look at the image.",
  tooMuchText: "The files have too much text for one message. Remove some of them.",
  sendRejected: "Message not sent: the server didn’t accept the files. Check them and send again.",
  tooManyFiles: (maxFiles) => `You can attach up to ${maxFiles} files to one message.`,
  fileTooLarge: (name, maxBytes) => `File “${name}” is larger than ${englishFileSize(maxBytes)}, so we can’t take it.`,
  fileProblem: (name, reason) => `File “${name}”: ${reason}`,
  errors: {
    unsupported_type: "this file type isn’t supported. Images, PDFs and text files work.",
    too_large: "the file is too large.",
    empty: "the file is empty.",
    no_text: "the file has no readable text (it may be a scan).",
    unreadable: "couldn’t read the file: it’s damaged or protected.",
    too_many_unsent: "too many unsent files. Send the message or remove some.",
    busy: "the server is busy with uploads. Wait a little and try again.",
    expired: "the file was kept too long and removed from the server. Upload it again.",
    other: "couldn’t upload. Check your connection and try again.",
  },
};
