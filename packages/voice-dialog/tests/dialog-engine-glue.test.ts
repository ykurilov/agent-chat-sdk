import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILLER_SETTINGS } from "../src/browser/filler-scheduler";
import { FILLER_PHRASES, harness } from "./support/engine-harness";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof harness>;

const SERVER = { phrases: FILLER_PHRASES, audioMs: 1000 };

/** Дать загрузке заполнителей дойти до конца: часы не двигаем. */
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

/** Человек сказал «Так.», модель ещё думает: ни текста, ни звука. */
async function saidSo(overrides: Parameters<typeof harness>[0] = {}) {
  const h = harness(overrides);
  await h.start();
  await settle();
  await h.saySomething("Так.");
  return h;
}

/** Человек продолжил, не дожидаясь ответа. */
async function continues(h: Harness, text = "Дай-ка подумать.") {
  h.heard(text.replace(/[.,]/g, ""));
  await h.saySomething(text);
  await h.flushPromises();
}

const interrupts = (h: Harness) => h.socket().ofType("interrupt");
const prepares = (h: Harness) => h.socket().ofType("prepare").map((message) => message.replyId);
const stateNames = (h: Harness) => h.views.map((view) => view.state);

describe("склейка: фраза в ожидании ответа дописывается к предыдущей (FR-026)", () => {
  it("пока модель думает, новая фраза не создаёт второго хода: вместо «Так.» уходит «Так. Дай-ка подумать.», остановки хода на стороне движка нет", async () => {
    const h = await saidSo();

    await continues(h);

    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);
    expect(h.bridge.sent).toEqual(["Так."]);
    expect(h.bridge.stops).toBe(0);
    expect(h.view()?.state).toBe("thinking");
  });

  it("на экране состояние не мигает: «думает» остаётся «думает», «перебит» не показывается", async () => {
    const h = await saidSo();
    const before = h.views.length;

    await continues(h);

    expect(stateNames(h).slice(before - 1)).not.toContain("interrupted");
    expect(stateNames(h).at(-1)).toBe("thinking");
  });

  it("на сервере голоса прежняя реплика закрыта, новая подготовлена — в этом порядке, после того как чат принял склейку", async () => {
    const h = await saidSo();

    await continues(h);

    expect(interrupts(h)).toEqual([{ type: "interrupt", replyId: 1, playedMs: 0 }]);
    expect(prepares(h)).toEqual([1, 2]);
    const order = h.log.filter((entry) => ["chat:replace:Так. Дай-ка подумать.", "chat:replaced", "ws:interrupt", "ws:prepare"].includes(entry));
    expect(order).toEqual(["ws:prepare", "chat:replace:Так. Дай-ка подумать.", "chat:replaced", "ws:interrupt", "ws:prepare"]);
  });

  it("ответ на склеенную фразу озвучивается как обычный: текст нового ответа → предложения новой реплики → «говорит»", async () => {
    const h = await saidSo();
    await continues(h);

    h.bridge.say("Хорошо, думаю. Вот что вышло.", 0, "a2");
    h.bridge.finish("complete", "a2");
    h.socket().receiveSpeech(2);
    await h.flushPromises();

    expect(h.socket().ofType("speak").map((message) => message.replyId)).toEqual([2, 2]);
    expect(h.view()?.state).toBe("speaking");
  });

  it("поздние события остановленного ответа (конец «остановлен», размышление) не относятся к новой реплике", async () => {
    const h = await saidSo();
    h.bridge.activity("reasoning", "start");
    await continues(h);

    h.bridge.activity("reasoning", "end");
    h.bridge.finish("stopped", "a1");
    h.bridge.say("Ответ. Готов.", 0, "a2");
    h.bridge.finish("complete", "a2");
    await h.flushPromises();

    expect(h.socket().ofType("speak").map((message) => message.text)).toEqual(["Ответ.", "Готов."]);
    expect(h.socket().ofType("end_reply")).toEqual([{ type: "end_reply", replyId: 2 }]);
  });

  it("размышление модели склейке не мешает: reasoning — ещё не ответ и не действие", async () => {
    const h = await saidSo();
    h.bridge.activity("reasoning", "start");

    await continues(h);

    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);
    expect(h.bridge.sent).toEqual(["Так."]);
  });

  it("новые слова ещё идут (предварительные), фраза не кончилась: ход не останавливается, ждём конца фразы", async () => {
    const h = await saidSo();

    h.heard("Дай-ка", 0.95, "interim");
    h.heard("Дай-ка подумать", 0.95, "interim");
    await h.flushPromises();

    expect(interrupts(h)).toEqual([]);
    expect(h.bridge.stops).toBe(0);
    expect(h.bridge.replaced).toEqual([]);
    expect(h.view()?.state).toBe("thinking");
  });

  it("склейка повторяется: третья фраза правит уже склеенное, а не создаёт ход", async () => {
    const h = await saidSo();
    await continues(h);

    await continues(h, "Найди новости.");

    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать.", "Так. Дай-ка подумать. Найди новости."]);
    expect(h.bridge.sent).toEqual(["Так."]);
    expect(prepares(h)).toEqual([1, 2, 3]);
    expect(interrupts(h).map((message) => message.replyId)).toEqual([1, 2]);
  });

  it("третья фраза пришла, пока первая склейка ещё идёт: ждёт и склеивается следом, ничего не теряется", async () => {
    const h = await saidSo();
    let release!: () => void;
    h.bridge.replaceGate = new Promise<void>((resolve) => (release = resolve));
    await continues(h);
    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);

    await continues(h, "Найди новости.");
    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);
    release();
    await h.flushPromises();
    await h.flushPromises();

    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать.", "Так. Дай-ка подумать. Найди новости."]);
    expect(h.bridge.sent).toEqual(["Так."]);
    expect(h.view()?.state).toBe("thinking");
  });

  it("пока склейка идёт, события прежнего ответа игнорируются: его «остановлен» не закрывает реплику", async () => {
    const h = await saidSo();
    let release!: () => void;
    h.bridge.replaceGate = new Promise<void>((resolve) => (release = resolve));
    await continues(h);

    h.bridge.finish("stopped", "a1");
    await h.flushPromises();
    release();
    await h.flushPromises();
    h.bridge.say("Ответ.", 0, "a2");
    h.bridge.finish("complete", "a2");
    await h.flushPromises();

    expect(h.socket().ofType("speak")).toEqual([{ type: "speak", replyId: 2, text: "Ответ.", messageId: "a2" }]);
  });
});

