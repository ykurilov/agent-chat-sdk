import { describe, expect, it, vi } from "vitest";
import { englishLabels, russianLabels } from "../../src/labels";
import { stepPhraseOf } from "../../src/work-view/step-phrases";
import type { StepPhrases } from "../../src/work-view/step-phrases";

const labels = russianLabels.workView;

const phrases: StepPhrases = {
  write_file: ({ input }) => {
    const path = (input as { path?: string } | undefined)?.path ?? "";
    if (path.endsWith("Calendar.tsx")) return { running: "Делаю календарь", done: "Сделал календарь" };
    return undefined;
  },
  look_at_app: ({ input }) =>
    (input as { device?: string } | undefined)?.device === "mobile"
      ? { running: "Проверяю на телефоне", done: "Проверил на телефоне" }
      : { running: "Смотрю на приложение", done: "Посмотрел на приложение" },
  web_search: { running: "Ищу в интернете", done: "Поискал в интернете" },
};

describe("stepPhraseOf: фраза шага для простого вида", () => {
  it("функция приложения получает вход и даёт фразу «идёт» и «готово»", () => {
    const input = { path: "src/components/Calendar.tsx", content: "<div className=…" };
    expect(stepPhraseOf({ toolName: "write_file", state: "running", input }, { phrases, labels })).toBe("Делаю календарь");
    expect(stepPhraseOf({ toolName: "write_file", state: "done", input, output: "ok" }, { phrases, labels })).toBe("Сделал календарь");
    expect(stepPhraseOf({ toolName: "look_at_app", state: "running", input: { device: "mobile" } }, { phrases, labels })).toBe("Проверяю на телефоне");
  });

  it("готовые фразы без функции", () => {
    expect(stepPhraseOf({ toolName: "web_search", state: "running" }, { phrases, labels })).toBe("Ищу в интернете");
    expect(stepPhraseOf({ toolName: "web_search", state: "done" }, { phrases, labels })).toBe("Поискал в интернете");
  });

  it("функция приложения видит имя, состояние и выход", () => {
    const phrase = vi.fn(() => ({ running: "Считаю", done: "Посчитал" }));
    stepPhraseOf({ toolName: "calc", state: "done", input: { a: 1 }, output: 2 }, { phrases: { calc: phrase }, labels });
    expect(phrase).toHaveBeenCalledWith({ toolName: "calc", state: "done", input: { a: 1 }, output: 2 });
  });

  it("без входа (права, вход ещё пишется) функция работает от имени инструмента", () => {
    expect(stepPhraseOf({ toolName: "look_at_app", state: "running" }, { phrases, labels })).toBe("Смотрю на приложение");
  });

  it("ошибка функции фраз не ломает чат: общая фраза", () => {
    const broken: StepPhrases = {
      write_file: () => {
        throw new Error("boom");
      },
    };
    expect(stepPhraseOf({ toolName: "write_file", state: "running", input: {} }, { phrases: broken, labels })).toBe(labels.stepRunning);
    expect(stepPhraseOf({ toolName: "write_file", state: "done", input: {} }, { phrases: broken, labels })).toBe(labels.stepDone);
  });

  it("функция вернула не то (пусто, не строку) — общая фраза", () => {
    const odd = { write_file: () => ({ running: "  ", done: 5 as unknown as string }) } satisfies StepPhrases;
    expect(stepPhraseOf({ toolName: "write_file", state: "running" }, { phrases: odd, labels })).toBe(labels.stepRunning);
    expect(stepPhraseOf({ toolName: "write_file", state: "done" }, { phrases: odd, labels })).toBe(labels.stepDone);
  });

  it("неизвестный инструмент: название инструмента от приложения (`title`), иначе общая фраза", () => {
    expect(stepPhraseOf({ toolName: "mystery", state: "running" }, { phrases, labels })).toBe(labels.stepRunning);
    expect(stepPhraseOf({ toolName: "mystery", state: "done", title: "Расчёт доставки" }, { phrases, labels })).toBe("Расчёт доставки");
    expect(stepPhraseOf({ toolName: "mystery", state: "done" }, { labels })).toBe(labels.stepDone);
  });

  it("запасная фраза слоя поведения (помощник) — когда приложение своей не дало", () => {
    const fallback = { running: "Помощник работает", done: "Помощник закончил" };
    expect(stepPhraseOf({ toolName: "helper_x", state: "done" }, { labels, fallback })).toBe("Помощник закончил");
    expect(stepPhraseOf({ toolName: "helper_x", state: "done" }, { labels, fallback, phrases: { helper_x: { running: "a", done: "b" } } })).toBe("b");
  });

  it("шаг с ошибкой: своя фраза `failed` или «идёт» с пометкой; общий — общая пометка", () => {
    const withFailed: StepPhrases = { deploy: { running: "Выкладываю", done: "Выложил", failed: "Не выложилось" } };
    expect(stepPhraseOf({ toolName: "deploy", state: "error" }, { phrases: withFailed, labels })).toBe("Не выложилось");
    expect(stepPhraseOf({ toolName: "web_search", state: "error" }, { phrases, labels })).toBe(labels.stepFailed("Ищу в интернете"));
    expect(stepPhraseOf({ toolName: "mystery", state: "error" }, { phrases, labels })).toBe(labels.stepFailedUnknown);
  });

  it("многоточие на конце фразы приложения не удваивается в пометке ошибки", () => {
    const dotted: StepPhrases = { a: { running: "Рисую календарь…", done: "Нарисовал" } };
    expect(stepPhraseOf({ toolName: "a", state: "error" }, { phrases: dotted, labels })).toBe(labels.stepFailed("Рисую календарь"));
  });

  it("словари: живая строка добавляет многоточие один раз; счёт шагов", () => {
    expect(labels.live("Рисую календарь")).toBe("Рисую календарь…");
    expect(labels.live("Рисую календарь…")).toBe("Рисую календарь…");
    expect(labels.stepsDone(1)).toBe("Сделан 1 шаг");
    expect(labels.stepsDone(3)).toBe("Сделано 3 шага");
    expect(labels.stepsDone(6)).toBe("Сделано 6 шагов");
    expect(englishLabels.workView.stepsDone(1)).toBe("1 step done");
    expect(englishLabels.workView.stepsDone(4)).toBe("4 steps done");
    expect(englishLabels.workView.live("Drawing a calendar")).toBe("Drawing a calendar…");
  });
  it("длинная фраза — до 120 знаков с «…», переводы строк схлопнуты", () => {
    const long = "Пишу ".repeat(40);
    const phrase = stepPhraseOf({ toolName: "x", state: "running" }, { phrases: { x: { running: long, done: "Готово" } }, labels });
    expect(phrase.length).toBe(120);
    expect(phrase.endsWith("…")).toBe(true);
    expect(stepPhraseOf({ toolName: "x", state: "done" }, { phrases: { x: { running: "a", done: "Сделал\n\n  календарь" } }, labels })).toBe("Сделал календарь");
  });
});
