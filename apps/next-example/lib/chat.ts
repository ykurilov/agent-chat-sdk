import { createAttachments, createMemoryAttachmentStorage } from "@ykurilov/agent-chat-attachments";
import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { createChatHandler } from "@ykurilov/agent-chat-server";
import type { ChatHandler } from "@ykurilov/agent-chat-server";
import { exampleCatalog, exampleModelId, exampleProviderId } from "./mock-model";
import { userCookieName } from "./user-cookie";

function readCookie(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function createExampleChatHandler(): ChatHandler {
  return createChatHandler({
    basePath: "/api/chat",
    storage: createInMemoryChatStorage(),
    attachments: createAttachments({ storage: createMemoryAttachmentStorage() }),
    // В своём приложении здесь читается ваша сессия. Пример берёт имя из cookie.
    resolveUser: async (request) => {
      const id = readCookie(request, userCookieName);
      return id ? { id } : null;
    },
    defaultChoice: { modelId: exampleModelId, providerId: exampleProviderId },
    catalog: exampleCatalog(),
    agent: { instructions: "Ты помощник." },
    env: { EXAMPLE_API_KEY: "не-настоящий-ключ" },
  });
}

/*
 * Обработчик один на процесс сервера: идущие ответы живут в нём. В `next dev` модуль
 * перезагружается при правках, поэтому обработчик лежит в globalThis и переживает перезагрузку.
 */
const shared = globalThis as typeof globalThis & { exampleChatHandler?: ChatHandler };
export const chatHandler = (shared.exampleChatHandler ??= createExampleChatHandler());

/*
 * Брошенные ответы (сервер упал посреди ответа) помечаются «прерванными». Зовётся один раз при старте процесса, как в шаге 4
 * getting-started. У хранилища в памяти после перезапуска ничего не остаётся, но образцу с настоящим хранилищем вызов нужен.
 */
const recovery = globalThis as typeof globalThis & { exampleChatRecovered?: boolean };
if (!recovery.exampleChatRecovered) {
  recovery.exampleChatRecovered = true;
  void chatHandler.recoverInterruptedAnswers();
}
