import { describe, expect, it } from "vitest";
import { russianLabels } from "../../src/labels";
import type { StepPhrases } from "../../src/work-view/step-phrases";
import { workLayoutOf } from "../../src/work-view/work-layout";
import type { AnswerEntry } from "../../src/work-view/work-layout";

const labels = russianLabels.workView;
const phrases: StepPhrases = {
  write_file: { running: "Делаю календарь", done: "Сделал календарь" },
  check_app: { running: "Проверяю приложение", done: "Проверил приложение" },
  look_at_app: { running: "Смотрю на телефоне", done: "Посмотрел на телефоне" },
};

const text = (value: string): AnswerEntry<string> => ({ kind: "shown", node: value, blank: value.trim().length === 0 });
const thinking = (key: string): AnswerEntry<string> => ({ kind: "step", key, step: { kind: "thinking" } });
const tool = (key: string, toolName: string, state: "running" | "done" | "error" = "done"): AnswerEntry<string> => ({
  kind: "step",
  key,
  step: { kind: "tool", call: { toolName, state } },
});

describe("workLayoutOf: простой вид ответа", () => {
  it("законченный ход: шаги и размышления — одна строка со списком фраз, текст — как есть", () => {
    const layout = workLayoutOf([thinking("r1"), tool("t1", "write_file"), thinking("r2"), tool("t2", "check_app"), text("Готово!")], {
      streaming: false,
      phrases,
      labels,
    });
    expect(layout).toEqual([
      {
        kind: "done",
        count: 2,
        key: "r1",
        steps: [
          { phrase: "Сделал календарь", failed: false },
          { phrase: "Проверил приложение", failed: false },
        ],
      },
      { kind: "shown", node: "Готово!" },
    ]);
  });

  it("пока ход идёт: последняя группа — живая строка с текущим шагом", () => {
    const layout = workLayoutOf([thinking("r1"), tool("t1", "write_file"), tool("t2", "look_at_app", "running")], { streaming: true, phrases, labels });
    expect(layout).toEqual([{ kind: "live", key: "r1", phrase: "Смотрю на телефоне…" }]);
  });

  it("живая строка: модель думает — «Думаю…», шаг закончился, следующего нет — общая фраза", () => {
    expect(workLayoutOf([tool("t1", "write_file"), thinking("r1")], { streaming: true, phrases, labels })).toEqual([
      { kind: "live", key: "t1", phrase: labels.live(labels.thinking) },
    ]);
    expect(workLayoutOf([tool("t1", "write_file")], { streaming: true, phrases, labels })).toEqual([
      { kind: "live", key: "t1", phrase: labels.live(labels.stepRunning) },
    ]);
  });

  it("текст между шагами — как обычно, шаги между кусками текста свёрнуты; живая только последняя группа", () => {
    const layout = workLayoutOf(
      [text("Начинаю."), tool("t1", "write_file"), text("Календарь готов, проверяю."), tool("t2", "check_app", "running")],
      { streaming: true, phrases, labels },
    );
    expect(layout).toEqual([
      { kind: "shown", node: "Начинаю." },
      { kind: "done", key: "t1", count: 1, steps: [{ phrase: "Сделал календарь", failed: false }] },
      { kind: "shown", node: "Календарь готов, проверяю." },
      { kind: "live", key: "t2", phrase: "Проверяю приложение…" },
    ]);
  });

  it("пустой текст после шагов (модель только начала писать) живую строку не гасит", () => {
    const layout = workLayoutOf([tool("t1", "check_app", "running"), text("")], { streaming: true, phrases, labels });
    expect(layout).toEqual([{ kind: "live", key: "t1", phrase: "Проверяю приложение…" }, { kind: "shown", node: "" }]);
  });

  it("одинаковые фразы подряд схлопываются с числом повторов «×N»", () => {
    const layout = workLayoutOf(
      [tool("t1", "check_app"), tool("t2", "check_app"), tool("t3", "write_file"), tool("t4", "check_app"), tool("t5", "check_app")],
      { streaming: false, phrases, labels },
    );
    expect(layout).toEqual([
      {
        kind: "done",
        key: "t1",
        count: 5,
        steps: [
          { phrase: "Проверил приложение ×2", failed: false },
          { phrase: "Сделал календарь", failed: false },
          { phrase: "Проверил приложение ×2", failed: false },
        ],
      },
    ]);
  });

  it("одни размышления без шагов после хода не показываются", () => {
    expect(workLayoutOf([thinking("r1"), text("Привет!")], { streaming: false, phrases, labels })).toEqual([{ kind: "shown", node: "Привет!" }]);
  });

  it("шаг с ошибкой (в том числе оборванный «Стопом») — в списке с пометкой", () => {
    const layout = workLayoutOf([tool("t1", "write_file", "error")], { streaming: false, phrases, labels });
    expect(layout).toEqual([{ kind: "done", key: "t1", count: 1, steps: [{ phrase: labels.stepFailed("Делаю календарь"), failed: true }] }]);
  });

  it("вызов, оставшийся «идёт» в законченном ответе («Стоп», обрыв), — «не закончил», с пометкой, без живой строки", () => {
    const layout = workLayoutOf([tool("t1", "write_file", "running")], { streaming: false, phrases, labels });
    expect(layout).toEqual([{ kind: "done", key: "t1", count: 1, steps: [{ phrase: labels.stepUnfinished("Делаю календарь"), failed: true }] }]);
    expect(labels.stepUnfinished("Делаю календарь")).toBe("Делаю календарь — не закончил");
  });

  it("пустой текст между шагами группу не разрывает: одна живая строка, потом одна свёрнутая", () => {
    const entries = [tool("t1", "write_file"), text(""), tool("t2", "check_app", "running")];
    expect(workLayoutOf(entries, { streaming: true, phrases, labels })).toEqual([
      { kind: "live", key: "t1", phrase: "Проверяю приложение…" },
      { kind: "shown", node: "" },
    ]);
    const done = [tool("t1", "write_file"), text(" "), tool("t2", "check_app"), text("Готово")];
    expect(workLayoutOf(done, { streaming: false, phrases, labels })).toEqual([
      {
        kind: "done",
        key: "t1",
        count: 2,
        steps: [
          { phrase: "Сделал календарь", failed: false },
          { phrase: "Проверил приложение", failed: false },
        ],
      },
      { kind: "shown", node: " " },
      { kind: "shown", node: "Готово" },
    ]);
  });

  it("параллельные вызовы: живая строка — фраза шага, который ещё идёт", () => {
    const layout = workLayoutOf([tool("t1", "write_file", "running"), tool("t2", "check_app")], { streaming: true, phrases, labels });
    expect(layout).toEqual([{ kind: "live", key: "t1", phrase: "Делаю календарь…" }]);
  });
});
