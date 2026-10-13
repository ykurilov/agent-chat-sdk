import { describe, expect, it } from "vitest";
import { createCacheMissWatch } from "../../../src/usage/cache-miss-watch";
import type { CacheMissWatch, WatchedRequest } from "../../../src/usage/cache-miss-watch";

const price = { inputPerMillion: 3, outputPerMillion: 15, cachedInputPerMillion: 0.3 };

function setup() {
  const lines: string[] = [];
  let clock = Date.parse("2026-01-01T10:00:00Z");
  const watch = createCacheMissWatch({ logError: (line) => lines.push(line), now: () => clock });
  return {
    lines,
    watch,
    pause: (minutes: number) => {
      clock += minutes * 60_000;
    },
  };
}

const request = (overrides: Partial<WatchedRequest> = {}): WatchedRequest => ({
  chatId: "chat-1",
  modelId: "model-x",
  providerId: "prov",
  historyIds: ["u1"],
  answerId: "a1",
  price,
  ...overrides,
});

/** Ход следующим вопросом: история прежнего хода плюс его ответ плюс новый вопрос. */
const nextTurn = (n: number): Partial<WatchedRequest> => ({
  historyIds: [...Array.from({ length: n }, (_, i) => [`u${i + 1}`, `a${i + 1}`]).flat(), `u${n + 1}`],
  answerId: `a${n + 1}`,
});

const step = (inputTokens: number, cachedInputTokens: number, cacheWriteTokens = 0) => ({ inputTokens, cachedInputTokens, cacheWriteTokens });

function firstTurn(watch: CacheMissWatch, usage = step(20_000, 0, 20_000)) {
  watch.forRequest(request()).onStep(usage);
}

