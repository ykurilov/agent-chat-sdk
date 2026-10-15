import { describe, expect, it } from "vitest";
import { DownloadTooLargeError, downloadedFile } from "../src/messenger-files";

/**
 * «Бесконечный» поток по `chunk` байт: считает, сколько кусков у него забрали. Потолок 1000 кусков: если предел
 * сломается, тест упадёт на `pulled`, а не съест всю память (07.10 такой поток без потолка раздул процесс тестов до 19 ГБ).
 */
function endless(chunk: number) {
  const state = { pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= 1000) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
  return { stream, state };
}

describe("скачанный файл", () => {
  it("читается целиком, тип — из заголовка без параметров", async () => {
    const file = await downloadedFile(new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg; codecs=opus" } }), 10);
    expect(file).toEqual({ bytes: new Uint8Array([1, 2, 3]), mediaType: "audio/ogg" });
  });

  it("файл больше предела без заявленной длины: чтение обрывается на пределе, а не после всего ответа", async () => {
    const { stream, state } = endless(1000);
    await expect(downloadedFile(new Response(stream), 10_000)).rejects.toBeInstanceOf(DownloadTooLargeError);
    expect(state.pulled).toBeLessThanOrEqual(12);
  });

  it("заявленная длина больше предела — тело не читается вовсе", async () => {
    const { stream, state } = endless(1000);
    const response = new Response(stream, { headers: { "content-length": "50000" } });
    await expect(downloadedFile(response, 10_000)).rejects.toBeInstanceOf(DownloadTooLargeError);
    expect(state.pulled).toBeLessThanOrEqual(1);
  });
});
