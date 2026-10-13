import { createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { describe, expect, it, vi } from "vitest";
import { ImageGenerationError } from "../src/index";
import { saveGeneratedImage } from "../src/save-images";
import type { SaveGeneratedImageInput } from "../src/save-images";
import { gifBytes, jpegBytes, pngBytes, webpBytes } from "./support/image-bytes";

const URL_OF_PROVIDER = "https://im.runware.ai/image/abc.jpg";
const NOW = new Date("2026-10-03T10:00:00.000Z");

function setup(body: BodyInit | (() => Response), overrides: Partial<SaveGeneratedImageInput> = {}) {
  const storage = createMemoryAttachmentStorage();
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (typeof body === "function" ? body() : new Response(body)));
  const input: SaveGeneratedImageInput = {
    url: URL_OF_PROVIDER,
    fetch,
    storage,
    chatId: "chat-1",
    ownerId: "anna",
    number: 2,
    maxImageBytes: 10 * 1024 * 1024,
    now: () => NOW,
    ...overrides,
  };
  return { storage, fetch, input };
}

async function failureOf(promise: Promise<unknown>): Promise<ImageGenerationError> {
  const error = await promise.then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(ImageGenerationError);
  return error as ImageGenerationError;
}

describe("сохранение созданной картинки (T042, FR-038)", () => {
  it("скачивает по адресу провайдера без заголовков и сохраняет как прикреплённый файл чата и владельца", async () => {
    const { storage, fetch, input } = setup(pngBytes());
    const saved = await saveGeneratedImage(input);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe(URL_OF_PROVIDER);
    expect(init?.headers).toBeUndefined();
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await storage.get(saved.id)).toEqual({
      id: saved.id,
      chatId: "chat-1",
      ownerId: "anna",
      name: "image-2.png",
      mediaType: "image/png",
      kind: "image",
      size: pngBytes().length,
      createdAt: NOW.toISOString(),
      attached: true,
    });
    expect(await storage.readBytes(saved.id)).toEqual(pngBytes());
    // Прикреплённые файлы не считаются неотправленными: лимиты загрузок человека картинки агента не занимают.
    expect(await storage.unattachedTotals("anna")).toEqual({ files: 0, bytes: 0 });
  });

  it.each([
    ["JPEG", jpegBytes(), "image/jpeg", "image-2.jpg"],
    ["WebP", webpBytes(), "image/webp", "image-2.webp"],
  ])("тип по содержимому: %s", async (_kind, bytes, mediaType, name) => {
    const { storage, input } = setup(new Blob([bytes as BlobPart], { type: "text/html" }));
    const saved = await saveGeneratedImage(input);
    expect(await storage.get(saved.id)).toMatchObject({ mediaType, name });
  });

  it.each([
    ["GIF", gifBytes()],
    ["SVG", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ["HTML", new TextEncoder().encode("<html><body>oops</body></html>")],
  ])("не PNG, JPEG или WebP (%s) — сбой, файл не сохранён", async (_kind, bytes) => {
    const { storage, input } = setup(new Blob([bytes as BlobPart], { type: "image/png" }));
    const error = await failureOf(saveGeneratedImage(input));
    expect(error.reason).toMatch(/не картинк/i);
    expect(await storage.removeAllOfChat("chat-1")).toBe(0);
  });

  it("больше предела по заголовку длины — сбой без чтения тела", async () => {
    const { storage, input } = setup(() => new Response(pngBytes(), { headers: { "content-length": String(11 * 1024 * 1024) } }));
    const error = await failureOf(saveGeneratedImage(input));
    expect(error.reason).toMatch(/больше 10 МБ/);
    expect(await storage.removeAllOfChat("chat-1")).toBe(0);
  });

  it("больше предела без заголовка длины — чтение обрывается на пределе, файл не сохранён", async () => {
    const big = new Uint8Array(4096);
    big.set(pngBytes());
    const { storage, input } = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(big);
              controller.enqueue(big);
              controller.close();
            },
          }),
        ),
      { maxImageBytes: 5000 },
    );
    const error = await failureOf(saveGeneratedImage(input));
    expect(error.reason).toMatch(/больше/);
    expect(await storage.removeAllOfChat("chat-1")).toBe(0);
  });

  it("адрес отвечает ошибкой или не http(s) — сбой «не скачалась»", async () => {
    const { input } = setup(() => new Response("nope", { status: 404 }));
    expect((await failureOf(saveGeneratedImage(input))).reason).toMatch(/не скачалась/);
    const local = setup(pngBytes(), { url: "file:///etc/passwd" });
    expect((await failureOf(saveGeneratedImage(local.input))).reason).toMatch(/не скачалась/);
    expect(local.fetch).not.toHaveBeenCalled();
  });

  it("картинка, пришедшая после «Стопа», не сохраняется (FR-042)", async () => {
    const stop = new AbortController();
    let push!: () => void;
    const { storage, input } = setup(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              push = () => {
                controller.enqueue(pngBytes());
                controller.close();
              };
            },
          }),
        ),
      { abortSignal: stop.signal },
    );
    const pending = saveGeneratedImage(input);
    await vi.waitFor(() => expect(push).toBeTypeOf("function"));
    stop.abort();
    push();
    await expect(pending).rejects.not.toBeInstanceOf(ImageGenerationError);
    expect(await storage.removeAllOfChat("chat-1")).toBe(0);
  });

  it("только https: и не внутренние адреса — иначе сбой без запроса", async () => {
    const refused = [
      "http://im.runware.ai/image/abc.jpg",
      "https://localhost/a.png",
      "https://images.localhost/a.png",
      "https://127.0.0.1/a.png",
      "https://10.0.0.5/a.png",
      "https://172.16.3.4/a.png",
      "https://192.168.1.1/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.1/a.png",
      "https://0.0.0.0/a.png",
      "https://2130706433/a.png",
      "https://[::1]/a.png",
      "https://[::ffff:127.0.0.1]/a.png",
      "https://[fd00::1]/a.png",
      "https://[fe80::1]/a.png",
      "https://[::]/a.png",
    ];
    for (const url of refused) {
      const { fetch, input } = setup(pngBytes(), { url });
      expect((await failureOf(saveGeneratedImage(input))).reason, url).toMatch(/не скачалась/);
      expect(fetch, url).not.toHaveBeenCalled();
    }
  });

  it("переадресация не идёт сама: каждый адрес проверяется, наружу — не дальше трёх шагов", async () => {
    const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
    const followed = setup(pngBytes());
    followed.fetch.mockResolvedValueOnce(redirect("https://cdn.runware.ai/abc.png"));
    expect((await saveGeneratedImage(followed.input)).mediaType).toBe("image/png");
    expect(followed.fetch.mock.calls.map(([url, init]) => [String(url), init?.redirect])).toEqual([
      [URL_OF_PROVIDER, "manual"],
      ["https://cdn.runware.ai/abc.png", "manual"],
    ]);

    for (const location of ["https://169.254.169.254/latest/meta-data", "http://cdn.runware.ai/abc.png", "/internal"]) {
      const { fetch, input } = setup(pngBytes(), { url: "https://im.runware.ai/a.png" });
      fetch.mockResolvedValueOnce(redirect(location === "/internal" ? "https://127.0.0.1/internal" : location));
      expect((await failureOf(saveGeneratedImage(input))).reason, location).toMatch(/не скачалась/);
      expect(fetch, location).toHaveBeenCalledTimes(1);
    }

    const endless = setup(() => redirect("https://cdn.runware.ai/next.png"));
    expect((await failureOf(saveGeneratedImage(endless.input))).reason).toMatch(/не скачалась/);
    expect(endless.fetch).toHaveBeenCalledTimes(4);
  });

  it("адрес того же сайта, что подключение провайдера из настройки (прокси, поддельный провайдер), разрешён и по http", async () => {
    const { fetch, input } = setup(pngBytes(), { url: "http://localhost:5173/api/demo/runware/images/a.png", trustedOrigin: "http://localhost:5173" });
    expect((await saveGeneratedImage(input)).mediaType).toBe("image/png");
    expect(fetch).toHaveBeenCalledTimes(1);
    const other = setup(pngBytes(), { url: "http://localhost:9999/a.png", trustedOrigin: "http://localhost:5173" });
    await failureOf(saveGeneratedImage(other.input));
    expect(other.fetch).not.toHaveBeenCalled();
  });
});
