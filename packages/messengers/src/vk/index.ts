import type { MessengerApiSettings } from "../messenger-api";
import type { MessengerTexts } from "../messenger-texts";
import type { MessengerBot } from "../types";
import { createVkAdapter } from "./vk-adapter";
import { createVkClient } from "./vk-client";

export interface VkBotOptions {
  /** Ключ доступа сообщества. */
  token: string;
  /** Номер сообщества (без минуса). */
  groupId: number;
  /** Короткий адрес сообщества: из него ссылка `vk.me/<адрес>`. */
  groupScreenName: string;
  /**
   * Callback API: `secret` и `confirmation` берутся из настроек сервера в сообществе; секрет обязателен — по нему
   * события VK отличаются от подделок. Long Poll — без адреса приложения.
   */
  receive: { callback: { secret: string; confirmation: string } } | { longPoll: true };
  api?: MessengerApiSettings;
  /** Свои фразы этого бота: перекрывают общие `texts` из `createMessengers`. Пустая строка — бот молчит. */
  texts?: Partial<MessengerTexts>;
}

/** Бот VK: `vkBot({ token, groupId, groupScreenName, receive })`. */
export function vkBot(options: VkBotOptions): MessengerBot {
  if (!Number.isInteger(options.groupId) || options.groupId <= 0) throw new Error("vk: groupId — номер сообщества, положительное целое число");
  if ("callback" in options.receive) {
    // Секрет приходит из переменной окружения или конфига: может быть и не задан, и не строкой.
    const secret: unknown = options.receive.callback?.secret;
    if (typeof secret !== "string" || secret.trim() === "") {
      throw new Error("vk: для Callback API нужен секретный ключ — задайте его в настройках сервера в сообществе и передайте в receive.callback.secret");
    }
  }
  return {
    messenger: "vk",
    botId: String(options.groupId),
    receive: "callback" in options.receive ? "webhook" : "polling",
    ...(options.texts !== undefined && { texts: options.texts }),
    adapter: createVkAdapter({
      client: createVkClient({ token: options.token, api: options.api }),
      groupId: options.groupId,
      groupScreenName: options.groupScreenName,
      receive: options.receive,
    }),
  };
}
