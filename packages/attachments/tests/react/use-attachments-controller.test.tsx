// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AgentChatMessage } from "@ykurilov/agent-chat-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { russianAttachmentsLabels } from "../../src/react/labels";
import { useAttachmentsController } from "../../src/react/use-attachments-controller";

const settings = { maxFiles: 3, maxFileBytes: 1000, maxMessageTextTokens: 100, accept: "image/png,.pdf,.txt" };

interface Upload {
  name: string;
  release: (response: Response) => void;
}

/** Сервер вложений: настройки, загрузка (ответ отдаёт тест), удаление. */
function fakeServer(options: { hold?: boolean; textTokens?: number } = {}) {
  const uploads: Upload[] = [];
  const deleted: string[] = [];
  const calls: string[] = [];
  let counter = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url}`);
    if (url.endsWith("/attachments/settings")) return Response.json(settings);
    if (method === "DELETE") {
      deleted.push(url.split("/").pop()!);
      return new Response(null, { status: 204 });
    }
    const file = (init!.body as FormData).get("file") as File;
    const respond = (response?: Response) =>
      response ?? Response.json({ id: `id-${++counter}`, name: file.name, mediaType: file.type || "text/plain", kind: file.type.startsWith("image/") ? "image" : "text", size: file.size, textTokens: options.textTokens ?? 10 }, { status: 201 });
    if (!options.hold) return respond();
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      uploads.push({ name: file.name, release: (response) => resolve(respond(response)) });
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, uploads, deleted, calls };
}

const png = () => new File([new Uint8Array([1, 2, 3])], "кот.png", { type: "image/png" });
const txt = (name = "заметки.txt") => new File(["текст"], name, { type: "text/plain" });

let revoked: string[] = [];
beforeEach(() => {
  revoked = [];
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
});
afterEach(cleanup);

function setup(server = fakeServer(), input: { modelSeesImages?: boolean; chatId?: string } = {}) {
  const hook = renderHook(
    (props: { modelSeesImages: boolean | undefined; chatId: string }) =>
      useAttachmentsController({ api: "/api/chat", fetch: server.fetch, busyRetryDelayMs: 1, ...props }, russianAttachmentsLabels),
    { initialProps: { chatId: input.chatId ?? "c1", modelSeesImages: input.modelSeesImages as boolean | undefined } },
  );
  return { server, ...hook };
}

const add = (result: { current: ReturnType<typeof useAttachmentsController> }, ...files: File[]) =>
  act(async () => result.current.composer.onAddFiles(files));

describe("контроллер вложений", () => {
  it("настройки берутся один раз с сервера: список допустимых типов для поля выбора", async () => {
    const { result, server } = setup();
    await waitFor(() => expect(result.current.composer.accept).toBe(settings.accept));
    expect(server.calls.filter((call) => call.includes("settings"))).toEqual(["GET /api/chat/attachments/settings"]);
    expect(result.current.hasFiles).toBe(false);
    expect(result.current.ready).toBe(true);
  });

  it("файл грузится: сначала «грузится» с превью-картинкой, затем «готов»; отправка ждёт загрузки", async () => {
    const server = fakeServer({ hold: true });
    const { result } = setup(server);
    await add(result, png());
    expect(result.current.composer.items).toMatchObject([{ name: "кот.png", kind: "image", status: "uploading", previewUrl: "blob:preview" }]);
    expect(result.current.ready).toBe(false);
    expect(result.current.hasFiles).toBe(true);
    await act(async () => server.uploads[0]!.release(undefined as never));
    await waitFor(() => expect(result.current.composer.items[0]!.status).toBe("ready"));
    expect(result.current.ready).toBe(true);
    expect(server.calls).toContain("POST /api/chat/c1/attachments");
  });

  it("readFiles отдаёт готовые файлы ссылками attachment:<id>, не трогая поле; markSent очищает поле", async () => {
    const { result } = setup();
    await add(result, png(), txt());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const expected = [
      { type: "file", url: "attachment:id-1", mediaType: "image/png", filename: "кот.png" },
      { type: "file", url: "attachment:id-2", mediaType: "text/plain", filename: "заметки.txt" },
    ];
    expect(result.current.readFiles()).toEqual(expected);
    expect(result.current.readFiles()).toEqual(expected);
    expect(result.current.composer.items).toHaveLength(2);
    act(() => result.current.markSent());
    expect(result.current.composer.items).toEqual([]);
    expect(result.current.hasFiles).toBe(false);
  });

  it("restoreFiles возвращает отправленные файлы в поле такими, какими они были; превью не освобождаются, пока их можно вернуть", async () => {
    const { result } = setup();
    await add(result, png(), txt());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.markSent());
    expect(revoked).toEqual([]);
    act(() => result.current.restoreFiles("bad_request"));
    expect(result.current.composer.items).toMatchObject([
      { name: "кот.png", status: "ready", previewUrl: "blob:preview" },
      { name: "заметки.txt", status: "ready" },
    ]);
    expect(result.current.ready).toBe(true);
    expect(result.current.composer.notice).toBe(russianAttachmentsLabels.sendRejected);
    expect(result.current.readFiles()).toHaveLength(2);
  });

  it("файл хранился слишком долго и удалён с сервера: после возврата в поле он с ошибкой «загрузите снова», отправка ждёт, пока его уберут", async () => {
    const { result } = setup();
    await add(result, txt("старый.txt"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.markSent());
    act(() => result.current.restoreFiles("attachment_expired"));
    expect(result.current.composer.items).toMatchObject([{ name: "старый.txt", status: "error" }]);
    expect(result.current.composer.notice).toContain("старый.txt");
    expect(result.current.composer.notice).toContain(russianAttachmentsLabels.errors.expired);
    expect(result.current.ready).toBe(false);
    act(() => result.current.composer.onRemove(result.current.composer.items[0]!.id));
    expect(result.current.ready).toBe(true);
  });

  it("restoreFiles без отправленного ничего не делает; следующая отправка забывает прежнюю и освобождает её превью", async () => {
    const { result } = setup();
    act(() => result.current.restoreFiles("attachment_expired"));
    expect(result.current.composer.items).toEqual([]);
    await add(result, png());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.markSent());
    await add(result, png());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.markSent());
    expect(revoked).toEqual(["blob:preview"]);
  });

  it("отказ сервера: файл с ошибкой, понятное объяснение, отправка недоступна, пока файл не убран", async () => {
    const server = fakeServer();
    const original = server.fetch;
    const failing: typeof globalThis.fetch = async (input, init) =>
      (init?.method ?? "GET") === "POST" ? Response.json({ error: { kind: "unsupported_type" } }, { status: 415 }) : original(input, init);
    const { result } = setup({ ...server, fetch: failing });
    await add(result, txt("вирус.exe"));
    await waitFor(() => expect(result.current.composer.items[0]!.status).toBe("error"));
    expect(result.current.composer.notice).toContain("вирус.exe");
    expect(result.current.composer.notice).toContain(russianAttachmentsLabels.errors.unsupported_type);
    expect(result.current.ready).toBe(false);
    act(() => result.current.composer.onRemove(result.current.composer.items[0]!.id));
    expect(result.current.ready).toBe(true);
    expect(result.current.composer.notice).toBeUndefined();
  });

  it("сеть недоступна: понятная ошибка «не удалось загрузить», файл с ошибкой", async () => {
    const original = fakeServer();
    const offline: typeof globalThis.fetch = async (input, init) => {
      if ((init?.method ?? "GET") === "POST") throw new TypeError("Failed to fetch");
      return original.fetch(input, init);
    };
    const { result } = setup({ ...original, fetch: offline });
    await add(result, txt());
    await waitFor(() => expect(result.current.composer.items[0]!.status).toBe("error"));
    expect(result.current.composer.notice).toContain(russianAttachmentsLabels.errors.other);
  });

  it("файлы с ошибкой не занимают места в лимите: убирать их не нужно, чтобы добавить другие", async () => {
    const server = fakeServer();
    const original = server.fetch;
    const failing: typeof globalThis.fetch = async (input, init) => {
      const file = (init?.body as FormData | undefined)?.get?.("file") as File | undefined;
      return file?.name.endsWith(".exe") ? Response.json({ error: { kind: "unsupported_type" } }, { status: 415 }) : original(input, init);
    };
    const { result } = setup({ ...server, fetch: failing });
    await waitFor(() => expect(result.current.composer.accept).toBe(settings.accept));
    await add(result, txt("1.exe"), txt("2.exe"), txt("3.txt"));
    await waitFor(() => expect(result.current.composer.items.filter((item) => item.status === "error")).toHaveLength(2));
    await add(result, txt("4.txt"), txt("5.txt"));
    expect(result.current.composer.items.map((item) => item.name)).toEqual(["1.exe", "2.exe", "3.txt", "4.txt", "5.txt"]);
    await add(result, txt("6.txt"));
    expect(result.current.composer.items).toHaveLength(5);
    expect(result.current.composer.notice).toContain("1.exe");
  });

  it("сервер занят или у человека слишком много неотправленных — свои понятные объяснения", async () => {
    for (const [kind, label] of [
      ["too_many_unsent", russianAttachmentsLabels.errors.too_many_unsent],
      ["busy", russianAttachmentsLabels.errors.busy],
    ] as const) {
      const server = fakeServer();
      const original = server.fetch;
      const refusing: typeof globalThis.fetch = async (input, init) =>
        (init?.method ?? "GET") === "POST" ? Response.json({ error: { kind } }, { status: 429 }) : original(input, init);
      const { result } = setup({ ...server, fetch: refusing });
      await add(result, txt());
      await waitFor(() => expect(result.current.composer.items[0]!.status).toBe("error"));
      expect(result.current.composer.notice).toContain(label);
      cleanup();
    }
  });

  it("файлы грузятся по два одновременно, остальные ждут своей очереди", async () => {
    const server = fakeServer({ hold: true });
    const { result } = setup(server);
    await add(result, txt("a.txt"), txt("b.txt"), txt("c.txt"));
    expect(server.uploads.map((upload) => upload.name)).toEqual(["a.txt", "b.txt"]);
    await act(async () => server.uploads[0]!.release(undefined as never));
    await waitFor(() => expect(server.uploads.map((upload) => upload.name)).toEqual(["a.txt", "b.txt", "c.txt"]));
  });

  it("сервер занят: файл ждёт и загружается со следующей попытки, человек ошибки не видит", async () => {
    const server = fakeServer();
    const original = server.fetch;
    let refusals = 2;
    const busyFirst: typeof globalThis.fetch = async (input, init) =>
      (init?.method ?? "GET") === "POST" && refusals-- > 0 ? Response.json({ error: { kind: "busy" } }, { status: 429 }) : original(input, init);
    const { result } = setup({ ...server, fetch: busyFirst });
    await add(result, txt());
    await waitFor(() => expect(result.current.composer.items[0]!.status).toBe("ready"));
    expect(result.current.composer.notice).toBeUndefined();
  });

  it("лишние файлы сверх лимита не добавляются, человек видит почему", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.composer.accept).toBe(settings.accept));
    await add(result, txt("1.txt"), txt("2.txt"), txt("3.txt"), txt("4.txt"));
    expect(result.current.composer.items).toHaveLength(3);
    expect(result.current.composer.notice).toBe(russianAttachmentsLabels.tooManyFiles(3));
  });

  it("слишком большой файл не грузится", async () => {
    const { result, server } = setup();
    await waitFor(() => expect(result.current.composer.accept).toBe(settings.accept));
    await add(result, new File([new Uint8Array(2000)], "big.txt", { type: "text/plain" }));
    expect(result.current.composer.items).toEqual([]);
    expect(result.current.composer.notice).toBe(russianAttachmentsLabels.fileTooLarge("big.txt", 1000));
    expect(server.calls.some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("удаление готового файла убирает его с сервера и освобождает превью; идущая загрузка отменяется", async () => {
    const server = fakeServer();
    const { result } = setup(server);
    await add(result, png());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.composer.onRemove(result.current.composer.items[0]!.id));
    await waitFor(() => expect(server.deleted).toEqual(["id-1"]));
    expect(revoked).toEqual(["blob:preview"]);
    expect(result.current.composer.items).toEqual([]);

    const held = fakeServer({ hold: true });
    const second = setup(held);
    await add(second.result, txt());
    act(() => second.result.current.composer.onRemove(second.result.current.composer.items[0]!.id));
    expect(second.result.current.composer.items).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(held.deleted).toEqual([]);
  });

  it("модель не видит картинки — пометка до отправки; видит или это не картинка — пометки нет", async () => {
    const blind = setup(fakeServer(), { modelSeesImages: false });
    await add(blind.result, txt());
    await waitFor(() => expect(blind.result.current.ready).toBe(true));
    expect(blind.result.current.composer.notice).toBeUndefined();
    await add(blind.result, png());
    await waitFor(() => expect(blind.result.current.ready).toBe(true));
    expect(blind.result.current.composer.notice).toBe(russianAttachmentsLabels.modelBlind);
    blind.rerender({ chatId: "c1", modelSeesImages: true });
    expect(blind.result.current.composer.notice).toBeUndefined();
    blind.rerender({ chatId: "c1", modelSeesImages: undefined });
    expect(blind.result.current.composer.notice).toBeUndefined();
  });

  it("текста в файлах больше потолка на сообщение — пояснение, отправка недоступна, пока файл не убран", async () => {
    const { result } = setup(fakeServer({ textTokens: 60 }));
    await add(result, txt("1.txt"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await add(result, txt("2.txt"));
    await waitFor(() => expect(result.current.composer.items.every((item) => item.status === "ready")).toBe(true));
    expect(result.current.ready).toBe(false);
    expect(result.current.composer.notice).toBe(russianAttachmentsLabels.tooMuchText);
    act(() => result.current.composer.onRemove(result.current.composer.items[1]!.id));
    expect(result.current.ready).toBe(true);
    expect(result.current.composer.notice).toBeUndefined();
  });

  it("смена чата очищает поле", async () => {
    const { result, rerender } = setup();
    await add(result, txt());
    expect(result.current.hasFiles).toBe(true);
    rerender({ chatId: "c2", modelSeesImages: undefined });
    await waitFor(() => expect(result.current.hasFiles).toBe(false));
  });

  it("describe: вложения сообщения для ленты с адресами на сервере; сообщение без файлов — undefined", async () => {
    const { result } = setup();
    const message = {
      id: "u1",
      role: "user",
      parts: [
        { type: "file", url: "attachment:aaa", mediaType: "image/png", filename: "кот.png" },
        { type: "file", url: "attachment:bbb", mediaType: "application/pdf", filename: "счёт.pdf" },
        { type: "file", url: "https://example.com/x.png", mediaType: "image/png", filename: "чужой.png" },
        { type: "text", text: "Смотри" },
      ],
    } as AgentChatMessage;
    expect(result.current.describe(message)).toEqual({
      label: russianAttachmentsLabels.messageAttachments,
      items: [
        { id: "aaa", partUrl: "attachment:aaa", name: "кот.png", kind: "image", url: "/api/chat/c1/attachments/aaa", mediaType: "image/png" },
        { id: "bbb", partUrl: "attachment:bbb", name: "счёт.pdf", kind: "file", url: "/api/chat/c1/attachments/bbb", mediaType: "application/pdf", caption: "PDF" },
      ],
    });
    expect(result.current.describe({ id: "u2", role: "user", parts: [{ type: "text", text: "Привет" }] } as AgentChatMessage)).toBeUndefined();
  });

  it("идентификатор чата с «/», «?» и пробелом кодируется в адресах загрузки, удаления и ленты", async () => {
    const server = fakeServer();
    const { result } = setup(server, { chatId: "a/b c?" });
    await add(result, txt());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.composer.onRemove(result.current.composer.items[0]!.id));
    await waitFor(() => expect(server.deleted).toEqual(["id-1"]));
    expect(server.calls).toContain("POST /api/chat/a%2Fb%20c%3F/attachments");
    expect(server.calls).toContain("DELETE /api/chat/a%2Fb%20c%3F/attachments/id-1");
    const described = result.current.describe({ id: "u1", role: "user", parts: [{ type: "file", url: "attachment:aaa", mediaType: "image/png", filename: "кот.png" }] } as AgentChatMessage);
    expect(described?.items[0]?.url).toBe("/api/chat/a%2Fb%20c%3F/attachments/aaa");
  });
});
