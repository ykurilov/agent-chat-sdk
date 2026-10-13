import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage, ResolvedUser } from "@ykurilov/agent-chat-core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createVoiceCatalog, mountVoiceRoutes } from "../src/server/voices";

const narrator = { id: "oE0n0S3wK5Mj9C62iehn", name: "Диктор аудиокниг" };
const pirate = { id: "JyEaew7H7mwhutMPHSNz", name: "Старый пират" };

function storageWithoutVoiceMethods(): ChatStorage {
  const storage = createInMemoryChatStorage();
  const { getVoiceChoice: _get, setVoiceChoice: _set, ...rest } = storage;
  return rest as ChatStorage;
}

describe("каталог голосов", () => {
  it("список и голос по умолчанию берутся из настроек", async () => {
    const catalog = createVoiceCatalog({ voices: [narrator, pirate], defaultVoiceId: narrator.id, storage: createInMemoryChatStorage() });

    expect(catalog.voices).toEqual([narrator, pirate]);
    expect(await catalog.view("anna")).toEqual({ voices: [narrator, pirate], current: narrator.id, persisted: true });
  });

  it("настройки без голосов или с голосом по умолчанию не из списка — понятная ошибка при создании", () => {
    const storage = createInMemoryChatStorage();

    expect(() => createVoiceCatalog({ voices: [], defaultVoiceId: "x", storage })).toThrow(/голос/i);
    expect(() => createVoiceCatalog({ voices: [narrator], defaultVoiceId: pirate.id, storage })).toThrow(/по умолчанию/i);
    expect(() => createVoiceCatalog({ voices: [narrator, narrator], defaultVoiceId: narrator.id, storage })).toThrow(/повтор/i);
  });

  it("выбор запоминается в хранилище и читается заново", async () => {
    const storage = createInMemoryChatStorage();
    const first = createVoiceCatalog({ voices: [narrator, pirate], defaultVoiceId: narrator.id, storage });

    expect(await first.select("anna", pirate.id)).toBe(true);

    const afterRestart = createVoiceCatalog({ voices: [narrator, pirate], defaultVoiceId: narrator.id, storage });
    expect(await afterRestart.current("anna")).toBe(pirate.id);
    expect(await afterRestart.current("boris")).toBe(narrator.id);
  });

  it("голос не из списка не принимается и выбор не меняет", async () => {
    const storage = createInMemoryChatStorage();
    const catalog = createVoiceCatalog({ voices: [narrator, pirate], defaultVoiceId: narrator.id, storage });
    await catalog.select("anna", pirate.id);

    expect(await catalog.select("anna", "чужой-голос")).toBe(false);

    expect(await catalog.current("anna")).toBe(pirate.id);
  });

  it("сохранённый голос, которого больше нет в списке, — голос по умолчанию, без ошибки", async () => {
    const storage = createInMemoryChatStorage();
    await storage.setVoiceChoice?.("anna", "удалённый-голос");
    const catalog = createVoiceCatalog({ voices: [narrator, pirate], defaultVoiceId: narrator.id, storage });

    expect(await catalog.current("anna")).toBe(narrator.id);
    expect((await catalog.view("anna")).current).toBe(narrator.id);
  });

  it("хранилище не отвечает — голос по умолчанию и запись в журнал ошибок", async () => {
    const storage = createInMemoryChatStorage();
    storage.getVoiceChoice = async () => {
      throw new Error("база недоступна");
    };
    const logged: unknown[] = [];
    const catalog = createVoiceCatalog({
      voices: [narrator, pirate],
      defaultVoiceId: narrator.id,
      storage,
      logError: (error) => logged.push(error),
    });

    expect(await catalog.current("anna")).toBe(narrator.id);
    expect(logged).toHaveLength(1);
  });

  it("хранилище без методов выбора — выбор живёт в памяти, persisted: false", async () => {
    const catalog = createVoiceCatalog({
      voices: [narrator, pirate],
      defaultVoiceId: narrator.id,
      storage: storageWithoutVoiceMethods(),
    });

    expect(await catalog.select("anna", pirate.id)).toBe(true);

    expect(await catalog.view("anna")).toEqual({ voices: [narrator, pirate], current: pirate.id, persisted: false });
    expect(await catalog.current("boris")).toBe(narrator.id);
  });

  it("один голос: выбирать нечего, но всё работает", async () => {
    const catalog = createVoiceCatalog({ voices: [narrator], defaultVoiceId: narrator.id, storage: createInMemoryChatStorage() });

    expect((await catalog.view("anna")).voices).toEqual([narrator]);
    expect(await catalog.select("anna", narrator.id)).toBe(true);
  });
});

