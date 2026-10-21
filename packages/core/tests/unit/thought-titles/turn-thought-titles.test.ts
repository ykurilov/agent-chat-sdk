import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createTurnThoughtTitles } from "../../../src/thought-titles/turn-thought-titles";
import type { TurnThoughtTitlesInput } from "../../../src/thought-titles/turn-thought-titles";

const LONG_RU = "Нужно продумать правила игры: сколько клеток, кто ходит первым, как считать победу. ".repeat(3);
const LONG_EN = "I need to think through the game rules: board size, who moves first, how to detect a win. ".repeat(3);

function thought(id: string, text: string): UIMessageChunk[] {
  return [
    { type: "reasoning-start", id },
    { type: "reasoning-delta", id, delta: text },
    { type: "reasoning-end", id },
  ];
}

function setup(overrides: Partial<TurnThoughtTitlesInput> = {}) {
  const changes: Array<Record<string, string>> = [];
  const titles = createTurnThoughtTitles({
    language: "ru",
    maxLength: 60,
    maxPerTurn: 6,
    minChars: 150,
    onChange: (map) => changes.push(map),
    logError: () => {},
    ...overrides,
  });
  const feed = (chunks: UIMessageChunk[]) => chunks.forEach((chunk) => titles.observe(chunk));
  return { titles, changes, feed };
}

describe("заголовки раздумий хода", () => {
  it("заголовок провайдера на языке человека — сразу, без модели", async () => {
    const summarize = vi.fn(async () => "Лишнее");
    const { titles, changes, feed } = setup({ summarize });
    feed(thought("r", `**Продумываю правила игры**\n\n${LONG_RU}`));
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Продумываю правила игры" });
    expect(changes).toEqual([{ "0": "Продумываю правила игры" }]);
    expect(summarize).not.toHaveBeenCalled();
  });

  it("заголовок провайдера не на языке человека — пересказ моделью", async () => {
    const summarize = vi.fn(async (_text: string) => "Продумываю правила игры");
    const { titles, feed } = setup({ summarize });
    feed(thought("r", `**Planning game rules**\n\n${LONG_EN}`));
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Продумываю правила игры" });
    expect(summarize.mock.calls[0]![0]).toContain("Planning game rules");
  });

  it("модель пересказывает после конца куска; ключ — порядковый номер раздумья", async () => {
    const summarize = vi.fn(async (text: string) => (text.includes("второе") ? "Проверяю счёт" : "Выбираю поле"));
    const { titles, feed } = setup({ summarize });
    feed([{ type: "reasoning-start", id: "a" }, { type: "reasoning-delta", id: "a", delta: LONG_RU }]);
    expect(summarize).not.toHaveBeenCalled();
    feed([{ type: "reasoning-end", id: "a" }]);
    feed(thought("a", `второе ${LONG_RU}`));
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Выбираю поле", "1": "Проверяю счёт" });
  });

  it("сбой модели и плохой ответ — тихо без заголовка", async () => {
    const logError = vi.fn();
    const summarize = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce("Planning rules");
    const { titles, changes, feed } = setup({ summarize, logError });
    feed(thought("a", LONG_RU));
    feed(thought("b", LONG_RU));
    await titles.settle(100);
    expect(titles.titles()).toEqual({});
    expect(changes).toEqual([]);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining("503"));
  });

  it("короткое раздумье на языке человека — первое предложение, без модели", async () => {
    const summarize = vi.fn(async () => "Лишнее");
    const { titles, feed } = setup({ summarize });
    feed(thought("a", "Проверю счёт. Потом отвечу."));
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Проверю счёт" });
    expect(summarize).not.toHaveBeenCalled();
  });

  it("короткое раздумье не на языке человека — пересказ моделью; без модели — без заголовка", async () => {
    const summarize = vi.fn(async (_text: string) => "Проверяю счёт");
    const { titles, feed } = setup({ summarize });
    feed(thought("a", "Let me check the score."));
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Проверяю счёт" });
    expect(summarize.mock.calls[0]![0]).toBe("Let me check the score.");

    const without = setup();
    without.feed(thought("a", "Let me check the score."));
    await without.titles.settle(100);
    expect(without.titles.titles()).toEqual({});
  });

  it("не больше maxPerTurn вызовов модели на ход", async () => {
    const summarize = vi.fn(async () => "Продумываю шаг");
    const { titles, feed } = setup({ summarize, maxPerTurn: 2 });
    for (const id of ["a", "b", "c"]) feed(thought(id, LONG_RU));
    await titles.settle(100);
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(Object.keys(titles.titles())).toEqual(["0", "1"]);
  });

  it("без модели — только заголовки провайдера и короткие", async () => {
    const { titles, feed } = setup();
    feed(thought("a", LONG_RU));
    await titles.settle(100);
    expect(titles.titles()).toEqual({});
  });

  it("имя инструмента хода в ответе модели — нет заголовка", async () => {
    const { titles, feed } = setup({ summarize: async () => "Открываю gamedev" });
    feed([{ type: "tool-input-start", toolCallId: "t1", toolName: "gamedev" }]);
    feed(thought("a", LONG_RU));
    await titles.settle(100);
    expect(titles.titles()).toEqual({});
  });

  it("стёртый шаг: заголовки после него забываются, поздний ответ отбрасывается", async () => {
    let release!: (title: string) => void;
    const summarize = vi.fn().mockResolvedValueOnce("Выбираю поле").mockReturnValueOnce(new Promise<string>((resolve) => (release = resolve)));
    const { titles, feed } = setup({ summarize });
    feed(thought("a", LONG_RU));
    await titles.settle(100);
    feed(thought("b", LONG_RU));
    titles.rewind(1);
    release("Поздний заголовок");
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Выбираю поле" });
  });

  it("продолжение ответа: прежние заголовки и счёт раздумий сохраняются", async () => {
    const { titles, feed } = setup({ existing: { count: 1, titles: { "0": "Выбираю поле" } }, summarize: async () => "Проверяю счёт" });
    feed(thought("a", LONG_RU));
    await titles.settle(100);
    expect(titles.titles()).toEqual({ "0": "Выбираю поле", "1": "Проверяю счёт" });
  });

  it("settle ждёт не дольше срока; после close заголовки не приходят", async () => {
    const summarize = vi.fn(() => new Promise<string>((resolve) => setTimeout(() => resolve("Поздно"), 200)));
    const { titles, changes, feed } = setup({ summarize });
    feed(thought("a", LONG_RU));
    const started = Date.now();
    await titles.settle(20);
    expect(Date.now() - started).toBeLessThan(150);
    titles.close();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(changes).toEqual([]);
    expect(titles.titles()).toEqual({});
  });
});

