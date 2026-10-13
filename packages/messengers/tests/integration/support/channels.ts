import { maxBot } from "../../../src/max/index";
import { telegramBot } from "../../../src/telegram/index";
import { vkBot } from "../../../src/vk/index";
import { MAX_BOT_NAME, MAX_GROUP_CHAT, MAX_SECRET, MAX_TOKEN, startFakeMax } from "../../fake-apis/max";
import { startFakeTelegram, TELEGRAM_SECRET, TELEGRAM_TOKEN, TELEGRAM_USERNAME } from "../../fake-apis/telegram";
import { startFakeVk, VK_CONFIRMATION, VK_GROUP_ID, VK_GROUP_PEER, VK_GROUP_SCREEN_NAME, VK_SECRET, VK_TOKEN } from "../../fake-apis/vk";
import type { MessengerChannel } from "./real-chat";

/** Поддельный Telegram и настоящий бот на вебхуке. */
export async function telegramChannel(): Promise<MessengerChannel & { fake: Awaited<ReturnType<typeof startFakeTelegram>> }> {
  const fake = await startFakeTelegram();
  const bot = telegramBot({ token: TELEGRAM_TOKEN, username: TELEGRAM_USERNAME, receive: { webhook: { secret: TELEGRAM_SECRET } }, api: { baseUrl: fake.url } });
  return {
    messenger: "telegram",
    bot,
    fake,
    privateChatOf: (person) => ({ id: person.id, type: "private" }),
    group: { id: "-500", type: "group" },
    webhookPath: "/telegram/webhook",
    webhookRequest: (url, event) =>
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": TELEGRAM_SECRET },
        body: JSON.stringify(fake.webhookBody(event)),
      }),
    get outgoing() {
      return fake.state.messages;
    },
    get answers() {
      return fake.state.callbackAnswers;
    },
    close: fake.close,
  };
}

/** Поддельный VK и настоящий бот на Callback API. */
export async function vkChannel(): Promise<MessengerChannel & { fake: Awaited<ReturnType<typeof startFakeVk>> }> {
  const fake = await startFakeVk();
  const bot = vkBot({ token: VK_TOKEN, groupId: VK_GROUP_ID, groupScreenName: VK_GROUP_SCREEN_NAME, receive: { callback: { secret: VK_SECRET, confirmation: VK_CONFIRMATION } }, api: { baseUrl: fake.url } });
  return {
    messenger: "vk",
    bot,
    fake,
    privateChatOf: (person) => ({ id: person.id, type: "private" }),
    group: { id: String(VK_GROUP_PEER), type: "group" },
    webhookPath: "/vk/callback",
    webhookRequest: (url, event) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fake.callbackBody(event)) }),
    get outgoing() {
      return fake.state.messages;
    },
    get answers() {
      return fake.state.eventAnswers;
    },
    close: fake.close,
  };
}

/** Поддельный MAX и настоящий бот на вебхуке. Личный чат у MAX — свой номер, не номер человека. */
export async function maxChannel(): Promise<MessengerChannel & { fake: Awaited<ReturnType<typeof startFakeMax>> }> {
  const fake = await startFakeMax();
  const bot = maxBot({ token: MAX_TOKEN, botName: MAX_BOT_NAME, receive: { webhook: { secret: MAX_SECRET } }, api: { baseUrl: fake.url } });
  return {
    messenger: "max",
    bot,
    fake,
    privateChatOf: (person) => ({ id: String(Number(person.id) + 5000), type: "private" }),
    group: { id: MAX_GROUP_CHAT, type: "group" },
    webhookPath: "/max/webhook",
    webhookRequest: (url, event) =>
      new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-max-bot-api-secret": MAX_SECRET }, body: JSON.stringify(fake.webhookBody(event)) }),
    get outgoing() {
      return fake.state.messages;
    },
    get answers() {
      return fake.state.answers;
    },
    close: fake.close,
  };
}

/** Все мессенджеры: одни и те же сценарии идут на каждом. */
export const allChannels = [
  { name: "Telegram", open: telegramChannel },
  { name: "VK", open: vkChannel },
  { name: "MAX", open: maxChannel },
] as const;