describe("журнал промахов кэша", () => {
  it("первый ход ничего не пишет, даже если кэш пуст", () => {
    const { watch, lines } = setup();
    firstTurn(watch, step(20_000, 0));
    expect(lines).toEqual([]);
  });

  it("второй ход, кэш не прочитан вовсе: одна строка с числом токенов, переплатой и паузой", () => {
    const { watch, lines, pause } = setup();
    firstTurn(watch);
    pause(1.5);
    watch.forRequest(request(nextTurn(1))).onStep(step(21_000, 0));
    // мимо кэша 20 000 токенов: меньший из двух входов (20 000), прочитано 0; переплата 20 000 × (3 − 0,3) / 1 000 000
    expect(lines).toEqual(["[промах кэша] чат=chat-1 модель=model-x провайдер=prov токенов=20000 переплата≈$0.0540 пауза=1.5мин"]);
  });

  it("история хода переписана (номера те же, начало другое): строки нет", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request({ historyIds: ["u1", "a1"], historyRewritten: true })).onStep(step(8_000, 0));
    expect(lines).toEqual([]);
  });

  it("кэш прочитан почти весь: строки нет", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request(nextTurn(1))).onStep(step(21_000, 20_000));
    expect(lines).toEqual([]);
  });

  it("промах до 1024 токенов включительно шумом считается: строки нет", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request(nextTurn(1))).onStep(step(21_000, 20_000 - 1024));
    expect(lines).toEqual([]);
    watch.forRequest(request(nextTurn(2))).onStep(step(22_000, 21_000 - 1025));
    expect(lines).toHaveLength(1);
  });

  it("провайдер ни разу не сообщал о кэше: строки нет", () => {
    const { watch, lines } = setup();
    firstTurn(watch, step(20_000, 0));
    watch.forRequest(request(nextTurn(1))).onStep(step(21_000, 0));
    expect(lines).toEqual([]);
  });

  it("провайдер сообщал о кэше раньше, а теперь прочитано 0: строка есть", () => {
    const { watch, lines } = setup();
    firstTurn(watch, step(20_000, 15_000));
    watch.forRequest(request(nextTurn(1))).onStep(step(21_000, 0));
    expect(lines).toHaveLength(1);
  });

  it("шаги одного хода сравниваются между собой", () => {
    const { watch, lines } = setup();
    const turn = watch.forRequest(request());
    turn.onStep(step(20_000, 0, 20_000));
    turn.onStep(step(22_000, 20_000));
    expect(lines).toEqual([]);
    turn.onStep(step(24_000, 0));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=22000");
  });

  it("сравнение с прошлым ходом идёт с последним шагом прошлого хода: его начало целиком в начале следующего хода", () => {
    const { watch, lines } = setup();
    const turn = watch.forRequest(request());
    turn.onStep(step(20_000, 0, 20_000));
    turn.onStep(step(60_000, 20_000, 40_000));
    // следующий ход: кэш прочитан до конца последнего шага прошлого хода
    watch.forRequest(request(nextTurn(1))).onStep(step(61_000, 60_000));
    expect(lines).toEqual([]);
  });

  it("прочитано только до первого шага прошлого хода: шаги с инструментами прошли мимо кэша, строка есть", () => {
    const { watch, lines } = setup();
    const turn = watch.forRequest(request());
    turn.onStep(step(20_000, 0, 20_000));
    turn.onStep(step(60_000, 20_000, 40_000));
    watch.forRequest(request(nextTurn(1))).onStep(step(61_000, 20_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=40000");
  });

  it("после сжатия истории начало другое: строки нет, а следующий ход снова сравнивается", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request({ historyIds: ["c1-summary", "u1", "a1", "u2"], answerId: "a2" })).onStep(step(6_000, 0));
    expect(lines).toEqual([]);
    watch.forRequest(request({ historyIds: ["c1-summary", "u1", "a1", "u2", "a2", "u3"], answerId: "a3" })).onStep(step(7_000, 0));
    expect(lines).toHaveLength(1);
  });

  it("другая ветка (правка или «Переделать»): общего начала нет, строки нет", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request({ historyIds: ["u1b"], answerId: "a1b" })).onStep(step(20_000, 0));
    watch.forRequest(request({ historyIds: ["u1"], answerId: "a1c" })).onStep(step(20_000, 0));
    expect(lines).toEqual([]);
  });

  it("смена модели или провайдера: у каждой свой кэш, строки нет", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request({ ...nextTurn(1), modelId: "model-y" })).onStep(step(21_000, 0));
    watch.forRequest(request({ ...nextTurn(2), modelId: "model-y", providerId: "backup" })).onStep(step(22_000, 0));
    expect(lines).toEqual([]);
  });

  it("продолжение после подтверждения: ответ уже в истории, начало то же", () => {
    const { watch, lines } = setup();
    firstTurn(watch, step(20_000, 15_000));
    watch.forRequest(request({ historyIds: ["u1", "a1"], answerId: "a1" })).onStep(step(22_000, 0));
    expect(lines).toHaveLength(1);
  });

  it("чаты не мешают друг другу", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request({ ...nextTurn(1), chatId: "chat-2" })).onStep(step(21_000, 0));
    expect(lines).toEqual([]);
  });

  it("нет цены кэша у модели: пишет «неизвестна», а не ноль", () => {
    const { watch, lines } = setup();
    const unpriced = { chatId: "chat-1", price: undefined };
    watch.forRequest(request(unpriced)).onStep(step(20_000, 0, 20_000));
    watch.forRequest(request({ ...nextTurn(1), ...unpriced })).onStep(step(21_000, 0));
    expect(lines[0]).toContain("переплата=неизвестна");
    const noCachePrice = { price: { inputPerMillion: 3, outputPerMillion: 15 } };
    watch.forRequest(request({ ...nextTurn(2), ...noCachePrice })).onStep(step(22_000, 0));
    expect(lines[1]).toContain("переплата=неизвестна");
  });

  it("в строке нет ничего, кроме номера чата, модели, провайдера и чисел", () => {
    const { watch, lines } = setup();
    firstTurn(watch);
    watch.forRequest(request(nextTurn(1))).onStep(step(21_000, 0));
    expect(lines[0]).toMatch(/^\[промах кэша\] чат=\S+ модель=\S+ провайдер=\S+ токенов=\d+ переплата(≈\$\d+\.\d{4}|=неизвестна) пауза=\d+\.\d+мин$/);
  });

  it("концовка последнего шага прошлого хода (снимок, пометки) в промах не входит: на следующем ходе её в начале запроса нет", () => {
    const { watch, lines } = setup();
    watch.forRequest(request()).onStep({ ...step(20_000, 15_000), tailTokens: 3_000 });
    // прочитано всё, что было до концовки: 20 000 − 3 000
    watch.forRequest(request(nextTurn(1))).onStep({ ...step(24_000, 17_000), tailTokens: 3_000 });
    watch.forRequest(request(nextTurn(2))).onStep({ ...step(28_000, 21_000), tailTokens: 3_000 });
    expect(lines).toEqual([]);
  });

  it("при концовке шага настоящий промах всё равно виден: из него вычитается только концовка", () => {
    const { watch, lines } = setup();
    watch.forRequest(request()).onStep({ ...step(20_000, 15_000), tailTokens: 3_000 });
    watch.forRequest(request(nextTurn(1))).onStep(step(24_000, 4_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=13000");
  });

  it("на следующем ходе вычитается концовка последнего шага прошлого хода, а не первого", () => {
    const { watch, lines } = setup();
    const turn = watch.forRequest(request());
    turn.onStep({ ...step(20_000, 0, 20_000), tailTokens: 5_000 });
    turn.onStep({ ...step(30_000, 15_000), tailTokens: 1_000 });
    // ожидание: 30 000 − 1 000 = 29 000; прочитано 25 000 — промах 4 000
    watch.forRequest(request(nextTurn(1))).onStep(step(35_000, 25_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=4000");
  });

  it("запоминает не больше 500 чатов: самый давний забывается", () => {
    const { watch, lines } = setup();
    for (let n = 0; n < 501; n++) watch.forRequest(request({ chatId: `c${n}` })).onStep(step(20_000, 15_000));
    watch.forRequest(request({ ...nextTurn(1), chatId: "c0" })).onStep(step(21_000, 0));
    expect(lines).toEqual([]);
    watch.forRequest(request({ ...nextTurn(1), chatId: "c500" })).onStep(step(21_000, 0));
    expect(lines).toHaveLength(1);
  });
  it("снимок шага (stepContext) в промах не входит: на следующем шаге его в начале запроса нет", () => {
    const { watch, lines } = setup();
    const turn = watch.forRequest(request());
    turn.onStep({ ...step(20_000, 0, 20_000), tailTokens: 2_000 });
    // прочитано всё, что было до снимка прошлого шага: 20 000 − 2 000
    turn.onStep({ ...step(23_000, 18_000), tailTokens: 2_000 });
    expect(lines).toEqual([]);
    turn.onStep(step(26_000, 10_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=11000");
  });

  it("снимок и пометки последнего шага прошлого хода не в счёт промаха следующего хода", () => {
    const { watch, lines } = setup();
    const turn = watch.forRequest(request());
    turn.onStep({ ...step(20_000, 0, 20_000), tailTokens: 2_000 });
    turn.onStep({ ...step(25_000, 18_000), tailTokens: 3_000 });
    // начало следующего хода — последний шаг прошлого без его концовки: 25 000 − 3 000
    watch.forRequest(request(nextTurn(1))).onStep(step(30_000, 22_000));
    expect(lines).toEqual([]);
  });

  it("попытка с пометкой продолжения из нескольких шагов: следующий ход совпадает с ней только до пометки — строки нет", () => {
    const { watch, lines } = setup();
    // Автопродолжение после обрыва по длине: пометка (500 токенов) — концовка шага 0, но на шаге 1 она остаётся внутри
    // запроса, а в следующий ход не попадает.
    const attempt = watch.forRequest(request({ tailNoteInside: true }));
    attempt.onStep({ ...step(20_000, 0, 20_000), tailTokens: 500 });
    attempt.onStep(step(25_000, 20_000, 5_000));
    // следующий ход совпадает с попыткой до пометки: 19 500 токенов, после — новое
    watch.forRequest(request(nextTurn(1))).onStep(step(30_000, 19_500));
    expect(lines).toEqual([]);
  });

  it("попытка с пометкой продолжения: настоящий промах следующего хода виден", () => {
    const { watch, lines } = setup();
    const attempt = watch.forRequest(request({ tailNoteInside: true }));
    attempt.onStep({ ...step(20_000, 0, 20_000), tailTokens: 500 });
    attempt.onStep(step(25_000, 20_000, 5_000));
    watch.forRequest(request(nextTurn(1))).onStep(step(30_000, 0));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("токенов=19500 ");
  });
});
