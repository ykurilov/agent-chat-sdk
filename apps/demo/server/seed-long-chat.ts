import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CURRENT_FORMAT_VERSION } from "@ykurilov/agent-chat-core";
import type { ChatStorage, StoredMessage } from "@ykurilov/agent-chat-core";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";

/*
 * Длинный чат для проверки ленты (SC-008): вопросы и ответы с рассуждениями, вызовами
 * инструмента, таблицами и кодом. Один ответ в середине чата остановлен: проверка отметки
 * «Остановлено» у старого ответа (FR-007). В модуль не входит.
 *
 *   pnpm exec tsx server/seed-long-chat.ts --user anna [--messages 500] [--db demo.sqlite]
 *
 * Печатает id созданного чата.
 */

const modelId = "deepseek-4.1-flash";
const providerId = "deepseek";

function answerMarkdown(turn: number): string {
  return `### Ответ ${turn}

Разбираю вопрос по шагам: сначала данные, потом вывод. Время взято инструментом, остальное — расчёт.

| Город | Время | Разница с Москвой |
|---|---|---|
| Москва | 12:${String(turn % 60).padStart(2, "0")} | 0 ч |
| Токио | 18:${String(turn % 60).padStart(2, "0")} | +6 ч |

\`\`\`ts
const difference${turn} = (tokyo: number, moscow: number) => tokyo - moscow;
\`\`\`

- первый пункт ответа ${turn};
- второй пункт с **выделением** и \`кодом\`.`;
}

function turnMessages(
  chatId: string,
  turn: number,
  parentId: string | null,
  startedAt: number,
  answerStatus: StoredMessage["status"],
): [StoredMessage, StoredMessage] {
  const common = {
    chatId,
    formatVersion: CURRENT_FORMAT_VERSION,
    usage: null,
    error: null,
  };
  const question: StoredMessage = {
    ...common,
    id: `${chatId}-${turn}-q`,
    parentId,
    role: "user",
    parts: [{ type: "text", text: `Вопрос ${turn}: сколько времени в Токио и в Москве?` }],
    status: "complete",
    modelId: null,
    providerId: null,
    reasoningDurationsMs: {},
    createdAt: new Date(startedAt + turn * 2_000).toISOString(),
  };
  const answer: StoredMessage = {
    ...common,
    id: `${chatId}-${turn}-a`,
    parentId: question.id,
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: `Нужно время в Токио для вопроса ${turn}.`, state: "done" },
      {
        type: "tool-current_time",
        toolCallId: `${chatId}-${turn}-call`,
        state: "output-available",
        input: { timeZone: "Asia/Tokyo" },
        output: { timeZone: "Asia/Tokyo", time: "2026-09-29T18:00:00+09:00" },
      },
      { type: "step-start" },
      { type: "reasoning", text: "Время есть, считаю разницу.", state: "done" },
      { type: "text", text: answerMarkdown(turn), state: "done" },
    ],
    status: answerStatus,
    modelId,
    providerId,
    reasoningDurationsMs: { "0": 1_200, "1": 800 },
    createdAt: new Date(startedAt + turn * 2_000 + 1_000).toISOString(),
  };
  return [question, answer];
}

/** Номер хода с остановленным ответом: середина чата. */
function stoppedTurn(turnCount: number): number {
  return Math.ceil(turnCount / 2);
}

/** Создаёт чат пользователя из `messageCount` сообщений (пары вопрос–ответ). Возвращает id чата. */
export async function seedLongChat(storage: ChatStorage, options: { ownerId: string; messageCount: number }): Promise<string> {
  const chatId = crypto.randomUUID();
  await storage.createChat({ id: chatId, ownerId: options.ownerId, modelId, providerId });
  const startedAt = Date.now() - options.messageCount * 2_000;
  let parentId: string | null = null;
  const turnCount = options.messageCount / 2;
  for (let turn = 1; turn <= turnCount; turn++) {
    const answerStatus = turn === stoppedTurn(turnCount) ? "stopped" : "complete";
    const [question, answer] = turnMessages(chatId, turn, parentId, startedAt, answerStatus);
    await storage.insertMessage(question);
    await storage.insertMessage(answer);
    parentId = answer.id;
  }
  return chatId;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      user: { type: "string", default: "anna" },
      messages: { type: "string", default: "500" },
      db: { type: "string", default: process.env.DEMO_DB_FILE ?? fileURLToPath(new URL("../demo.sqlite", import.meta.url)) },
    },
  });
  const messageCount = Number(values.messages);
  if (!Number.isInteger(messageCount) || messageCount < 2 || messageCount % 2 !== 0) {
    throw new Error("--messages: чётное число не меньше 2");
  }
  const storage = createSqliteChatStorage({ filePath: values.db });
  try {
    console.log(await seedLongChat(storage, { ownerId: values.user, messageCount }));
  } finally {
    storage.close();
  }
}
