/** Больше этого тело JSON (вебхук, запрос привязки) не читается: обновление мессенджера — единицы килобайт. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Тело длиннее предела: оно не дочитано. */
export class BodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`тело больше ${maxBytes} байт`);
    this.name = "BodyTooLargeError";
  }
}

/**
 * Тело запроса или ответа не длиннее `maxBytes`: заявленная длина больше — тело не читается, поток длиннее —
 * чтение обрывается на пределе. Тогда `BodyTooLargeError` (или ошибка из `tooLarge`).
 */
export async function readAtMost(source: Request | Response, maxBytes: number, tooLarge: () => Error = () => new BodyTooLargeError(maxBytes)): Promise<Uint8Array> {
  if (Number(source.headers.get("content-length")) > maxBytes) {
    void source.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!source.body) return new Uint8Array(0);
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > maxBytes) {
      void reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(read.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** JSON тела запроса: тело длиннее `MAX_JSON_BODY_BYTES` — `too_large`, не JSON — `bad`. */
export async function readJsonBody(request: Request): Promise<{ json: unknown } | { error: "too_large" | "bad" }> {
  let bytes: Uint8Array;
  try {
    bytes = await readAtMost(request, MAX_JSON_BODY_BYTES);
  } catch (error) {
    return { error: error instanceof BodyTooLargeError ? "too_large" : "bad" };
  }
  try {
    return { json: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { error: "bad" };
  }
}
