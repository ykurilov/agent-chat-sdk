import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentsController } from "./attachments-contract";

/**
 * Файлы ещё грузятся, и ни один не упал: нажатие «Отправить» стоит запомнить. С упавшим файлом ждать нечего —
 * отправка недоступна, как и раньше.
 */
export function uploadsInProgress(attachments: AttachmentsController | undefined): boolean {
  if (!attachments?.hasFiles || attachments.ready) return false;
  const items = attachments.composer.items;
  return items.some((item) => item.status === "uploading") && !items.some((item) => item.status === "error");
}

export interface SendAfterUpload {
  /** Нажатие запомнено: сообщение уйдёт, когда файлы загрузятся. */
  pending: boolean;
  /** Ожидание кончилось упавшей загрузкой: у поля сказать, что сообщение не отправлено. */
  failed: boolean;
  /** Запомнить нажатие. Повторное ничего не меняет. */
  hold: () => void;
  /** Человек передумал: ожидание снять, ничего не отправлять. */
  cancel: () => void;
}

/**
 * «Отправить», нажатое во время загрузки файлов: нажатие помнится и само уходит, когда загрузка закончилась успешно,
 * с тем, что в поле на этот момент. Упала — ничего не уходит, `failed` до следующей загрузки или отправки.
 * Отправка стала невозможна (лимит, закрытый чат) или все файлы убраны — ожидание снимается молча, ничего не уходит.
 * Идёт ответ без поправок — ждёт и конца ответа.
 */
export function useSendAfterUpload({
  attachments,
  sendingBlocked,
  waitForAnswer,
  send,
}: {
  attachments: AttachmentsController | undefined;
  sendingBlocked: boolean;
  waitForAnswer: boolean;
  /** Отправить то, что сейчас в поле. Берётся последняя переданная. */
  send: () => void;
}): SendAfterUpload {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const latestSend = useRef(send);
  latestSend.current = send;
  const uploading = uploadsInProgress(attachments);
  const hasFiles = attachments?.hasFiles ?? false;
  const ready = attachments?.ready ?? true;

  useEffect(() => {
    if (!pending) return;
    if (sendingBlocked) return setPending(false);
    // Все файлы убраны — человек передумал отправлять их: ожидание снять, как «Не отправлять».
    if (!hasFiles) return setPending(false);
    if (uploading || waitForAnswer) return;
    setPending(false);
    if (!ready) return setFailed(true);
    latestSend.current();
  }, [pending, sendingBlocked, uploading, waitForAnswer, hasFiles, ready]);

  // Надпись об упавшей отправке живёт, пока в поле упавший файл: убрали его или загрузили новый — её нет.
  useEffect(() => {
    if (failed && (!hasFiles || ready || uploading)) setFailed(false);
  }, [failed, hasFiles, ready, uploading]);

  const hold = useCallback(() => {
    setFailed(false);
    setPending(true);
  }, []);
  const cancel = useCallback(() => setPending(false), []);
  return { pending, failed, hold, cancel };
}
