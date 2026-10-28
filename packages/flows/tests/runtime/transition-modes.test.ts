import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { readAll } from "../../../core/tests/unit/support/mock-model";
import { callTool, saying } from "../../../core/tests/unit/support/notice-chat";
import { flowChat, newChat, runOf, say, toolOutput, stateOf, systemOf, plain, OWNER } from "./flow-chat";
const claim = (confirm = false, id = "claim") => callTool("flow_exit", id, { exit: 1, why: "Цель этапа достигнута", ...(confirm && { confirm: true }) });

describe("режим перехода запуска", () => {
  it("free: переход без обоих обычных вызовов судьи", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "free" }, scripts: [claim(), saying("Продолжим")] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Тема курса — Excel"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("block");
    expect(chat.judge.checkClaim).not.toHaveBeenCalled(); expect(chat.judge.checkAll).not.toHaveBeenCalled();
    expect((await runOf(chat.service, id))?.path.at(-1)).not.toHaveProperty("probability");
    expect(await chat.store.getChat(id)).toMatchObject({ transitionMode: "free" });
  });
  it("advisor: явный повтор после отрицательного совета проходит в том же ходе", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, scripts: [claim(), claim(true, "confirm"), saying("Продолжим")] });
    chat.judge.checkClaim.mockResolvedValue({ exitId: "intro_clear", confirmed: false, probability: 0.2, source: "decision", reason: "О продажах ещё не сказано" });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Тема курса — Excel"); await chat.flow.settled();
    expect(toolOutput(chat.model.doStreamCalls[1]!, "claim")).toContain("О продажах ещё не сказано");
    expect((await runOf(chat.service, id))?.state).toBe("block");
    expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
  });
  it("advisor: confirm без полученного в этом ходе совета не обходит судью", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, scripts: [claim(true)] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Тема курса — Excel"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
  });
  it("advisor: положительный afterTurn только советует, переход сам не исполняется", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, yes: ["intro_clear"], scripts: [saying("Что ещё важно?"), saying("Продолжим здесь")] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Тема курса — Excel"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro");
    expect((await chat.store.getChat(id))?.pending).toEqual([expect.objectContaining({ kind: "advice", from: "intro" })]);
    await say(chat.service, id, "Больше пока ничего"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro");
    expect(JSON.stringify(chat.model.doStreamCalls[1]!.prompt)).toContain("flow:advice");
  });
});

