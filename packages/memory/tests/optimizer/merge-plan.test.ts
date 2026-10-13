import { describe, expect, it } from "vitest";
import { validateMergePlan } from "../../src/optimizer/merge-plan";
import type { MergePlanCode } from "../../src/optimizer/merge-plan";
import { limits, proposalOf, snapshotNote } from "./support";

// Строгая проверка предложения модели кодом: модель предлагает, код решает.

const ts1 = snapshotNote("a", "Пишет код на TypeScript каждый день", ["О себе", "Работа"], 3);
const ts2 = snapshotNote("b", "Пишет код на TypeScript в компании Acme", ["О себе", "Работа"], 5);
const tea = snapshotNote("c", "Любит зелёный чай без сахара", ["О себе", "Вкусы"]);
const tea2 = snapshotNote("d", "Зелёный чай пьёт без сахара утром", ["О себе", "Вкусы"]);
const snapshot = [ts1, ts2, tea, tea2];

const mergedTs = { sourceIds: ["a", "b"], categories: ["О себе", "Работа"], content: "Пишет код на TypeScript каждый день в компании Acme" };
const mergedTea = { sourceIds: ["c", "d"], categories: ["О себе", "Вкусы"], content: "Любит зелёный чай без сахара, пьёт утром" };

const check = (proposal: unknown, extra: { undone?: string[][]; snapshot?: typeof snapshot } = {}) =>
  validateMergePlan({ snapshot: extra.snapshot ?? snapshot, proposal, limits, ...(extra.undone && { undone: extra.undone }) });

function rejected(proposal: unknown, code: MergePlanCode, extra?: Parameters<typeof check>[1]) {
  const result = check(proposal, extra);
  expect(result).toEqual({ ok: false, code });
}

describe("проверка плана слияния: принимается", () => {
  it("бесспорная склейка: результат с разделами, оригиналы с версиями из снимка", () => {
    expect(check(proposalOf(mergedTs))).toEqual({
      ok: true,
      merges: [
        {
          result: { categories: ["О себе", "Работа"], content: "Пишет код на TypeScript каждый день в компании Acme" },
          originals: [
            { id: "a", version: 3 },
            { id: "b", version: 5 },
          ],
        },
      ],
    });
  });

  it("несколько склеек; пробелы в результате схлопываются", () => {
    const result = check(proposalOf(mergedTs, { ...mergedTea, content: "  Любит зелёный   чай без сахара,\n пьёт утром " }));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.merges).toHaveLength(2);
    expect(result.merges[1]!.result.content).toBe("Любит зелёный чай без сахара, пьёт утром");
  });

  it("пустой список групп — нечего сливать, не ошибка", () => {
    expect(check(proposalOf())).toEqual({ ok: true, merges: [] });
  });

  it("группа из трёх и четырёх записей", () => {
    const three = [snapshotNote("x", "Живёт в Берлине уже шесть лет"), snapshotNote("y", "Живёт в Берлине с семьёй"), snapshotNote("z", "Живёт в Берлине рядом с парком")];
    const merged = { sourceIds: ["x", "y", "z"], categories: ["О себе"], content: "Живёт в Берлине уже шесть лет с семьёй рядом с парком" };
    expect(check(proposalOf(merged), { snapshot: three })).toMatchObject({ ok: true });
  });
});

describe("проверка плана: форма предложения", () => {
  it.each([
    ["не объект", "слить всё"],
    ["нет groups", {}],
    ["groups не список", { groups: "a" }],
    ["одна запись в группе", proposalOf({ ...mergedTs, sourceIds: ["a"] })],
    ["пять записей в группе", proposalOf({ ...mergedTs, sourceIds: ["a", "b", "c", "d", "e"] })],
    ["id не строка", proposalOf({ ...mergedTs, sourceIds: ["a", 2] as never })],
    ["больше десяти групп", proposalOf(...Array.from({ length: 11 }, () => mergedTs))],
    ["пустой текст результата", proposalOf({ ...mergedTs, content: "  " })],
    ["текст длиннее 500 знаков", proposalOf({ ...mergedTs, content: `Пишет код на TypeScript ${"я".repeat(500)}` })],
    ["нет разделов", proposalOf({ ...mergedTs, categories: [] })],
    ["четыре раздела", proposalOf({ ...mergedTs, categories: ["а", "б", "в", "г"] })],
    ["«/» в названии раздела", proposalOf({ ...mergedTs, categories: ["О себе/Работа"] })],
    ["раздел не строка", proposalOf({ ...mergedTs, categories: [1] as never })],
  ])("%s → invalid_form", (_name, proposal) => {
    rejected(proposal, "invalid_form");
  });
});

