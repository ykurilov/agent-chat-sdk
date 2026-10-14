import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying } from "../../../core/tests/unit/support/notice-chat";
import { FLOW_CLOSE_DAY_TOOL } from "../../src/runtime/close-day-tool";
import { agentTexts, clockAt, human, MSK, OWNER } from "./timer-chat";
import { daysChat, msk, promptText, systemOf, threeDays } from "./days-chat";
import { toolOutput } from "./flow-chat";

// T801–T804 на модели-заглушке и подменённых часах: мягкая рамка с 3-го сообщения, жёсткая на 5-м, «закрыть день».

beforeEach(() => {
  process.env.TZ = "UTC";
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(msk(13, 15)) });
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.TZ;
});

const FRAME = { softFrom: 3, hardAt: 5, hardText: "Утром отвечу!" };
const SOFT = "сворачиваться до завтра";

type Script = NonNullable<Parameters<typeof daysChat>[0]>["scripts"];

function framed(scripts?: Script, frame: Record<string, unknown> = FRAME) {
  return daysChat({ edit: (json) => threeDays(json, { dayFrame: frame }), ...(scripts && { scripts }) });
}

async function started(chat = framed()) {
  const { id } = await chat.service.createChat(OWNER);
  await human(chat, id, "Курс по акварели");
  return { chat, id };
}

const userTexts = async (chat: ReturnType<typeof framed>, id: string) =>
  (await chat.service.peekHistory(OWNER, id)).messages.filter((message) => message.role === "user").length;

describe("T802: рамки дня в чате SDK", () => {
  it("с 3-го сообщения — строка «сворачиваться» в хвосте, на 5-м — готовая фраза без модели, дальше молчание до утра", async () => {
    const { chat, id } = await started();
    await human(chat, id, "второе");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain(SOFT);

    await human(chat, id, "третье");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain(SOFT);
    // Постоянная инструкция от рамки не зависит: кэш цел.
    expect(systemOf(chat.model.doStreamCalls.at(-1)!)).toBe(systemOf(chat.model.doStreamCalls[0]!));
    await human(chat, id, "четвёртое");
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).toContain(SOFT);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id, text: "пятое" })).toEqual({ kind: "reply", text: "Утром отвечу!" });

    const calls = chat.model.doStreamCalls.length;
    await human(chat, id, "пятое");
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect((await agentTexts(chat.service, id)).at(-1)).toBe("Утром отвечу!");

    // Готовая фраза — один раз за день: дальше сообщения записываются, агент молчит до начала дня.
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "hold", until: new Date(msk(14, 9)) });
    await human(chat, id, "шестое");
    await human(chat, id, "седьмое");
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect(await agentTexts(chat.service, id)).toHaveLength(5);
    expect(await userTexts(chat, id)).toBe(7);
    // Ночью — всё ещё вчерашний день сценария.
    clockAt(msk(14, 8, 59));
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "hold", until: new Date(msk(14, 9)) });

    // Утром счёт заново: агент отвечает ходом, без «сворачиваться».
    clockAt(msk(14, 10));
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
    await human(chat, id, "доброе утро");
    expect(chat.model.doStreamCalls.length).toBeGreaterThan(calls);
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain(SOFT);
  });

  it("без готовой фразы автора — фраза по умолчанию; только мягкая рамка — модель отвечает всегда", async () => {
    const hard = framed(undefined, { hardAt: 2 });
    const first = await started(hard);
    const answer = await hard.flow.admit({ ownerId: OWNER, chatId: first.id });
    expect(answer).toMatchObject({ kind: "reply" });
    expect((answer as { text: string }).text.length).toBeGreaterThan(0);

    const soft = framed(undefined, { softFrom: 2 });
    const second = await started(soft);
    for (const text of ["2", "3", "4", "5", "6"]) await human(soft, second.id, text);
    expect(soft.model.doStreamCalls).toHaveLength(6);
    expect(promptText(soft.model.doStreamCalls.at(-1)!)).toContain(SOFT);
  });

  it("в последний день мягкая рамка не обещает «завтра», а просит подвести итог", async () => {
    const { chat, id } = await started();
    clockAt(msk(15, 12));
    for (const text of ["1", "2", "3"]) await human(chat, id, text, MSK);
    const tail = promptText(chat.model.doStreamCalls.at(-1)!);
    expect(tail).toContain("на завтра не откладывай");
    expect(tail).not.toContain(SOFT);
  });

  it("сценарий без рамок — решение «ответить» и хвост без строки рамки", async () => {
    const chat = daysChat();
    const { id } = await started(chat as ReturnType<typeof framed>);
    for (const text of ["2", "3", "4", "5", "6", "7"]) await human(chat, id, text);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
    expect(promptText(chat.model.doStreamCalls.at(-1)!)).not.toContain(SOFT);
  });

  it("чужой чат или чат без сценария — «ответить»", async () => {
    const { chat, id } = await started();
    expect(await chat.flow.admit({ ownerId: "bob", chatId: id })).toEqual({ kind: "answer" });
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: "nope" })).toEqual({ kind: "answer" });
  });
});

