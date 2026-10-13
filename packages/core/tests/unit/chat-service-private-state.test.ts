import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentToolsModel, ChatEvent } from "../../src/index";
import { readAll } from "./support/mock-model";
import { callTool, noticeService, saying, scriptedModel, userMessage } from "./support/notice-chat";

const bookTool = (model: AgentToolsModel) => ({
  book: tool({
    description: "Забронировать",
    inputSchema: z.object({}),
    execute: async () => {
      model.state!.set("form.date", "12 октября");
      model.state!.set("booking.id", "bk-secret-42");
      return "забронировано";
    },
  }),
});

function setup(privateStateKeys?: string[]) {
  const events: ChatEvent[] = [];
  const built = noticeService(scriptedModel([callTool("book", "b1", {}), saying("Готово")]), {
    agent: { tools: bookTool },
    ...(privateStateKeys && { privateStateKeys }),
  });
  built.service.subscribeEvents((event) => events.push(event));
  return { ...built, events };
}

describe("закрытые ключи состояния (privateStateKeys)", () => {
  it("клиенту — без закрытых ключей: поток и история; серверу — всё: getChatState, события, хранилище", async () => {
    const { service, storage, events } = setup(["booking"]);
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Забронируй")));
    expect(JSON.stringify(chunks)).not.toContain("bk-secret-42");
    expect(JSON.stringify(chunks)).toContain("12 октября");
    for (const history of [await service.getHistory("anna", chat.id), await service.peekHistory("anna", chat.id)]) {
      expect(JSON.stringify(history)).not.toContain("bk-secret-42");
      expect(JSON.stringify(history)).toContain("12 октября");
    }
    expect((await service.getChatState("anna", chat.id)).values).toEqual({ form: { date: "12 октября" }, booking: { id: "bk-secret-42" } });
    expect(events.find((event) => event.type === "state-changed")).toMatchObject({ state: { booking: { id: "bk-secret-42" } } });
    expect(JSON.stringify(await storage.listMessages(chat.id))).toContain("bk-secret-42");
  });

  it("без опции — всё как раньше", async () => {
    const { service } = setup();
    const chat = await service.createChat("anna");
    const chunks = await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Забронируй")));
    expect(JSON.stringify(chunks)).toContain("bk-secret-42");
  });

  it("неверное имя: пустое, служебное ($) или с точкой — TypeError", () => {
    for (const bad of ["", "$closed", "booking.id"]) expect(() => setup([bad])).toThrow(TypeError);
  });
});
