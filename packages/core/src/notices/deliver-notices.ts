import { isStateMessage } from "../app-state/state-messages";
import type { UIMessage } from "ai";
import { AGENT_NOTICE_PART_TYPE } from "./agent-notice";
import type { DeliverNoticesInput } from "./agent-notice";

/** Больше стольких ходов сервера подряд без человека — служебное сообщение пишется без хода (защита от петли). */
export const MAX_SERVER_TURNS_IN_ROW = 5;

interface NoticePartData {
  notices: DeliverNoticesInput["notices"];
  deliveryKey: string;
  wakeAgent: boolean;
}

/** Части служебного сообщения: ключ доставки и `wakeAgent` хранятся рядом, чтобы повтор и счёт ходов читались из истории. */
export function noticeMessageParts(input: DeliverNoticesInput): UIMessage["parts"] {
  const data: NoticePartData = { notices: input.notices, deliveryKey: input.deliveryKey, wakeAgent: input.wakeAgent };
  return [{ type: AGENT_NOTICE_PART_TYPE, data } as UIMessage["parts"][number]];
}

function noticeDataOf(message: Pick<UIMessage, "role" | "parts">): Partial<NoticePartData> | undefined {
  if (message.role !== "user") return undefined;
  const part = message.parts.find((candidate) => candidate.type === AGENT_NOTICE_PART_TYPE) as { data?: Partial<NoticePartData> } | undefined;
  return part ? (part.data ?? {}) : undefined;
}

/** Ключ доставки служебного сообщения; у остальных сообщений — `undefined`. */
export function deliveryKeyOf(message: Pick<UIMessage, "role" | "parts">): string | undefined {
  return noticeDataOf(message)?.deliveryKey;
}

/** Сколько ходов сервер начал подряд после последнего сообщения человека. */
export function serverTurnsInRow(branch: ReadonlyArray<Pick<UIMessage, "role" | "parts">>): number {
  let count = 0;
  for (let index = branch.length - 1; index >= 0; index--) {
    const message = branch[index]!;
    if (message.role !== "user" || isStateMessage(message)) continue;
    const notice = noticeDataOf(message);
    if (!notice) break;
    if (notice.wakeAgent !== false) count++;
  }
  return count;
}
