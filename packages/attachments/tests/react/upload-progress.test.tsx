// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { russianAttachmentsLabels } from "../../src/react/labels";
import { isBrowserOwnFetch } from "../../src/react/upload-file";
import { useAttachmentsController } from "../../src/react/use-attachments-controller";

/*
 * Прогресс загрузки. У `fetch` нет прогресса отправки, поэтому без своего транспорта приложения файл уходит через
 * XMLHttpRequest: его `upload.onprogress` сообщает, сколько отправлено. Транспорт приложения (`fetch` в настройках) —
 * как раньше, без прогресса.
 */

const settings = { maxFiles: 5, maxFileBytes: 10_000, maxMessageTextTokens: 100, accept: "image/png,.txt" };

/** Поддельный XMLHttpRequest: тест сам двигает отправку, отвечает, рвёт сеть. */
class FakeXhr {
  static sent: FakeXhr[] = [];
  method = "";
  url = "";
  body: unknown;
  status = 0;
  responseText = "";
  aborted = false;
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader() {}
  send(body: unknown) {
    this.body = body;
    FakeXhr.sent.push(this);
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  get fileName() {
    return ((this.body as FormData).get("file") as File).name;
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  respond(status: number, payload: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(payload);
    this.onload?.();
  }
  done(id: string) {
    this.respond(201, { id, name: this.fileName, mediaType: "text/plain", kind: "text", size: 3, textTokens: 1 });
  }
}

const pageFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/attachments/settings")) return Response.json(settings);
  if ((init?.method ?? "GET") === "DELETE") return new Response(null, { status: 204 });
  throw new Error(`страница не должна слать ${init?.method ?? "GET"} ${url} через fetch`);
});

/**
 * Двойник родного `fetch` браузера: как у настоящего, имя `fetch` и тело `[native code]` (связанная функция). Подменённый
 * приложением `fetch` — обычная функция: у неё виден исходный код.
 */
function browserOwnFetch(handler: typeof globalThis.fetch): typeof globalThis.fetch {
  const own = handler.bind(null);
  Object.defineProperty(own, "name", { value: "fetch" });
  return own;
}

