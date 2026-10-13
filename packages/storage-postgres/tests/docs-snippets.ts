// Не тест: фрагменты из docs/getting-started.md («Какое хранилище выбрать»). Попадают в `pnpm typecheck`,
// чтобы инструкция не разошлась с настоящими подписями функций.
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { ChatStorage } from "@ykurilov/agent-chat-core";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { createPostgresChatStorage } from "../src";

export async function threeWaysToCreateStorage(): Promise<ChatStorage[]> {
  const memory = createInMemoryChatStorage();
  const sqlite = createSqliteChatStorage({ filePath: "chat.sqlite" });
  const postgres = await createPostgresChatStorage({ connectionString: process.env.DATABASE_URL! });
  sqlite.close();
  await postgres.close();
  return [memory, sqlite, postgres];
}
