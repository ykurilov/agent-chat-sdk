import type { ExternalChannel } from "@ykurilov/agent-chat-core";

/** Мессенджер, с которым работает адаптер. */
export type MessengerName = ExternalChannel;

/** Чем мессенджеры отличаются. Общий слой смотрит сюда и больше нигде не ветвится по имени мессенджера. */
export interface MessengerAbilities {
  /** Сколько знаков помещается в одно сообщение; длинный ответ режется по абзацам. */
  textLimit: number;
  /** Как показывать печатаемый ответ: `draft` — черновик, `edit` — правка сообщения, `none` — только готовый. */
  liveText: "draft" | "edit" | "none";
  /** Не чаще, чем раз в столько миллисекунд правим сообщение. */
  editEveryMs: number;
  markup: "html" | "plain";
  /** Есть ли меню команд. */
  commandsMenu: boolean;
}

/** Внешний чат: личный или группа. */
export interface ExternalChat {
  id: string;
  type: "private" | "group";
}

export interface ExternalAccount {
  messenger: MessengerName;
  botId: string;
  externalUserId: string;
  name: string;
  username?: string;
  /** Пользователь приложения, если аккаунт уже привязан. */
  linkedUserId?: string;
}

/** Кнопка под сообщением: `id` — короткий номер из `messenger_buttons`. */
export interface Button {
  id: string;
  text: string;
  /** Кнопка-ссылка: открывает адрес, нажатие боту не приходит; `id` в таком случае только для учёта. */
  url?: string;
}

export interface OutboundMessage {
  text: string;
  markup: "html" | "plain";
  buttons?: Button[][];
  photo?: { bytes: Uint8Array; name: string } | { url: string };
}

/** Отправленное сообщение: по нему его правят. */
export interface SentMessage {
  chat: ExternalChat;
  messageId: string;
}

export interface BotCommand {
  command: string;
  description: string;
}

/** Нажатие на кнопку: `callbackId` нужен, чтобы ответить мессенджеру, что нажатие принято. */
export interface ButtonPress {
  chat: ExternalChat;
  account: ExternalAccount;
  buttonId: string;
  callbackId: string;
}

/** Файл, присланный человеком: байты забираются отдельным вызовом `downloadFile`. */
export interface InboundFile {
  fileId: string;
  name?: string;
  mediaType?: string;
  size?: number;
  /** Длина голосового, если мессенджер её присылает. */
  durationMs?: number;
}

export type InboundUpdateKind = "text" | "command" | "start" | "button" | "files" | "voice" | "blocked" | "allowed" | "bot_added" | "bot_removed";

/** Обновление мессенджера, приведённое к общему виду. */
export interface InboundUpdate {
  /** Ключ повтора: мессенджер присылает обновление не раз, второй раз его не обрабатываем. */
  key: string;
  account: ExternalAccount;
  chat: ExternalChat;
  kind: InboundUpdateKind;
  text?: string;
  /** Метка из ссылки на бота (`?start=`): код привязки или метка сценария. */
  startPayload?: string;
  buttonId?: string;
  /** Для `button`: чем ответить мессенджеру. */
  callbackId?: string;
  files?: InboundFile[];
  /** Для `voice`: текст, если мессенджер сам распознал голосовое. */
  transcription?: string;
  /** Для обновлений из группы. */
  group?: { mentioned: boolean; replyToBot: boolean };
}

/** Тонкий интерфейс адаптера: всё, чем Telegram, VK и MAX отличаются друг от друга. */
export interface MessengerAdapter {
  readonly messenger: MessengerName;
  readonly abilities: MessengerAbilities;
  /** Проверяет секрет и читает тело запроса мессенджера: что ответить сразу и какие обновления пришли. */
  readWebhook(request: Request): Promise<{ response: Response; updates: InboundUpdate[] }>;
  /** Опрос мессенджера, пока `signal` не сработал. */
  poll(signal: AbortSignal): AsyncIterable<InboundUpdate>;
  send(chat: ExternalChat, message: OutboundMessage): Promise<SentMessage>;
  edit(sent: SentMessage, message: OutboundMessage): Promise<void>;
  /** Удалить сообщение бота. Нужно, когда закрывающая фраза пустая: без него строка статуса так и остаётся в чате. */
  deleteMessage?(sent: SentMessage): Promise<void>;
  /** Черновик печатаемого ответа; есть только там, где `liveText: "draft"`. */
  draft?(chat: ExternalChat, draftId: number, text: string): Promise<void>;
  answerButton(press: ButtonPress, text?: string): Promise<void>;
  typing(chat: ExternalChat): Promise<void>;
  downloadFile(file: InboundFile): Promise<{ bytes: Uint8Array; name: string; mediaType: string }>;
  /** Меню команд в области; пустой список — снять меню. */
  setCommands(commands: BotCommand[], scope: "private" | "group"): Promise<void>;
  sendVoice(chat: ExternalChat, voice: { audio: Uint8Array; durationMs: number }): Promise<SentMessage>;
  /** Ссылка на бота с кодом привязки: «Подключить» открывает её. */
  linkUrl(code: string): string;
}