describe("проверка плана: источники", () => {
  it("id, которого нет в снимке", () => {
    rejected(proposalOf({ ...mergedTs, sourceIds: ["a", "ghost"] }), "unknown_source");
  });

  it("одна запись дважды в группе", () => {
    rejected(proposalOf({ ...mergedTs, sourceIds: ["a", "a"] }), "unknown_source");
  });

  it("одна запись в двух группах", () => {
    rejected(proposalOf(mergedTs, { ...mergedTea, sourceIds: ["b", "c"] }), "unknown_source");
  });

  it("запись из скрытых оригиналов (её нет в снимке) не годится", () => {
    rejected(proposalOf({ ...mergedTs, sourceIds: ["a", "hidden-1"] }), "unknown_source", { snapshot: [ts1, ts2] });
  });
});

describe("проверка плана: результат короче суммы", () => {
  it("равный по длине сумме и длиннее — отказ", () => {
    const sum = ts1.content.length + ts2.content.length;
    rejected(proposalOf({ ...mergedTs, content: `${ts1.content} ${ts2.content}` }), "not_shorter");
    rejected(proposalOf({ ...mergedTs, content: `Пишет код на TypeScript каждый день в компании Acme ${"и".repeat(sum)}`.slice(0, 500) }), "not_shorter");
  });

  it("экономия меньше четырёх знаков — отказ, ровно четыре — можно", () => {
    const sum = ts1.content.length + ts2.content.length; // 35 + 38
    const pad = (length: number) => `Пишет код на TypeScript каждый день в компании Acme ${"и".repeat(length)}`.trim();
    const base = "Пишет код на TypeScript каждый день в компании Acme ".length;
    rejected(proposalOf({ ...mergedTs, content: pad(sum - 3 - base) }), "not_shorter");
    expect(check(proposalOf({ ...mergedTs, content: pad(sum - 4 - base) }))).toMatchObject({ ok: true });
  });
});

describe("проверка плана: общие слова", () => {
  it("у записей нет общих слов — несвязанная группа", () => {
    const stranger = snapshotNote("s", "Живёт в Берлине");
    const other = snapshotNote("t", "Любит горные лыжи");
    rejected(
      proposalOf({ sourceIds: ["s", "t"], categories: ["О себе"], content: "Живёт в Берлине, катается" }),
      "unrelated_group",
      { snapshot: [stranger, other] },
    );
  });

  it("слова короче четырёх знаков общими не считаются", () => {
    const one = snapshotNote("s", "Пьёт чай утром бодро");
    const two = snapshotNote("t", "Ест сыр вечером спокойно");
    rejected(
      proposalOf({ sourceIds: ["s", "t"], categories: ["О себе"], content: "Пьёт чай, ест сыр" }),
      "unrelated_group",
      { snapshot: [one, two] },
    );
  });

  it("результат не содержит ни одного слова одной из записей", () => {
    rejected(proposalOf({ ...mergedTs, content: "Программирует ежедневно" }), "unrelated_group");
  });
});