describe("склейка: когда её нет, поведение прежнее", () => {
  it("у ответа уже есть текст: новая фраза перебивает ход и уходит отдельным сообщением", async () => {
    const h = await saidSo();
    h.bridge.say("Конечно");

    h.heard("Дай-ка подумать");
    await h.saySomething("Дай-ка подумать.");
    await h.flushPromises();

    expect(h.bridge.replaced).toEqual([]);
    expect(h.bridge.stops).toBe(1);
    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
  });

  it("звук ответа уже пошёл: перебивание, новая фраза отдельным сообщением", async () => {
    const h = await saidSo();
    h.bridge.say("Конечно, сейчас расскажу.");
    h.socket().receiveSpeech(1);
    await h.flushPromises();

    h.heard("Дай-ка подумать");
    await h.saySomething("Дай-ка подумать.");
    await h.flushPromises();

    expect(h.bridge.replaced).toEqual([]);
    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
  });

  it("начат вызов инструмента: это уже действие модели, не склеиваем — перебивание и отдельное сообщение", async () => {
    const h = await saidSo();
    h.bridge.activity("tool", "start", { toolName: "web_search" });

    h.heard("Дай-ка подумать");
    await h.saySomething("Дай-ка подумать.");
    await h.flushPromises();

    expect(h.bridge.replaced).toEqual([]);
    expect(h.bridge.stops).toBe(1);
    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
  });

  it("инструмент закончил работу, текста ещё нет — всё равно не склеиваем: действие уже было", async () => {
    const h = await saidSo();
    h.bridge.activity("tool", "start", { toolName: "web_search" });
    h.bridge.activity("tool", "end", { toolName: "web_search" });

    await continues(h);

    expect(h.bridge.replaced).toEqual([]);
    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
  });

  it("стоп-слово останавливает сразу, как раньше, без склейки", async () => {
    const h = await saidSo();

    h.heard("подожди");
    await h.flushPromises();

    expect(interrupts(h)).toEqual([{ type: "interrupt", replyId: 1, playedMs: 0 }]);
    expect(h.bridge.stops).toBe(1);
    expect(h.view()?.state).toBe("interrupted");
    expect(h.bridge.replaced).toEqual([]);
  });

  it("два междометия подряд («ага угу») перебивают, как раньше", async () => {
    const h = await saidSo();

    h.heard("ага");
    h.heard("угу");
    await h.saySomething("ага угу");
    await h.flushPromises();

    expect(h.bridge.replaced).toEqual([]);
    expect(h.bridge.stops).toBe(1);
    expect(h.bridge.sent).toEqual(["Так.", "ага угу"]);
  });

  it("одно междометие («угу») не значит ничего: ни склейки, ни перебивания", async () => {
    const h = await saidSo();

    await continues(h, "Угу.");

    expect(h.bridge.replaced).toEqual([]);
    expect(h.bridge.stops).toBe(0);
    expect(h.view()?.state).toBe("thinking");
  });

  it("мост без склейки (старый): новая фраза перебивает ход и уходит отдельным сообщением", async () => {
    const h = await saidSo();
    h.bridge.withoutReplace = true;

    await continues(h);

    expect(h.bridge.stops).toBe(1);
    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
  });

  it("склейка не вышла (мост ответил «нет»): перебивание и отдельное сообщение, как раньше", async () => {
    const h = await saidSo();
    h.bridge.replaceResult = false;

    await continues(h);
    await h.flushPromises();

    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);
    expect(interrupts(h).map((message) => message.replyId)).toEqual([1]);
    expect(h.bridge.stops).toBe(1);
    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
    expect(h.view()?.state).toBe("thinking");
  });

  it("склейка не вышла, а за время ожидания пришла ещё фраза: уходят отдельным сообщением обе, вместе", async () => {
    const h = await saidSo();
    h.bridge.replaceResult = false;
    let release!: () => void;
    h.bridge.replaceGate = new Promise<void>((resolve) => (release = resolve));
    await continues(h);
    await continues(h, "Найди новости.");

    release();
    await h.flushPromises();
    await h.flushPromises();

    expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать. Найди новости."]);
  });
});

describe("склейка и заполнители", () => {
  it("«Хмм…» до склейки не считается началом ответа: звучит заполнитель, а склейка всё равно проходит и глушит его", async () => {
    const h = await saidSo({ fillersServer: SERVER });
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);
    expect(h.player.fillers).toHaveLength(1);

    await continues(h);

    expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);
    expect(h.player.fillerPlaying).toBe(false);
    expect(h.bridge.stops).toBe(0);
  });

  it("после склейки заполнитель снова может прозвучать: отсчёт молчания идёт заново", async () => {
    const h = await saidSo({ fillersServer: SERVER });
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);
    h.player.drainFiller();
    await continues(h);
    expect(h.player.fillers).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);

    expect(h.player.fillers).toHaveLength(2);
  });
});

describe("склейка и замеры", () => {
  it("задержка ответа считается от конца последней фразы, а не первой", async () => {
    const h = await saidSo();
    await vi.advanceTimersByTimeAsync(1300);
    await continues(h);
    await vi.advanceTimersByTimeAsync(500);

    h.bridge.say("Ответ.", 0, "a2");
    h.socket().receiveSpeech(2);
    await h.flushPromises();

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]!.totalMs).toBe(500);
  });
});