describe("границы advisor и журнал решений", () => {
  it("по умолчанию rails: даже confirm не обходит отрицательное решение", async () => {
    const chat = flowChat({ scripts: [claim(), claim(true, "confirm"), saying("Останемся здесь")] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
  });
  it("совет другого хода не даёт подтверждения в новом ходе", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, scripts: [claim(), saying("Уточним"), claim(true, "next"), saying("Уточним ещё")] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    await say(chat.service, id, "Продолжим"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).toHaveBeenCalledTimes(2);
  });
  it("без повторного confirm отрицательный совет не проверяется по кругу", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, scripts: [claim(), claim(false, "again"), saying("Уточним")] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
    expect(toolOutput(chat.model.doStreamCalls[1]!, "claim")).toContain("Текстового довода нет");
  });
  it.each(["free", "advisor"] as const)("%s: номер вне обычных выходов не проходит", async transitionMode => {
    const chat = flowChat({ flowOptions: { transitionMode }, scripts: [callTool("flow_exit", "invalid", { exit: 999, why: "Пойдём дальше", confirm: true })] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).not.toHaveBeenCalled();
  });
  it("запуск loadFlow переопределяет умолчание, режим закрепляется", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "free" }, scripts: [claim()] });
    chat.loadFlow.mockImplementation(async () => ({ flowId: "sales-review", versionId: "v1", flow: chat.json!, transitionMode: "rails" }));
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect(await chat.store.getChat(id)).toMatchObject({ transitionMode: "rails" });
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
  });
  it("совет и решение спорить записаны раздельно; события попадают в поток", async () => {
    const events: import("../../src/runtime/flow-types").FlowTransitionDecision[] = [];
    const chat = flowChat({ flowOptions: { transitionMode: "advisor", onTransitionDecision: event => { events.push(event); } }, scripts: [claim(), claim(true, "confirm"), saying("Продолжим")] });
    const { id } = await newChat(chat.service); const chunks = await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect(events.map(event => [event.phase, event.decision])).toEqual([["judge", "advice"], ["decision", "against_advice"]]);
    expect(events[1]).toMatchObject({ chatId: id, mode: "advisor", state: "intro", exitId: "intro_clear", judge: { confirmed: false, probability: 0.2 } });
    expect(JSON.stringify(chunks)).toContain("flow.transition-decision");
    expect(new Set(events.map(event => event.id)).size).toBe(2);
    expect(events[1]!.actor).toBe("model"); expect(events[1]!.adviceId).toBe(events[0]!.id);
  });
  it("решение остаться появляется после полного ответа", async () => {
    const events: import("../../src/runtime/flow-types").FlowTransitionDecision[] = [];
    const chat = flowChat({ flowOptions: { transitionMode: "advisor", onTransitionDecision: event => { events.push(event); } }, scripts: [claim(), saying("Уточним продажи")] });
    const { id } = await newChat(chat.service); const chunks = await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect(events.filter(event => event.phase === "decision")).toMatchObject([{ decision: "stayed", judge: { confirmed: false } }]);
    expect(JSON.stringify(chunks)).toContain('stayed');
  });
  it.each(["free", "advisor", "rails"] as const)("%s: условия данных нельзя обойти flow_exit", async transitionMode => {
    const chat = flowChat({ flowOptions: { transitionMode }, edit: json => { stateOf(json, "intro").exits = [{ id: "data_only", when: { type: "data", field: "sales", op: "eq", value: "больше 10 продаж" }, to: "block" }]; }, scripts: [claim(true)] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("intro"); expect(chat.judge.checkClaim).not.toHaveBeenCalled();
  });
  it("ошибка аудитора не мешает переходу", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "free", onTransitionDecision: () => { throw new Error("journal unavailable"); } }, scripts: [claim()] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("block"); expect(chat.logError).toHaveBeenCalledWith(expect.stringContaining("onTransitionDecision"));
  });
});


describe("кэш и автоматические условия", () => {
  it("совет меняет только последний хвост, начало запроса и tools сохраняются", async () => {
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, yes: ["intro_clear"], scripts: [saying("Уточним"), saying("Останемся здесь")] });
    const { id } = await newChat(chat.service); await say(chat.service, id, "Начнём"); await chat.flow.settled();
    await say(chat.service, id, "Продолжим"); await chat.flow.settled();
    const [first, second] = chat.model.doStreamCalls;
    expect(systemOf(first!)).toBe(systemOf(second!));
    expect(first!.tools).toEqual(second!.tools);
    const fixedFirst = plain(first!.prompt.filter(message => !JSON.stringify(message).includes("[flow:policy]")));
    const fixedSecond = plain(second!.prompt.filter(message => !JSON.stringify(message).includes("[flow:policy]")));
    expect(fixedSecond.slice(0, fixedFirst.length)).toEqual(fixedFirst);
    expect(JSON.stringify(second!.prompt.at(-1))).toContain("flow:advice");
    expect(systemOf(second!)).not.toContain("flow:advice");
  });
  it("поздний совет от предыдущего ответа не переносится на более новую ветку", async () => {
    let release!: (value: import("../../src/runtime/flow-types").JudgeVerdict[]) => void;
    const wait = new Promise<import("../../src/runtime/flow-types").JudgeVerdict[]>(resolve => { release = resolve; });
    const chat = flowChat({ flowOptions: { transitionMode: "advisor" }, scripts: [saying("Первый"), saying("Второй"), saying("Третий")] });
    chat.judge.checkAll.mockImplementationOnce(() => wait);
    const { id } = await newChat(chat.service); await say(chat.service, id, "Первый вопрос");
    await say(chat.service, id, "Новый вопрос");
    release([{ exitId: "intro_clear", confirmed: true, probability: 0.9, source: "decision" }]); await chat.flow.settled();
    await say(chat.service, id, "Ещё вопрос"); await chat.flow.settled();
    expect(JSON.stringify(chat.model.doStreamCalls[2]!.prompt)).not.toContain("flow:advice");
    expect((await runOf(chat.service, id))?.state).toBe("intro");
  });
  it.each(["free", "advisor", "rails"] as const)("%s: подходящие данные и события по-прежнему исполняет код", async transitionMode => {
    const chat = flowChat({ flowOptions: { transitionMode }, edit: json => { stateOf(json, "intro").exits = [{ id: "data_only", when: { type: "data", field: "sales", op: "eq", value: "больше 10 продаж" }, to: "block" }]; json.tools.push("check_data"); stateOf(json, "intro").tools = ["check_data"]; stateOf(json, "block").exits.push({ id: "paid", when: { type: "event", event: "app", name: "paid" }, to: "booked" }); }, tools: { check_data: tool({ description: "Проверить данные", inputSchema: z.object({}), execute: async () => "Готово" }) }, scripts: [callTool("check_data", "check", {}), saying("Продолжим")] });
    const { id } = await newChat(chat.service);
    await chat.store.writeCardField({ ownerId: OWNER, fieldId: "sales", value: "больше 10 продаж", chatId: id, flowId: "sales-review", at: new Date().toISOString() });
    await say(chat.service, id, "Начнём"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("block");
    await chat.flow.signal({ ownerId: OWNER, chatId: id, name: "paid" });
    await say(chat.service, id, "Оплачено"); await chat.flow.settled();
    expect((await runOf(chat.service, id))?.state).toBe("booked");
  });
});