describe("каталог голосов: наборы тегов", () => {
  const taggedPirate = { ...pirate, tags: { allowed: ["laughs", "wheezing", "low, gravelly voice"], avoid: ["softly"] } };
  const taggedNarrator = { ...narrator, tags: { allowed: ["sighs", "curious"] } };

  it("tagsOf отдаёт набор голоса; у голоса без набора и у неизвестного — undefined (общий список)", () => {
    const catalog = createVoiceCatalog({ voices: [narrator, taggedPirate], defaultVoiceId: narrator.id, storage: createInMemoryChatStorage() });

    expect(catalog.tagsOf(pirate.id)).toEqual(taggedPirate.tags);
    expect(catalog.tagsOf(narrator.id)).toBeUndefined();
    expect(catalog.tagsOf("чужой-голос")).toBeUndefined();
  });

  it("человеку и экрану наборы не уходят: в списке голосов только id и имя", async () => {
    const catalog = createVoiceCatalog({ voices: [taggedNarrator, taggedPirate], defaultVoiceId: narrator.id, storage: createInMemoryChatStorage() });

    const view = await catalog.view("anna");

    expect(view.voices).toEqual([narrator, pirate]);
    expect(JSON.stringify(view)).not.toContain("laughs");
  });

  it("чату нужны голос человека и набор: каталог отвечает на оба вопроса", async () => {
    const storage = createInMemoryChatStorage();
    const catalog = createVoiceCatalog({ voices: [taggedNarrator, taggedPirate], defaultVoiceId: narrator.id, storage });
    await catalog.select("anna", pirate.id);

    expect(await catalog.current("anna")).toBe(pirate.id);
    expect(catalog.tagsOf(await catalog.current("anna"))).toEqual(taggedPirate.tags);
  });

  it("набор не из тегов голоса или пустой — понятная ошибка с именем голоса при создании", () => {
    const storage = createInMemoryChatStorage();
    const make = (tags: { allowed: string[]; avoid?: string[] }) => () =>
      createVoiceCatalog({ voices: [{ ...pirate, tags }], defaultVoiceId: pirate.id, storage });

    expect(make({ allowed: [] })).toThrow(/Старый пират/);
    expect(make({ allowed: ["смеётся"] })).toThrow(/Старый пират.*тег/);
    expect(make({ allowed: ["laughs"], avoid: ["laughs"] })).toThrow(/laughs/);
  });
});

function appWith(options: { storage?: ChatStorage; user?: string | null; voices?: (typeof narrator)[]; resolved?: ResolvedUser } = {}) {
  const storage = options.storage ?? createInMemoryChatStorage();
  const catalog = createVoiceCatalog({
    voices: options.voices ?? [narrator, pirate],
    defaultVoiceId: narrator.id,
    storage,
  });
  const app = new Hono();
  const user = options.user === undefined ? "anna" : options.user;
  mountVoiceRoutes(app, { path: "/api/voice-dialog", catalog, resolveUser: async () => options.resolved ?? (user ? { id: user } : null) });
  return { app, storage };
}

const putVoice = (app: Hono, body: unknown) =>
  app.request("/api/voice-dialog/voice", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("GET {path}/voices и PUT {path}/voice", () => {
  it("GET отдаёт список, текущий голос и признак запоминания; без кэша", async () => {
    const { app } = appWith();

    const response = await app.request("/api/voice-dialog/voices");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ voices: [narrator, pirate], current: narrator.id, persisted: true });
  });

  it("без вошедшего пользователя — 401 и на GET, и на PUT", async () => {
    const { app } = appWith({ user: null });

    expect((await app.request("/api/voice-dialog/voices")).status).toBe(401);
    expect((await putVoice(app, { voiceId: pirate.id })).status).toBe(401);
  });

  it("приложение отказало словами — GET и PUT отвечают access_refused без кэша", async () => {
    const { app } = appWith({ resolved: ({ refused: { code: "no_course", message: "Нужен доступ к курсу", status: 401 as const } }) });
    const expected = { error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" } };

    const list = await app.request("/api/voice-dialog/voices");
    expect(list.status).toBe(401);
    expect(list.headers.get("cache-control")).toBe("no-store");
    expect(await list.json()).toEqual(expected);
    const put = await putVoice(app, { voiceId: pirate.id });
    expect(put.status).toBe(401);
    expect(await put.json()).toEqual(expected);
  });

  it("PUT из списка → 204, следующий GET показывает новый голос", async () => {
    const { app, storage } = appWith();

    const response = await putVoice(app, { voiceId: pirate.id });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await storage.getVoiceChoice?.("anna")).toBe(pirate.id);
    const after = (await (await app.request("/api/voice-dialog/voices")).json()) as { current: string };
    expect(after.current).toBe(pirate.id);
  });

  it("PUT не из списка, без поля или с кривым телом → 400, выбор не меняется", async () => {
    const { app, storage } = appWith();

    expect((await putVoice(app, { voiceId: "чужой" })).status).toBe(400);
    expect((await putVoice(app, {})).status).toBe(400);
    expect((await putVoice(app, { voiceId: 5 })).status).toBe(400);
    expect((await putVoice(app, "не json")).status).toBe(400);
    expect(await storage.getVoiceChoice?.("anna")).toBeNull();
  });

  it("хранилище без методов: PUT → 204, GET показывает выбор и persisted: false", async () => {
    const { app } = appWith({ storage: storageWithoutVoiceMethods() });

    expect((await putVoice(app, { voiceId: pirate.id })).status).toBe(204);

    expect(await (await app.request("/api/voice-dialog/voices")).json()).toEqual({
      voices: [narrator, pirate],
      current: pirate.id,
      persisted: false,
    });
  });

  it("один голос: ответ со списком из одного голоса", async () => {
    const { app } = appWith({ voices: [narrator] });

    const body = (await (await app.request("/api/voice-dialog/voices")).json()) as { voices: unknown[] };

    expect(body.voices).toEqual([narrator]);
  });

  it("у каждого человека свой выбор", async () => {
    const storage = createInMemoryChatStorage();
    const anna = appWith({ storage, user: "anna" });
    const boris = appWith({ storage, user: "boris" });
    await putVoice(anna.app, { voiceId: pirate.id });

    const forBoris = (await (await boris.app.request("/api/voice-dialog/voices")).json()) as { current: string };

    expect(forBoris.current).toBe(narrator.id);
  });
});