describe("проверка плана: числа, ссылки, почты и имена не теряются", () => {
  const pair = (first: string, second: string) => [snapshotNote("p", first), snapshotNote("q", second)];
  const merge = (content: string) => proposalOf({ sourceIds: ["p", "q"], categories: ["О себе"], content });

  it("число потеряно", () => {
    rejected(merge("Живёт в Берлине уже давно с семьёй"), "lost_detail", { snapshot: pair("Живёт в Берлине уже 6 лет", "Живёт в Берлине с семьёй в квартире") });
  });

  it("число сохранено — можно", () => {
    expect(check(merge("Живёт в Берлине 6 лет с семьёй"), { snapshot: pair("Живёт в Берлине уже 6 лет подряд", "Живёт в Берлине с семьёй в квартире") })).toMatchObject({ ok: true });
  });

  it("ссылка потеряна; знак после ссылки ссылкой не считается", () => {
    const notes = pair("Ведёт блог о путешествиях: https://example.com/blog.", "Блог о путешествиях ведёт много лет подряд");
    rejected(merge("Ведёт блог о путешествиях много лет"), "lost_detail", { snapshot: notes });
    expect(check(merge("Ведёт блог о путешествиях много лет: https://example.com/blog"), { snapshot: notes })).toMatchObject({ ok: true });
  });

  it("почта потеряна", () => {
    rejected(merge("Пишите по рабочим вопросам в любое время"), "lost_detail", {
      snapshot: pair("Пишите по рабочим вопросам: anna@example.com", "Пишите по рабочим вопросам в любое время суток"),
    });
  });

  it("имя (заглавное слово не в начале) потеряно; в начале записи не считается именем", () => {
    const notes = pair("Сестра зовут Мария, живёт рядом", "Сестра живёт рядом с парком");
    rejected(merge("Сестра живёт рядом с парком"), "lost_detail", { snapshot: notes });
    expect(check(merge("Сестра Мария живёт рядом с парком"), { snapshot: notes })).toMatchObject({ ok: true });
    // «Сестра» в начале — не имя: результат без заглавной буквы принимается.
    expect(check(merge("сестра Мария живёт рядом с парком"), { snapshot: notes })).toMatchObject({ ok: true });
  });

  it("латинское название с заглавной буквы (не в начале) потеряно", () => {
    rejected(merge("Пишет код каждый день в компании"), "lost_detail", {
      snapshot: pair("Пишет код каждый день на Rust", "Пишет код каждый день в компании"),
    });
  });

  it("упоминание (@имя) потеряно", () => {
    rejected(merge("Ведёт канал про путешествия"), "lost_detail", {
      snapshot: pair("Ведёт канал про путешествия @travelanna", "Ведёт канал про путешествия по Азии"),
    });
  });
});

describe("проверка плана: отрицание не теряется", () => {
  const pair = (first: string, second: string) => [snapshotNote("p", first), snapshotNote("q", second)];
  const merge = (content: string) => proposalOf({ sourceIds: ["p", "q"], categories: ["О себе"], content });

  it("«Не любит кофе» и «Любит кофе» не склеиваются в «Любит кофе»", () => {
    rejected(merge("Любит кофе по утрам"), "lost_detail", { snapshot: pair("Не любит кофе по утрам", "Любит кофе по утрам за завтраком") });
  });

  it.each([
    ["нет", "Нет времени пить кофе по утрам", "Пьёт кофе по утрам за завтраком"],
    ["без", "Пьёт кофе по утрам без сахара", "Пьёт кофе по утрам за завтраком"],
    ["никогда", "Никогда не пьёт кофе по утрам", "Пьёт кофе по утрам за завтраком"],
    ["ни", "Ни чай, ни кофе по утрам не пьёт", "Пьёт кофе по утрам за завтраком"],
  ])("слово «%s» в оригинале, а в результате отрицания нет — lost_detail", (_word, first, second) => {
    rejected(merge("Пьёт кофе по утрам"), "lost_detail", { snapshot: pair(first, second) });
  });

  it("отрицание может стоять в любом из оригиналов", () => {
    rejected(merge("Любит кофе по утрам"), "lost_detail", { snapshot: pair("Любит кофе по утрам за завтраком", "Не любит кофе по утрам") });
  });

  it("отрицание сохранено в результате — можно", () => {
    expect(check(merge("Не любит кофе по утрам"), { snapshot: pair("Не любит кофе по утрам никогда", "Не любит кофе по утрам за завтраком дома") })).toMatchObject({ ok: true });
  });

  it("слово только начинается с «не»/«ни» (неделя, низко) — это не отрицание", () => {
    expect(check(merge("Пьёт кофе по утрам"), { snapshot: pair("Пьёт кофе по утрам каждую неделю подряд", "Пьёт кофе по утрам низко склонившись над чашкой") })).toMatchObject({ ok: true });
  });

  it("отрицания нет ни в оригиналах, ни в результате — как раньше", () => {
    expect(check(proposalOf(mergedTs))).toMatchObject({ ok: true });
  });
});