describe("T804: flow_close_day", () => {
  it("человек сказал «до завтра» — день закрыт до утра; правило в постоянной инструкции", async () => {
    const chat = framed([saying("Здравствуйте!"), callTool(FLOW_CLOSE_DAY_TOOL, "c1"), saying("До завтра!")]);
    const { id } = await started(chat);
    expect(systemOf(chat.model.doStreamCalls[0]!)).toContain(FLOW_CLOSE_DAY_TOOL);

    clockAt(msk(13, 18));
    await human(chat, id, "Всё, на сегодня хватит, до завтра");
    expect(toolOutput(chat.model.doStreamCalls.at(-1)!, "c1")).toContain("закрыт");
    expect(await chat.store.getChat(id)).toMatchObject({ dayClosedOn: "2026-10-13" });
    // Человек сам пишет снова — агент отвечает: закрыт только «писать первым».
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id })).toEqual({ kind: "answer" });
  });

  it("в последний день день не закрывается: подсказка «попрощайся и заверши с итогом»", async () => {
    const chat = framed([saying("Здравствуйте!"), callTool(FLOW_CLOSE_DAY_TOOL, "c1"), saying("Спасибо!")]);
    const { id } = await started(chat);
    clockAt(msk(15, 18));
    await human(chat, id, "Спасибо, до завтра");
    const output = toolOutput(chat.model.doStreamCalls.at(-1)!, "c1");
    expect(output).toContain("последний день");
    expect(output).toContain("итог");
    expect(await chat.store.getChat(id)).toMatchObject({ dayClosedOn: null });
  });
});

describe("0.50: готовая фраза один раз за день, ночью агент отвечает", () => {
  it("hardAt 3: сообщения 3, 4, 5 — готовая фраза, молчание, молчание; фраза в чате одна", async () => {
    const chat = framed(undefined, { hardAt: 3, hardText: "Утром отвечу!" });
    const { id } = await started(chat);
    await human(chat, id, "второе");
    const calls = chat.model.doStreamCalls.length;
    const decisions = [];
    for (const text of ["третье", "четвёртое", "пятое"]) {
      decisions.push(await chat.flow.admit({ ownerId: OWNER, chatId: id, text }));
      await human(chat, id, text);
    }
    expect(decisions).toEqual([
      { kind: "reply", text: "Утром отвечу!" },
      { kind: "hold", until: new Date(msk(14, 9)) },
      { kind: "hold", until: new Date(msk(14, 9)) },
    ]);
    expect(chat.model.doStreamCalls).toHaveLength(calls);
    expect((await agentTexts(chat.service, id)).filter((text) => text === "Утром отвечу!")).toHaveLength(1);
  });

  it("сообщение человека в 23:00 — ответ ходом модели: тихие часы только для сообщений первым", async () => {
    clockAt(msk(13, 23));
    const chat = framed();
    const { id } = await chat.service.createChat(OWNER);
    expect(await chat.flow.admit({ ownerId: OWNER, chatId: id, text: "Не сплю" })).toEqual({ kind: "answer" });
    await human(chat, id, "Не сплю");
    expect(chat.model.doStreamCalls).toHaveLength(1);
    expect(await agentTexts(chat.service, id)).toHaveLength(1);
  });
});
