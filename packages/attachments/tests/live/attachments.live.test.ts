// Живая проверка на настоящих моделях: картинку видят GPT 6 Luna и Gemini через OpenRouter, текст PDF читает DeepSeek.
// Ключи — только из окружения (`pnpm secrets:load`), в вывод они не попадают.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { describe, expect, it } from "vitest";
import { createAttachments, createMemoryAttachmentStorage } from "../../src";
import { makePdf, makePng } from "../support/sample-files";

for (const name of ["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"]) {
  if (!process.env[name]) throw new Error(`Нет ${name}: выполните \`pnpm secrets:load\``);
}

/** Чат с вложениями на настоящей модели: загружает файл теми же адресами, что и браузер, и задаёт вопрос. */
async function askAboutFile(
  choice: { modelId: string; providerId: string },
  file: { name: string; bytes: Uint8Array; type: string },
  question: string,
) {
  const attachments = createAttachments({ storage: createMemoryAttachmentStorage() });
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: standardCatalog,
    defaultChoice: choice,
    attachments,
    agent: { instructions: `Ты помощник. Отвечай по-русски, коротко.` },
    env: process.env,
  });
  const chat = await service.createChat("anna");
  const form = new FormData();
  form.set("file", new File([file.bytes as BlobPart], file.name, { type: file.type }));
  const uploaded = await attachments.handle({
    request: new Request(`http://x/api/chat/${chat.id}/attachments`, { method: "POST", body: form }),
    userId: "anna",
    chatId: chat.id,
    segments: [],
  });
  expect(uploaded.status).toBe(201);
  const { id } = (await uploaded.json()) as { id: string };

  const stream = await service.sendMessage("anna", chat.id, {
    id: "q1",
    role: "user",
    parts: [
      { type: "file", url: `attachment:${id}`, mediaType: file.type, filename: file.name },
      { type: "text", text: question },
    ],
  });
  for await (const _chunk of stream) {
    // ход дочитывается до конца
  }
  const { messages } = await service.getHistory("anna", chat.id);
  const answer = messages.findLast((message) => message.role === "assistant");
  expect(answer?.metadata?.status, `ответ: ${JSON.stringify(answer?.metadata)}`).toBe("complete");
  return (answer?.parts ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

describe("картинка в сообщении: модель её видит", () => {
  const redSquare = { name: "квадрат.png", bytes: makePng(64, [220, 20, 20]), type: "image/png" };
  const question = "Какого цвета квадрат на картинке? Ответь одним словом.";

  it.each([
    ["GPT 6 Luna", "gpt-6-luna"],
    ["Gemini 3.8 Flash", "gemini-3.8-flash"],
  ])(
    "%s через OpenRouter называет цвет красного квадрата",
    async (_name, modelId) => {
      const text = await askAboutFile({ modelId, providerId: "openrouter" }, redSquare, question);
      expect(text, `ответ: ${text}`).toMatch(/красн|red/i);
    },
    120_000,
  );
});

describe("PDF в сообщении: текст достаётся на сервере и читается любой моделью", () => {
  it(
    "DeepSeek 4.1 Flash находит код в PDF",
    async () => {
      const pdf = { name: "счёт.pdf", bytes: makePdf(["Invoice 2026-118", "Access code: ZEBRA-4471", "Total due: 42 EUR"]), type: "application/pdf" };
      const text = await askAboutFile({ modelId: "deepseek-4.1-flash", providerId: "deepseek" }, pdf, "Какой код доступа указан в файле? Ответь только кодом.");
      expect(text, `ответ: ${text}`).toContain("ZEBRA-4471");
    },
    120_000,
  );
});