describe("проверка плана: результат не дублирует другую запись", () => {
  it("совпадает с записью, что остаётся", () => {
    const keep = snapshotNote("k", "Пишет код на TypeScript каждый день в компании Acme", ["О себе", "Работа"]);
    rejected(proposalOf(mergedTs), "duplicate_result", { snapshot: [ts1, ts2, keep] });
  });

  it("два результата одинаковы между собой", () => {
    const same = snapshotNote("e", "Пишет код на TypeScript каждый день", ["О себе", "Работа"]);
    const same2 = snapshotNote("f", "Пишет код на TypeScript в компании Acme", ["О себе", "Работа"]);
    rejected(proposalOf(mergedTs, { ...mergedTs, sourceIds: ["e", "f"] }), "duplicate_result", { snapshot: [ts1, ts2, same, same2] });
  });

  it("совпадает с одним из своих оригиналов — это обычное слияние, ошибки нет", () => {
    const long = snapshotNote("l", "Пишет код на TypeScript каждый день в компании Acme, а ещё много и охотно");
    const short = snapshotNote("m", "Пишет код на TypeScript каждый день в компании Acme");
    expect(check(proposalOf({ sourceIds: ["l", "m"], categories: ["О себе"], content: "Пишет код на TypeScript каждый день в компании Acme" }), { snapshot: [long, short] })).toMatchObject({ ok: true });
  });
});

describe("проверка плана: предел объёма", () => {
  it("после слияния память не должна выходить за предел знаков", () => {
    const result = validateMergePlan({ snapshot, proposal: proposalOf(mergedTs), limits: { ...limits, maxTotalChars: 100 } });
    expect(result).toEqual({ ok: false, code: "too_large" });
  });
});

describe("проверка плана: отменённое не предлагается снова", () => {
  it("группа, где две и больше записи из отменённой, пропускается; остальные принимаются", () => {
    const result = check(proposalOf(mergedTs, mergedTea), { undone: [["a", "b"]] });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.merges.map((merge) => merge.originals.map((original) => original.id))).toEqual([["c", "d"]]);
  });

  it("группа шире отменённой тоже пропускается; одна общая запись — нет", () => {
    const wider = { sourceIds: ["a", "b", "c"], categories: ["О себе"], content: "Пишет код на TypeScript" };
    expect(check(proposalOf(wider), { undone: [["a", "b"]] })).toEqual({ ok: true, merges: [] });
    const touching = { sourceIds: ["b", "c"], categories: ["О себе"], content: "Зелёный чай" };
    // Одна общая запись — не то же слияние: доходит до обычной проверки (здесь она отказывает по общим словам).
    expect(check(proposalOf(touching), { undone: [["a", "b"]] })).toEqual({ ok: false, code: "unrelated_group" });
  });

  it("но неверный id в пропущенной группе всё равно отказ", () => {
    rejected(proposalOf({ ...mergedTs, sourceIds: ["a", "ghost"] }), "unknown_source", { undone: [["a", "ghost"]] });
  });
});

describe("проверка плана: одна плохая группа отменяет весь план", () => {
  it("хорошая группа не применяется, если вторая плоха", () => {
    rejected(proposalOf(mergedTs, { ...mergedTea, content: `${tea.content} ${tea2.content}` }), "not_shorter");
  });
});
