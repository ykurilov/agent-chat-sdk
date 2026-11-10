import { afterEach, describe, expect, it } from "vitest";
import { messengerTexts } from "../../src/messenger-texts";
import { anna, boris } from "../fake-apis/rig";
import { allChannels } from "./support/channels";
import { BASE_PATH, type RealChat, startRealChat } from "./support/real-chat";

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

/** Человек нажал «Отключить» в приложении. */
async function unlink(real: RealChat, userId: string) {
  const response = await real.messengers.handler.fetch(
    new Request(`http://app.test${BASE_PATH}/links/${real.channel.messenger}`, { method: "DELETE", headers: { "x-user": userId } }),
  );
  expect(response.status).toBe(204);
  await real.settle();
}

describe.each(allChannels)("отвязка мессенджера выключает его разговоры, $name", ({ open }) => {
  async function linkedChat() {
    const real = await startRealChat({
      channel: await open(),
      messengers: { groups: {}, linkConfirmation: false, resolveUser: async (request) => ({ id: request.headers.get("x-user") ?? "anna" }) },
    });
    await real.link(anna, "anna");
    return real;
  }

  it("ход по служебному сообщению (агент пишет первым) после отвязки в отвязанный аккаунт не уходит", async () => {
    chat = await linkedChat();
    const dialog = chat.channel.privateChatOf(anna);
    await chat.human({ type: "text", chat: dialog, from: anna, text: "Привет" });
    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1"]);
    const [current] = await chat.service.listChats("anna");

    await unlink(chat, "anna");
    await chat.service.deliverNotices({ ownerId: "anna", chatId: current!.id, notices: [{ kind: "app", name: "flow_timer", title: "Прошло два дня" }], wakeAgent: true, deliveryKey: "timer-1" });
    await chat.until(() => (chat as RealChat).model.calls.length === 2, "ход по служебному сообщению");
    await chat.settle();
    expect(chat.textsIn(dialog.id)).toEqual(["Ответ 1"]);
  });

  it("привязал снова — ходы сервера снова приходят в мессенджер", async () => {
    chat = await linkedChat();
    const dialog = chat.channel.privateChatOf(anna);
    await chat.human({ type: "text", chat: dialog, from: anna, text: "Привет" });
    const [current] = await chat.service.listChats("anna");
    await unlink(chat, "anna");

    const offer = await chat.messengers.handler.fetch(
      new Request(`http://app.test${BASE_PATH}/links`, { method: "POST", headers: { "x-user": "anna", "content-type": "application/json" }, body: JSON.stringify({ messenger: chat.channel.messenger }) }),
    );
    const { code } = (await offer.json()) as { code: string };
    await chat.human({ type: "text", chat: dialog, from: anna, text: `/start ${code}` });
    expect(chat.textsIn(dialog.id).at(-1)).toBe(messengerTexts.linked);

    await chat.service.deliverNotices({ ownerId: "anna", chatId: current!.id, notices: [{ kind: "app", name: "flow_timer", title: "Прошло два дня" }], wakeAgent: true, deliveryKey: "timer-2" });
    await chat.until(() => (chat as RealChat).textsIn(dialog.id).at(-1) === "Ответ 2", "ответ сервера в мессенджере");
  });

  it("подключивший группу отвязался — группа как неподключённая, его лимит не тратится", async () => {
    chat = await linkedChat();
    const group = chat.channel.group;
    await chat.human({ type: "text", chat: group, from: anna, text: "/connect" });
    await unlink(chat, "anna");

    await chat.human({ type: "text", chat: group, from: boris, text: "@test_bot ау", mentionsBot: true });
    expect(chat.model.calls).toHaveLength(0);
    expect(chat.textsIn(group.id).at(-1)).toBe(messengerTexts.connectHint);
  });
});
