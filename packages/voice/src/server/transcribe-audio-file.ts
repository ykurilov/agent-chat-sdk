import { createSonioxSession } from "./soniox-session";
import type { SonioxSessionOptions } from "./soniox-session";

/** Размер куска звука: столько уходит в Soniox одним сообщением. */
const DEFAULT_CHUNK_BYTES = 32 * 1024;

export interface TranscribeAudioFileOptions extends SonioxSessionOptions {
  /** Файл целиком: голосовое из мессенджера, запись звонка. Формат Soniox определит сам. */
  bytes: Uint8Array;
  chunkBytes?: number | undefined;
}

/**
 * Распознаёт готовый звуковой файл через живой поток Soniox: файл уходит кусками сразу, без пауз реального времени,
 * затем «звука больше не будет». Возвращает итоговый текст; ошибка Soniox, обрыв или нет ответа — отказ.
 */
export function transcribeAudioFile(options: TranscribeAudioFileOptions): Promise<string> {
  const { bytes, chunkBytes = DEFAULT_CHUNK_BYTES, ...sessionOptions } = options;
  if (bytes.byteLength === 0) return Promise.reject(new Error("Распознавание файла: файл пуст"));

  return new Promise<string>((resolve, reject) => {
    const hideKey = (text: string) => (sessionOptions.apiKey ? text.replaceAll(sessionOptions.apiKey, "***") : text);
    const session = createSonioxSession(sessionOptions, {
      onReady() {
        for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) session.sendAudio(bytes.subarray(offset, offset + chunkBytes));
        session.endAudio();
      },
      onMessage(_raw, event) {
        if (event.type !== "error") return;
        session.close();
        reject(new Error(hideKey(`Распознавание файла: Soniox ответил ошибкой ${event.code}: ${event.message}`)));
      },
      onClosed(reason) {
        if (reason === "finished") resolve(session.text().finalText);
        else reject(new Error(`Распознавание файла не удалось: ${reason}`));
      },
    });
    session.begin({ audio_format: "auto" });
  });
}
