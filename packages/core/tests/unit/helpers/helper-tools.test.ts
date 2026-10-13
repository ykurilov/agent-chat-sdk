import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readAll } from "../support/mock-model";
import {
  askInNewChat,
  callsHelper,
  helperCalls,
  helperChatModel,
  helperService,
  researchHelper,
  searchTool,
  userMessage,
} from "../support/helper-fixtures";

const removeTool = tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), execute: async () => "удалено" });
const toolNames = (call: { tools?: Array<{ name: string }> } | undefined) => (call?.tools ?? []).map((item) => item.name);

describe("инструменты помощников helper_<имя>", () => {
  it("у основного агента — инструмент helper_<имя> с описанием помощника и входом { task }, по имени вместе с остальными", async () => {
    const model = helperChatModel();
    const { service } = helperService({ model, helpers: { research: researchHelper() }, tools: { zzz: removeTool, aaa: removeTool } });
    await askInNewChat(service);
    const call = model.doStreamCalls[0]!;
    expect(toolNames(call)).toEqual(["aaa", "helper_research", "zzz"]);
    expect(call.tools!.find((item) => item.name === "helper_research")).toMatchObject({
      type: "function",
      description: "Ищет в интернете и пишет короткую сводку",
      inputSchema: { type: "object", properties: { task: { type: "string" } }, required: ["task"] },
    });
  });

  it("список инструментов одинаков в каждом ходе, в том числе после вызова помощника", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода в Москве")] });
    const { service } = helperService({ model, helpers: { research: researchHelper(), notes: researchHelper({ description: "Заметки" }) } });
    const { chat } = await askInNewChat(service);
    await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "а завтра?")));
    const calls = model.doStreamCalls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(call.tools).toEqual(calls[0]!.tools);
    expect(toolNames(calls[0])).toEqual(["helper_notes", "helper_research"]);
  });

  it("помощнику достаются только его инструменты: без helper_* и инструментов приложения", async () => {
    const model = helperChatModel({
      stream: [callsHelper("h1", "research", "погода")],
      generate: [helperCalls({ id: "s1", toolName: "search", input: { query: "погода" } })],
    });
    const { service } = helperService({ model, helpers: { research: researchHelper(), notes: researchHelper() }, tools: { remove: removeTool } });
    await askInNewChat(service);
    expect(model.doGenerateCalls.length).toBeGreaterThan(0);
    for (const call of model.doGenerateCalls) expect(toolNames(call)).toEqual(["search"]);
  });

  it("помощник без инструментов получает запрос без инструментов", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "plain", "скажи привет")] });
    const { service } = helperService({ model, helpers: { plain: researchHelper({ tools: undefined }) }, tools: { remove: removeTool } });
    await askInNewChat(service);
    expect(toolNames(model.doGenerateCalls[0])).toEqual([]);
  });

  it("инструменты помощника функцией получают модель помощника", async () => {
    const seen: string[] = [];
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")] });
    const helper = researchHelper({
      tools: (toolsModel) => {
        seen.push(`${toolsModel.profile.id}/${toolsModel.providerId}/${toolsModel.ownerId}`);
        return { search: searchTool() };
      },
    });
    const { service } = helperService({ model, helpers: { research: helper } });
    await askInNewChat(service);
    expect(seen).toContain("mock-model/mock/anna");
  });

  it.each(["Research", "1st", "web-search", "поиск", "", "a".repeat(32)])("имя «%s» — ошибка при создании службы", (name) => {
    const model = helperChatModel();
    expect(() => helperService({ model, helpers: { [name]: researchHelper() } })).toThrow(/Помощник/);
  });

  it("имя по правилу [a-z][a-z0-9_]{0,30} принимается", () => {
    const model = helperChatModel();
    expect(() => helperService({ model, helpers: { a: researchHelper(), web_search_2: researchHelper(), ["a".repeat(31)]: researchHelper() } })).not.toThrow();
  });

  it("helper_<имя> совпало с инструментом приложения — ошибка при создании службы", () => {
    const model = helperChatModel();
    expect(() => helperService({ model, helpers: { research: researchHelper() }, tools: { helper_research: removeTool } })).toThrow(/helper_research/);
  });

  it("helper_<имя> совпало с инструментом памяти — ошибка при создании службы", () => {
    const model = helperChatModel();
    const memory = { instructions: "", tools: () => ({ helper_research: removeTool }), toolNames: ["helper_research"], snapshot: async () => null };
    expect(() => helperService({ model, helpers: { research: researchHelper() }, extra: { memory } })).toThrow(/helper_research/);
  });

  it("helper_<имя> совпало с инструментом приложения, заданным функцией, — ход падает, причина в журнале", async () => {
    const errors: string[] = [];
    const model = helperChatModel();
    const { service } = helperService({
      model,
      helpers: { research: researchHelper() },
      extra: { agent: { tools: () => ({ helper_research: removeTool }) }, logError: (message) => errors.push(message) },
    });
    const { chat } = await askInNewChat(service);
    const { messages } = await service.getHistory("anna", chat.id);
    expect(messages.at(-1)!.metadata?.status).toBe("error");
    expect(errors.some((line) => line.includes("helper_research"))).toBe(true);
  });

  it("модель помощника, которой нет в каталоге, — ошибка при создании службы", () => {
    const model = helperChatModel();
    expect(() => helperService({ model, helpers: { research: researchHelper({ model: { modelId: "нет-такой", providerId: "mock" } }) } })).toThrow();
  });

  it("фоновый помощник (background: true) без подключённого фона — ошибка при создании службы", () => {
    const model = helperChatModel();
    expect(() => helperService({ model, helpers: { research: researchHelper({ background: true }) } })).toThrow(/фон/);
  });
});
