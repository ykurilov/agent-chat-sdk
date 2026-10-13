import { afterEach, describe, expect, it } from "vitest";
import type { ConversationKey, MessengerConversation, MessengerLink, MessengerStore, PendingDelivery } from "../../src/types";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 12, minute)).toISOString();

const privateKey: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "100" };
const groupKey: ConversationKey = { messenger: "telegram", botId: "bot1", externalChatId: "-500" };

function link(overrides: Partial<MessengerLink> = {}): MessengerLink {
  return { messenger: "telegram", botId: "bot1", externalUserId: "100", userId: "anna", name: "Анна", username: "anna_tg", linkedAt: at(0), ...overrides };
}

function conversation(overrides: Partial<MessengerConversation> = {}): MessengerConversation {
  return { ...privateKey, type: "private", userId: "anna", blocked: false, active: true, createdAt: at(0), updatedAt: at(0), ...overrides };
}

function delivery(id: string, overrides: Partial<PendingDelivery> = {}): PendingDelivery {
  return { ...privateKey, id, chat: { id: "100", type: "private" }, message: { text: `Итог ${id}`, markup: "plain" }, createdAt: at(0), ...overrides };
}

/**
 * Проверки договора `MessengerStore`: каждое хранилище подключает их одной строкой.
 * Одновременные вызовы проверяют, что одноразовое (код, обновление, кнопка, аренда) отдаётся ровно одному.
 */
