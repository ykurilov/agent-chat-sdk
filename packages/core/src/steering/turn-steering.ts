import type { AgentChatMessage, StoredMessage } from "../conversation/types";

/** Отметка поправки в частях сообщения человека: написано, пока шёл ответ. Модели не уходит. */
export const STEER_PART_TYPE = "data-agent-steer";

export function steerPart(): AgentChatMessage["parts"][number] {
  return { type: STEER_PART_TYPE, data: true } as AgentChatMessage["parts"][number];
}

export function isCorrection(message: Pick<AgentChatMessage, "role" | "parts">): boolean {
  return message.role === "user" && message.parts.some((part) => part.type === STEER_PART_TYPE);
}

/**
 * Поправки подряд — одним сообщением человека: строгие провайдеры не принимают двух сообщений человека подряд, а пометка
 * «ответа нет» между ними была бы неправдой. Части следующей поправки — после частей предыдущей, её первый текст — через
 * пустую строку. Зависит только от истории: на каждом ходе те же байты.
 */
export function withCorrectionsJoined(history: readonly AgentChatMessage[]): AgentChatMessage[] {
  const joined: AgentChatMessage[] = [];
  for (const message of history) {
    const previous = joined.at(-1);
    if (previous && isCorrection(previous) && isCorrection(message)) joined[joined.length - 1] = { ...previous, parts: [...previous.parts, ...joinedParts(message.parts)] };
    else joined.push(message);
  }
  return joined;
}

/** Текст и файлы поправки (или сообщения пачки); первый текст — через пустую строку. Служебные части остаются у первого сообщения. */
export function joinedParts(parts: AgentChatMessage["parts"]): AgentChatMessage["parts"] {
  let separated = false;
  return parts.flatMap((part): AgentChatMessage["parts"] => {
    if (part.type === "file") return [part];
    if (part.type !== "text") return [];
    if (separated) return [part];
    separated = true;
    return [{ ...part, text: `\n\n${part.text}` }];
  });
}

/** Приём поправок одного ответа; `Page` — запрос страницы, с которым пришла поправка. */
export interface SteeringTurn<Page = unknown> {
  /**
   * Есть записанные поправки, ждущие этот ответ: ход останавливается на границе шага. Поправка, которая ещё пишется, ход не
   * останавливает: запись может сорваться, и ответ остался бы оборванным без продолжения.
   */
  waiting(): boolean;
  /** Ответ кончается: приём закрыт. Сколько поправок досталось ответу, вместе с теми, что ещё пишутся. */
  close(): number;
  /** Записанные поправки ответа по порядку; ждёт идущие записи. */
  settled(): Promise<StoredMessage[]>;
  /** Запросы страницы записанных поправок по порядку (поправки без запроса пропущены): продолжение идёт со свежим местом и заметками. */
  correctionPages(): readonly Page[];
}

/** Поправки ходов этой копии сервера, по чату. */
export interface TurnSteering<Page = unknown> {
  /** Ход чата начат: поправки идут к ответу `answerId`. */
  begin(chatId: string, answerId: string): SteeringTurn<Page>;
  /**
   * Поправка к идущему ходу, по очереди на чат: `write(parentId)` пишет сообщение, родитель — последняя поправка ответа
   * или сам ответ. Хода нет или приём закрыт — `null`, ничего не записано. `page` — запрос страницы поправки.
   */
  accept(chatId: string, write: (parentId: string) => Promise<StoredMessage>, page?: Page): Promise<StoredMessage | null>;
  /** Принимает ли чат поправки сейчас. */
  isOpen(chatId: string): boolean;
}

interface OpenTurn<Page> {
  answerId: string;
  corrections: StoredMessage[];
  pages: Page[];
  /** Поправки, которые записаны или пишутся. */
  reserved: number;
  closed: boolean;
  queue: Promise<unknown>;
}

export function createTurnSteering<Page = unknown>(): TurnSteering<Page> {
  const open = new Map<string, OpenTurn<Page>>();
  return {
    begin(chatId, answerId) {
      const turn: OpenTurn<Page> = { answerId, corrections: [], pages: [], reserved: 0, closed: false, queue: Promise.resolve() };
      open.set(chatId, turn);
      return {
        waiting: () => turn.corrections.length > 0,
        close() {
          turn.closed = true;
          if (open.get(chatId) === turn) open.delete(chatId);
          return turn.reserved;
        },
        async settled() {
          await turn.queue;
          return [...turn.corrections];
        },
        correctionPages: () => [...turn.pages],
      };
    },
    accept(chatId, write, page) {
      const turn = open.get(chatId);
      if (!turn) return Promise.resolve(null);
      const job = turn.queue.then(async () => {
        if (turn.closed) return null;
        const parentId = turn.corrections.at(-1)?.id ?? turn.answerId;
        turn.reserved += 1;
        try {
          const written = await write(parentId);
          turn.corrections.push(written);
          if (page !== undefined) turn.pages.push(page);
          return written;
        } catch (error) {
          turn.reserved -= 1;
          throw error;
        }
      });
      turn.queue = job.catch(() => {});
      return job;
    },
    isOpen: (chatId) => open.has(chatId),
  };
}
