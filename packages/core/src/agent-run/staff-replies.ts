import type { AgentChatMessage } from "../conversation/types";
import { AGENT_NOTICE_PART_TYPE } from "../notices/agent-notice";
import { noticePartForModel, noticesOfPart } from "../notices/notices-for-model";
import { joinedParts } from "../steering/turn-steering";

/** Сообщение — только реплики живого сотрудника (`appendStaffMessage`). */
function isStaffReply(message: AgentChatMessage): boolean {
  if (message.role !== "user") return false;
  const notices = message.parts.flatMap(noticesOfPart);
  return notices.length > 0 && notices.every((notice) => notice.kind === "staff");
}

/** Реплика сотрудника — текстом через пустую строку (часть-данные при склейке иначе пропала бы). */
function staffPartsJoined(parts: AgentChatMessage["parts"]): AgentChatMessage["parts"] {
  return parts.flatMap((part): AgentChatMessage["parts"] => {
    if (part.type !== AGENT_NOTICE_PART_TYPE) return joinedParts([part]);
    const text = noticePartForModel(part);
    return text ? [{ type: "text", text: `\n\n${text.text}` }] : [];
  });
}

/**
 * Реплика сотрудника — не вопрос к агенту и не его ход: в запросе она идёт в одном сообщении с соседними словами человека
 * (до неё и после неё), через пустую строку. Иначе два сообщения человека подряд получили бы между собой пометку
 * «ход оборвался» (`withUnansweredMarked`), хотя хода не было. Склейка зависит только от истории: на каждом ходе те же байты.
 */
export function withStaffRepliesJoined(history: readonly AgentChatMessage[]): readonly AgentChatMessage[] {
  const joined: AgentChatMessage[] = [];
  let afterStaff = false;
  let changed = false;
  for (const message of history) {
    const previous = joined.at(-1);
    const staff = isStaffReply(message);
    if (previous?.role === "user" && message.role === "user" && (staff || afterStaff)) {
      joined[joined.length - 1] = { ...previous, parts: [...previous.parts, ...(staff ? staffPartsJoined(message.parts) : joinedParts(message.parts))] };
      changed = true;
    } else joined.push(message);
    afterStaff = staff;
  }
  return changed ? joined : history;
}