export function describeMessengerStoreContract(create: () => Promise<MessengerStore>): void {
  const opened: MessengerStore[] = [];
  afterEach(async () => {
    for (const store of opened.splice(0)) await store.close?.();
  });
  async function open(): Promise<MessengerStore> {
    const store = await create();
    opened.push(store);
    return store;
  }

  describe("коды привязки", () => {
    it("код принимается один раз и только до срока", async () => {
      const store = await open();
      await store.saveLinkCode({ codeHash: "h1", userId: "anna", messenger: "telegram", expiresAt: at(15) });
      await store.saveLinkCode({ codeHash: "h2", userId: "anna", messenger: "vk", expiresAt: at(15) });
      expect(await store.consumeLinkCode("h1", "vk", at(5))).toBeNull();
      expect(await store.consumeLinkCode("h1", "telegram", at(5))).toEqual({ userId: "anna" });
      expect(await store.consumeLinkCode("h1", "telegram", at(6))).toBeNull();
      expect(await store.consumeLinkCode("h2", "vk", at(15))).toBeNull();
      expect(await store.consumeLinkCode("нет такого", "telegram", at(1))).toBeNull();
    });

    it("одновременно код принимает только один", async () => {
      const store = await open();
      await store.saveLinkCode({ codeHash: "race", userId: "anna", messenger: "telegram", expiresAt: at(15) });
      const results = await Promise.all(Array.from({ length: 5 }, () => store.consumeLinkCode("race", "telegram", at(1))));
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });
  });

  describe("привязки", () => {
    it("сохранение, поиск, список пользователя, отвязка по мессенджеру", async () => {
      const store = await open();
      await store.saveLink(link());
      await store.saveLink(link({ messenger: "vk", botId: "club1", externalUserId: "7", username: undefined, linkedAt: at(1) }));
      await store.saveLink(link({ externalUserId: "200", userId: "boris", name: "Борис", username: undefined }));
      expect(await store.findLink("telegram", "bot1", "100")).toEqual(link());
      expect(await store.findLink("telegram", "bot2", "100")).toBeNull();
      expect((await store.listLinks("anna")).map((item) => item.messenger)).toEqual(["telegram", "vk"]);
      const vk = (await store.listLinks("anna"))[1];
      expect(vk).toEqual({ messenger: "vk", botId: "club1", externalUserId: "7", userId: "anna", name: "Анна", linkedAt: at(1) });
      await store.removeLinks("anna", "telegram");
      expect((await store.listLinks("anna")).map((item) => item.messenger)).toEqual(["vk"]);
      expect(await store.findLink("telegram", "bot1", "200")).not.toBeNull();
    });

    it("повторная привязка того же аккаунта переписывает пользователя", async () => {
      const store = await open();
      await store.saveLink(link());
      await store.saveLink(link({ userId: "boris", linkedAt: at(3) }));
      expect((await store.findLink("telegram", "bot1", "100"))?.userId).toBe("boris");
      expect(await store.listLinks("anna")).toEqual([]);
    });
  });

  describe("разговоры", () => {
    it("личный и групповой: тип, плательщик, текущий чат, блок, активность", async () => {
      const store = await open();
      expect(await store.getConversation(privateKey)).toBeNull();
      await store.saveConversation(conversation());
      await store.saveConversation(conversation({ ...groupKey, type: "group", userId: "boris", connectedBy: "boris", currentChatId: "chat-g" }));
      expect(await store.getConversation(privateKey)).toEqual(conversation());
      await store.setCurrentChat(privateKey, "chat-1", at(1));
      await store.setBlocked(privateKey, true, at(2));
      expect(await store.getConversation(privateKey)).toEqual(conversation({ currentChatId: "chat-1", blocked: true, updatedAt: at(2) }));
      await store.setCurrentChat(privateKey, null, at(3));
      await store.setBlocked(privateKey, false, at(3));
      expect(await store.getConversation(privateKey)).toEqual(conversation({ updatedAt: at(3) }));
      await store.setActive(groupKey, false, at(4));
      expect(await store.getConversation(groupKey)).toEqual(
        conversation({ ...groupKey, type: "group", userId: "boris", connectedBy: "boris", currentChatId: "chat-g", active: false, updatedAt: at(4) }),
      );
    });

    it("сохранение того же разговора переписывает его", async () => {
      const store = await open();
      await store.saveConversation(conversation());
      await store.saveConversation(conversation({ userId: "boris", currentChatId: "c2", updatedAt: at(5) }));
      expect(await store.getConversation(privateKey)).toEqual(conversation({ userId: "boris", currentChatId: "c2", updatedAt: at(5) }));
    });

    it("разговоры, у которых текущий чат — этот", async () => {
      const store = await open();
      await store.saveConversation(conversation({ currentChatId: "shared" }));
      await store.saveConversation(conversation({ ...groupKey, type: "group", currentChatId: "shared" }));
      await store.saveConversation(conversation({ externalChatId: "300", currentChatId: "other" }));
      expect((await store.listConversationsOfChat("shared")).map((item) => item.externalChatId).sort()).toEqual(["-500", "100"]);
      expect(await store.listConversationsOfChat("нет")).toEqual([]);
    });

    it("разговоры человека: личные и группы, где он плательщик", async () => {
      const store = await open();
      await store.saveConversation(conversation());
      await store.saveConversation(conversation({ ...groupKey, type: "group" }));
      await store.saveConversation(conversation({ externalChatId: "300", userId: "boris" }));
      expect((await store.listConversationsOfUser("anna")).map((item) => item.externalChatId).sort()).toEqual(["-500", "100"]);
      expect(await store.listConversationsOfUser("нет")).toEqual([]);
    });
  });

  describe("обращения участников группы", () => {
    it("считаются по участнику и группе с момента `since`", async () => {
      const store = await open();
      for (const [index, minute] of [0, 10, 20, 30].entries()) await store.addMemberHit({ ...groupKey, id: `hit-${index}`, externalUserId: "7", at: at(minute) });
      await store.addMemberHit({ ...groupKey, id: "other-member", externalUserId: "8", at: at(30) });
      await store.addMemberHit({ ...groupKey, externalChatId: "-600", id: "other-group", externalUserId: "7", at: at(30) });
      expect(await store.countMemberHits(groupKey, "7", at(10))).toBe(3);
      expect(await store.countMemberHits(groupKey, "7", at(31))).toBe(0);
      expect(await store.countMemberHits(groupKey, "8", at(0))).toBe(1);
    });
  });

  describe("обновления", () => {
    it("первое принятие — true, повтор того же ключа — false, даже после окончания", async () => {
      const store = await open();
      expect(await store.claimUpdate("telegram:bot1:1", at(0))).toBe(true);
      expect(await store.claimUpdate("telegram:bot1:1", at(1))).toBe(false);
      await store.finishUpdate("telegram:bot1:1", "done", at(2));
      expect(await store.claimUpdate("telegram:bot1:1", at(3))).toBe(false);
      expect(await store.claimUpdate("telegram:bot1:2", at(3))).toBe(true);
      await store.finishUpdate("telegram:bot1:2", "failed", at(4));
    });

    it("одновременный повтор принимает только один", async () => {
      const store = await open();
      const results = await Promise.all(Array.from({ length: 5 }, () => store.claimUpdate("dup", at(0))));
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    const bot1 = { messenger: "telegram", botId: "bot1" } as const;
    const work = (holder: string, leaseUntil: string, text: string, botId = "bot1") => ({
      messenger: "telegram" as const,
      botId,
      update: { key: text, chat: { id: "100", type: "private" }, kind: "text", text, files: [{ fileId: "f1", size: 3 }] },
      holder,
      leaseUntil,
    });

    it("обновление в работе за держателем до срока; после срока его забирает другой — с содержимым, по порядку приёма, со счётом попыток", async () => {
      const store = await open();
      expect(await store.claimUpdate("u2", at(1), work("a", at(5), "второе"))).toBe(true);
      expect(await store.claimUpdate("u1", at(0), work("a", at(5), "первое"))).toBe(true);
      await store.claimUpdate("mark", at(0));
      await store.claimUpdate("other-bot", at(0), work("a", at(5), "чужое", "bot2"));
      expect(await store.claimUpdate("u1", at(2), work("b", at(9), "первое"))).toBe(false);
      expect(await store.takeAbandonedUpdates(bot1, "b", at(4), at(9), 10)).toEqual([]);

      const taken = await store.takeAbandonedUpdates(bot1, "b", at(5), at(9), 10);
      expect(taken).toEqual([
        { key: "u1", update: work("a", at(5), "первое").update, receivedAt: at(0), attempts: 1 },
        { key: "u2", update: work("a", at(5), "второе").update, receivedAt: at(1), attempts: 1 },
      ]);
      expect(await store.takeAbandonedUpdates(bot1, "c", at(6), at(10), 10)).toEqual([]);
      expect((await store.takeAbandonedUpdates(bot1, "c", at(9), at(12), 1)).map((item) => [item.key, item.attempts])).toEqual([["u1", 2]]);
    });

    it("держатель продлевает только названные свои обновления; законченное не возвращается; отпущенное — после паузы", async () => {
      const store = await open();
      await store.claimUpdate("mine", at(0), work("a", at(5), "моё"));
      await store.claimUpdate("theirs", at(0), work("b", at(5), "чужое"));
      await store.claimUpdate("finished", at(0), work("a", at(5), "готово"));
      await store.claimUpdate("failed", at(0), work("a", at(5), "сбой"));
      await store.renewUpdates(["mine", "theirs", "finished"], "a", at(20));
      await store.finishUpdate("finished", "done", at(1));
      await store.finishUpdate("failed", "failed", at(1));
      expect((await store.takeAbandonedUpdates(bot1, "c", at(10), at(30), 10)).map((item) => item.key)).toEqual(["theirs"]);

      await store.releaseUpdate("mine", "x", at(10));
      await store.releaseUpdate("mine", "a", at(15));
      expect(await store.takeAbandonedUpdates(bot1, "c", at(14), at(30), 10)).toEqual([]);
      expect((await store.takeAbandonedUpdates(bot1, "c", at(15), at(30), 10)).map((item) => item.key)).toEqual(["mine"]);
      await store.renewUpdates(["mine"], "a", at(60));
      expect((await store.takeAbandonedUpdates(bot1, "d", at(31), at(40), 10)).map((item) => item.key)).toContain("mine");
    });

    it("одновременно брошенное обновление забирает один", async () => {
      const store = await open();
      await store.claimUpdate("u1", at(0), work("a", at(1), "одно"));
      const results = await Promise.all(["b", "c", "d"].map((holder) => store.takeAbandonedUpdates(bot1, holder, at(2), at(9), 10)));
      expect(results.flat().map((item) => item.key)).toEqual(["u1"]);
    });
  });

  describe("кнопки", () => {
    it("действие отдаётся один раз и только своему чату", async () => {
      const store = await open();
      const action = { type: "approval", chatId: "c1", approvalId: "a1", answer: "allow", nested: { list: [1, 2] } };
      await store.saveButton({ ...privateKey, id: "Ab3dE6gH", action, createdAt: at(0) });
      expect(await store.takeButton(groupKey, "Ab3dE6gH", at(1))).toBeNull();
      expect(await store.takeButton(privateKey, "Ab3dE6gH", at(1))).toEqual(action);
      expect(await store.takeButton(privateKey, "Ab3dE6gH", at(2))).toBeNull();
      expect(await store.takeButton(privateKey, "unknown1", at(2))).toBeNull();
    });

    it("одновременное нажатие засчитывается один раз", async () => {
      const store = await open();
      await store.saveButton({ ...privateKey, id: "race0001", action: { type: "x" }, createdAt: at(0) });
      const results = await Promise.all(Array.from({ length: 5 }, () => store.takeButton(privateKey, "race0001", at(1))));
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });
  });

  describe("аренды", () => {
    it("занята до срока; тот же держатель продлевает; после срока перехватывает другой; отпускает только держатель", async () => {
      const store = await open();
      expect(await store.acquireLease("poll:telegram:bot1", "copy-a", at(1), at(0))).toBe(true);
      expect(await store.acquireLease("poll:telegram:bot1", "copy-b", at(1), at(0))).toBe(false);
      expect(await store.acquireLease("poll:telegram:bot1", "copy-a", at(2), at(1))).toBe(true);
      expect(await store.acquireLease("poll:telegram:bot1", "copy-b", at(3), at(1))).toBe(false);
      expect(await store.acquireLease("poll:telegram:bot1", "copy-b", at(4), at(2))).toBe(true);
      await store.releaseLease("poll:telegram:bot1", "copy-a");
      expect(await store.acquireLease("poll:telegram:bot1", "copy-a", at(5), at(3))).toBe(false);
      await store.releaseLease("poll:telegram:bot1", "copy-b");
      expect(await store.acquireLease("poll:telegram:bot1", "copy-a", at(5), at(3))).toBe(true);
    });

    it("одновременно свободную аренду берёт один", async () => {
      const store = await open();
      const results = await Promise.all(["a", "b", "c", "d"].map((holder) => store.acquireLease("lease", holder, at(5), at(0))));
      expect(results.filter(Boolean)).toHaveLength(1);
    });
  });

  describe("очередь отправки", () => {
    it("итог за держателем до срока; после срока его забирает другой — по порядку, со всем содержимым", async () => {
      const store = await open();
      const full = delivery("d1", {
        message: { text: "<b>Итог</b>", markup: "html", buttons: [[{ id: "btn00001", text: "Да" }]] },
        edit: { chat: { id: "100", type: "private" }, messageId: "77" },
        rows: [[{ id: "btn00001", text: "Да", action: { type: "reply", text: "да" } }]],
      });
      await store.savePendingDelivery(full, "a", at(5));
      await store.savePendingDelivery(delivery("d2"), "a", at(5));
      await store.savePendingDelivery(delivery("other-bot", { botId: "bot2" }), "a", at(5));
      expect(await store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, "b", at(4), at(9), 10)).toEqual([]);

      const taken = await store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, "b", at(5), at(9), 10);
      expect(taken).toEqual([full, delivery("d2")]);
      expect(await store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, "c", at(6), at(10), 10)).toEqual([]);
      expect(await store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, "c", at(9), at(12), 1)).toEqual([full]);
    });

    it("держатель продлевает свои итоги; удалённый итог не возвращается", async () => {
      const store = await open();
      await store.savePendingDelivery(delivery("mine"), "a", at(5));
      await store.savePendingDelivery(delivery("theirs"), "b", at(5));
      await store.savePendingDelivery(delivery("sent"), "a", at(5));
      await store.deletePendingDelivery("sent");
      await store.renewPendingDeliveries("a", at(20));
      const taken = await store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, "c", at(10), at(30), 10);
      expect(taken.map((item) => item.id)).toEqual(["theirs"]);
    });

    it("одновременно брошенный итог забирает один", async () => {
      const store = await open();
      await store.savePendingDelivery(delivery("d1"), "a", at(1));
      const results = await Promise.all(["b", "c", "d"].map((holder) => store.takeAbandonedDeliveries({ messenger: "telegram", botId: "bot1" }, holder, at(2), at(9), 10)));
      expect(results.flat().map((item) => item.id)).toEqual(["d1"]);
    });
  });

  it("purgeBefore не убирает обновление с живой арендой, как бы старо оно ни было; законченное, брошенное и забытое — убирает", async () => {
    const store = await open();
    const bot = { messenger: "telegram", botId: "bot1" } as const;
    const work = (holder: string, leaseUntil: string, botId = "bot1") => ({ ...bot, botId, update: { text: "старое" }, holder, leaseUntil });
    // Принято давно, аренда ещё идёт (копия продлевает) или отпущено на повтор позже начала срока хранения.
    await store.claimUpdate("in-work", at(1), work("a", at(20)));
    await store.claimUpdate("released", at(1), work("a", at(2)));
    await store.releaseUpdate("released", "a", at(15));
    await store.claimUpdate("done", at(1), work("a", at(2)));
    await store.finishUpdate("done", "done", at(2));
    await store.claimUpdate("given-up", at(1), work("a", at(2)));
    await store.finishUpdate("given-up", "failed", at(2));
    // Бот убран из настроек: его обновление никто не подберёт, аренда истекла давно.
    await store.claimUpdate("orphan", at(1), work("a", at(2), "removed-bot"));
    await store.purgeBefore(at(10));
    expect(await store.claimUpdate("done", at(11))).toBe(true);
    expect(await store.claimUpdate("given-up", at(11))).toBe(true);
    expect(await store.claimUpdate("orphan", at(11))).toBe(true);
    expect(await store.claimUpdate("in-work", at(11))).toBe(false);
    expect(await store.claimUpdate("released", at(11))).toBe(false);
    expect((await store.takeAbandonedUpdates(bot, "b", at(20), at(30), 10)).map((item) => item.key).sort()).toEqual(["in-work", "released"]);
  });

  it("purgeBefore убирает старые коды, обновления, кнопки и обращения, привязки и разговоры остаются", async () => {
    const store = await open();
    await store.saveLink(link());
    await store.saveConversation(conversation());
    await store.saveLinkCode({ codeHash: "old", userId: "anna", messenger: "telegram", expiresAt: at(5) });
    await store.saveLinkCode({ codeHash: "fresh", userId: "anna", messenger: "telegram", expiresAt: at(40) });
    await store.claimUpdate("old-update", at(1));
    await store.saveButton({ ...privateKey, id: "oldbtn01", action: { type: "x" }, createdAt: at(1) });
    await store.saveButton({ ...privateKey, id: "newbtn01", action: { type: "x" }, createdAt: at(30) });
    await store.addMemberHit({ ...groupKey, id: "old-hit", externalUserId: "7", at: at(1) });
    await store.addMemberHit({ ...groupKey, id: "new-hit", externalUserId: "7", at: at(30) });
    await store.purgeBefore(at(10));
    expect(await store.claimUpdate("old-update", at(11))).toBe(true);
    expect(await store.takeButton(privateKey, "oldbtn01", at(11))).toBeNull();
    expect(await store.takeButton(privateKey, "newbtn01", at(11))).toEqual({ type: "x" });
    expect(await store.countMemberHits(groupKey, "7", at(0))).toBe(1);
    expect(await store.consumeLinkCode("fresh", "telegram", at(11))).not.toBeNull();
    expect(await store.findLink("telegram", "bot1", "100")).not.toBeNull();
    expect(await store.getConversation(privateKey)).not.toBeNull();
  });
}