beforeEach(() => {
  FakeXhr.sent = [];
  pageFetch.mockClear();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  vi.stubGlobal("fetch", browserOwnFetch(pageFetch as unknown as typeof globalThis.fetch));
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const txt = (name: string) => new File(["абв"], name, { type: "text/plain" });

function setup(fetch?: typeof globalThis.fetch) {
  return renderHook(() =>
    useAttachmentsController({ api: "/api/chat", chatId: "c1", modelSeesImages: true, busyRetryDelayMs: 1, ...(fetch && { fetch }) }, russianAttachmentsLabels),
  );
}
const add = (result: { current: ReturnType<typeof useAttachmentsController> }, ...files: File[]) =>
  act(async () => result.current.composer.onAddFiles(files));
const item = (result: { current: ReturnType<typeof useAttachmentsController> }, index = 0) => result.current.composer.items[index]!;

describe("прогресс загрузки файла", () => {
  it("без своего транспорта файл уходит через XMLHttpRequest: доля отправленного растёт до конца, готовый файл — без прогресса", async () => {
    const { result } = setup();
    await add(result, txt("a.txt"));
    expect(FakeXhr.sent).toHaveLength(1);
    const xhr = FakeXhr.sent[0]!;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/chat/c1/attachments");
    expect(xhr.fileName).toBe("a.txt");
    // Загрузка началась: прогресс известен сразу — так видно, какие файлы уже идут, а какие ждут очереди.
    expect(item(result)).toMatchObject({ status: "uploading", progress: 0 });

    act(() => xhr.progress(250, 1000));
    expect(item(result).progress).toBe(0.25);
    act(() => xhr.progress(1000, 1000));
    expect(item(result).progress).toBe(1);

    act(() => xhr.done("id-1"));
    await waitFor(() => expect(item(result).status).toBe("ready"));
    expect(item(result)).not.toHaveProperty("progress");
    expect(result.current.readFiles()).toEqual([{ type: "file", url: "attachment:id-1", mediaType: "text/plain", filename: "a.txt" }]);
  });

  it("частые события прогресса не перерисовывают поле чаще, чем меняется целый процент", async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useAttachmentsController({ api: "/api/chat", chatId: "c1", modelSeesImages: true }, russianAttachmentsLabels);
    });
    await add(result, txt("a.txt"));
    const before = renders;
    act(() => {
      for (let loaded = 0; loaded <= 1000; loaded++) FakeXhr.sent[0]!.progress(loaded, 100_000);
    });
    expect(item(result).progress).toBe(0.01);
    expect(renders - before).toBeLessThanOrEqual(2);
  });

  it("две загрузки идут одновременно, у обеих прогресс; файл в очереди — без прогресса, пока не начнётся", async () => {
    const { result } = setup();
    await add(result, txt("a.txt"), txt("b.txt"), txt("c.txt"));
    expect(FakeXhr.sent.map((xhr) => xhr.fileName)).toEqual(["a.txt", "b.txt"]);
    act(() => {
      FakeXhr.sent[0]!.progress(30, 100);
      FakeXhr.sent[1]!.progress(60, 100);
    });
    expect(result.current.composer.items.map((file) => file.progress)).toEqual([0.3, 0.6, undefined]);

    act(() => FakeXhr.sent[0]!.done("id-1"));
    await waitFor(() => expect(FakeXhr.sent.map((xhr) => xhr.fileName)).toEqual(["a.txt", "b.txt", "c.txt"]));
    expect(item(result, 2).progress).toBe(0);
  });

  it("сервер занят: повтор начинает прогресс заново, человек ошибки не видит", async () => {
    const { result } = setup();
    await add(result, txt("a.txt"));
    act(() => FakeXhr.sent[0]!.progress(100, 100));
    act(() => FakeXhr.sent[0]!.respond(429, { error: { kind: "busy" } }));
    await waitFor(() => expect(FakeXhr.sent).toHaveLength(2));
    expect(item(result)).toMatchObject({ status: "uploading", progress: 0 });
    act(() => FakeXhr.sent[1]!.done("id-1"));
    await waitFor(() => expect(item(result).status).toBe("ready"));
    expect(result.current.composer.notice).toBeUndefined();
  });

  it("отказ сервера и обрыв сети — файл с понятной ошибкой", async () => {
    const { result } = setup();
    await add(result, txt("a.txt"), txt("b.txt"));
    act(() => FakeXhr.sent[0]!.respond(413, { error: { kind: "too_large" } }));
    act(() => FakeXhr.sent[1]!.onerror?.());
    await waitFor(() => expect(result.current.composer.items.map((file) => file.status)).toEqual(["error", "error"]));
    expect(result.current.composer.items.every((file) => file.progress === undefined)).toBe(true);
    expect(result.current.composer.notice).toBe(russianAttachmentsLabels.fileProblem("a.txt", russianAttachmentsLabels.errors.too_large));
  });

  it("удаление файла во время загрузки обрывает отправку, ошибки нет, очередь идёт дальше", async () => {
    const { result } = setup();
    await add(result, txt("a.txt"), txt("b.txt"), txt("c.txt"));
    const first = FakeXhr.sent[0]!;
    act(() => result.current.composer.onRemove(item(result).id));
    expect(first.aborted).toBe(true);
    expect(result.current.composer.items.map((file) => file.name)).toEqual(["b.txt", "c.txt"]);
    await waitFor(() => expect(FakeXhr.sent.map((xhr) => xhr.fileName)).toEqual(["a.txt", "b.txt", "c.txt"]));
    expect(result.current.composer.notice).toBeUndefined();
  });

  it("транспорт приложения (`fetch` в настройках) остаётся главным: XMLHttpRequest не нужен, прогресса нет", async () => {
    const appFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/settings")
        ? Response.json(settings)
        : Response.json({ id: "id-1", name: "a.txt", mediaType: "text/plain", kind: "text", size: 3 }, { status: 201 }),
    );
    const { result } = setup(appFetch as unknown as typeof globalThis.fetch);
    await add(result, txt("a.txt"));
    expect(item(result)).not.toHaveProperty("progress");
    await waitFor(() => expect(item(result).status).toBe("ready"));
    expect(FakeXhr.sent).toHaveLength(0);
    expect(appFetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("приложение подменило глобальный fetch (токен, перехватчик, мок в тестах) — загрузка идёт через него, как раньше, без прогресса", async () => {
    const patched = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/settings")
        ? Response.json(settings)
        : Response.json({ id: "id-1", name: "a.txt", mediaType: "text/plain", kind: "text", size: 3 }, { status: 201 }),
    );
    vi.stubGlobal("fetch", patched);
    const { result } = setup();
    await add(result, txt("a.txt"));
    expect(item(result)).not.toHaveProperty("progress");
    await waitFor(() => expect(item(result).status).toBe("ready"));
    expect(FakeXhr.sent).toHaveLength(0);
    expect(patched.mock.calls.some(([url, init]) => String(url) === "/api/chat/c1/attachments" && init?.method === "POST")).toBe(true);
  });
});

describe("родной ли fetch браузера", () => {
  // Настоящий fetch Chrome проверяет браузерный тест apps/demo/e2e/upload-progress.spec.ts: прогресс там есть.
  it("родной — да; обёртка, мок, связанная копия — нет", () => {
    expect(isBrowserOwnFetch(browserOwnFetch(pageFetch as unknown as typeof globalThis.fetch))).toBe(true);
    const original = globalThis.fetch;
    expect(isBrowserOwnFetch(((input, init) => original(input, init)) as typeof globalThis.fetch)).toBe(false);
    expect(isBrowserOwnFetch(vi.fn() as unknown as typeof globalThis.fetch)).toBe(false);
    expect(isBrowserOwnFetch(original.bind(globalThis))).toBe(false);
    expect(isBrowserOwnFetch(undefined as unknown as typeof globalThis.fetch)).toBe(false);
  });
});
