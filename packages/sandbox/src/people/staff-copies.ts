import type { AfterTurnHandler, AgentToolsModel, Chat, ChatSubject, StaffActor } from "@ykurilov/agent-chat-core";
import { isSandboxOwner, realOwnerOf } from "../sandbox-owner";

const STAFF_COPY_PREFIX = "staff-copy:";
/** Поле в `subjectData` копии: объект исходного чата человека (ключ и данные). */
const ORIGINAL_SUBJECT_FIELD = "staffCopyOf";
/** Сколько копий помнить: копия запоминается заново перед каждым своим ходом, поэтому забыть давнюю не страшно. */
export const STAFF_COPIES_REMEMBERED = 1000;

/** Ключ копии чата человека в песочнице: `staff-copy:<человек>:<чат>:<n>`, `n` — номер копии с 1. */
export function staffCopyKey(personId: string, chatId: string, copyNumber: number): string {
  return `${staffCopyKeyPrefix(personId, chatId)}${copyNumber}`;
}

/** Начало ключей всех копий одного чата человека. */
export function staffCopyKeyPrefix(personId: string, chatId: string): string {
  return `${STAFF_COPY_PREFIX}${personId}:${chatId}:`;
}

/** Человек, чат и номер копии по ключу; не ключ копии — `null`. Id человека может содержать `:`, чат и номер — нет. */
export function parseStaffCopyKey(key: string | undefined): { personId: string; chatId: string; copyNumber: number } | null {
  if (!key?.startsWith(STAFF_COPY_PREFIX)) return null;
  const rest = key.slice(STAFF_COPY_PREFIX.length).split(":");
  if (rest.length < 3) return null;
  const copyNumber = Number(rest.pop());
  const chatId = rest.pop()!;
  const personId = rest.join(":");
  if (!Number.isInteger(copyNumber) || copyNumber < 1 || !chatId || !personId) return null;
  return { personId, chatId, copyNumber };
}

/** Исходный чат человека: ключ объекта (если это чат объекта) и данные чата (если есть). */
export interface OriginalChat {
  key?: string;
  data?: Record<string, unknown>;
}

/** Данные копии: исходный чат лежит под служебным полем; у чата без ключа и без данных переносить нечего. */
export function staffCopySubjectData(original: OriginalChat | undefined): Record<string, unknown> | undefined {
  return original && (original.key !== undefined || original.data !== undefined) ? { [ORIGINAL_SUBJECT_FIELD]: original } : undefined;
}

/** Человек и исходный чат, если `subject` — ключ копии в песочном чате; иначе `null`. */
function copyOfSubject(ownerId: string, subject: ChatSubject | undefined): { personId: string; original: ChatSubject | undefined; data: Record<string, unknown> | undefined } | null {
  const copy = isSandboxOwner(ownerId) ? parseStaffCopyKey(subject?.key) : null;
  if (!copy) return null;
  const stored = subject?.data?.[ORIGINAL_SUBJECT_FIELD] as OriginalChat | undefined;
  const data = isRecord(stored?.data) ? stored.data : undefined;
  const original = typeof stored?.key === "string" ? { key: stored.key, ...(data && { data }) } : undefined;
  return { personId: copy.personId, original, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Ключ копии наружу не уходит: вместо него объект исходного чата человека (если у него был ключ). Данные чата копии —
 * служебная обёртка, поэтому `chat.data` и `chatData` заменяются данными исходного чата, с ключом или без.
 */
function withOriginalChat<T extends { subject?: ChatSubject; chat?: { data?: Record<string, unknown> }; chatData?: Record<string, unknown> }>(
  value: T,
  copy: { original: ChatSubject | undefined; data: Record<string, unknown> | undefined },
): T {
  const { subject: _copyKey, chat: _copyChat, chatData: _copyData, ...rest } = value;
  return {
    ...rest,
    ...(copy.original && { subject: copy.original }),
    ...("chat" in value && { chat: { ...(copy.data && { data: copy.data }) } }),
    ...("chatData" in value && copy.data && { chatData: copy.data }),
  } as T;
}

/**
 * Копии чатов людей в песочнице: ядро спрашивает сотрудника хода (`staffOfChat`) перед каждым ходом, и в этот момент
 * копия запоминает, чей это чат. Инструменты и память хода копии читают человека отсюда: их функции синхронны и
 * знают только id чата.
 */
export function createStaffCopies() {
  const personOfChat = new Map<string, string>();

  return {
    /** Сотрудник хода: админ песочницы, если чат — копия чата человека; иначе `null`. */
    staffOf(chat: Chat): StaffActor | null {
      const copy = isSandboxOwner(chat.ownerId) ? parseStaffCopyKey(chat.subjectKey) : null;
      if (!copy) {
        personOfChat.delete(chat.id);
        return null;
      }
      // Самая свежая — в конце: при переполнении забывается та, что дольше всех не ходила.
      personOfChat.delete(chat.id);
      personOfChat.set(chat.id, copy.personId);
      if (personOfChat.size > STAFF_COPIES_REMEMBERED) personOfChat.delete(personOfChat.keys().next().value!);
      return { id: realOwnerOf(chat.ownerId) };
    },

    /** Человек, чей чат скопирован в этот песочный чат; не копия — `undefined`. */
    personOf(chatId: string): string | undefined {
      return personOfChat.get(chatId);
    },

    /**
     * Модель хода для инструментов приложения. В копии — id человека, `staff` админа и объект исходного чата
     * человека (`subject`), в том числе вне хода (сжатие, фоновый помощник): данные человека инструменты только
     * читают. В обычном песочном чате — настоящий id админа, остальное как поставило ядро.
     */
    toolsModel(model: AgentToolsModel): AgentToolsModel {
      const copy = copyOfSubject(model.ownerId, model.subject);
      if (!copy) return { ...model, ownerId: realOwnerOf(model.ownerId) };
      return withOriginalChat({ ...model, ownerId: copy.personId, staff: model.staff ?? { id: realOwnerOf(model.ownerId) } }, copy);
    },

    /**
     * Хук итога хода приложения в песочнице: зовётся только в копии чата человека — с id человека, `staff` и `actorId`
     * админа и объектом исходного чата, в том числе при доделке после перезапуска. При `turn.staff` в данные человека
     * не писать. В обычном песочном чате не зовётся, как и `beforeTurn`: там ходит не человек приложения.
     */
    afterTurn(handler: AfterTurnHandler): AfterTurnHandler {
      return (result) => {
        const copy = copyOfSubject(result.ownerId, result.subject);
        if (!copy) return;
        const staff = result.staff ?? { id: realOwnerOf(result.ownerId) };
        return handler(withOriginalChat({ ...result, ownerId: copy.personId, staff, actorId: staff.id }, copy));
      };
    },

    /** Чат удалён: забыть его. */
    forget(chatId: string): void {
      personOfChat.delete(chatId);
    },
  };
}

export type StaffCopies = ReturnType<typeof createStaffCopies>;
