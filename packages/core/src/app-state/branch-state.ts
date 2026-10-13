import { VOICE_MODE_PART_TYPE } from "../agent-run/mode-notes";
import { selectCurrentBranch } from "../conversation/branches";
import { withoutGlueFragments } from "../conversation/glue-fragments";
import type { StoredBranchSelection, StoredMessage } from "../conversation/types";
import type { ChatStorage, MessageLink } from "../storage/chat-storage";
import { APP_STATE_PART_TYPE, foldAppState } from "./app-state";
import type { AppStateValues } from "./app-state";
import { touchesClosure } from "./state-messages";

/** Состояние текущей ветки со служебными ключами. */
export interface BranchState {
  values: AppStateValues;
  /** Последнее сообщение ветки; пустой чат — `null`. */
  atMessageId: string | null;
  /** Закрытие хоть раз записано в чате (на любой ветке): иначе флаг в колонке — закрытие 0.27. */
  closureRecorded: boolean;
}

type MessageWithParts = MessageLink & { parts: StoredMessage["parts"] };

// Части склейки голосовых фраз — чтобы ветка выбиралась так же, как у полного чтения.
const BRANCH_PART_TYPES = [APP_STATE_PART_TYPE, VOICE_MODE_PART_TYPE] as const;

/**
 * Состояние текущей ветки без текстов сообщений: связи и части состояния через `listMessagePartsOfTypes`, ветка и
 * свёртка — здесь. Хранилище без метода — полное чтение `listMessages`.
 */
export async function readBranchState(
  storage: Pick<ChatStorage, "listMessages" | "listBranchSelections" | "listMessagePartsOfTypes">,
  chatId: string,
): Promise<BranchState> {
  const [messages, selections] = await Promise.all([
    storage.listMessagePartsOfTypes ? storage.listMessagePartsOfTypes(chatId, BRANCH_PART_TYPES) : storage.listMessages(chatId),
    storage.listBranchSelections(chatId),
  ]);
  return branchStateOf(messages, selections);
}

/** То же по уже прочитанным сообщениям чата (все ветки) и выбору человека. */
export function branchStateOf(messages: readonly MessageWithParts[], selections: readonly StoredBranchSelection[]): BranchState {
  const branch = selectCurrentBranch(withoutGlueFragments(messages), selections);
  return {
    values: foldAppState(branch),
    atMessageId: branch.at(-1)?.id ?? null,
    closureRecorded: messages.some((message) => message.parts.some(touchesClosure)),
  };
}
