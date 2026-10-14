import type { ReplyCheck } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { saying } from "../../../core/tests/unit/support/notice-chat";
import { finishPart, streamStart } from "../../../core/tests/unit/support/mock-model";
import type { FlowDeliveryOutcome, FlowOutgoing } from "../../src/runtime/flow-types";
import { agentTexts, clockAt, human, OWNER, tick, timerChat, type TimerChatSetup } from "./timer-chat";
import { iso, msk, promptText } from "./days-chat";
import { withoutSilenceTimers } from "../flow-fixtures";
import { memoryFlowStore } from "../../src/store/memory";
import type { FlowStore } from "../../src/store/flow-store";
import { FLOW_FIRST_EXIT } from "../../src/engine/timers";
import { FLOW_DELIVERY_EXIT } from "../../src/runtime/flow-delivery";

// T705 на модели-заглушке и подменённых часах: доставка ответа, написанного первым, в канал приложения и исходы (SC-104).

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(14, 10)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

/** Касания 15 мин и 1 ч; своих таймеров тишины у сценария нет. */
const nudging = (json: Record<string, any>) => {
  withoutSilenceTimers(json);
  json.schedule = { dayStart: "09:00", nightFrom: "21:00", nudges: { afterSilence: [{ amount: 15, unit: "min" }, { amount: 1, unit: "h" }] } };
};

/** Чат с доставкой приложения: исходы по очереди, дальше — `delivered`. */
function appChannel(outcomes: FlowDeliveryOutcome[] = [], setup: TimerChatSetup = {}) {
  const chat = timerChat({ edit: nudging, ...setup });
  const sent: FlowOutgoing[] = [];
  const deliver = vi.fn(async (message: FlowOutgoing) => {
    sent.push(message);
    return outcomes.shift() ?? { status: "delivered" as const };
  });
  chat.flow.attach({ portFor: () => chat.service, deliver });
  return { ...chat, sent, deliver };
}

async function startedAndNudged(chat: ReturnType<typeof appChannel>) {
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  clockAt(msk(14, 10, 15));
  await tick(chat, id);
  return id;
}

const undeliveredOf = async (chat: ReturnType<typeof timerChat>, id: string) =>
  (await chat.service.peekHistory(OWNER, id)).messages.filter((message) => message.metadata?.undelivered === true).map((message) => message.role);

