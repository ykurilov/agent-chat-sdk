import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { createAttachments } from "../src/create-attachments";
import { createMemoryAttachmentStorage } from "../src/memory-attachment-storage";
import { jpegBytes, makeBlankPdf, makePdf, makePng, utf8 } from "./support/sample-files";

function setup(limits = {}) {
  const storage = createMemoryAttachmentStorage();
  const attachments = createAttachments({ storage, limits });
  const call = (method: string, segments: string[], init: { body?: BodyInit; headers?: Record<string, string> } = {}, userId = "anna", chatId = "chat-1") =>
    attachments.handle({
      request: new Request(`http://x/api/chat/${chatId}/attachments/${segments.join("/")}`, { method, ...init }),
      userId,
      chatId,
      segments,
    });
  const upload = (bytes: Uint8Array, name: string, userId = "anna", chatId = "chat-1", type = "application/octet-stream") => {
    const form = new FormData();
    form.set("file", new File([bytes as BlobPart], name, { type }));
    return call("POST", [], { body: form }, userId, chatId);
  };
  return { storage, attachments, call, upload };
}

describe("загрузка", () => {
  it("картинка принимается: 201, описание без текста; тип определён по содержимому, а не заявлен браузером", async () => {
    const { upload, storage } = setup();
    const response = await upload(makePng(2, [0, 255, 0]), "кот.png", "anna", "chat-1", "text/html");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ name: "кот.png", mediaType: "image/png", kind: "image" });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await storage.get(body.id)).toMatchObject({ chatId: "chat-1", ownerId: "anna", attached: false });
  });

  it("PDF и текст: текст достаётся при загрузке и хранится в записи; в ответе — оценка токенов", async () => {
    const { upload, storage } = setup();
    const pdf = await (await upload(makePdf(["Code ZEBRA-4471"]), "счёт.pdf")).json();
    expect(pdf).toMatchObject({ kind: "pdf", mediaType: "application/pdf" });
    expect(pdf.textTokens).toBeGreaterThan(0);
    expect((await storage.get(pdf.id))?.extractedText).toContain("ZEBRA-4471");
    const text = await (await upload(utf8("a,b\n1,2"), "t.csv")).json();
    expect(text).toMatchObject({ kind: "text", mediaType: "text/csv" });
  });

  it("длинный текст обрезается по потолку, ответ говорит textTruncated", async () => {
    const { upload, storage } = setup({ maxFileTextTokens: 10 });
    const body = await (await upload(utf8("а".repeat(500)), "long.txt")).json();
    expect(body.textTruncated).toBe(true);
    expect((await storage.get(body.id))?.extractedText).toHaveLength(30);
    expect(body.textTokens).toBe(10);
  });

  it("имя очищается: путь отбрасывается, управляющие символы убираются, длина ограничена", async () => {
    const { upload, storage } = setup();
    const body = await (await upload(utf8("текст"), "../../etc/pass\nwd\u0000.txt")).json();
    expect(body.name).toBe("passwd.txt");
    expect((await storage.get(body.id))?.name).toBe("passwd.txt");
    const long = await (await upload(utf8("текст"), `${"я".repeat(500)}.txt`)).json();
    expect(long.name.length).toBeLessThanOrEqual(200);
  });

  it.each([
    ["архив", Uint8Array.from([0x50, 0x4b, 3, 4]), "a.zip", 415, "unsupported_type"],
    ["подделка расширения", utf8("не картинка"), "cat.png", 415, "unsupported_type"],
    ["JPEG под именем PDF", jpegBytes, "a.pdf", 415, "unsupported_type"],
    ["пустой файл", new Uint8Array(), "a.txt", 400, "empty"],
    ["скан без текста", makeBlankPdf(), "scan.pdf", 422, "no_text"],
    ["битый PDF", utf8("%PDF-1.4 мусор"), "bad.pdf", 422, "unreadable"],
    ["битая картинка", jpegBytes, "photo.jpg", 422, "unreadable"],
  ])("%s — отказ с понятным видом ошибки", async (_title, bytes, name, status, kind) => {
    const { upload, storage } = setup();
    const response = await upload(bytes, name);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: { kind } });
    expect(await storage.removeUnattachedOlderThan(new Date("2999-01-01"))).toBe(0);
  });

  it("файл больше лимита — 413 too_large, в том числе по заголовку Content-Length до чтения тела", async () => {
    const { upload, call } = setup({ maxFileBytes: 100 });
    const response = await upload(utf8("а".repeat(200)), "big.txt");
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: { kind: "too_large" } });
    const early = await call("POST", [], { body: "x", headers: { "content-length": "999999999", "content-type": "multipart/form-data; boundary=x" } });
    expect(early.status).toBe(413);
  });

  it("большое фото уменьшается при загрузке: хранится копия до 2000 по длинной стороне, размер — её", async () => {
    const { upload, storage } = setup();
    const big = new Uint8Array(
      await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 90, g: 160, b: 220 } } }).jpeg().toBuffer(),
    );
    const response = await upload(big, "фото.jpg");
    expect(response.status).toBe(201);
    const body = await response.json();
    const stored = (await storage.readBytes(body.id))!;
    const meta = await sharp(stored).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    expect(body.size).toBe(stored.length);
    expect((await storage.get(body.id))?.size).toBe(stored.length);
    expect(body.mediaType).toBe(`image/${meta.format}`);
  });

  it("тело без поля file или не multipart — 400", async () => {
    const { call } = setup();
    const form = new FormData();
    form.set("other", "x");
    expect((await call("POST", [], { body: form })).status).toBe(400);
    expect((await call("POST", [], { body: "{}", headers: { "content-type": "application/json" } })).status).toBe(400);
  });
});

