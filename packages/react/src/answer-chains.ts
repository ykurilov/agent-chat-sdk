import { messageText } from "./chat-types";
import type { AgentChatMessage } from "./chat-types";

/**
 * Цепочки ответов: ответ агента, за которым в ленте не видно ничего, кроме следующего ответа. Так бывает, когда сервер
 * будит агента невидимым служебным сообщением (фоновые генерации готовы) или отдаёт ответы подряд без него. Человек
 * видит один ответ: у всех, кроме последнего, `continued` — без «Копировать» и без промежутка; у всех, кроме первого,
 * `follows` — скин не начинает новое сообщение (второй аватар); «Копировать» последнего копирует всю цепочку
 * (`before` — id прежних ответов цепочки).
 */
export interface AnswerChains {
  continued: ReadonlySet<string>;
  follows: ReadonlySet<string>;
  before: ReadonlyMap<string, readonly string[]>;
}

// Разделители, которых не бывает в id сообщений.
const ID_SEPARATOR = "\u0001";
const CHAIN_SEPARATOR = "\u0002";

interface ChainRules {
  /** Обычный ответ агента (не плашка, не реплика сотрудника, не поправка). Законченный ответ без текста — не он: иначе
   * «Копировать» не осталось бы ни у одного ответа цепочки. */
  isAnswer: (message: AgentChatMessage) => boolean;
  /** На экране сообщения нет совсем: служебное сообщение без видимой строки. */
  isInvisible: (message: AgentChatMessage) => boolean;
  /** После сообщения стоит что-то своё (разделитель сжатой истории): цепочка на нём рвётся. */
  breaksAfter: (message: AgentChatMessage) => boolean;
}

/** Цепочки одной строкой: по ней лента узнаёт, что цепочки не изменились, пока дописывается ответ. */
export function answerChainsKey(messages: readonly AgentChatMessage[], rules: ChainRules): string {
  const chains: string[][] = [];
  let current: string[] | null = null;
  for (const message of messages) {
    if (rules.isInvisible(message)) continue;
    if (rules.isAnswer(message)) {
      if (current) current.push(message.id);
      else current = [message.id];
      if (current.length === 2) chains.push(current);
    } else current = null;
    if (rules.breaksAfter(message)) current = null;
  }
  return chains.map((chain) => chain.join(ID_SEPARATOR)).join(CHAIN_SEPARATOR);
}

export function answerChainsOf(key: string): AnswerChains {
  const continued = new Set<string>();
  const follows = new Set<string>();
  const before = new Map<string, string[]>();
  if (key === "") return { continued, follows, before };
  for (const chain of key.split(CHAIN_SEPARATOR)) {
    const ids = chain.split(ID_SEPARATOR);
    ids.slice(0, -1).forEach((id) => continued.add(id));
    ids.slice(1).forEach((id) => follows.add(id));
    before.set(ids.at(-1)!, ids.slice(0, -1));
  }
  return { continued, follows, before };
}

/**
 * Ответ по объекту сообщения: законченные сообщения между кусками потока не меняются, а цепочки пересчитываются на
 * каждом куске. Подпись — на случай, если объект всё же поменяли на месте.
 */
const textlessAnswers = new WeakMap<AgentChatMessage, { signature: string; textless: boolean }>();

/** Законченный ответ без текста (ошибка, остановка, закрыт ради поправки): у него нет «Копировать», цепочку он рвёт. */
export function settledWithoutText(message: AgentChatMessage, { streaming, voiceAnswer }: { streaming: boolean; voiceAnswer: boolean }): boolean {
  if (streaming || message.metadata?.status === "awaiting_approval") return false;
  const signature = `${message.metadata?.status ?? ""}|${message.parts.length}|${voiceAnswer}`;
  const known = textlessAnswers.get(message);
  if (known?.signature === signature) return known.textless;
  const textless = messageText(message, { voiceAnswer }).trim().length === 0;
  textlessAnswers.set(message, { signature, textless });
  return textless;
}