describe("T705: доставка приложения", () => {
  it("delivered — готовый текст уходит в deliver, счётчик дня растёт", async () => {
    const chat = appChannel();
    const id = await startedAndNudged(chat);
    expect(chat.sent).toEqual([
      {
        ownerId: OWNER,
        chatId: id,
        messageId: expect.any(String),
        text: (await agentTexts(chat.service, id)).at(-1),
        parts: [expect.objectContaining({ type: "text", text: (await agentTexts(chat.service, id)).at(-1) })],
        reasons: [{ kind: "silence", step: 1 }],
        attempt: 1,
      },
    ]);
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-14")).toBe(1);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 15)), delivery: null });
  });

  it("deliver получает проверенный текст (проверки ответа проходит и ход по таймеру)", async () => {
    const fix: ReplyCheck = async ({ text }) => ({ text: text.replace("ответ", "проверено") });
    const chat = appChannel([], { chatOptions: { replyChecks: [fix] } });
    await startedAndNudged(chat);
    expect(chat.sent[0]!.text).toMatch(/^проверено/);
  });

  it("retry — тот же текст и messageId через 1 мин, 5 мин, 30 мин без нового хода; после трёх — не доставлено", async () => {
    const retry = { status: "retry" as const };
    const chat = appChannel([retry, retry, retry, retry]);
    const id = await startedAndNudged(chat);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 16)), delivery: { attempt: 2 } });
    for (const at of [msk(14, 10, 16), msk(14, 10, 21), msk(14, 10, 51)]) {
      clockAt(at);
      await tick(chat, id);
    }
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(chat.sent.map((message) => message.attempt)).toEqual([1, 2, 3, 4]);
    expect(new Set(chat.sent.map((message) => `${message.messageId}:${message.text}`)).size).toBe(1);
    expect(await chat.store.getChat(id)).toMatchObject({ delivery: null });
    expect(await undeliveredOf(chat, id)).toContain("assistant");
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-14")).toBe(0);

    // Недоставленное модель больше не видит.
    const lost = chat.sent[0]!.text;
    clockAt(msk(14, 11));
    await human(chat, id, "Алло");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain(lost);
  });

  it("retry с afterMs — повтор через столько", async () => {
    const chat = appChannel([{ status: "retry", afterMs: 10_000 }]);
    const id = await startedAndNudged(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 15) + 10_000) });
  });

  it("failed — не доставлено сразу: пометка, счётчик не растёт", async () => {
    const chat = appChannel([{ status: "failed" }]);
    const id = await startedAndNudged(chat);
    expect(await undeliveredOf(chat, id)).toContain("assistant");
    expect(await chat.store.countFirstMessages(OWNER, "2026-10-14")).toBe(0);
  });

  it("window_closed — молчать первым, пока человек не напишет; потом касания снова идут", async () => {
    const chat = appChannel([{ status: "window_closed" }]);
    const id = await startedAndNudged(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ windowClosed: true });
    clockAt(msk(14, 11, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(chat.sent).toHaveLength(1);

    clockAt(msk(14, 12));
    await human(chat, id, "Я тут");
    clockAt(msk(14, 12, 15));
    await tick(chat, id);
    expect(chat.sent).toHaveLength(2);
  });

  it("window_closed — сообщение человека без хода (пауза сотрудника) тоже открывает окно", async () => {
    const chat = appChannel([{ status: "window_closed" }]);
    const id = await startedAndNudged(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ windowClosed: true });
    await chat.flow.pause({ ownerId: OWNER, chatId: id });
    clockAt(msk(14, 12));
    await human(chat, id, "Я тут");
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(await chat.store.getChat(id)).toMatchObject({ windowClosed: false });
  });

  it("пересчёт сроков после хода не затирает срок повтора доставки, записанный во время счёта", async () => {
    const inner = memoryFlowStore();
    let armed = false;
    let retryAt = "";
    // Повтор доставки пишется между проверкой «повтора нет» и записью нового срока.
    const store: FlowStore = {
      ...inner,
      async setDue(chatId, due, options) {
        if (armed && due?.exitId === FLOW_FIRST_EXIT) {
          armed = false;
          retryAt = iso(Date.now() + 60_000);
          await inner.setDelivery(chatId, { messageId: "m-race", attempt: 2, retryAt, reasons: [] });
          await inner.setDue(chatId, { at: retryAt, exitId: FLOW_DELIVERY_EXIT, branchHead: null });
        }
        return inner.setDue(chatId, due, options);
      },
    };
    const chat = appChannel([], { store });
    const { id } = await chat.service.createChat(OWNER);
    armed = true;
    await human(chat, id, "Курс по акварели");
    expect(retryAt).not.toBe("");
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: retryAt, dueExitId: FLOW_DELIVERY_EXIT });
  });

  it("срок касания при ждущем повторе доставки: нового хода нет, срок — повтор", async () => {
    const chat = appChannel();
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс по акварели");
    const retryAt = iso(msk(14, 10, 20));
    await chat.store.setDelivery(id, { messageId: "m-wait", attempt: 2, retryAt, reasons: [] });
    clockAt(msk(14, 10, 15));
    await tick(chat, id);
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(chat.sent).toEqual([]);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: retryAt, dueExitId: FLOW_DELIVERY_EXIT });
  });

  it("failed — касание не засчитано: тот же шаг через свой срок, а не следующий (FR-309)", async () => {
    const chat = appChannel([{ status: "failed" }]);
    const id = await startedAndNudged(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 30)), dueExitId: FLOW_FIRST_EXIT });
    clockAt(msk(14, 10, 30));
    await tick(chat, id);
    expect(chat.sent.map((message) => message.reasons)).toEqual([[{ kind: "silence", step: 1 }], [{ kind: "silence", step: 1 }]]);
    // Второе дошло — оно и засчитано: следующий шаг через 1 ч от него.
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 30)) });
  });

  it("повторы кончились — не доставлено: касание не засчитано, тот же шаг от отказа, нового хода в том же тике нет", async () => {
    const retry = { status: "retry" as const };
    const chat = appChannel([retry, retry, retry, retry]);
    const id = await startedAndNudged(chat);
    for (const at of [msk(14, 10, 16), msk(14, 10, 21), msk(14, 10, 51)]) {
      clockAt(at);
      await tick(chat, id);
    }
    expect(chat.model.doStreamCalls).toHaveLength(2);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 6)), dueExitId: FLOW_FIRST_EXIT, delivery: null });
    clockAt(msk(14, 11, 6));
    await tick(chat, id);
    expect(chat.sent.at(-1)).toMatchObject({ attempt: 1, reasons: [{ kind: "silence", step: 1 }] });
  });

  it("повтор дошёл — касание засчитано: следующий шаг от него", async () => {
    const chat = appChannel([{ status: "retry" }]);
    const id = await startedAndNudged(chat);
    clockAt(msk(14, 10, 16));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 15)), delivery: null });
  });

  it("blocked — конец разговора «blocked», событие, таймеров нет", async () => {
    const chat = appChannel([{ status: "blocked" }]);
    const id = await startedAndNudged(chat);
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "blocked", dueAt: null });
    expect(chat.finished).toEqual([expect.objectContaining({ chatId: id, reason: "blocked" })]);
    expect(await undeliveredOf(chat, id)).toContain("assistant");
  });

  it("deliver бросил — как retry", async () => {
    const chat = timerChat({ edit: nudging });
    chat.flow.attach({ portFor: () => chat.service, deliver: async () => Promise.reject(new Error("сеть")) });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс");
    clockAt(msk(14, 10, 15));
    await tick(chat, id);
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 16)), delivery: { attempt: 2 } });
  });
});

