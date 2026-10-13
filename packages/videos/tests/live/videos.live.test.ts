// Живая проверка видео (025, SC-004): настоящая модель на «покажи урок про …» ищет через `find_videos` и показывает нужное
// через `show_video`; на просьбу «с того места, где примеры» — с начала главы. Каталог демо, дешёвая модель через OpenRouter.
// Ключ — только из окружения (`pnpm secrets:load`). Запуск: `pnpm test:live videos`.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "../../../core/src/index";
import { describe, expect, it } from "vitest";
import { demoVideos } from "../../../../apps/demo/server/demo-videos";
import { createVideoLibrary } from "../../src/index";

if (!process.env.OPENROUTER_API_KEY) throw new Error("Нет OPENROUTER_API_KEY: выполните `pnpm secrets:load`");

const modelId = "deepseek-4.1-flash";
const providerId = "openrouter";
const ownerId = "videos-tester";

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done);
}

interface ToolPart {
  type: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

describe("видео у настоящей модели (OpenRouter)", () => {
  it("«покажи урок про нейросети, с того места, где примеры»: find_videos → show_video нужного id с главы", async () => {
    const storage = createInMemoryChatStorage();
    const library = createVideoLibrary({ videos: demoVideos });
    const service = createChatService({
      storage,
      catalog: standardCatalog,
      defaultChoice: { modelId, providerId },
      agent: { instructions: "Ты помощник школы. Отвечай по-русски, коротко.", tools: (model) => library.tools(model) },
      env: process.env,
    });

    const chat = await service.createChat(ownerId);
    await drain(
      await service.sendMessage(ownerId, chat.id, {
        id: "u-1",
        role: "user",
        parts: [{ type: "text", text: "Покажи короткий урок про нейросети — с того места, где разбирают примеры." }],
      }),
    );
    const { messages } = await service.getHistory(ownerId, chat.id);
    const answer = messages.filter((message) => message.role === "assistant").at(-1)!;
    expect(answer.metadata?.status, JSON.stringify(answer.metadata)).toBe("complete");
    const tools = answer.parts.filter((part) => part.type.startsWith("tool-")) as ToolPart[];
    console.info(`[videos-result] вызовы: ${tools.map((part) => `${part.type.slice(5)}(${JSON.stringify(part.input)})`).join(", ")}`);

    expect(tools.some((part) => part.type === "tool-find_videos")).toBe(true);
    const shown = tools.find((part) => part.type === "tool-show_video" && part.output && "видео" in part.output);
    expect(shown, "модель не показала видео").toBeTruthy();
    const video = shown!.output!["видео"] as { id: string; начало?: number };
    expect(video.id).toBe("neural-networks");
    console.info(`[videos-result] показано ${video.id} с секунды ${video.начало ?? 0} (глава «Примеры» — 200)`);

    const [usage] = await storage.sumUsage({ ownerId });
    console.info(`[videos-result] токены: вход ${usage?.inputTokens}, выход ${usage?.outputTokens}, рассуждения ${usage?.reasoningTokens}`);
  }, 180_000);
});
