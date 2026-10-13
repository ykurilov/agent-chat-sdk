import { jsonSchema, tool } from "ai";
import type { UIMessageChunk } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { anna } from "../fake-apis/rig";
import { telegramChannel } from "./support/channels";
import { type RealChat, startRealChat } from "./support/real-chat";

const annaChat = { id: anna.id, type: "private" as const };

let chat: RealChat | undefined;
afterEach(async () => {
  await chat?.close();
  chat = undefined;
});

const lookup = tool({
  description: "Служебный поиск",
  inputSchema: jsonSchema<{ q: string }>({ type: "object", properties: { q: { type: "string" } } }),
  execute: async () => "внутренние цены",
});

async function chatWith(toolDetails: boolean) {
  const real = await startRealChat({
    channel: await telegramChannel(),
    server: { agent: { instructions: "Ты помощник.", tools: { lookup } }, chatCapabilities: () => ({ toolDetails }) },
  });
  await real.link(anna, "anna");
  // Куски, которые служба отдала мессенджеру.
  const received: UIMessageChunk[] = [];
  const send = real.service.sendMessage.bind(real.service);
  vi.spyOn(real.service, "sendMessage").mockImplementation(async (...args) => {
    const [mine, copy] = (await send(...args)).tee();
    void (async () => {
      const reader = copy.getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) received.push(read.value);
    })();
    return mine;
  });
  real.model.script({ tool: { name: "lookup", input: { q: "цены" } } }, { text: "Тариф — 100 ₽." });
  await real.human({ type: "text", chat: annaChat, from: anna, text: "Сколько стоит?" });
  return { real, received };
}

const toolChunks = (chunks: UIMessageChunk[]) => chunks.filter((chunk) => "toolCallId" in chunk);

describe("мессенджер и запрет служебных инструментов (toolDetails: false)", () => {
  it("скрытый вызов до мессенджера не доходит: ни кусков вызова, ни строки «Работаю…»; ответ приходит", async () => {
    const { real, received } = await chatWith(false);
    chat = real;
    expect(received.some((chunk) => chunk.type === "text-delta")).toBe(true);
    expect(toolChunks(received)).toEqual([]);
    expect(JSON.stringify(received)).not.toContain("внутренние цены");
    const texts = chat.textsIn(annaChat.id);
    expect(texts.at(-1)).toBe("Тариф — 100 ₽.");
    expect(texts.join("\n")).not.toContain("Работаю");
    expect(chat.errors).toEqual([]);
  });

  it("разрешено — тот же ход отдаёт мессенджеру вызов инструмента", async () => {
    const { real, received } = await chatWith(true);
    chat = real;
    expect(toolChunks(received).map((chunk) => chunk.type)).toContain("tool-input-available");
  });
});
