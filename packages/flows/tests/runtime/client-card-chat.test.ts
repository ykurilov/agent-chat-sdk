import { flowStateCommitter, type ChatService } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, noticeService, saying, scriptedModel } from "../../../core/tests/unit/support/notice-chat";
import { mockModelId } from "../../../core/tests/unit/support/mock-model";
import { buildAgentFlow } from "../../src/runtime/agent-flow";
import { createClientCard } from "../../src/runtime/client-card";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { fixtureJson } from "../flow-fixtures";
import { fakeJudge, fakeTimers, newChat, OWNER, runOf, say, toolOutput, userTexts, type FlowChatSetup } from "./flow-chat";

// T080/T082 в живом ходе: настоящий модуль карточки вместо подделки, поддельные модель, судья и таймеры.

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

type Script = NonNullable<FlowChatSetup["scripts"]>[number];

function cardChat(setup: {
  flow: "sales-review" | "shop-support";
  edit?: (json: Record<string, any>) => void;
  scripts?: Script[];
  store?: FlowStore;
  chatOptions?: Record<string, unknown>;
}) {
  const json = fixtureJson(setup.flow);
  setup.edit?.(json);
  const store = setup.store ?? memoryFlowStore();
  const model = scriptedModel(setup.scripts ?? []);
  const { judge } = fakeJudge();
  const flow = buildAgentFlow(
    {
      loadFlow: async () => ({ flowId: setup.flow, versionId: "v1", flow: json }),
      store,
      judge: { fallback: { modelId: mockModelId, providerId: "mock" } },
    },
    { judge, timers: fakeTimers(), clientCard: createClientCard(store, () => new Date()) },
  );
  const options = flow.withChat({ agent: { instructions: "Ты помощник." }, ...setup.chatOptions });
  const { service } = noticeService(model, options);
  flow.attach(service);
  return { model, store, flow, service };
}

const note = (field: string, value: unknown, id = "n1") => callTool("flow_note", id, { field, value });

