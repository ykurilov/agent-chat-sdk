import type { ResolvedUser } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountLinking, hashLinkCode, isLinkCode } from "../src/account-linking";
import { messengerTexts } from "../src/messenger-texts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteMessengerStore } from "../src/sqlite";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { MessengerStore, MessengersOptions } from "../src/types";
import { account, createFakeAdapter, update } from "./support/fake-adapter";

const NOW = Date.UTC(2026, 9, 5, 12, 0);

function setup(resolved?: ResolvedUser, hooks: { onLinked?: MessengersOptions["onLinked"]; logError?(error: unknown): void } = {}) {
  const store = createMemoryMessengerStore();
  const telegram = createFakeAdapter();
  const vk = createFakeAdapter({ messenger: "vk" });
  const users: Record<string, string> = { "token-anna": "anna", "token-boris": "boris" };
  const linking = createAccountLinking({
    store,
    bots: [telegram.bot(), vk.bot({ botId: "club1" })],
    ...hooks,
    resolveUser: async (request) => {
      if (resolved) return resolved;
      const id = users[request.headers.get("authorization") ?? ""];
      return id ? { id } : null;
    },
  });
  return { store, linking, telegram };
}

const request = (method: string, path: string, user?: string, body?: unknown) =>
  new Request(`https://app.test/api/messengers${path}`, {
    method,
    headers: { ...(user && { authorization: `token-${user}` }), ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

async function issue(store: MessengerStore, linking: ReturnType<typeof setup>["linking"], userId = "anna", messenger: "telegram" | "vk" = "telegram") {
  void store;
  return linking.issueCode(userId, messenger);
}

describe("привязка аккаунта", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("код — 22 знака base64url, живёт 15 минут, ссылка от адаптера, в базе только хеш", async () => {
    const { store, linking } = setup();
    const offer = await issue(store, linking);
    expect(offer.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(offer.url).toBe(`https://t.me/test_bot?start=${offer.code}`);
    expect(offer.expiresAt).toBe(new Date(NOW + 15 * 60_000).toISOString());
    expect(await store.consumeLinkCode(offer.code, "telegram", new Date(NOW).toISOString())).toBeNull();
    expect(await store.consumeLinkCode(hashLinkCode(offer.code), "telegram", new Date(NOW).toISOString())).toEqual({ userId: "anna" });
    const other = await issue(store, linking);
    expect(other.code).not.toBe(offer.code);
  });

  it("форма кода отличает его от метки сценария", () => {
    expect(isLinkCode("AbCdEfGhIjKlMnOpQrSt_-")).toBe(true);
    expect(isLinkCode("AbCdEfGhIjKlMnOpQrSt_")).toBe(false);
    expect(isLinkCode("AbCdEfGhIjKlMnOpQrSt_-x")).toBe(false);
    expect(isLinkCode("promo-autumn")).toBe(false);
    expect(isLinkCode("AbCdEfGhIjKlMnOpQrSt+/")).toBe(false);
  });

  it("/start <код> привязывает аккаунт; второй раз код не подходит", async () => {
    const { store, linking } = setup();
    const { code } = await issue(store, linking);
    expect(await linking.handleUpdate(update({ kind: "start", text: `/start ${code}`, startPayload: code }))).toEqual({ reply: "Готово: аккаунт подключён." });
    expect(await store.findLink("telegram", "bot1", "100")).toEqual({
      messenger: "telegram",
      botId: "bot1",
      externalUserId: "100",
      userId: "anna",
      name: "Анна",
      username: "anna_tg",
      linkedAt: new Date(NOW).toISOString(),
    });
    const again = await linking.handleUpdate(update({ kind: "start", startPayload: code, account: account({ externalUserId: "200" }) }));
    expect(again).toEqual({ reply: "Код не подошёл или устарел. Возьмите новую ссылку в приложении." });
    expect(await store.findLink("telegram", "bot1", "200")).toBeNull();
  });

  it("привязка в личном чате запоминает разговор этого человека: туда придёт «Задача готова» (у MAX номер чата свой)", async () => {
    const { store, linking } = setup();
    const dialog = { messenger: "telegram" as const, botId: "bot1", externalChatId: "9100" };
    // Разговор гостя, который писал до привязки: его чат человеку не принадлежит.
    await store.saveConversation({ ...dialog, type: "private", userId: "guest-1", currentChatId: "guest-chat", blocked: false, active: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
    const { code } = await issue(store, linking);
    await linking.handleUpdate(update({ kind: "start", startPayload: code, chat: { id: "9100", type: "private" } }));
    expect(await store.listConversationsOfUser("anna")).toEqual([expect.objectContaining({ ...dialog, type: "private", userId: "anna", active: true, blocked: false })]);
    expect((await store.getConversation(dialog))?.currentChatId).toBeUndefined();

    // Уже свой разговор не трогаем: текущий чат остаётся.
    const second = await issue(store, linking);
    await store.setCurrentChat(dialog, "anna-chat", new Date().toISOString());
    await linking.handleUpdate(update({ kind: "command", text: `/link ${second.code}`, chat: { id: "9100", type: "private" } }));
    expect((await store.getConversation(dialog))?.currentChatId).toBe("anna-chat");

    // В группе разговор не личный — не запоминаем.
    const inGroup = await issue(store, linking);
    await linking.handleUpdate(update({ kind: "command", text: `/link ${inGroup.code}`, chat: { id: "-500", type: "group" }, account: account({ externalUserId: "300" }) }));
    expect(await store.getConversation({ ...dialog, externalChatId: "-500" })).toBeNull();
  });

  it("/link <код> и /link@бот <код> тоже привязывают", async () => {
    const { store, linking } = setup();
    const first = await issue(store, linking);
    expect(await linking.handleUpdate(update({ kind: "command", text: `/link ${first.code}` }))).toEqual({ reply: expect.stringContaining("Готово") });
    const second = await issue(store, linking, "boris");
    await linking.handleUpdate(update({ kind: "command", text: `/link@test_bot ${second.code}`, account: account({ externalUserId: "300" }) }));
    expect((await store.findLink("telegram", "bot1", "300"))?.userId).toBe("boris");
  });

  it("код после 15 минут и код другого мессенджера не подходят", async () => {
    const { store, linking } = setup();
    const late = await issue(store, linking);
    vi.setSystemTime(NOW + 15 * 60_000);
    expect(await linking.handleUpdate(update({ kind: "start", startPayload: late.code }))).toEqual({ reply: expect.stringContaining("не подошёл") });
    const vkCode = await issue(store, linking, "anna", "vk");
    expect(await linking.handleUpdate(update({ kind: "start", startPayload: vkCode.code }))).toEqual({ reply: expect.stringContaining("не подошёл") });
    expect(await store.findLink("telegram", "bot1", "100")).toBeNull();
  });

  it("код другого мессенджера не сгорает: им всё ещё можно привязаться в своём мессенджере", async () => {
    const { store, linking } = setup();
    const vkCode = await issue(store, linking, "anna", "vk");
    expect(await linking.handleUpdate(update({ kind: "start", startPayload: vkCode.code }))).toEqual({ reply: expect.stringContaining("не подошёл") });
    const vkAccount = account({ messenger: "vk", botId: "club1", externalUserId: "555" });
    expect(await linking.handleUpdate(update({ kind: "start", startPayload: vkCode.code, account: vkAccount }))).toEqual({ reply: messengerTexts.linked });
    expect(await store.findLink("vk", "club1", "555")).toMatchObject({ userId: "anna" });
  });

  it("/link без кода, /start без кода и метка сценария — не привязка", async () => {
    const { linking } = setup();
    expect(await linking.handleUpdate(update({ kind: "start" }))).toBeNull();
    expect(await linking.handleUpdate(update({ kind: "start", startPayload: "promo-autumn" }))).toBeNull();
    expect(await linking.handleUpdate(update({ kind: "text", text: "/link abc" }))).toBeNull();
    expect(await linking.handleUpdate(update({ kind: "command", text: "/link" }))).toEqual({ reply: expect.stringContaining("не подошёл") });
    expect(await linking.handleUpdate(update({ kind: "command", text: "/help" }))).toBeNull();
  });

  it("одновременное использование одного кода привязывает один аккаунт", async () => {
    const { store, linking } = setup();
    const { code } = await issue(store, linking);
    await Promise.all(["1", "2", "3"].map((id) => linking.handleUpdate(update({ kind: "start", startPayload: code, account: account({ externalUserId: id }) }))));
    const linked = await Promise.all(["1", "2", "3"].map((id) => store.findLink("telegram", "bot1", id)));
    expect(linked.filter(Boolean)).toHaveLength(1);
  });

  it("хранилище без saveLinkIfFree не принимается: привязка не запускается с небезопасной записью", () => {
    const { saveLinkIfFree: _, ...legacy } = createMemoryMessengerStore();
    expect(() => createAccountLinking({ store: legacy as MessengerStore, bots: [createFakeAdapter().bot()], resolveUser: async () => null })).toThrow(TypeError);
    expect(() => createAccountLinking({ store: legacy as MessengerStore, bots: [createFakeAdapter().bot()], resolveUser: async () => null })).toThrow(/saveLinkIfFree/);
  });

  let folder: string | undefined;
  describe.each([
    ["память", async () => createMemoryMessengerStore()],
    ["SQLite", async () => createSqliteMessengerStore({ filePath: join((folder = await mkdtemp(join(tmpdir(), "linking-race-"))), "app.db") })],
  ] as const)("два кода разных людей на один аккаунт одновременно (%s, аудит C-04)", (_name, open) => {
    it("привязывает один, второй получает «занят»; запись и onLinked — у привязанного", async () => {
      const shared = await open();
      // Оба кода приняты раньше, чем кто-то из них записал привязку.
      let arrived = 0;
      let release!: () => void;
      const bothConsumed = new Promise<void>((resolve) => (release = resolve));
      const store: MessengerStore = {
        ...shared,
        consumeLinkCode: async (...args) => {
          const claimed = await shared.consumeLinkCode(...args);
          if (++arrived === 2) release();
          await bothConsumed;
          return claimed;
        },
      };
      const onLinked = vi.fn();
      const linking = createAccountLinking({ store, bots: [createFakeAdapter().bot()], onLinked, resolveUser: async () => null });
      const anna = await linking.issueCode("anna", "telegram");
      const boris = await linking.issueCode("boris", "telegram");
      const outcomes = await Promise.all([anna, boris].map((offer) => linking.redeem(offer.code, account())));
      expect([...outcomes].sort()).toEqual(["linked", "taken"]);
      const winner = outcomes[0] === "linked" ? "anna" : "boris";
      expect((await shared.findLink("telegram", "bot1", "100"))?.userId).toBe(winner);
      expect(onLinked).toHaveBeenCalledTimes(1);
      expect(onLinked.mock.calls[0]?.[0]).toMatchObject({ userId: winner });
      await shared.close?.();
      if (folder) await rm(folder, { recursive: true, force: true });
    });
  });

  describe("сигнал onLinked", () => {
    const linkOf = (userId: string, externalUserId = "100") => ({
      messenger: "telegram",
      botId: "bot1",
      externalUserId,
      userId,
      name: "Анна",
      username: "anna_tg",
      linkedAt: new Date(NOW).toISOString(),
    });

    it("приходит один раз с той же записью, что сохранена, когда код принят", async () => {
      const onLinked = vi.fn();
      const { store, linking } = setup(undefined, { onLinked });
      const { code } = await issue(store, linking);
      await linking.handleUpdate(update({ kind: "start", startPayload: code }));
      expect(onLinked).toHaveBeenCalledTimes(1);
      expect(onLinked).toHaveBeenCalledWith(linkOf("anna"));
      expect(onLinked.mock.calls[0]?.[0]).toEqual(await store.findLink("telegram", "bot1", "100"));
    });

    it("вызывается после сохранения привязки и ждётся до ответа человеку", async () => {
      let linkWasSaved: boolean | undefined;
      let finished = false;
      const { store, linking } = setup(undefined, {
        onLinked: async () => {
          linkWasSaved = (await store.findLink("telegram", "bot1", "100")) !== null;
          await Promise.resolve();
          finished = true;
        },
      });
      const { code } = await issue(store, linking);
      await linking.handleUpdate(update({ kind: "start", startPayload: code }));
      expect(linkWasSaved).toBe(true);
      expect(finished).toBe(true);
    });

    it("не приходит при неверном, просроченном и уже использованном коде", async () => {
      const onLinked = vi.fn();
      const { store, linking } = setup(undefined, { onLinked });
      await linking.handleUpdate(update({ kind: "command", text: "/link" }));
      await linking.handleUpdate(update({ kind: "command", text: "/link AbCdEfGhIjKlMnOpQrSt_-" }));
      const late = await issue(store, linking);
      vi.setSystemTime(NOW + 15 * 60_000);
      await linking.handleUpdate(update({ kind: "start", startPayload: late.code }));
      expect(onLinked).not.toHaveBeenCalled();

      vi.setSystemTime(NOW);
      const used = await issue(store, linking);
      await linking.handleUpdate(update({ kind: "start", startPayload: used.code }));
      expect(onLinked).toHaveBeenCalledTimes(1);
      await linking.handleUpdate(update({ kind: "start", startPayload: used.code, account: account({ externalUserId: "200" }) }));
      expect(onLinked).toHaveBeenCalledTimes(1);
    });

    it("ошибка в сигнале уходит в logError, привязка сохранена, человек получает «привязано»", async () => {
      const failure = new Error("награда не выдана");
      const logError = vi.fn();
      const { store, linking } = setup(undefined, { onLinked: () => Promise.reject(failure), logError });
      const { code } = await issue(store, linking);
      const result = await linking.handleUpdate(update({ kind: "start", startPayload: code }));
      expect(result).toEqual({ reply: messengerTexts.linked });
      expect(logError).toHaveBeenCalledWith(failure);
      expect(await store.findLink("telegram", "bot1", "100")).toMatchObject({ userId: "anna" });
    });

    it("ошибка, брошенная сразу (не через промис), тоже не ломает привязку", async () => {
      const failure = new Error("упало");
      const logError = vi.fn();
      const { store, linking } = setup(undefined, {
        onLinked: () => {
          throw failure;
        },
        logError,
      });
      const { code } = await issue(store, linking);
      expect(await linking.handleUpdate(update({ kind: "start", startPayload: code }))).toEqual({ reply: messengerTexts.linked });
      expect(logError).toHaveBeenCalledWith(failure);
    });

    it("без onLinked привязка работает как раньше, даже если ошибок некуда писать", async () => {
      const { store, linking } = setup();
      const { code } = await issue(store, linking);
      expect(await linking.handleUpdate(update({ kind: "start", startPayload: code }))).toEqual({ reply: messengerTexts.linked });
    });

    it("при перепривязке того же аккаунта к тому же пользователю сигнал приходит снова", async () => {
      const onLinked = vi.fn();
      const { store, linking } = setup(undefined, { onLinked });
      const first = await issue(store, linking, "anna");
      await linking.handleUpdate(update({ kind: "start", startPayload: first.code }));
      const second = await issue(store, linking, "anna");
      await linking.handleUpdate(update({ kind: "start", startPayload: second.code }));
      expect(onLinked).toHaveBeenCalledTimes(2);
      expect(onLinked).toHaveBeenLastCalledWith(linkOf("anna"));
    });

    it("аккаунт уже привязан к другому пользователю — чужой код его не переносит: отказ, привязка прежняя, сигналов нет", async () => {
      const onLinked = vi.fn();
      const { store, linking } = setup(undefined, { onLinked });
      const first = await issue(store, linking, "anna");
      await linking.handleUpdate(update({ kind: "start", startPayload: first.code }));
      const foreign = await issue(store, linking, "boris");
      expect(await linking.handleUpdate(update({ kind: "start", startPayload: foreign.code }))).toEqual({ reply: messengerTexts.linkTaken });
      expect((await store.findLink("telegram", "bot1", "100"))?.userId).toBe("anna");
      expect(onLinked).toHaveBeenCalledTimes(1);
    });
  });

  describe("адреса /links", () => {
    it("без пользователя — 401, чужой адрес — не наш", async () => {
      const { linking } = setup();
      expect((await linking.handleRequest(request("POST", "/links", undefined, { messenger: "telegram" }), "/links"))?.status).toBe(401);
      expect((await linking.handleRequest(request("GET", "/links"), "/links"))?.status).toBe(401);
      expect((await linking.handleRequest(request("DELETE", "/links/telegram"), "/links/telegram"))?.status).toBe(401);
      expect(await linking.handleRequest(request("GET", "/other", "anna"), "/other")).toBeNull();
    });

    it("приложение отказало в доступе словами — access_refused с его статусом и кодом, ничего не выдано", async () => {
      const { linking, store } = setup({ refused: { code: "no_course", message: "Нужен доступ к курсу", status: 401 } });
      const response = await linking.handleRequest(request("POST", "/links", "anna", { messenger: "telegram" }), "/links");
      expect(response?.status).toBe(401);
      expect(await response?.json()).toEqual({ error: { kind: "access_refused", code: "no_course", message: "Нужен доступ к курсу" } });
      expect(await store.listLinks("anna")).toEqual([]);
    });

    it("POST выдаёт ссылку и код; неизвестный мессенджер или кривое тело — 400", async () => {
      const { linking } = setup();
      const response = await linking.handleRequest(request("POST", "/links", "anna", { messenger: "telegram" }), "/links");
      expect(response?.status).toBe(200);
      const body = (await response?.json()) as { url: string; code: string; expiresAt: string };
      expect(body.url).toBe(`https://t.me/test_bot?start=${body.code}`);
      expect(body.expiresAt).toBe(new Date(NOW + 15 * 60_000).toISOString());
      expect((await linking.handleRequest(request("POST", "/links", "anna", { messenger: "max" }), "/links"))?.status).toBe(400);
      expect((await linking.handleRequest(request("POST", "/links", "anna", { messenger: 5 }), "/links"))?.status).toBe(400);
      const broken = new Request("https://app.test/api/messengers/links", { method: "POST", headers: { authorization: "token-anna" }, body: "{" });
      expect((await linking.handleRequest(broken, "/links"))?.status).toBe(400);
    });

    it("POST и DELETE с чужой страницы — 403 forbidden_origin, ничего не выдано и не снято; свои страницы и allowedOrigins проходят", async () => {
      const { store, linking } = setup();
      const { code } = await linking.issueCode("anna", "telegram");
      await linking.handleUpdate(update({ kind: "start", startPayload: code }));
      const fromSite = (method: string, path: string, site: string, origin: string, body?: unknown) => {
        const base = request(method, path, "anna", body);
        const headers = new Headers(base.headers);
        headers.set("sec-fetch-site", site);
        headers.set("origin", origin);
        return new Request(base, { headers });
      };
      const issued = await linking.handleRequest(fromSite("POST", "/links", "cross-site", "https://evil.test", { messenger: "telegram" }), "/links");
      expect(issued?.status).toBe(403);
      expect(await issued?.json()).toEqual({ error: { kind: "forbidden_origin" } });
      expect((await linking.handleRequest(fromSite("DELETE", "/links/telegram", "cross-site", "https://evil.test"), "/links/telegram"))?.status).toBe(403);
      expect(await store.findLink("telegram", "bot1", "100")).not.toBeNull();
      // Чтение чужой странице не покажут — его не проверяем; своя страница проходит.
      expect((await linking.handleRequest(fromSite("GET", "/links", "cross-site", "https://evil.test"), "/links"))?.status).toBe(200);
      expect((await linking.handleRequest(fromSite("POST", "/links", "same-origin", "https://app.test", { messenger: "telegram" }), "/links"))?.status).toBe(200);

      const allowed = createAccountLinking({
        store,
        bots: [createFakeAdapter().bot()],
        allowedOrigins: ["https://school.test"],
        resolveUser: async () => ({ id: "anna" }),
      });
      expect((await allowed.handleRequest(fromSite("POST", "/links", "cross-site", "https://school.test", { messenger: "telegram" }), "/links"))?.status).toBe(200);
    });

    it("битый адрес отвязки (`%`) — 400, а не сбой", async () => {
      const { linking } = setup();
      expect((await linking.handleRequest(request("DELETE", "/links/%E0%A4%A", "anna"), "/links/%E0%A4%A"))?.status).toBe(400);
    });

    it("тело запроса ссылки больше 1 МиБ не читается — 413", async () => {
      const { linking } = setup();
      const response = await linking.handleRequest(request("POST", "/links", "anna", { messenger: "telegram", pad: "x".repeat(2 * 1024 * 1024) }), "/links");
      expect(response?.status).toBe(413);
    });

    it("GET — подключённые мессенджеры и свои привязки; DELETE отвязывает", async () => {
      const { store, linking } = setup();
      const { code } = await linking.issueCode("anna", "telegram");
      await linking.handleUpdate(update({ kind: "start", startPayload: code }));
      const boris = await linking.issueCode("boris", "telegram");
      await linking.handleUpdate(update({ kind: "start", startPayload: boris.code, account: account({ externalUserId: "200", name: "Борис", username: undefined }) }));
      const response = await linking.handleRequest(request("GET", "/links", "anna"), "/links");
      expect(await response?.json()).toEqual({
        messengers: ["telegram", "vk"],
        links: [{ messenger: "telegram", name: "Анна", username: "anna_tg", linkedAt: new Date(NOW).toISOString() }],
      });
      const removed = await linking.handleRequest(request("DELETE", "/links/telegram", "anna"), "/links/telegram");
      expect(removed?.status).toBe(204);
      expect(await store.findLink("telegram", "bot1", "100")).toBeNull();
      expect(await store.findLink("telegram", "bot1", "200")).not.toBeNull();
      expect((await linking.handleRequest(request("DELETE", "/links/icq", "anna"), "/links/icq"))?.status).toBe(400);
      expect((await linking.handleRequest(request("PUT", "/links", "anna"), "/links"))?.status).toBe(405);
    });
  });
});
