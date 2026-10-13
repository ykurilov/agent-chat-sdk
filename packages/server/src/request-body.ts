/** Больше этого тело JSON не читается: самое длинное сообщение (100 000 знаков) с местом на экране занимает меньше 0,5 МиБ. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Тело запроса длиннее предела: оно не дочитано и не разобрано, ответ — 413. */
export class RequestBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Тело запроса больше ${maxBytes} байт`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * JSON тела не длиннее `maxBytes`: заявленная длина больше — тело не читается, поток длиннее — чтение обрывается;
 * тогда `RequestBodyTooLargeError`. Нет тела или не JSON — `null`.
 */
export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }
      chunks.push(read.value);
    }
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) throw error;
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
