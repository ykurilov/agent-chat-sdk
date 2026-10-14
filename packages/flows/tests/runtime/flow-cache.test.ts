import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, saying } from "../../../core/tests/unit/support/notice-chat";
import { flowChat, newChat, plain, say, systemOf, userTexts } from "./flow-chat";

// T040, решение В9: инструкция постоянная, карточка состояния — застывающим блоком; переход посреди ответа — карточка в
// результате `flow_exit`. Начало запроса между ходами не меняется ни с переходом, ни без.

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => vi.useRealTimers());

const toolsOf = (call: { tools?: unknown[] }) => JSON.stringify(call.tools ?? []);

describe("кэш модели в чате по сценарию (В9)", () => {
  it("инструкция и инструменты одинаковы во всех состояниях, начало запроса цело с переходом и без", async () => {
    const chat = flowChat({
      scripts: [
        saying("Здравствуйте! О чём ваш курс?"),
        // Ход 2: агент заявляет выход посреди ответа.
        callTool("flow_exit", "x1", { exit: 1, why: "тема и продажи понятны" }),
        saying("Давайте поищем затык."),
        saying("Откуда к вам приходят люди?"),
        saying("Понятно."),
      ],
    });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "привет");
    await chat.flow.settled();
    // Судья подтвердит заявку только во втором ходе: после первого хода он сам перехода не находит.
    chat.yes.add("intro_clear");
    await say(chat.service, id, "курс про Excel, продаж пока нет");
    await chat.flow.settled();
    await say(chat.service, id, "из инстаграма");
    await chat.flow.settled();
    await say(chat.service, id, "ага");
    await chat.flow.settled();

    const calls = chat.model.doStreamCalls;
    expect(calls).toHaveLength(5);
    expect((await chat.service.getChatState("anna", id)).values.flow).toMatchObject({ state: "block" });

    // Инструкция: правила сценария и «Общее для всех состояний», одна на все ходы.
    expect(systemOf(calls[0]!)).toContain("Ты помощник.");
    expect(systemOf(calls[0]!)).toContain("разбор бесплатный, 30 минут");
    expect(systemOf(calls[0]!)).toContain("flow_exit");
    for (const call of calls) expect(systemOf(call)).toBe(systemOf(calls[0]!));
    // Инструменты одни и те же в «Знакомстве» и в «Поиске затыка».
    expect(toolsOf(calls[0]!)).toContain("flow_exit");
    for (const call of calls) expect(toolsOf(call)).toBe(toolsOf(calls[0]!));

    // Начало каждого следующего запроса — прошлый запрос байт в байт: и после перехода, и без него.
    for (let index = 1; index < calls.length; index += 1) {
      const before = plain(calls[index - 1]!.prompt);
      expect(plain(calls[index]!.prompt).slice(0, before.length)).toEqual(before);
    }

    // Карточка «Знакомства» ушла в первом ходе; карточка «Поиска затыка» — в результате `flow_exit` и одним новым блоком
    // в следующем ходе, дальше не повторяется.
    expect(userTexts(calls[0]!)).toContain("Знакомство");
    expect(JSON.stringify(calls[2]!.prompt.at(-1))).toContain("Поиск затыка");
    const newPart = (index: number) => plain(calls[index]!.prompt).slice(plain(calls[index - 1]!.prompt).length).join("\n");
    expect(newPart(3)).toContain("Поиск затыка");
    expect(newPart(4)).not.toContain("Поиск затыка");
  });

  it("переход судьи после хода: в начале следующего хода — служебное сообщение и новая карточка в хвосте", async () => {
    const chat = flowChat({ yes: ["intro_clear"], scripts: [saying("О чём курс?"), saying("Где затык?")] });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "курс про Excel, продаж нет");
    await chat.flow.settled();
    await say(chat.service, id, "да");

    const [first, second] = chat.model.doStreamCalls;
    expect(systemOf(second!)).toBe(systemOf(first!));
    expect(toolsOf(second!)).toBe(toolsOf(first!));
    const before = plain(first!.prompt);
    expect(plain(second!.prompt).slice(0, before.length)).toEqual(before);
    const tail = plain(second!.prompt).slice(before.length).join("\n");
    expect(tail).toContain("Поиск затыка");
    expect(tail).toContain("Сработало");
  });
});
