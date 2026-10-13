import type { MessengerApiSettings } from "../messenger-api";
import type { MessengerTexts } from "../messenger-texts";
import type { MessengerBot } from "../types";
import { createMaxAdapter, MAX_UPDATE_TYPES } from "./max-adapter";
import { createMaxClient } from "./max-client";

export interface MaxBotOptions {
  token: string;
  /** Имя бота в MAX без `@`: из него ссылка на бота и разбор упоминаний. */
  botName: string;
  /** Вебхук: `secret` — 5–256 знаков из `A–Z a–z 0–9 _ -`. Опрос — без адреса приложения. */
  receive: { webhook: { secret: string } } | { polling: true };
  api?: MessengerApiSettings;
  /** Свои фразы этого бота: перекрывают общие `texts` из `createMessengers`. Пустая строка — бот молчит. */
  texts?: Partial<MessengerTexts>;
  /** Ставить ли меню команд: перекрывает общую `commandsMenu` из `createMessengers`. `false` — меню снимается. */
  commandsMenu?: boolean;
}

export interface MaxMessengerBot extends MessengerBot {
  /** Подписывает бота на события: приложение зовёт при запуске, когда знает свой публичный адрес (нужен HTTPS). */
  registerWebhook(url: string): Promise<void>;
}

const SECRET_PATTERN = /^[A-Za-z0-9_-]{5,256}$/;

/** Бот MAX: `maxBot({ token, botName, receive })`. */
export function maxBot(options: MaxBotOptions): MaxMessengerBot {
  const botName = options.botName.replace(/^@/, "");
  const webhook = "webhook" in options.receive ? options.receive.webhook : undefined;
  if (webhook && !SECRET_PATTERN.test(webhook.secret)) throw new Error("max: секрет вебхука должен быть длиной 5–256 знаков из латинских букв, цифр, «_» и «-» — иначе MAX подписку не примет");
  const client = createMaxClient({ token: options.token, api: options.api });
  return {
    messenger: "max",
    botId: botName,
    receive: webhook ? "webhook" : "polling",
    ...(options.texts !== undefined && { texts: options.texts }),
    ...(options.commandsMenu !== undefined && { commandsMenu: options.commandsMenu }),
    adapter: createMaxAdapter({ client, bot: { botName }, ...(webhook && { webhookSecret: webhook.secret }) }),
    async registerWebhook(url) {
      if (!webhook) throw new Error("max: бот принимает обновления опросом, подписка на вебхук ему не нужна");
      await client.call("POST", "/subscriptions", { body: { url, secret: webhook.secret, update_types: MAX_UPDATE_TYPES } });
    },
  };
}