describe("T705: reportDelivery — исходы из каналов SDK", () => {
  async function nudgedBySdk() {
    const chat = timerChat({ edit: nudging });
    const { id } = await chat.service.createChat(OWNER);
    await human(chat, id, "Курс");
    clockAt(msk(14, 10, 15));
    await tick(chat, id);
    const { messages } = await chat.service.peekHistory(OWNER, id);
    return { chat, id, messageId: messages.at(-1)!.id };
  }

  it("blocked — конец разговора один раз, сколько бы исходов ни пришло", async () => {
    const { chat, id, messageId } = await nudgedBySdk();
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "blocked" } });
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "blocked" } });
    await chat.flow.settled();
    expect(await chat.store.getChat(id)).toMatchObject({ endReason: "blocked", dueAt: null });
    expect(chat.finished).toHaveLength(1);
    expect(await undeliveredOf(chat, id)).toContain("assistant");
  });

  it("window_closed — окно закрыто; failed — пометка; retry и delivered — ничего", async () => {
    const { chat, id, messageId } = await nudgedBySdk();
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "retry" } });
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "delivered" } });
    expect(await undeliveredOf(chat, id)).toEqual([]);
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "window_closed" } });
    expect(await chat.store.getChat(id)).toMatchObject({ windowClosed: true });
    expect(await undeliveredOf(chat, id)).toContain("assistant");
  });

  it("failed из канала SDK — касание не засчитано: тот же шаг от отказа; повтор исхода ничего не меняет (FR-309)", async () => {
    const { chat, id, messageId } = await nudgedBySdk();
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 11, 15)) });
    clockAt(msk(14, 10, 20));
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "failed" } });
    await chat.flow.settled();
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 35)), dueExitId: FLOW_FIRST_EXIT });
    await chat.flow.reportDelivery({ chatId: id, messageId, outcome: { status: "failed" } });
    await chat.flow.settled();
    expect(await chat.store.getChat(id)).toMatchObject({ dueAt: iso(msk(14, 10, 35)) });
    expect(await undeliveredOf(chat, id)).toEqual(["assistant"]);
  });

  it("исход чужого или неизвестного чата — ничего", async () => {
    const { chat } = await nudgedBySdk();
    await expect(chat.flow.reportDelivery({ chatId: "нет", messageId: "m", outcome: { status: "blocked" } })).resolves.toBeUndefined();
  });
});

describe("0.53: доставка приложения отдаёт все части ответа, а не только текст", () => {
  const showVideo = tool({ description: "Показать ролик", inputSchema: z.object({ id: z.string() }), execute: async ({ id }) => ({ видео: { id } }) });
  const videoCall = [streamStart, { type: "tool-call" as const, toolCallId: "v1", toolName: "show_video", input: JSON.stringify({ id: "v-7" }) }, finishPart("tool-calls")];
  const videoPart = expect.objectContaining({ type: "tool-show_video", toolCallId: "v1", state: "output-available", output: { видео: { id: "v-7" } } });

  it("касание с карточкой ролика: в deliver — части ответа (ролик и текст), text прежний; повтор — те же части", async () => {
    const chat = appChannel([{ status: "retry" }], { agent: { tools: { show_video: showVideo } }, scripts: [saying("Здравствуйте!"), videoCall, saying("Вот ролик.")] });
    const id = await startedAndNudged(chat);
    expect(chat.sent[0]).toMatchObject({ text: "Вот ролик.", parts: [videoPart, expect.objectContaining({ type: "text", text: "Вот ролик." })] });
    expect(chat.sent[0]!.parts.map((part) => part.type)).not.toContain("step-start");
    clockAt(msk(14, 10, 16));
    await tick(chat, id);
    expect(chat.sent[1]).toMatchObject({ attempt: 2, parts: chat.sent[0]!.parts });
  });

  it("касание только карточкой ролика, без текста, тоже уходит в deliver", async () => {
    const chat = appChannel([], { agent: { tools: { show_video: showVideo } }, scripts: [saying("Здравствуйте!"), videoCall, [streamStart, finishPart()]] });
    await startedAndNudged(chat);
    expect(chat.sent).toEqual([expect.objectContaining({ text: "", parts: [videoPart] })]);
  });
});