describe("чтение и удаление", () => {
  async function uploaded(kind: "png" | "pdf" | "txt") {
    const s = setup();
    const file = { png: [makePng(2, [1, 2, 3]), "кот.png"], pdf: [makePdf(["hello"]), "счёт.pdf"], txt: [utf8("привет"), "заметка.txt"] }[kind] as [Uint8Array, string];
    const body = await (await s.upload(file[0], file[1])).json();
    return { ...s, id: body.id as string };
  }

  it("картинка отдаётся на месте с безопасными заголовками", async () => {
    const { call, id } = await uploaded("png");
    const response = await call("GET", [id]);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toMatch(/^inline/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer()).length).toBeGreaterThan(20);
  });

  it("PDF скачивается; текст отдаётся как text/plain; имя в заголовке закодировано", async () => {
    const pdf = await uploaded("pdf");
    const pdfResponse = await pdf.call("GET", [pdf.id]);
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
    expect(pdfResponse.headers.get("content-disposition")).toBe(`attachment; filename*=UTF-8''%D1%81%D1%87%D1%91%D1%82.pdf`);
    const text = await uploaded("txt");
    const textResponse = await text.call("GET", [text.id]);
    expect(textResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(textResponse.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("чужой человек, чужой чат, несуществующий и не-UUID id — одинаковый 404", async () => {
    const { call, id } = await uploaded("png");
    for (const response of [
      await call("GET", [id], {}, "boris"),
      await call("GET", [id], {}, "anna", "chat-2"),
      await call("GET", [crypto.randomUUID()]),
      await call("GET", ["..%2F..%2Fetc%2Fpasswd"]),
      await call("DELETE", [id], {}, "boris"),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { kind: "not_found" } });
    }
  });

  it("DELETE: непривязанный удаляется (204), привязанный — 409", async () => {
    const { call, id, attachments } = await uploaded("txt");
    expect((await call("DELETE", [id])).status).toBe(204);
    expect((await call("GET", [id])).status).toBe(404);
    const second = await uploaded("txt");
    const parts = await second.attachments.acceptUserParts({ userId: "anna", chatId: "chat-1", parts: [{ type: "file", url: `attachment:${second.id}` }] });
    await second.attachments.confirmUserParts(parts);
    const response = await second.call("DELETE", [second.id]);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: { kind: "attached" } });
    void attachments;
  });

  it("лишние сегменты и неподходящие методы — 404 и 405", async () => {
    const { call, id } = await uploaded("txt");
    expect((await call("GET", [id, "extra"])).status).toBe(404);
    expect((await call("PUT", [id])).status).toBe(405);
    expect((await call("GET", [])).status).toBe(405);
  });
});

describe("настройки для клиента", () => {
  it("лимиты и список допустимых типов для поля выбора файла", async () => {
    const { attachments } = setup({ maxFiles: 3 });
    const response = attachments.settings();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ maxFiles: 3, maxFileBytes: 20 * 1024 * 1024, maxMessageTextTokens: 100_000 });
    expect(body.accept).toContain("image/png");
    expect(body.accept).toContain(".pdf");
    expect(body.accept).toContain(".md");
  });
});