describe("T080 переход по данным в том же ответе", () => {
  it("flow_note, clear карточки и отказ flow_exit сохраняют квитанцию и неизвестные поля приложения", async () => {
    const chat = cardChat({ flow: "sales-review", scripts: [
      saying("Привет"), note("name", "Анна"), saying("Запомнил"),
      callTool("client_card", "clear-card", { action: "forget", field: "all" }), saying("Карточка очищена"),
      callTool("flow_exit", "declined-exit", { exit: 1, why: "Заявка" }), saying("Продолжим"),
    ] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет"); await chat.flow.settled();
    const snapshot = await chat.service.getChatState(OWNER, id);
    const confirmations = { ownPublished: { status: "confirmed", revision: "1", source: { kind: "judge" } } };
    const applicationData = { retained: 42 };
    expect((await flowStateCommitter(chat.service)!({ ownerId: OWNER, chatId: id, flowId: "sales-review", revision: "1", expectedAtMessageId: snapshot.atMessageId,
      idempotencyKey: "seed-server-proof", flow: { ...(snapshot.values.flow as Record<string, unknown>), confirmations, applicationData } })).status).toBe("applied");
    for (const message of ["Меня зовут Анна", "Забудь карточку", "Попробуй перейти"]) {
      await say(chat.service, id, message); await chat.flow.settled();
      expect((await chat.service.getChatState(OWNER, id)).values.flow).toMatchObject({ confirmations, applicationData });
    }
    expect(toolOutput(chat.model.doStreamCalls[2]!, "n1")).toContain("Записано");
    expect(toolOutput(chat.model.doStreamCalls[4]!, "clear-card")).toContain("Стёр всё");
    expect(toolOutput(chat.model.doStreamCalls[6]!, "declined-exit")).toContain("Судья не подтвердил");
    await chat.flow.stop(); await chat.service.flush();
  });

  it("поле карточки: flow_note записал значение — в результате карточка нового состояния", async () => {
    const chat = cardChat({
      flow: "sales-review",
      edit: (json) =>
        json.states.find((state: { id: string }) => state.id === "intro").exits.unshift({
          id: "intro_big",
          when: { type: "data", field: "sales", op: "eq", value: "больше 10 продаж" },
          to: "offer",
        }),
      scripts: [note("sales", "больше 10 продаж"), saying("Отлично!")],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Я продал больше десяти");

    const output = toolOutput(chat.model.doStreamCalls[1]!, "n1");
    expect(output).toContain("Предложение разбора");
    expect((await runOf(chat.service, id))?.state).toBe("offer");
    expect((await chat.store.readCard(OWNER)).map((entry) => entry.fieldId)).toEqual(["sales"]);
  });

  it("заметка чата: условие по заметке срабатывает сразу после flow_note", async () => {
    const chat = cardChat({ flow: "shop-support", scripts: [note("topic", "заказ"), saying("Назовите номер заказа.")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Где мой заказ?");

    expect(toolOutput(chat.model.doStreamCalls[1]!, "n1")).toContain("Состояние");
    expect((await runOf(chat.service, id))?.state).toBe("order");
    expect(await chat.store.readCard(OWNER)).toEqual([]);
  });

  it("значение не по типу — неизвестно: перехода нет, ничего не записано", async () => {
    const chat = cardChat({ flow: "shop-support", scripts: [note("topic", "что-то другое"), saying("Расскажите подробнее.")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Привет");

    expect((await runOf(chat.service, id))?.state).toBe("hello");
  });
});

describe("T080 второй чат того же человека в другом сценарии", () => {
  it("имя из карточки известно сразу: в блоке flow:client есть имя, переспрашивать не просят", async () => {
    const store = memoryFlowStore();
    const first = cardChat({ flow: "sales-review", store, scripts: [note("name", "Ольга"), saying("Приятно познакомиться, Ольга!")] });
    const { id: firstId } = await newChat(first.service);
    await say(first.service, firstId, "Меня зовут Ольга");

    const second = cardChat({ flow: "shop-support", store });
    const { id } = await newChat(second.service);
    await say(second.service, id, "Привет");

    const text = userTexts(second.model.doStreamCalls[0]!);
    expect(text).toContain("Что известно о человеке");
    expect(text).toContain("Имя: Ольга");
    expect(text).not.toMatch(/можно спросить между делом: «Имя»/i);
  });
});

describe("T081 словами через агента: «что ты обо мне знаешь?» и «забудь…»", () => {
  it("client_card show отвечает записанным, forget стирает поле — и в хранилище, и для следующего блока", async () => {
    const store = memoryFlowStore();
    const chat = cardChat({
      flow: "sales-review",
      store,
      scripts: [
        note("occupation", "Иллюстратор"),
        saying("Запомнил."),
        callTool("client_card", "c1", { action: "show" }),
        saying("Вы иллюстратор."),
        callTool("client_card", "c2", { action: "forget", field: "occupation" }),
        saying("Забыл."),
      ],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Я иллюстратор");
    await say(chat.service, id, "Что ты обо мне знаешь?");
    expect(toolOutput(chat.model.doStreamCalls[3]!, "c1")).toContain("Иллюстратор");

    await say(chat.service, id, "Забудь, где я работаю");
    expect(toolOutput(chat.model.doStreamCalls[5]!, "c2")).toContain("Чем занимается");
    expect(await store.readCard(OWNER)).toEqual([]);
  });

  it("хэндл сценария: readClientCard и forgetClientCard — для экрана карточки", async () => {
    const chat = cardChat({ flow: "sales-review", scripts: [note("name", "Ольга"), saying("Запомнил.")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Меня зовут Ольга");

    expect((await chat.flow.readClientCard(OWNER)).map((entry) => entry.fieldId)).toEqual(["name"]);
    expect(await chat.flow.readClientCard("ivan")).toEqual([]);
    await chat.flow.forgetClientCard(OWNER, "all");
    expect(await chat.flow.readClientCard(OWNER)).toEqual([]);
  });

  it("ход сотрудника (песочница): карточку только читает — flow_note в карточку и forget отказывают", async () => {
    const store = memoryFlowStore();
    await store.writeCardField({ ownerId: OWNER, fieldId: "name", value: "Ольга", chatId: "old", flowId: "sales-review", at: "2026-10-01T10:00:00Z" });
    const chat = cardChat({
      flow: "sales-review",
      store,
      chatOptions: { staffOfChat: () => ({ id: "admin" }) },
      scripts: [
        note("occupation", "Иллюстратор"),
        saying("Запомнил."),
        callTool("client_card", "c1", { action: "show" }),
        saying("Вы Ольга."),
        callTool("client_card", "c2", { action: "forget", field: "all" }),
        saying("Забыл."),
      ],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "Я иллюстратор");
    expect(toolOutput(chat.model.doStreamCalls[1]!, "n1")).toContain("Не записано");
    await say(chat.service, id, "Что ты обо мне знаешь?");
    expect(toolOutput(chat.model.doStreamCalls[3]!, "c1")).toContain("Ольга");
    await say(chat.service, id, "Забудь всё");
    expect(toolOutput(chat.model.doStreamCalls[5]!, "c2")).toContain("Не стёр");

    expect((await store.readCard(OWNER)).map((entry) => [entry.fieldId, entry.value])).toEqual([["name", "Ольга"]]);
  });

  it("чат без сценария: инструментов карточки нет", async () => {
    const store = memoryFlowStore();
    const model = scriptedModel([note("name", "Ольга"), saying("ок")]);
    const { judge } = fakeJudge();
    const flow = buildAgentFlow(
      { loadFlow: async () => null, store, judge: { fallback: { modelId: mockModelId, providerId: "mock" } } },
      { judge, timers: fakeTimers(), clientCard: createClientCard(store, () => new Date()) },
    );
    const { service } = noticeService(model, flow.withChat({ agent: { instructions: "Ты помощник." } }));
    flow.attach(service as ChatService);
    const { id } = await service.createChat(OWNER);
    await say(service, id, "Привет");

    expect(await store.readCard(OWNER)).toEqual([]);
  });
});
