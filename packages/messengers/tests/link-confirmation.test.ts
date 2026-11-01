import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountLinking } from "../src/account-linking";
import { createMemoryMessengerStore } from "../src/store/memory-store";
import { account, createFakeAdapter, update } from "./support/fake-adapter";
import type { InboundUpdate, MessengerName } from "../src/messenger-adapter";

function setup(messenger: MessengerName = "telegram") {
  const store = createMemoryMessengerStore();
  const fake = createFakeAdapter({ messenger });
  const onLinked = vi.fn();
  const label = vi.fn(async (userId: string) => `${userId[0]}***@mail.test`);
  const deps = { store, bots: [fake.bot()], resolveUser: async () => ({ id: "anna" }), linkConfirmation: { label }, onLinked };
  const linking = createAccountLinking(deps);
  const inbound = (overrides: Partial<InboundUpdate> = {}) => update({ account: account({ messenger }), ...overrides });
  const open = async (userId = "anna") => {
    const offer = await linking.issueCode(userId, messenger);
    const result = await linking.handleUpdate(inbound({ kind: "start", startPayload: offer.code }));
    return { offer, result, buttonId: result?.buttons?.[0]?.[0]?.id as string };
  };
  const press = (buttonId: string, overrides: Partial<InboundUpdate> = {}) => inbound({ kind: "button", buttonId, callbackId: "callback", ...overrides });
  return { store, deps, linking, inbound, open, press, label, onLinked };
}

afterEach(() => vi.useRealTimers());

describe.each(["telegram", "vk"] as const)("подтверждение привязки: %s", (messenger) => {
  it("открытие только показывает подпись; после перезапуска кнопка связывает один раз", async () => {
    const { store, deps, open, press, label, onLinked } = setup(messenger);
    const saveButton = vi.spyOn(store, "saveButton");
    const { result, buttonId } = await open();
    expect(saveButton).toHaveBeenCalledWith(expect.objectContaining({
      messenger, botId: "bot1", externalChatId: "100", id: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(saveButton.mock.calls[0]![0].id).not.toBe(buttonId);
    expect(result?.reply).toContain("a***@mail.test");
    expect(result?.buttons?.[0]?.[0]?.text).toBe("Да");
    expect(buttonId).toMatch(/^link_[A-Za-z0-9_-]{22}$/);
    expect(label).toHaveBeenCalledWith("anna", expect.objectContaining({ messenger, externalUserId: "100" }));
    expect(await store.findLink(messenger, "bot1", "100")).toBeNull();
    expect(await store.listConversationsOfUser("anna")).toEqual([]);
    expect(onLinked).not.toHaveBeenCalled();
    const restarted = createAccountLinking(deps);
    const results = await Promise.all([restarted.handleUpdate(press(buttonId)), restarted.handleUpdate(press(buttonId))]);
    expect(results.filter((item) => item?.reply === "Готово: аккаунт подключён.")).toHaveLength(1);
    expect((await store.findLink(messenger, "bot1", "100"))?.userId).toBe("anna");
    expect(await store.listConversationsOfUser("anna")).toHaveLength(1);
    expect(onLinked).toHaveBeenCalledTimes(1);
  });

  it("чужой аккаунт, чат, бот и группа не могут забрать или сжечь подтверждение", async () => {
    const { linking, store, open, press } = setup(messenger);
    const { buttonId } = await open();
    for (const overrides of [
      { account: account({ messenger, externalUserId: "200" }) },
      { chat: { id: "200", type: "private" as const } },
      { account: account({ messenger, botId: "other" }) },
      { account: account({ messenger: messenger === "vk" ? "telegram" : "vk" }) },
      { chat: { id: "100", type: "group" as const } },
    ]) await linking.handleUpdate(press(buttonId, overrides));
    expect(await store.findLink(messenger, "bot1", "100")).toBeNull();
    expect((await linking.handleUpdate(press(buttonId)))?.reply).toBe("Готово: аккаунт подключён.");
  });

  it("код сгорает при открытии; слова «да» и прямой redeem не обходят кнопку", async () => {
    const { linking, store, open, inbound } = setup(messenger);
    const { offer } = await open();
    expect(await linking.handleUpdate(inbound({ kind: "text", text: "Да" }))).toBeNull();
    expect((await linking.handleUpdate(inbound({ kind: "start", startPayload: offer.code })))?.buttons).toBeUndefined();
    const fresh = await linking.issueCode("anna", messenger);
    expect(await linking.redeem(fresh.code, inbound().account)).toBe("failed");
    expect(await store.findLink(messenger, "bot1", "100")).toBeNull();
  });

  it("кнопка истекает через 15 минут; занятый аккаунт не переносится", async () => {
    vi.useFakeTimers();
    const { linking, store, open, press, onLinked } = setup(messenger);
    const { buttonId } = await open();
    vi.advanceTimersByTime(15 * 60_000);
    expect((await linking.handleUpdate(press(buttonId)))?.reply).toContain("не подошёл");
    expect(onLinked).not.toHaveBeenCalled();
    const next = await open();
    await store.saveLink({ messenger, botId: "bot1", externalUserId: "100", userId: "boris", name: "Анна", linkedAt: new Date().toISOString() });
    expect((await linking.handleUpdate(press(next.buttonId)))?.reply).toContain("другому");
    expect((await store.findLink(messenger, "bot1", "100"))?.userId).toBe("boris");
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("ошибка/пустая подпись закрывает привязку, отключение опции инвалидирует старую кнопку", async () => {
    const { linking, deps, open, press, label, store } = setup(messenger);
    label.mockResolvedValueOnce("");
    await expect(open()).rejects.toThrow();
    label.mockRejectedValueOnce(new Error("label unavailable"));
    await expect(open()).rejects.toThrow("label unavailable");
    const { buttonId } = await open();
    const { linkConfirmation: _confirmation, ...withoutConfirmation } = deps;
    const disabled = createAccountLinking(withoutConfirmation);
    expect((await disabled.handleUpdate(press(buttonId)))?.reply).toContain("не подошёл");
    expect(await store.findLink(messenger, "bot1", "100")).toBeNull();
    expect(await linking.handleUpdate(press("unrelated"))).toBeNull();
  });
});

it("SQLite: закрытие файла и новый экземпляр сохраняют разрешение и одноразовость", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createSqliteMessengerStore } = await import("../src/sqlite");
  const folder = await mkdtemp(join(tmpdir(), "link-confirmation-"));
  const filePath = join(folder, "messengers.db");
  let store = await createSqliteMessengerStore({ filePath });
  const deps = { bots: [createFakeAdapter().bot()], resolveUser: async () => null, linkConfirmation: { label: () => "a***@mail.test" } };
  try {
    const first = createAccountLinking({ ...deps, store });
    const { code } = await first.issueCode("anna", "telegram");
    const result = await first.handleUpdate(update({ kind: "start", startPayload: code }));
    const buttonId = result!.buttons![0]![0]!.id;
    await store.close();
    store = await createSqliteMessengerStore({ filePath });
    const second = createAccountLinking({ ...deps, store });
    const callback = () => update({ kind: "button", buttonId });
    expect((await second.handleUpdate(callback()))?.reply).toBe("Готово: аккаунт подключён.");
    await store.close();
    store = await createSqliteMessengerStore({ filePath });
    const third = createAccountLinking({ ...deps, store });
    expect((await third.handleUpdate(callback()))?.reply).toContain("не подошёл");
    expect((await store.findLink("telegram", "bot1", "100"))?.userId).toBe("anna");
  } finally {
    await store.close();
    await rm(folder, { recursive: true, force: true });
  }
});
