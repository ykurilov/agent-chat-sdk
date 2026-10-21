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
    expect(layout).toMatchObject([
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
    expect(layout).toMatchObject([{ kind: "live", key: "r1", phrase: "Смотрю на телефоне…" }]);
  });

  it("живая строка: модель думает — «Думаю…», шаг закончился, следующего нет — общая фраза", () => {
    expect(workLayoutOf([tool("t1", "write_file"), thinking("r1")], { streaming: true, phrases, labels })).toMatchObject([
      { kind: "live", key: "t1", phrase: labels.live(labels.thinking) },
    ]);
    expect(workLayoutOf([tool("t1", "write_file")], { streaming: true, phrases, labels })).toMatchObject([
      { kind: "live", key: "t1", phrase: labels.live(labels.stepRunning) },
    ]);
  });

  it("текст между шагами — как обычно, шаги между кусками текста свёрнуты; живая только последняя группа", () => {
    const layout = workLayoutOf(
      [text("Начинаю."), tool("t1", "write_file"), text("Календарь готов, проверяю."), tool("t2", "check_app", "running")],
      { streaming: true, phrases, labels },
    );
    expect(layout).toMatchObject([
      { kind: "shown", node: "Начинаю." },
      { kind: "done", key: "t1", count: 1, steps: [{ phrase: "Сделал календарь", failed: false }] },
      { kind: "shown", node: "Календарь готов, проверяю." },
      { kind: "live", key: "t2", phrase: "Проверяю приложение…" },
    ]);
  });

  it("пустой текст после шагов (модель только начала писать) живую строку не гасит", () => {
    const layout = workLayoutOf([tool("t1", "check_app", "running"), text("")], { streaming: true, phrases, labels });
    expect(layout).toMatchObject([{ kind: "live", key: "t1", phrase: "Проверяю приложение…" }, { kind: "shown", node: "" }]);
  });

  it("одинаковые фразы подряд схлопываются с числом повторов «×N»", () => {
    const layout = workLayoutOf(
      [tool("t1", "check_app"), tool("t2", "check_app"), tool("t3", "write_file"), tool("t4", "check_app"), tool("t5", "check_app")],
      { streaming: false, phrases, labels },
    );
    expect(layout).toMatchObject([
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
    expect(workLayoutOf([thinking("r1"), text("Привет!")], { streaming: false, phrases, labels })).toMatchObject([{ kind: "shown", node: "Привет!" }]);
  });

  it("шаг с ошибкой (в том числе оборванный «Стопом») — в списке с пометкой", () => {
    const layout = workLayoutOf([tool("t1", "write_file", "error")], { streaming: false, phrases, labels });
    expect(layout).toMatchObject([{ kind: "done", key: "t1", count: 1, steps: [{ phrase: labels.stepFailed("Делаю календарь"), failed: true }] }]);
  });

  it("вызов, оставшийся «идёт» в законченном ответе («Стоп», обрыв), — «не закончил», с пометкой, без живой строки", () => {
    const layout = workLayoutOf([tool("t1", "write_file", "running")], { streaming: false, phrases, labels });
    expect(layout).toMatchObject([{ kind: "done", key: "t1", count: 1, steps: [{ phrase: labels.stepUnfinished("Делаю календарь"), failed: true }] }]);
    expect(labels.stepUnfinished("Делаю календарь")).toBe("Делаю календарь — не закончил");
  });

  it("пустой текст между шагами группу не разрывает: одна живая строка, потом одна свёрнутая", () => {
    const entries = [tool("t1", "write_file"), text(""), tool("t2", "check_app", "running")];
    expect(workLayoutOf(entries, { streaming: true, phrases, labels })).toMatchObject([
      { kind: "live", key: "t1", phrase: "Проверяю приложение…" },
      { kind: "shown", node: "" },
    ]);
    const done = [tool("t1", "write_file"), text(" "), tool("t2", "check_app"), text("Готово")];
    expect(workLayoutOf(done, { streaming: false, phrases, labels })).toMatchObject([
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
    expect(layout).toMatchObject([{ kind: "live", key: "t1", phrase: "Делаю календарь…" }]);
  });
});

describe("workLayoutOf: значки шагов и заголовки раздумий (договор 28)", () => {
  const titled = (key: string, title?: string, durationMs: number | null = 3000): AnswerEntry<string> => ({
    kind: "step",
    key,
    step: { kind: "thinking", ...(title !== undefined && { title }), durationMs },
  });
  const iconPhrases: StepPhrases = { ...phrases, write_file: { running: "Правлю src/rules.ts", done: "Правил src/rules.ts", icon: "edit" } };

  it("свёрнутая группа: ряд значков по шагу и список «значок + фраза», раздумье — заголовком", () => {
    const [done] = workLayoutOf([titled("r1", "Продумываю правила игры"), tool("t1", "write_file"), titled("r2", undefined, 4000), tool("t2", "use_skill"), text("Готово")], {
      streaming: false,
      phrases: iconPhrases,
      labels,
      thoughts: true,
    });
    expect(done).toMatchObject({
      kind: "done",
      count: 2,
      icons: ["thinking", "edit", "thinking", "skill"],
      moreIcons: 0,
      items: [
        { icon: "thinking", phrase: "Продумываю правила игры", failed: false },
        { icon: "edit", phrase: "Правил src/rules.ts", failed: false },
        { icon: "thinking", phrase: labels.thought(4000), failed: false },
        { icon: "skill", phrase: labels.stepDone, failed: false },
      ],
    });
    // Прежний список для скинов 23–27 — только вызовы.
    expect((done as { steps: unknown[] }).steps).toHaveLength(2);
  });

  it("без заголовков у ответа (thoughts: false) раздумий в списке и ряду нет, как до 0.69", () => {
    const [done] = workLayoutOf([titled("r1", undefined), tool("t1", "write_file")], { streaming: false, phrases: iconPhrases, labels });
    expect(done).toMatchObject({ icons: ["edit"], items: [{ icon: "edit", phrase: "Правил src/rules.ts", failed: false }] });
  });

  it("длинный ряд — первые 8 значков и сколько скрыто", () => {
    const entries = Array.from({ length: 11 }, (_, index) => tool(`t${index}`, "write_file"));
    const [done] = workLayoutOf(entries, { streaming: false, phrases: iconPhrases, labels });
    expect(done).toMatchObject({ icons: Array(8).fill("edit"), moreIcons: 3 });
    // Одинаковые подряд в списке схлопнуты, в ряду — нет.
    expect((done as { items: unknown[] }).items).toEqual([{ icon: "edit", phrase: labels.stepRepeated("Правил src/rules.ts", 11), failed: false }]);
  });

  it("живая строка со значком; раздумье с заголовком — заголовок, без — «Думаю…»", () => {
    expect(workLayoutOf([tool("t1", "write_file", "running")], { streaming: true, phrases: iconPhrases, labels })).toEqual([
      { kind: "live", key: "t1", phrase: "Правлю src/rules.ts…", icon: "edit" },
    ]);
    expect(workLayoutOf([titled("r1", undefined, null)], { streaming: true, phrases, labels })).toEqual([
      { kind: "live", key: "r1", phrase: labels.live(labels.thinking), icon: "thinking" },
    ]);
    expect(workLayoutOf([titled("r1", "Выбираю цвета")], { streaming: true, phrases, labels })).toEqual([
      { kind: "live", key: "r1", phrase: "Выбираю цвета…", icon: "thinking" },
    ]);
  });

  it("подписи раздумья без заголовка: «Думал 4 сек», без времени — «Подумал»", () => {
    expect(labels.thought(4000)).toBe("Думал 4 сек");
    expect(labels.thought(null)).toBe("Подумал");
    expect(labels.moreSteps(3)).toBe("+3");
  });
});

describe("workLayoutOf: прежний список для скинов 23–27", () => {
  it("одинаковые вызовы через раздумье по-прежнему схлопываются в «×N»", () => {
    const [done] = workLayoutOf([tool("t1", "write_file"), thinking("r1"), tool("t2", "write_file")], { streaming: false, phrases, labels });
    expect((done as { steps: unknown }).steps).toEqual([{ phrase: labels.stepRepeated("Сделал календарь", 2), failed: false }]);
  });
});
