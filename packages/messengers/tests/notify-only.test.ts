import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessengers } from "../src/create-messengers";
import type { InboundUpdate } from "../src/messenger-adapter";
import { defaultMessengerTextsWithoutChat, messengerTexts } from "../src/messenger-texts";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import type { MessengerLink, MessengersOptions } from "../src/types";
import { account, createFakeAdapter, groupChat, update } from "./support/fake-adapter";
import { createFakeChatService } from "./support/fake-chat-service";

const NOW = Date.UTC(2026, 9, 7, 12, 0);
const BASE = "/api/messengers";

type Overrides = Partial<Omit<MessengersOptions, "service">> & { withService?: boolean };

/** Мессенджеры с поддельным ботом; `withService: false` — без службы чата (только привязка и уведомления). */
function setup(overrides: Overrides = {}) {
  const { withService = true, ...options } = overrides;
  const fake = createFakeAdapter();
  const store = createMemoryMessengerStore();
  const chats = createFakeChatService();
  const errors: unknown[] = [];
  const common = {
    store,
    resolveUser: async (request: Request) => (request.headers.get("x-user") ? { id: request.headers.get("x-user") as string } : null),
    bots: [fake.bot()],
    basePath: BASE,
    logError: (error: unknown) => errors.push(error),
    ...options,
  };
  const messengers = withService ? createMessengers({ ...common, service: chats.service } as MessengersOptions) : createMessengers(common as MessengersOptions);
  const post = (updates: InboundUpdate[]) =>
    messengers.handler.fetch(
      new Request(`http://app${BASE}/telegram/webhook`, { method: "POST", headers: { "x-secret": "webhook-secret", "content-type": "application/json" }, body: JSON.stringify({ updates }) }),
    );
  const call = (method: string, path: string, user = "anna", body?: unknown) =>
    messengers.handler.fetch(
      new Request(`http://app${BASE}${path}`, {
        method,
        headers: { "x-user": user, "content-type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
    );
  /** Привязка тем же путём, что у человека: код из приложения, `/start <код>` в боте. */
  const linkThroughBot = async (user = "anna", externalUserId = "100") => {
    const { code } = (await (await call("POST", "/links", user, { messenger: "telegram" })).json()) as { code: string };
    await post([update({ kind: "command", text: `/start ${code}`, account: account({ externalUserId }) })]);
    await settle();
  };
  const settle = async () => {
    let finished = false;
    const done = messengers.flush().then(() => {
      finished = true;
    });
    for (let step = 0; step < 100 && !finished; step++) await vi.advanceTimersByTimeAsync(500);
    await done;
  };
  return { fake, store, chats, errors, messengers, post, call, linkThroughBot, settle };
}

const menuOf = (fake: ReturnType<typeof createFakeAdapter>) => fake.commands.map((item) => [item.scope, item.commands.map((entry) => entry.command)]);

describe("меню команд по желанию", () => {
  it("по умолчанию — как раньше: start() ставит меню личных чатов, а с группами — и групповых", async () => {
    const plain = setup();
    await plain.messengers.start();
    expect(menuOf(plain.fake)).toEqual([["private", ["help", "stop"]]]);
    await plain.messengers.stop();

    const withGroups = setup({ conversations: "many", groups: {} });
    await withGroups.messengers.start();
    expect(menuOf(withGroups.fake)).toEqual([
      ["private", ["new", "chats", "help", "stop"]],
      ["group", ["connect", "disconnect", "help", "stop"]],
    ]);
    await withGroups.messengers.stop();
  });

  it("commandsMenu: false в createMessengers — меню не ставится, а поставленное раньше снимается в обеих областях", async () => {
    const { fake, messengers } = setup({ commandsMenu: false, groups: {} });
    await messengers.start();
    expect(menuOf(fake)).toEqual([
      ["private", []],
      ["group", []],
    ]);
    await messengers.stop();
  });

  it("настройка бота главнее общей: общая false, у бота true — меню ставится; общая по умолчанию, у бота false — снимается", async () => {
    const on = createFakeAdapter();
    const off = createFakeAdapter({ messenger: "max" });
    const messengers = createMessengers({
      service: createFakeChatService().service,
      store: createMemoryMessengerStore(),
      resolveUser: async () => null,
      bots: [on.bot({ commandsMenu: true }), off.bot({ messenger: "max", botId: "max1", commandsMenu: false })],
      basePath: BASE,
      commandsMenu: false,
    });
    await messengers.start();
    expect(menuOf(on)).toEqual([["private", ["help", "stop"]]]);
    expect(menuOf(off)).toEqual([
      ["private", []],
      ["group", []],
    ]);
    await messengers.stop();

    const offOnly = createFakeAdapter();
    const second = createMessengers({
      service: createFakeChatService().service,
      store: createMemoryMessengerStore(),
      resolveUser: async () => null,
      bots: [offOnly.bot({ commandsMenu: false })],
      basePath: BASE,
    });
    await second.start();
    expect(menuOf(offOnly)).toEqual([
      ["private", []],
      ["group", []],
    ]);
    await second.stop();
  });

  it("мессенджер без меню (VK) — ни поставить, ни снять нечего: setCommands не зовётся", async () => {
    const vk = createFakeAdapter({ messenger: "vk", abilities: { commandsMenu: false } });
    const messengers = createMessengers({
      store: createMemoryMessengerStore(),
      resolveUser: async () => null,
      bots: [vk.bot({ messenger: "vk", botId: "vk1", commandsMenu: false })],
      basePath: BASE,
    });
    await messengers.start();
    expect(vk.commands).toEqual([]);
    await messengers.stop();
  });

  it("ошибка постановки или снятия меню не роняет start(): она в logError, бот работает", async () => {
    for (const commandsMenu of [true, false]) {
      const failure = new Error("меню недоступно");
      const { fake, errors, messengers } = setup({ commandsMenu });
      fake.adapter.setCommands = async () => {
        throw failure;
      };
      await expect(messengers.start()).resolves.toBeUndefined();
      expect(errors).toContain(failure);
      await messengers.stop();
    }
  });

  it("без службы чата меню снимается: команд, которые бот выполняет, нет", async () => {
    const { fake, messengers } = setup({ withService: false });
    await messengers.start();
    expect(menuOf(fake)).toEqual([
      ["private", []],
      ["group", []],
    ]);
    await messengers.stop();
  });
});

describe("без службы чата: только привязка и уведомления", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("привязка и onLinked работают; непривязанному — howToConnect без обещания разговора", async () => {
    const onLinked = vi.fn();
    const { fake, store, errors, messengers, post, linkThroughBot, settle } = setup({ withService: false, onLinked });
    await messengers.start();
    await post([update({ text: "Привет" })]);
    await settle();
    expect(fake.texts()).toEqual([defaultMessengerTextsWithoutChat.howToConnect]);

    await linkThroughBot();
    expect(fake.texts().at(-1)).toBe(defaultMessengerTextsWithoutChat.linked);
    expect(onLinked).toHaveBeenCalledWith(await store.findLink("telegram", "bot1", "100"));
    expect(errors).toEqual([]);
    await messengers.stop();
  });

  it("фразы по умолчанию без чата не обещают разговор; порядок: бот → общая → умолчание без чата", async () => {
    expect(defaultMessengerTextsWithoutChat.linked).toBe("Готово: аккаунт подключён.");
    for (const text of [defaultMessengerTextsWithoutChat.linked, defaultMessengerTextsWithoutChat.howToConnect]) {
      expect(text).not.toMatch(/отвеч|пишите/i);
    }
    const general = setup({ withService: false, texts: { linked: "Общая: подключено." } });
    await general.linkThroughBot();
    expect(general.fake.texts().at(-1)).toBe("Общая: подключено.");

    const fake = createFakeAdapter();
    const store = createMemoryMessengerStore();
    const messengers = createMessengers({
      store,
      resolveUser: async () => ({ id: "anna" }),
      bots: [fake.bot({ texts: { howToConnect: "Бот: подключитесь." } })],
      basePath: BASE,
      texts: { howToConnect: "Общая: подключитесь." },
    });
    await messengers.handler.fetch(
      new Request(`http://app${BASE}/telegram/webhook`, { method: "POST", headers: { "x-secret": "webhook-secret" }, body: JSON.stringify({ updates: [update()] }) }),
    );
    await messengers.flush();
    expect(fake.texts()).toEqual(["Бот: подключитесь."]);
  });

  it("со службой чата фразы по умолчанию прежние", async () => {
    const { fake, post, linkThroughBot, settle } = setup();
    await post([update({ text: "Привет" })]);
    await settle();
    expect(fake.texts()).toEqual([messengerTexts.howToConnect]);
    await linkThroughBot();
    expect(fake.texts().at(-1)).toBe(messengerTexts.linked);
  });

  it("привязанный пишет что угодно — фраза notifyOnly, ход не начинается, файлы и голос не скачиваются, ничего не падает", async () => {
    const { fake, errors, messengers, post, linkThroughBot, settle } = setup({ withService: false });
    await messengers.start();
    await linkThroughBot();
    const before = fake.sent.length;
    await post([
      update({ text: "Привет" }),
      update({ kind: "command", text: "/start" }),
      update({ kind: "command", text: "/help" }),
      update({ kind: "command", text: "/new" }),
      update({ kind: "voice", files: [{ fileId: "voice-1", durationMs: 3000 }] }),
      update({ kind: "files", files: [{ fileId: "file-1", name: "a.pdf" }] }),
    ]);
    await settle();
    await post([update({ kind: "command", text: "/stop" })]);
    await settle();
    expect(fake.texts().slice(before)).toEqual(Array(7).fill(messengerTexts.notifyOnly));
    expect(fake.downloads).toEqual([]);
    expect(errors).toEqual([]);
    await messengers.stop();
  });

  it("кнопка привязанного: нажатие подтверждается (без вечного значка), в ответ — notifyOnly", async () => {
    const { fake, errors, messengers, post, linkThroughBot, settle } = setup({ withService: false });
    await messengers.start();
    await linkThroughBot();
    const before = fake.sent.length;
    await post([update({ kind: "button", buttonId: "7", callbackId: "cb-1" })]);
    await settle();
    expect(fake.answers).toHaveLength(1);
    expect(fake.answers[0]?.text).toBeUndefined();
    expect(fake.texts().slice(before)).toEqual([messengerTexts.notifyOnly]);
    expect(errors).toEqual([]);
    await messengers.stop();
  });

  it("пустая notifyOnly — тишина; отказ resolveAccount главнее и звучит своим текстом", async () => {
    const silent = setup({ withService: false, texts: { notifyOnly: "" } });
    await silent.linkThroughBot();
    const before = silent.fake.sent.length;
    await silent.post([update({ text: "Привет" }), update({ kind: "command", text: "/stop" })]);
    await silent.settle();
    expect(silent.fake.texts().slice(before)).toEqual([]);
    expect(silent.errors).toEqual([]);

    const refusing = setup({ withService: false, resolveAccount: async () => ({ refuse: "Сюда писать не нужно." }) });
    await refusing.linkThroughBot();
    await refusing.post([update({ text: "Привет" }), update({ kind: "command", text: "/stop" })]);
    await refusing.settle();
    expect(refusing.fake.texts().slice(-2)).toEqual(["Сюда писать не нужно.", "Сюда писать не нужно."]);
  });

  it("группа — один раз writeInPrivate, как при выключенных группах", async () => {
    const { fake, errors, post, settle } = setup({ withService: false });
    await post([update({ chat: groupChat, group: { mentioned: true, replyToBot: false } }), update({ chat: groupChat, kind: "command", text: "/stop" })]);
    await settle();
    expect(fake.texts()).toEqual([messengerTexts.writeInPrivate]);
    expect(errors).toEqual([]);
  });

  it("типы: без service нельзя задать то, что без чата не работает", () => {
    const base = { store: createMemoryMessengerStore(), resolveUser: async () => null, bots: [], basePath: BASE };
    createMessengers(base);
    createMessengers({ ...base, resolveAccount: async () => ({ refuse: "" }), onLinked: () => {}, onUnlinked: () => {}, texts: { notifyOnly: "" }, commandsMenu: false });
    // @ts-expect-error группы без службы чата не работают
    createMessengers({ ...base, groups: {} });
    // @ts-expect-error голосовые ответы без службы чата не работают
    createMessengers({ ...base, voiceReplies: { speak: async () => ({ skipped: "unavailable" as const }) } });
    // @ts-expect-error «Задача готова» без службы чата не работает
    createMessengers({ ...base, taskReadyPing: true });
    // @ts-expect-error режим разговоров без службы чата не работает
    createMessengers({ ...base, conversations: "many" });
  });
});

describe("onUnlinked", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("DELETE /links/<мессенджер> — сигнал на каждую снятую привязку, уже после удаления", async () => {
    const seen: Array<{ link: MessengerLink; stillThere: boolean }> = [];
    const { store, call, linkThroughBot } = setup({
      onUnlinked: async (link) => {
        seen.push({ link, stillThere: (await store.findLink(link.messenger, link.botId, link.externalUserId)) !== null });
      },
    });
    await linkThroughBot("anna", "100");
    await linkThroughBot("anna", "200");
    const links = await store.listLinks("anna");
    expect(links).toHaveLength(2);

    expect((await call("DELETE", "/links/telegram")).status).toBe(204);
    expect(seen.map((item) => item.link)).toEqual(links);
    expect(seen.every((item) => !item.stillThere)).toBe(true);
  });

  it("сбой onUnlinked отвязку не отменяет: 204, привязки нет, ошибка в logError; нечего снимать — сигнала нет", async () => {
    const failure = new Error("рассылка недоступна");
    const onUnlinked = vi.fn().mockRejectedValue(failure);
    const { store, errors, call, linkThroughBot } = setup({ onUnlinked });
    await linkThroughBot();
    expect((await call("DELETE", "/links/telegram")).status).toBe(204);
    expect(await store.listLinks("anna")).toEqual([]);
    expect(errors).toEqual([failure]);

    expect((await call("DELETE", "/links/telegram")).status).toBe(204);
    expect(onUnlinked).toHaveBeenCalledTimes(1);
  });

  it("тот же аккаунт мессенджера пробует привязать другой пользователь — отказ: прежняя привязка остаётся, сигналов нет", async () => {
    const order: string[] = [];
    const { linkThroughBot } = setup({
      onLinked: (link) => {
        order.push(`linked:${link.userId}`);
      },
      onUnlinked: (link) => {
        order.push(`unlinked:${link.userId}`);
      },
    });
    await linkThroughBot("anna");
    await linkThroughBot("anna");
    await linkThroughBot("boris");
    expect(order).toEqual(["linked:anna", "linked:anna"]);
  });

  it("без onUnlinked отвязка работает как раньше", async () => {
    const { store, call, linkThroughBot, errors } = setup();
    await linkThroughBot();
    expect((await call("DELETE", "/links/telegram")).status).toBe(204);
    expect(await store.listLinks("anna")).toEqual([]);
    expect(errors).toEqual([]);
  });
});
