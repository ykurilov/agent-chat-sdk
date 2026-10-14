import { describe, expect, it } from "vitest";
import { openSideTasks, startRun, type AgentFlow, type FlowRun } from "../src/format";
import { fixtureFlow } from "./flow-fixtures";

// T904: какие попутные задачи агент может предложить сейчас. Темп — общий с вопросами между делом.

const T0 = Date.UTC(2026, 9, 14, 6, 0);
const CHAT = "c1";

const flowWith = (tasks: Record<string, unknown>[], edit?: (json: Record<string, any>) => void): AgentFlow =>
  fixtureFlow("sales-review", (json) => {
    json.sideTasks = tasks;
    edit?.(json);
  });

const runAt = (flow: AgentFlow, patch: Partial<FlowRun> = {}): FlowRun => ({ ...startRun(flow, T0), ...patch });
const ids = (tasks: readonly { id: string }[]) => tasks.map((task) => task.id);

const subscribe = { id: "subscribe", text: "Предложи подписаться на канал", when: "когда человек получил результат" };

describe("попутные задачи: что открыто", () => {
  it("задач нет — пусто, как в 0.48", () => {
    const flow = fixtureFlow("sales-review");
    expect(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts: [], card: {} })).toEqual([]);
  });

  it("новая задача открыта; порядок — как в сценарии", () => {
    const flow = flowWith([subscribe, { id: "review", text: "Попроси отзыв" }]);
    expect(ids(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts: [], card: {} }))).toEqual(["subscribe", "review"]);
  });

  it("не больше двух попыток по умолчанию; у задачи можно больше", () => {
    const flow = flowWith([subscribe, { id: "review", text: "Попроси отзыв", maxAttempts: 3 }]);
    const attempts = [
      { taskId: "subscribe", chatId: null, asks: 2, doneAt: null },
      { taskId: "review", chatId: null, asks: 2, doneAt: null },
    ];
    expect(ids(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts, card: {} }))).toEqual(["review"]);
    attempts[1]!.asks = 3;
    expect(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts, card: {} })).toEqual([]);
  });

  it("одна попытка из двух — задача ещё открыта", () => {
    const flow = flowWith([subscribe]);
    const attempts = [{ taskId: "subscribe", chatId: null, asks: 1, doneAt: null }];
    expect(ids(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts, card: {} }))).toEqual(["subscribe"]);
  });

  it("решённая не всплывает, сколько бы попыток ни осталось", () => {
    const flow = flowWith([subscribe]);
    const attempts = [{ taskId: "subscribe", chatId: null, asks: 1, doneAt: "2026-10-14T07:00:00.000Z" }];
    expect(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts, card: {} })).toEqual([]);
  });

  it("задача с полем решена, когда поле известно; значение не по типу — не знаем", () => {
    const flow = flowWith([{ id: "ask_audience", text: "Узнай аудиторию", field: "audience" }]);
    const open = (card: Record<string, unknown>, patch?: Partial<FlowRun>) =>
      ids(openSideTasks({ flow, run: runAt(flow, patch), chatId: CHAT, attempts: [], card }));
    expect(open({})).toEqual(["ask_audience"]);
    expect(open({ audience: "   " })).toEqual(["ask_audience"]);
    expect(open({ audience: "Новички" })).toEqual([]);
  });

  it("поле-заметка чата берётся из чата, а не из карточки", () => {
    const flow = flowWith([{ id: "ask_block", text: "Узнай главную преграду", field: "main_block" }]);
    expect(ids(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts: [], card: { main_block: "из карточки" } }))).toEqual(["ask_block"]);
    expect(openSideTasks({ flow, run: runAt(flow, { notes: { main_block: "Не доверяют" } }), chatId: CHAT, attempts: [], card: {} })).toEqual([]);
  });

  it("поле «да/нет»: «нет» — тоже известный ответ", () => {
    const flow = flowWith([{ id: "ask_sub", text: "Узнай, подписан ли", field: "subscribed" }], (json) =>
      json.clientCard.push({ id: "subscribed", name: "Подписан", type: "boolean", about: "Подписан ли на канал." }),
    );
    expect(ids(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts: [], card: {} }))).toEqual(["ask_sub"]);
    expect(openSideTasks({ flow, run: runAt(flow), chatId: CHAT, attempts: [], card: { subscribed: false } })).toEqual([]);
  });
});

describe("попутные задачи: попытки на человека или на разговор (В3)", () => {
  const flow = flowWith([subscribe, { id: "review", text: "Попроси отзыв", perConversation: true }]);
  const open = (attempts: Parameters<typeof openSideTasks>[0]["attempts"], chatId = CHAT) =>
    ids(openSideTasks({ flow, run: runAt(flow), chatId, attempts, card: {} }));

  it("по умолчанию попытки считаются на человека: во втором разговоре они уже потрачены", () => {
    const spent = [{ taskId: "subscribe", chatId: null, asks: 2, doneAt: null }];
    expect(open(spent, "c1")).toEqual(["review"]);
    expect(open(spent, "c2")).toEqual(["review"]);
  });

  it("«заново в каждом разговоре»: считаются попытки этого разговора, чужие и общие — нет", () => {
    expect(open([{ taskId: "review", chatId: "c1", asks: 2, doneAt: null }], "c1")).toEqual(["subscribe"]);
    expect(open([{ taskId: "review", chatId: "c1", asks: 2, doneAt: null }], "c2")).toEqual(["subscribe", "review"]);
    expect(open([{ taskId: "review", chatId: null, asks: 2, doneAt: null }], "c1")).toEqual(["subscribe", "review"]);
  });

  it("задача на человека не смотрит на попытки в чужих разговорах", () => {
    expect(open([{ taskId: "subscribe", chatId: "c9", asks: 2, doneAt: null }])).toEqual(["subscribe", "review"]);
  });

  it("решённая на человека задача не открывается и в новом разговоре", () => {
    const done = [{ taskId: "subscribe", chatId: null, asks: 1, doneAt: "2026-10-14T07:00:00.000Z" }];
    expect(open(done, "c2")).toEqual(["review"]);
  });
});