it("перезапуск службы не меняет закреплённый режим запуска", async () => {
  const original = flowChat({ flowOptions: { transitionMode: "free" }, scripts: [saying("Начнём")] });
  const { id } = await newChat(original.service); await say(original.service, id, "Привет"); await original.flow.settled();
  const restarted = flowChat({ store: original.store, chatOptions: { storage: original.storage }, flowOptions: { transitionMode: "rails" }, scripts: [claim()] });
  await say(restarted.service, id, "Перейдём дальше"); await restarted.flow.settled();
  expect(await restarted.store.getChat(id)).toMatchObject({ transitionMode: "free" });
  expect((await runOf(restarted.service, id))?.state).toBe("block");
  expect(restarted.judge.checkClaim).not.toHaveBeenCalled();
});


it("advisor: разрешение инструмента продолжает тот же ход и сохраняет право подтвердить совет", async () => {
  const chat = flowChat({ flowOptions: { transitionMode: "advisor" },
    edit: json => { json.tools.push("ask_permission"); stateOf(json, "intro").tools = ["ask_permission"]; },
    tools: { ask_permission: tool({ description: "Запросить разрешение", inputSchema: z.object({}), needsApproval: true, execute: async () => "Разрешено" }) },
    scripts: [claim(), callTool("ask_permission", "permission", {}), claim(true, "confirmed-after-approval"), saying("Продолжим")] });
  const { id } = await newChat(chat.service);
  const chunks = await say(chat.service, id, "Начнём");
  const request = chunks.find(chunk => chunk.type === "tool-approval-request") as { approvalId: string } | undefined;
  expect(request).toBeDefined();
  expect((await runOf(chat.service, id))?.state).toBe("intro");
  await chat.service.answerApproval(OWNER, id, request!.approvalId, "allow");
  await readAll((await chat.service.subscribe(OWNER, id))!); await chat.flow.settled();
  expect((await runOf(chat.service, id))?.state).toBe("block");
  expect(chat.judge.checkClaim).toHaveBeenCalledTimes(1);
});


it("ожидающий аудит отказа не перетирает параллельный успешный переход", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const parallel = [claim()[0]!, claim()[1]!, claim(false, "second")[1]!, claim().at(-1)!];
  const chat = flowChat({ flowOptions: { onTransitionDecision: async event => {
    if (event.decision === "rejected") await gate;
    if (event.decision === "with_advice") release();
  } }, scripts: [parallel, saying("Продолжим")] });
  chat.judge.checkClaim.mockResolvedValueOnce({ exitId: "intro_clear", confirmed: false, probability: 0.2, source: "decision" });
  chat.judge.checkClaim.mockResolvedValueOnce({ exitId: "intro_clear", confirmed: true, probability: 0.9, source: "decision" });
  const { id } = await newChat(chat.service);
  try { await say(chat.service, id, "Начнём"); await chat.flow.settled(); }
  finally { release(); }
  expect(chat.judge.checkClaim).toHaveBeenCalledTimes(2);
  expect((await runOf(chat.service, id))?.state).toBe("block");
});
