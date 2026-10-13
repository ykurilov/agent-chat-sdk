import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentToolsModel } from "../../../src/agent-run/run-agent-turn";
import { readAll } from "../support/mock-model";
import { lastUserTexts, noticeService, scriptedModel, textsOf, toolNamesOf, userMessage } from "../support/notice-chat";

const openTask = tool({ description: "Открыть задачу на экране", inputSchema: z.object({ taskId: z.number() }) });
const find = tool({ description: "Найти", inputSchema: z.object({}), execute: async () => "нашёл" });

describe("T044: канал хода", () => {
  it("в мессенджере нет браузерных инструментов, в вебе — есть; модель инструментов знает канал и id ответа", async () => {
    const model = scriptedModel();
    const seen: AgentToolsModel[] = [];
    const { service } = noticeService(model, {
      agent: {
        browserTools: { open_task: openTask },
        tools: (toolsModel) => {
          seen.push(toolsModel);
          return { find };
        },
      },
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { channel: "telegram" }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё"), { channel: "telegram" }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "из веба")));
    expect(toolNamesOf(model.doStreamCalls[0]!)).toEqual(["find"]);
    expect(toolNamesOf(model.doStreamCalls[1]!)).toEqual(["find"]);
    expect(toolNamesOf(model.doStreamCalls[2]!)).toEqual(["find", "open_task"]);
    expect(seen[0]).toMatchObject({ channel: "telegram", audience: "private" });
    expect(seen.at(-1)).toMatchObject({ channel: "web", audience: "private" });
    const answers = (await service.getHistory("anna", chat.id)).messages.filter((message) => message.role === "assistant");
    expect(seen[0]!.messageId).toBe(answers[0]!.id);
  });

  it("заметка о канале — в хвосте сообщения человека при смене канала; история до неё не меняется", async () => {
    const model = scriptedModel();
    const { service } = noticeService(model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "привет"), { channel: "telegram" }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "ещё"), { channel: "telegram" }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u3", "из веба"), { channel: "web" }));
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u4", "из вк"), { channel: "vk" }));
    const [first, second, third, fourth] = model.doStreamCalls;
    expect(lastUserTexts(first!).some((text) => text.includes("Telegram"))).toBe(true);
    expect(lastUserTexts(second!).some((text) => text.includes("Telegram"))).toBe(false);
    expect(lastUserTexts(third!).some((text) => /веб/i.test(text))).toBe(true);
    expect(lastUserTexts(fourth!).some((text) => text.includes("ВКонтакте"))).toBe(true);
    const prefix = (call: typeof first) => JSON.stringify(call!.prompt.slice(0, 2).map(({ providerOptions: _, ...rest }) => rest));
    // Дата — только в последнем сообщении (как и раньше); заметка о канале остаётся в истории тем же текстом.
    expect(prefix(third)).toBe(prefix(second));
    expect(textsOf(second!.prompt[1])).toContain(lastUserTexts(first!)[1]);
  });
});