describe("заголовки раздумий хода: правки ревью", () => {
  it("имена всех инструментов и навыков хода — и невызванных; заголовок провайдера проходит ту же проверку", async () => {
    const summarize = vi.fn(async () => "Открываю огненный дракон");
    const { titles, feed } = setup({ summarize, toolNames: ["огненный дракон"] });
    titles.addToolNames(["gamedev"]);
    feed(thought("a", `**Запускаю gamedev**\n\n${LONG_RU}`));
    await titles.settle(100);
    // Заголовок провайдера с именем инструмента отброшен — пересказ моделью; и её ответ с именем навыка отброшен.
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(titles.titles()).toEqual({});
  });

  it("«Стоп»: сигнал хода уходит в пересказ, после остановки новых запросов нет и журнал молчит", async () => {
    const stop = new AbortController();
    const logError = vi.fn();
    const signals: AbortSignal[] = [];
    const summarize = vi.fn((_text: string, signal?: AbortSignal) => {
      signals.push(signal!);
      return new Promise<string>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const { titles, feed } = setup({ summarize, signal: stop.signal, logError });
    feed(thought("a", LONG_RU));
    stop.abort();
    expect(signals[0]!.aborted).toBe(true);
    feed(thought("b", LONG_RU));
    await titles.settle(50);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it("maxPerTurn — на ответ целиком: продолжение несёт число уже сделанных запросов", async () => {
    const summarize = vi.fn(async (_text: string) => "Проверяю счёт");
    const { titles, feed } = setup({ summarize, maxPerTurn: 2, existing: { count: 2, titles: { "0": "Выбираю поле" }, asked: 2 } });
    feed(thought("a", LONG_RU));
    await titles.settle(100);
    expect(summarize).not.toHaveBeenCalled();
    expect(titles.askedKeys()).toEqual([]);
  });
});
