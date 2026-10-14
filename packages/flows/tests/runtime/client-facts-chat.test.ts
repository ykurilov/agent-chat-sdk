import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, noticeService, saying, scriptedModel } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureJson } from "../flow-fixtures";
import { fakeJudge, fakeTimers, newChat, OWNER, say, toolOutput, userTexts } from "./flow-chat";

// Факты о человеке в живом ходе: `clientFacts: true` — правило в инструкции, запись через flow_note, блок в следующем ходе.

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

function factsChat(clientFacts: boolean, scripts: Parameters<typeof scriptedModel>[0]) {
  const store = memoryFlowStore();
  const model = scriptedModel(scripts);
  const { judge } = fakeJudge();
  const flow = buildAgentFlow(
    { loadFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow: fixtureJson("sales-review") }), store, judge: { fallback: { modelId: mockModelId, providerId: "mock" } }, ...(clientFacts && { clientFacts }) },
    { judge, timers: fakeTimers() },
  );
  const { service } = noticeService(model, flow.withChat({ agent: { instructions: "Ты помощник." } }));
  flow.attach(service);
  return { model, store, flow, service };
}

describe("clientFacts: true", () => {
  it("агент записывает факт через flow_note; со следующего хода он в блоке flow:client; в инструкции есть правило про факты и память", async () => {
    const chat = factsChat(true, [callTool("flow_note", "n1", { fact: "Ведёт блог про акварель" }), saying("Здорово!"), saying("Расскажите подробнее")]);
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "У меня блог про акварель");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "n1")).toContain("Записано");
    expect((await chat.store.readCard(OWNER)).map((entry) => entry.value)).toEqual(["Ведёт блог про акварель"]);
    expect(JSON.stringify(chat.model.doStreamCalls[0]!.prompt)).toContain("manage_memory");

    await say(chat.service, id, "Что дальше?");
    expect(userTexts(chat.model.doStreamCalls[2]!)).toContain("- Ведёт блог про акварель");
  });

  it("человеку через handle: readClientCard отдаёт факт записью `fact:<id>`, forgetClientCard(all) стирает", async () => {
    const chat = factsChat(true, [callTool("flow_note", "n1", { fact: "Ведёт блог" }), saying("Ок")]);
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "У меня блог");

    expect((await chat.flow.readClientCard(OWNER)).map((entry) => entry.fieldId)).toEqual([expect.stringMatching(/^fact:f[0-9a-f]{8}$/)]);
    await chat.flow.forgetClientCard(OWNER, "all");
    expect(await chat.flow.readClientCard(OWNER)).toEqual([]);
  });
});

describe("clientFacts не включён", () => {
  it("в инструкции нет правила про факты, в схеме flow_note нет `fact`", async () => {
    const chat = factsChat(false, [saying("Привет")]);
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет");

    expect(JSON.stringify(chat.model.doStreamCalls[0]!.prompt)).not.toContain("manage_memory");
    expect(JSON.stringify(chat.model.doStreamCalls[0]!.tools)).not.toContain('"fact"');
  });
});
