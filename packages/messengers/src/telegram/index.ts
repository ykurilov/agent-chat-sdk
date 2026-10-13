import type { MessengerApiSettings } from "../messenger-api";
import type { MessengerTexts } from "../messenger-texts";
import type { MessengerBot } from "../types";
import { createTelegramAdapter } from "./telegram-adapter";
import { createTelegramClient } from "./telegram-client";

export interface TelegramBotOptions {
  token: string;
  /** Имя бота без `@`: из него ссылка на бота и разбор упоминаний. */
  username: string;
  receive: { webhook: { secret: string } } | { polling: true };
  api?: MessengerApiSettings;
  /** Свои фразы этого бота: перекрывают общие `texts` из `createMessengers`. Пустая строка — бот молчит. */
  texts?: Partial<MessengerTexts>;
  /** Ставить ли меню команд: перекрывает общую `commandsMenu` из `createMessengers`. `false` — меню снимается. */
  commandsMenu?: boolean;
}

export interface TelegramMessengerBot extends MessengerBot {
  /** Говорит Telegram, куда присылать обновления: приложение зовёт при запуске, когда знает свой публичный адрес. */
  registerWebhook(url: string): Promise<void>;
}

const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"];

/** Бот Telegram: `telegramBot({ token, username, receive })`. */
export function telegramBot(options: TelegramBotOptions): TelegramMessengerBot {
  const botId = options.token.split(":")[0] ?? "";
  if (!/^\d+$/.test(botId)) throw new Error("telegram: токен бота должен начинаться с числового номера бота (123456:ABC…)");
  const username = options.username.replace(/^@/, "");
  const client = createTelegramClient({ token: options.token, api: options.api });
  const webhook = "webhook" in options.receive ? options.receive.webhook : undefined;
  return {
    messenger: "telegram",
    botId,
    receive: webhook ? "webhook" : "polling",
    ...(options.texts !== undefined && { texts: options.texts }),
    ...(options.commandsMenu !== undefined && { commandsMenu: options.commandsMenu }),
    adapter: createTelegramAdapter({ client, bot: { botId, username }, ...(webhook && { webhookSecret: webhook.secret }) }),
    async registerWebhook(url) {
      if (!webhook) throw new Error("telegram: бот принимает обновления опросом, вебхук ему не нужен");
      await client.call("setWebhook", { url, secret_token: webhook.secret, allowed_updates: ALLOWED_UPDATES });
    },
  };
}