/** Затвор: пока его не откроют, всё, что ждёт `opened`, стоит. */
function openGate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe("лимиты на неотправленные и параллельные загрузки", () => {
  it("число неотправленных файлов на человека ограничено: следующая загрузка — 429 too_many_unsent; у другого человека свой счёт", async () => {
    const { upload } = setup({ maxUnsentFiles: 2 });
    expect((await upload(utf8("раз"), "1.txt")).status).toBe(201);
    expect((await upload(utf8("два"), "2.txt", "anna", "chat-2")).status).toBe(201);
    const third = await upload(utf8("три"), "3.txt");
    expect(third.status).toBe(429);
    expect(await third.json()).toEqual({ error: { kind: "too_many_unsent" } });
    expect((await upload(utf8("борис"), "b.txt", "boris")).status).toBe(201);
  });

  it("общий объём неотправленного ограничен: превышение — 429 too_many_unsent", async () => {
    const { upload } = setup({ maxUnsentBytes: 50 });
    expect((await upload(utf8("а".repeat(15)), "1.txt")).status).toBe(201);
    expect((await upload(utf8("б".repeat(15)), "2.txt")).status).toBe(429);
  });

  it("отправленные файлы в счёт не идут; удалённый неотправленный освобождает место", async () => {
    const { upload, storage, call } = setup({ maxUnsentFiles: 1 });
    const first = await (await upload(utf8("раз"), "1.txt")).json();
    expect((await upload(utf8("два"), "2.txt")).status).toBe(429);
    await storage.markAttached(first.id);
    const second = await (await upload(utf8("два"), "2.txt")).json();
    expect((await upload(utf8("три"), "3.txt")).status).toBe(429);
    expect((await call("DELETE", [second.id])).status).toBe(204);
    expect((await upload(utf8("три"), "3.txt")).status).toBe(201);
  });

  it("параллельные загрузки одного человека ограничены: лишняя — 429 busy; когда первая закончилась, снова можно", async () => {
    const gate = openGate();
    const storage = createMemoryAttachmentStorage();
    const save = storage.save.bind(storage);
    storage.save = async (record, bytes) => {
      await gate.opened;
      await save(record, bytes);
    };
    const attachments = createAttachments({ storage, limits: { maxParallelUploadsPerUser: 1 } });
    const send = (userId: string, name: string) => {
      const form = new FormData();
      form.set("file", new File([utf8("текст")], name));
      return attachments.handle({ request: new Request("http://x/a", { method: "POST", body: form }), userId, chatId: "chat-1", segments: [] });
    };
    const first = send("anna", "1.txt");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await send("anna", "2.txt");
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: { kind: "busy" } });
    gate.open();
    expect((await first).status).toBe(201);
    expect((await send("anna", "3.txt")).status).toBe(201);
  });

  it("общий предел параллельных загрузок на сервер: лишняя от любого человека — 429 busy", async () => {
    const gate = openGate();
    const storage = createMemoryAttachmentStorage();
    const save = storage.save.bind(storage);
    storage.save = async (record, bytes) => {
      await gate.opened;
      await save(record, bytes);
    };
    const attachments = createAttachments({ storage, limits: { maxParallelUploads: 1 } });
    const send = (userId: string) => {
      const form = new FormData();
      form.set("file", new File([utf8("текст")], "t.txt"));
      return attachments.handle({ request: new Request("http://x/a", { method: "POST", body: form }), userId, chatId: "chat-1", segments: [] });
    };
    const first = send("anna");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await send("boris")).status).toBe(429);
    gate.open();
    expect((await first).status).toBe(201);
  });

  it("параллельные загрузки, не дожидаясь записи, не проскакивают мимо лимита числа файлов", async () => {
    const { attachments } = setup({ maxUnsentFiles: 2, maxParallelUploadsPerUser: 5 });
    const send = (name: string) => {
      const form = new FormData();
      form.set("file", new File([utf8("текст")], name));
      return attachments.handle({ request: new Request("http://x/a", { method: "POST", body: form }), userId: "anna", chatId: "chat-1", segments: [] });
    };
    const statuses = (await Promise.all([send("1.txt"), send("2.txt"), send("3.txt"), send("4.txt")])).map((response) => response.status).sort();
    expect(statuses).toEqual([201, 201, 429, 429]);
  });

  it("лимиты по умолчанию заданы и настраиваются", async () => {
    const { defaultAttachmentLimits } = await import("../src/limits");
    expect(defaultAttachmentLimits).toMatchObject({
      maxUnsentFiles: expect.any(Number),
      maxUnsentBytes: expect.any(Number),
      maxParallelUploads: expect.any(Number),
      maxParallelUploadsPerUser: expect.any(Number),
    });
  });
});
