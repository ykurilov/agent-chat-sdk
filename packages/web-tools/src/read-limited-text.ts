import { serviceFailure } from "./web-tool-error";

/** Самый большой ответ веб-службы, который читается: страница и поиск в разы меньше, больше — сбой службы. */
export const MAX_SERVICE_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Текст ответа службы с потолком: превышение отменяет чтение и даёт `bad_response`, остаток тела не читается. */
export async function readLimitedText(response: Response, maxBytes = MAX_SERVICE_RESPONSE_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw serviceFailure("bad_response");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}
