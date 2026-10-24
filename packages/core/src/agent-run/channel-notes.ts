import { isStateMessage } from "../app-state/state-messages";
import type { AgentChannel, AgentChatMessage, GroupTurn } from "../conversation/types";
import type { ChatTurnTrigger } from "../chat-events/chat-events";
import { AGENT_NOTICE_PART_TYPE } from "../notices/agent-notice";

/**
 * Тип части-отметки: сообщение человека пришло не из веба или из группы. Хранится в самом сообщении, экран её не рисует;
 * в веб-чате без мессенджеров её нет — запрос побайтно прежний.
 */
export const CHANNEL_PART_TYPE = "data-agent-channel";

/**
 * Отметка канала для сообщения человека; веб без группы — `undefined` (отметка не нужна). У группы в отметке и
 * разрешённые инструменты: по ним идут и продолжения хода (подтверждение, «Повторить»).
 */
export function channelPart(channel: AgentChannel, group?: GroupTurn): AgentChatMessage["parts"][number] | undefined {
  if (channel === "web" && !group) return undefined;
  return { type: CHANNEL_PART_TYPE, data: { channel, ...(group && { author: group.author, allowedTools: [...group.allowedTools] }) } };
}

/** Канал и групповой ход из отметки сообщения; отметки нет — веб. */
export function channelOfMessage(message: Pick<AgentChatMessage, "parts">): { channel: AgentChannel; group?: GroupTurn } {
  for (const part of message.parts) {
    if (part.type !== CHANNEL_PART_TYPE) continue;
    const data = (part as { data?: { channel?: AgentChannel; author?: unknown; allowedTools?: unknown } }).data;
    const group =
      typeof data?.author === "string"
        ? { author: data.author, allowedTools: Array.isArray(data.allowedTools) ? data.allowedTools.filter((name): name is string => typeof name === "string") : [] }
        : undefined;
    return { channel: data?.channel ?? "web", ...(group && { group }) };
  }
  return { channel: "web" };
}

const isNoticeMessage = (message: Pick<AgentChatMessage, "parts">): boolean => message.parts.some((part) => part.type === AGENT_NOTICE_PART_TYPE);

/** Сообщение человека: не служебное сообщение сервера и не запись состояния. Копия в react (`use-agent-chat.ts`) — держать в синхроне. */
export const isHumanMessage = (message: Pick<AgentChatMessage, "role" | "parts">): boolean =>
  message.role === "user" && !isNoticeMessage(message) && !isStateMessage(message);

const hasChannelPart = (message: Pick<AgentChatMessage, "parts">): boolean => message.parts.some((part) => part.type === CHANNEL_PART_TYPE);

/**
 * Канал хода по ветке: отметка последнего сообщения человека или служебного сообщения сервера с явной отметкой (агент
 * пишет первым в группе). Служебные сообщения без отметки не в счёт; сообщение человека без отметки — веб. Отметки пишет
 * только сервер: клиент их не задаёт.
 */
export function turnChannelOf(branch: readonly Pick<AgentChatMessage, "role" | "parts">[]): { channel: AgentChannel; group?: GroupTurn } {
  const source = branch.findLast((message) => isHumanMessage(message) || (message.role === "user" && isNoticeMessage(message) && hasChannelPart(message)));
  return source ? channelOfMessage(source) : { channel: "web" };
}

/**
 * Отметка группы, которую наследует производное сообщение (правка сообщения группы, поправка к групповому ходу): оно
 * пишется из веба, но остаётся в границах группы — иначе следующий ход сервера в чате группы шёл бы как личный. Вне
 * группы — `undefined`: правка и поправка из веба идут как веб, как раньше.
 */
export function inheritedGroupPart(scope: { channel: AgentChannel; group?: GroupTurn }): AgentChatMessage["parts"][number] | undefined {
  return scope.group ? channelPart(scope.channel, scope.group) : undefined;
}

/**
 * Источник и канал хода, чей ответ — последнее сообщение ветки, по истории: ответ на служебное сообщение начал сервер,
 * иначе человек. Продолжение после подтверждения на служебное сообщение тоже считается ходом сервера.
 */
export function turnOriginOf(branch: readonly Pick<AgentChatMessage, "role" | "parts">[]): { trigger: ChatTurnTrigger; channel: AgentChannel } {
  const parent = branch.at(-2);
  return { trigger: parent && isNoticeMessage(parent) ? "notice" : "human", channel: turnChannelOf(branch).channel };
}

const CHANNEL_NOTES: Record<AgentChannel, string> = {
  web: "Разговор снова в веб-приложении: обычная разметка и инструменты страницы доступны.",
  telegram:
    "Разговор идёт в Telegram. Пиши обычным Markdown: его переведут в разметку Telegram. Таблиц и схем там нет — вместо них списки. Отвечай короче, чем в вебе.",
  vk: "Разговор идёт во ВКонтакте. Разметки там нет: Markdown превратится в простой текст. Пиши простым текстом и списками, без таблиц и схем. Отвечай короче, чем в вебе.",
  max: "Разговор идёт в MAX. Пиши обычным Markdown: его переведут в разметку MAX. Таблиц и схем там нет — вместо них списки. Отвечай короче, чем в вебе.",
};

const authorNote = (author: string): string => `Сообщение в группе от участника: ${author}`;

/**
 * Пометки канала для модели, как пометки голосового режима: у сообщения человека, чей канал не такой, как у предыдущего
 * (первое считается после веба), в конец — заметка о канале и разметке; у сообщения из группы — имя автора. Служебные
 * сообщения сервера канал не меняют. Выводятся из сохранённых отметок: уже отправленное не меняется, кэш модели цел.
 * Веб-история без отметок возвращается как есть.
 */
export function withChannelNotes(history: readonly AgentChatMessage[]): readonly AgentChatMessage[] {
  let previous: AgentChannel = "web";
  let changed = false;
  const result = history.map((message) => {
    if (message.role !== "user" || isNoticeMessage(message)) return message;
    const { channel, group } = channelOfMessage(message);
    const author = group?.author;
    const notes = [channel !== previous ? CHANNEL_NOTES[channel] : undefined, author !== undefined ? authorNote(author) : undefined].filter(
      (text): text is string => text !== undefined,
    );
    previous = channel;
    if (notes.length === 0) return message;
    changed = true;
    return { ...message, parts: [...message.parts, ...notes.map((text) => ({ type: "text" as const, text }))] };
  });
  return changed ? result : history;
}