describe("попутные задачи: общий темп с вопросами между делом", () => {
  const flow = flowWith([subscribe]);
  const open = (patch: Partial<FlowRun>) => ids(openSideTasks({ flow, run: runAt(flow, patch), chatId: CHAT, attempts: [], card: {} }));
  const every = flow.pace.sideQuestionEveryMessages;

  it("с прошлого вопроса или задачи прошло меньше положенного — рано", () => {
    expect(open({ humanMessages: 4, sideQuestionAt: 4 })).toEqual([]);
    expect(open({ humanMessages: 4 + every - 1, sideQuestionAt: 4 })).toEqual([]);
  });

  it("прошло достаточно или вопросов ещё не было — можно", () => {
    expect(open({ humanMessages: 4 + every, sideQuestionAt: 4 })).toEqual(["subscribe"]);
    expect(open({ humanMessages: 1, sideQuestionAt: null })).toEqual(["subscribe"]);
  });

  it("в состоянии «без вопросов» и в конце сценария — не предлагаем", () => {
    const offered = (stateId: string) =>
      ids(openSideTasks({ flow, run: { ...runAt(flow), state: stateId }, chatId: CHAT, attempts: [], card: {} }));
    expect(offered("intro")).toEqual(["subscribe"]);
    expect(offered("remind")).toEqual([]);
    expect(offered("bye")).toEqual([]);
  });
});

// В1: пока пояс человека неизвестен, в первый день до ночи агент узнаёт город — встроенная задача, первая по важности.
// Признак `askTimeZone` («пояс неизвестен, сегодня первый день до первой ночи») отдаёт этап 4.

describe("встроенная попутная задача: узнать город", () => {
  const withSchedule = (json: Record<string, any>) => (json.schedule = { dayStart: "09:00", lateStartHours: 3, farewellOnDeadline: false });
  const scheduled = (tasks: Record<string, unknown>[] = []) => flowWith(tasks, withSchedule);
  const open = (flow: AgentFlow, patch: Partial<FlowRun> = {}, extra: Partial<Parameters<typeof openSideTasks>[0]> = {}) =>
    ids(openSideTasks({ flow, run: runAt(flow, patch), chatId: CHAT, attempts: [], card: {}, askTimeZone: true, ...extra }));

  it("пояс неизвестен, первый день: задача открыта, даже если в сценарии своих задач нет", () => {
    const flow = fixtureFlow("sales-review", withSchedule);
    expect(open(flow)).toEqual(["ask_time_zone"]);
  });

  it("признака нет (пояс известен или не первый день) — задачи нет", () => {
    const flow = scheduled();
    expect(open(flow, {}, { askTimeZone: false })).toEqual([]);
    expect(open(flow, {}, { askTimeZone: undefined })).toEqual([]);
  });

  it("у сценария без «Дней и времени» города не спрашиваем", () => {
    expect(open(flowWith([subscribe]))).toEqual(["subscribe"]);
  });

  it("первая по важности: стоит выше задач сценария", () => {
    expect(open(scheduled([subscribe]))).toEqual(["ask_time_zone", "subscribe"]);
  });

  it("общий темп её не держит, а задачи сценария — держит", () => {
    const flow = scheduled([subscribe]);
    expect(open(flow, { humanMessages: 4, sideQuestionAt: 4 })).toEqual(["ask_time_zone"]);
  });

  it("две попытки на человека, потом хватит; в другом разговоре они тоже потрачены", () => {
    const flow = scheduled();
    const asked = (asks: number) => [{ taskId: "ask_time_zone", chatId: null, asks, doneAt: null }];
    expect(open(flow, {}, { attempts: asked(1) })).toEqual(["ask_time_zone"]);
    expect(open(flow, {}, { attempts: asked(2) })).toEqual([]);
    expect(open(flow, {}, { attempts: asked(2), chatId: "c2" })).toEqual([]);
  });

  it("отмеченная решённой не всплывает", () => {
    const attempts = [{ taskId: "ask_time_zone", chatId: null, asks: 1, doneAt: "2026-10-14T07:00:00.000Z" }];
    expect(open(scheduled(), {}, { attempts })).toEqual([]);
  });

  it("в состоянии «без вопросов» и в конце сценария — не спрашиваем", () => {
    const flow = scheduled();
    expect(open(flow, { state: "remind" })).toEqual([]);
    expect(open(flow, { state: "bye" })).toEqual([]);
  });
});
