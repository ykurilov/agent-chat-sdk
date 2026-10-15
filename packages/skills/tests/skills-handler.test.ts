import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ResolvedUser } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createSkills, createSkillsHandler } from "../src/index";
import { memorySkillStore } from "../src/store/memory";

const ORIGIN = "http://app.test";

function setup(options: { maxBodyChars?: number; basePath?: string; resolve?: (request: Request) => ResolvedUser } = {}) {
  const store = memorySkillStore();
  const adminChecks: Array<{ id: string; hasRequest: boolean }> = [];
  const errors: string[] = [];
  let minute = 0;
  const skills = createSkills({
    store,
    isAdmin: (user, request) => {
      adminChecks.push({ id: user.id, hasRequest: request instanceof Request });
      return user.id === "boss";
    },
    chatStorage: createInMemoryChatStorage(),
    maxBodyChars: options.maxBodyChars,
    now: () => new Date(Date.UTC(2026, 9, 15, 12, minute++)),
    log: () => {},
  });
  const handler = createSkillsHandler({
    skills,
    resolveUser: options.resolve ?? ((request) => {
      const id = request.headers.get("x-user");
      return id ? { id } : null;
    }),
    basePath: options.basePath,
    logError: (message) => void errors.push(message),
  });
  const base = handler.basePath;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await handler.fetch(
      new Request(`${ORIGIN}${base}${path}`, {
        method,
        headers: { "x-user": "boss", ...(body !== undefined && { "content-type": "application/json" }), ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : null };
  };
  return { store, handler, call, adminChecks, errors };
}

const gameDev = { name: "game-dev", whenToUse: "Когда просят сделать игру.", body: "# Игры\nДелай на canvas.", status: "everyone" };

describe("адреса навыков: доступ", () => {
  it("не-админ, отказ приложения и гость — 404 на любом адресе, данные не тронуты; isAdmin получает запрос", async () => {
    const { store, call, adminChecks } = setup();
    await store.create({ ...gameDev, status: "everyone", author: "boss" }, "2026-10-15T10:00:00.000Z");
    const routes: Array<[string, string, unknown?]> = [
      ["GET", ""],
      ["POST", "", { ...gameDev, name: "new-one" }],
      ["GET", "/game-dev"],
      ["PUT", "/game-dev", { whenToUse: "w", body: "b", expectedVersion: 1 }],
      ["PUT", "/game-dev/status", { status: "off" }],
      ["GET", "/game-dev/versions"],
      ["POST", "/game-dev/rollback", { version: 1, expectedVersion: 1 }],
      ["DELETE", "/game-dev"],
    ];
    for (const [method, path, body] of routes) {
      expect((await call(method, path, body, { "x-user": "anna" })).status, `${method} ${path}`).toBe(404);
      expect((await call(method, path, body, { "x-user": "" })).status, `${method} ${path} гость`).toBe(404);
    }
    expect(await store.list()).toHaveLength(1);
    expect((await store.get("game-dev"))?.status).toBe("everyone");
    expect(adminChecks.every((check) => check.id === "anna" && check.hasRequest)).toBe(true);

    const refused = setup({ resolve: () => ({ refused: { code: "blocked", message: "Нельзя" } }) });
    const answer = await refused.call("GET", "");
    expect(answer).toEqual({ status: 404, json: { error: { kind: "not_found" } } });
  });

  it("чужой сайт: админу 403 на запись, не-админу — 404; чтение с чужого сайта не проверяется", async () => {
    const { call } = setup();
    const crossSite = { origin: "https://evil.test", "sec-fetch-site": "cross-site" };
    expect((await call("POST", "", gameDev, crossSite)).json).toEqual({ error: { kind: "forbidden_origin" } });
    expect((await call("POST", "", gameDev, { ...crossSite, "x-user": "anna" })).status).toBe(404);
    expect((await call("GET", "", undefined, crossSite)).status).toBe(200);
  });

  it("адрес вне basePath — 404; свой basePath работает", async () => {
    const { handler } = setup({ basePath: "/admin/skills/" });
    expect(handler.basePath).toBe("/admin/skills");
    expect((await handler.fetch(new Request(`${ORIGIN}/admin/skills`, { headers: { "x-user": "boss" } }))).status).toBe(200);
    expect((await handler.fetch(new Request(`${ORIGIN}/admin/other`, { headers: { "x-user": "boss" } }))).status).toBe(404);
    expect((await handler.fetch(new Request(`${ORIGIN}/admin/skills/a/b/c`, { headers: { "x-user": "boss" } }))).status).toBe(404);
  });
});

describe("адреса навыков: работа админа", () => {
  it("создание, список с учётом, карточка, правка, гонка, статус, версии, откат, удаление", async () => {
    const { store, call } = setup();
    const created = await call("POST", "", gameDev);
    expect(created.status).toBe(201);
    expect(created.json.skill).toMatchObject({ name: "game-dev", version: 1, status: "everyone", createdBy: "boss", createdAt: "2026-10-15T12:00:00.000Z" });
    expect((await call("POST", "", gameDev)).json).toEqual({ error: { kind: "skill_exists", message: expect.any(String) } });

    await store.recordLoad({ name: "game-dev", version: 1, chatId: "c1", ownerId: "anna", turnId: "a1", loadedAt: "2026-10-15T12:30:00.000Z" });
    const list = await call("GET", "");
    expect(list.json.skills).toEqual([
      expect.objectContaining({ name: "game-dev", whenToUse: gameDev.whenToUse, status: "everyone", version: 1, loads: 1 }),
    ]);
    expect(list.json.skills[0].body).toBeUndefined();
    const card = await call("GET", "/game-dev");
    expect(card.json.skill.body).toBe(gameDev.body);
    expect(card.json.loads).toEqual({ total: 1, recent: [expect.objectContaining({ chatId: "c1", ownerId: "anna", version: 1 })] });

    const edited = await call("PUT", "/game-dev", { whenToUse: "Игры.", body: "v2", expectedVersion: 1 });
    expect(edited.json.skill).toMatchObject({ version: 2, body: "v2", updatedBy: "boss" });
    const stale = await call("PUT", "/game-dev", { whenToUse: "Игры.", body: "чужое", expectedVersion: 1 });
    expect(stale).toEqual({ status: 409, json: { error: { kind: "version_conflict", currentVersion: 2, message: expect.any(String) } } });

    expect((await call("PUT", "/game-dev/status", { status: "admins" })).json.skill).toMatchObject({ status: "admins", version: 2 });
    const versions = await call("GET", "/game-dev/versions");
    expect(versions.json.versions.map((version: { version: number; body: string }) => [version.version, version.body])).toEqual([
      [2, "v2"],
      [1, gameDev.body],
    ]);

    const rolledBack = await call("POST", "/game-dev/rollback", { version: 1, expectedVersion: 2 });
    expect(rolledBack.json.skill).toMatchObject({ version: 3, body: gameDev.body, whenToUse: gameDev.whenToUse });
    expect((await call("POST", "/game-dev/rollback", { version: 9, expectedVersion: 3 })).status).toBe(404);

    expect((await call("DELETE", "/game-dev")).status).toBe(204);
    expect((await call("GET", "/game-dev")).status).toBe(404);
    expect((await call("DELETE", "/game-dev")).status).toBe(404);
  });

  it("имя на кириллице в адресе", async () => {
    const { call } = setup();
    await call("POST", "", { ...gameDev, name: "договоры" });
    expect((await call("GET", `/${encodeURIComponent("договоры")}`)).json.skill.name).toBe("договоры");
  });

  it("без статуса навык создаётся выключенным", async () => {
    const { call } = setup();
    const { status: _status, ...withoutStatus } = gameDev;
    expect((await call("POST", "", withoutStatus)).json.skill.status).toBe("off");
  });

  it("проверка полей: 400 с полем и причиной; кривой JSON — 400; тело больше 256 КБ — 413", async () => {
    const { call } = setup({ maxBodyChars: 20 });
    expect((await call("POST", "", { ...gameDev, name: "Game Dev" })).json).toEqual({
      error: { kind: "invalid_skill", field: "name", reason: "name_format", message: expect.any(String) },
    });
    expect((await call("POST", "", { ...gameDev, body: "x".repeat(21) })).json.error).toMatchObject({ field: "body", reason: "body_too_long" });
    expect((await call("POST", "", { ...gameDev, status: "all" })).json.error).toMatchObject({ field: "status", reason: "status_unknown" });
    expect((await call("POST", "", { ...gameDev, whenToUse: "раз\nдва" })).json.error).toMatchObject({ reason: "when_to_use_multiline" });
    expect((await call("POST", "", "{не json")).json).toEqual({ error: { kind: "bad_request", message: expect.any(String) } });
    expect((await call("POST", "", { name: 1 })).status).toBe(400);
    expect((await call("PUT", "/game-dev", { whenToUse: "w", body: "b" })).status).toBe(400);
    expect((await call("POST", "", { ...gameDev, body: "x".repeat(300 * 1024) })).status).toBe(413);
  });

  it("предел запроса — по maxBodyChars: большое кириллическое тело в пределе принимается, сверх предела запроса — 413", async () => {
    const { call } = setup({ maxBodyChars: 200_000 });
    expect((await call("POST", "", { ...gameDev, body: "я".repeat(200_000) })).status).toBe(201);
    expect((await call("POST", "", { ...gameDev, name: "huge", body: "я".repeat(1_000_000) })).status).toBe(413);
  });

  it("откат проверяется текущими правилами: старая версия длиннее нынешнего предела — 400, навык не тронут", async () => {
    const { store, call } = setup({ maxBodyChars: 20 });
    await store.create({ ...gameDev, body: "x".repeat(50), status: "everyone", author: "boss" }, "2026-10-15T10:00:00.000Z");
    await store.updateText("game-dev", { whenToUse: gameDev.whenToUse, body: "коротко", author: "boss", expectedVersion: 1 }, "2026-10-15T10:01:00.000Z");
    const rolledBack = await call("POST", "/game-dev/rollback", { version: 1, expectedVersion: 2 });
    expect(rolledBack).toEqual({ status: 400, json: { error: { kind: "invalid_skill", field: "body", reason: "body_too_long", message: expect.any(String) } } });
    expect(await store.get("game-dev")).toMatchObject({ version: 2, body: "коротко" });
  });

  it("сбой хранилища — 500 без подробностей, подробности в журнал", async () => {
    const { store, call, errors } = setup();
    store.listBrief = async () => {
      throw new Error("диск отвалился");
    };
    expect(await call("GET", "")).toEqual({ status: 500, json: { error: { kind: "other", message: expect.any(String) } } });
    expect(errors.join("\n")).toContain("диск отвалился");
  });
});
