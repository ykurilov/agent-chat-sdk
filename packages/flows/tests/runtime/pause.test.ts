import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noticeService, scriptedModel } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { DEFAULT_PAUSE_STAFF_SILENCE_HOURS } from "../../src/runtime/pause";
import type { AgentFlowOptions } from "../../src/runtime/flow-types";
import { memoryFlowStore } from "../../src/store/memory";
import { fixtureJson } from "../flow-fixtures";
import { emptyClientCard, fakeJudge } from "./flow-chat";
import { agentTexts, clockAt, human, OWNER, stateOfChat, tick } from "./timer-chat";
import { iso, msk, promptText, threeDays } from "./days-chat";

// T805: пауза «отвечает живой сотрудник» (→ В4) на модели-заглушке и подменённых часах. Сценарий трёхдневный:
// «Знакомство» длится 1 день — переход в 9:00 следующего дня.

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const HOUR = 3_600_000;

function pausedChat(pause?: AgentFlowOptions["pause"]) {
  const json = fixtureJson("sales-review");
  threeDays(json);
  const model = scriptedModel();
  const store = memoryFlowStore();
  const { judge } = fakeJudge();
  const logError = vi.fn<(message: string) => void>();
  const flow = buildAgentFlow(
    {
      loadFlow: async () => ({ flowId: "sales-review", versionId: "v1", flow: json }),
      store,
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
      logError,
      ...(pause && { pause }),
    },
    { judge, clientCard: emptyClientCard() },
  );
  const options = flow.withChat({ agent: { instructions: "Ты помощник." } });
  const { service, storage } = noticeService(model, options);
  flow.attach(service);
  return { model, store, storage, flow, service, logError, json };
}

async function started(chat = pausedChat()) {
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return { chat, id };
}

describe("T805: пауза при живом сотруднике", () => {
  it("по умолчанию 2 часа; на паузе admit → paused, сообщение записано без хода; потом агент отвечает снова", async () => {
    expect(DEFAULT_PAUSE_STAFF_SILENCE_HOURS).toBe(2);
    const { chat, id } = await started();
    await chat.flow.pause({ ownerId: OWNER, chatId: id });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: iso(msk(13, 17)) });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "paused" });

    const calls = chat.model.doStreamCalls.length;
    await human(chat, id, "Алло, вы тут?");
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(await agentTexts(chat.service, id)).toHaveLength(1);

    clockAt(msk(13, 17));
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
    await human(chat, id, "Есть кто?");
    expect(chat.model.doStreamCalls).toHaveLength(calls + 1);
  });

  it("каждый ответ сотрудника продлевает паузу ещё на 2 часа; длительность — настройка", async () => {
    const { chat, id } = await started();
    await chat.flow.noteStaffReply({ ownerId: OWNER, chatId: id, text: "Здравствуйте, это Мария." });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: iso(msk(13, 17)) });
    clockAt(msk(13, 16, 30));
    await chat.flow.noteStaffReply({ ownerId: OWNER, chatId: id, text: "Сейчас уточню." });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: iso(msk(13, 18, 30)) });

    // Пауза до заданного момента позже — продление её не укорачивает.
    await chat.flow.pause({ ownerId: OWNER, chatId: id, until: new Date(msk(13, 23)) });
    await chat.flow.noteStaffReply({ ownerId: OWNER, chatId: id });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: iso(msk(13, 23)) });

    const custom = await started(pausedChat({ staffSilenceHours: 5 }));
    await custom.chat.flow.noteStaffReply({ ownerId: OWNER, chatId: custom.id });
    expect(await custom.chat.store.getChat(custom.id)).toMatchObject({ pausedUntil: new Date(Date.now() + 5 * HOUR).toISOString() });
  });

  it("вернувшись, агент видит реплики сотрудника в своём контексте", async () => {
    const { chat, id } = await started();
    await chat.flow.noteStaffReply({ ownerId: OWNER, chatId: id, text: "Перезвоню вам завтра в 15:00." });
    await chat.flow.resume({ ownerId: OWNER, chatId: id });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: null });
    await human(chat, id, "Хорошо, а пока вопрос");
    const prompt = promptText(chat.model.doStreamCalls.at(-1)!);
    expect(prompt).toContain("Перезвоню вам завтра в 15:00.");
    expect(prompt).toContain("не противореч");
  });

  it("реплика идёт путём ядра (`appendStaffMessage`): сообщение сотрудника с именем, модель видит имя", async () => {
    const { chat, id } = await started();
    await chat.flow.noteStaffReply({ ownerId: OWNER, chatId: id, text: "Запись эфира: https://staff.example/rec", staffName: "Мария" });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: iso(msk(13, 17)) });
    const { messages } = (await chat.service.getHistory(OWNER, id))!;
    expect(messages.at(-1)!.parts).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ notices: [{ kind: "staff", title: "Запись эфира: https://staff.example/rec", staffName: "Мария" }] }) }),
    ]);
    await chat.flow.resume({ ownerId: OWNER, chatId: id });
    await human(chat, id, "Спасибо");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain("Живой сотрудник «Мария»");
  });

  it("таймеры стоят на паузе; после неё дни идут как шли (SC-105)", async () => {
    const { chat, id } = await started();
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 9)), dueExitId: "intro_day" });
    await chat.flow.pause({ ownerId: OWNER, chatId: id, until: new Date(msk(14, 12)) });
    const calls = chat.model.doStreamCalls.length;

    clockAt(msk(14, 9));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("intro");
    expect(chat.model.doStreamCalls).toHaveLength(calls);

    clockAt(msk(14, 12));
    await tick(chat, id);
    expect(await stateOfChat(chat.service, id)).toBe("block");
  });

  it("чужой или неизвестный чат пауза не трогает", async () => {
    const { chat, id } = await started();
    await chat.flow.pause({ ownerId: "bob", chatId: id });
    await chat.flow.noteStaffReply({ ownerId: "bob", chatId: id, text: "чужое" });
    await chat.flow.pause({ ownerId: OWNER, chatId: "nope" });
    expect(await chat.store.getChat(id)).toMatchObject({ pausedUntil: null });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
  });
});
