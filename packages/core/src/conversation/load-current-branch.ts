import type { ChatStorage, MessageLink } from "../storage/chat-storage";
import { selectCurrentBranch } from "./branches";
import { withoutGlueFragments } from "./glue-fragments";
import type { StoredMessage } from "./types";

/** Текущая ветка чата: сообщения и выбор человека читаются из хранилища вместе. Обрывки склейки голосовых фраз в неё не попадают. */
export async function loadCurrentBranch(
  storage: Pick<ChatStorage, "listMessages" | "listBranchSelections">,
  chatId: string,
): Promise<StoredMessage[]> {
  const [messages, selections] = await Promise.all([storage.listMessages(chatId), storage.listBranchSelections(chatId)]);
  return selectCurrentBranch(withoutGlueFragments(messages), selections);
}

/** То же по связям без содержимого: для тех, кому нужна только форма ветки (например, записи сжатия для экрана). */
export async function loadCurrentBranchLinks(
  storage: Pick<ChatStorage, "listMessageLinks" | "listBranchSelections">,
  chatId: string,
): Promise<MessageLink[]> {
  const [links, selections] = await Promise.all([storage.listMessageLinks(chatId), storage.listBranchSelections(chatId)]);
  return selectCurrentBranch(links, selections);
}
