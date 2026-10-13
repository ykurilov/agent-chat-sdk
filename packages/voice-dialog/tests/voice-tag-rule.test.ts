import { splitVoiceTags as coreSplit, stripVoiceTags as coreStrip } from "@ykurilov/agent-chat-core";
import { splitVoiceTags as reactSplit, stripVoiceTags as reactStrip } from "@ykurilov/agent-chat-react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * Правило «что такое тег голоса» живёт в двух копиях: в ядре (сервер: поиск по истории) и в экране
 * (браузер: показ, копирование). Ядро браузеру не нужно, экран ядра не знает, поэтому копии держит в согласии
 * этот тест: тела файлов совпадают буква в букву, а широкий набор строк (таблицы ниже и случайные склейки)
 * прогоняется через обе.
 */
const implementations = [
  ["ядро", coreStrip, coreSplit],
  ["экран", reactStrip, reactSplit],
] as const;

const STRIPPED: Array<[name: string, source: string, expected: string]> = [
  ["тег посреди фразы", "Привет [laughs] мир", "Привет мир"],
  ["тег в начале", "[sighs] Ладно.", "Ладно."],
  ["тег перед знаком препинания", "Ну вот [sighs].", "Ну вот."],
  ["тег в конце текста", "Ну вот [sighs]", "Ну вот"],
  ["несколько тегов", "Так [whispers] тихо [laughs harder] смех", "Так тихо смех"],
  ["теги подряд", "[sighs] [softly] Ладно.", "Ладно."],
  ["описательный тег с запятой", "[warm, quiet voice] Здравствуй", "Здравствуй"],
  ["описательный тег с дефисом", "[high-pitched] ну да", "ну да"],
  ["тег после знака конца предложения", "Ура! [laughs] Получилось.", "Ура! Получилось."],
  ["тег одиночкой", "[sighs]", ""],
  ["тег одиночкой на своей строке", "Первая\n[sighs]\nВторая", "Первая\nВторая"],
  ["тег одиночкой на последней строке", "Первая\n[sighs]", "Первая"],
  ["тег у начала строки со словами", "Первая\n[whispers] Вторая", "Первая\nВторая"],
  ["тег в скобках русской фразы", "Да ([laughs] правда)", "Да (правда)"],
  ["тег в курсиве", "Это *[laughs] смешно*", "Это *смешно*"],
  ["тег в списке", "- [laughs] Один\n- Два", "- Один\n- Два"],
  ["обычный текст без правок", "Просто текст. Ещё один.\n\nАбзац.", "Просто текст. Ещё один.\n\nАбзац."],
  ["курсив вокруг тега", "*[laughs]* ну", "ну"],
  ["подчёркивание вокруг тега", "_[laughs]_ ну", "ну"],
  ["жирный вокруг тега", "**[laughs]** ну", "ну"],
  ["курсив вокруг тега в конце", "Ну вот *[sighs]*", "Ну вот"],
  ["тег с заглавной", "[Laughs] ну", "ну"],
  ["слово с заглавной внутри", "Тут [Warm, quiet voice] тихо", "Тут тихо"],
  ["парный закрывающий тег", "[whispers] тише [/whispers] ну", "тише ну"],
  ["тег одиночкой при переводах CRLF", "Первая\r\n[sighs]\r\nВторая", "Первая\r\nВторая"],
  ["тег в конце строки при CRLF", "Ну вот [sighs]\r\nДа", "Ну вот\r\nДа"],
  ["тег в начале при CRLF", "[laughs]\r\nпривет", "привет"],
  ["тег вплотную к слову слева", "ну[sighs] ещё", "ну ещё"],
  ["тег вплотную с двух сторон", "ну[sighs]ещё", "ну ещё"],
  ["тег вплотную к слову справа", "Ну [sighs]ещё", "Ну ещё"],
];

const KEPT: Array<[name: string, source: string]> = [
  ["сноска-число", "Так сказано [1] и [12]."],
  ["[sic]", "Он написал «тоесть» [sic] в письме."],
  ["чекбокс пустой", "- [ ] сделать"],
  ["чекбокс отмеченный", "- [x] сделано\n- [X] тоже"],
  ["одна буква", "Пункт [a] и пункт [b]."],
  ["заглавные буквы", "Смотри [TODO] и [WIP]."],
  ["кириллица в скобках", "Скобки [смеётся] русские."],
  ["ссылка Markdown", "Читай [laughs](https://example.com/a) тут."],
  ["ссылка-сноска Markdown", "Смотри [laughs][ref] тут."],
  ["определение ссылки", "[ref]: https://example.com"],
  ["индекс из одной буквы", "Берём arr[i] и dict[k]."],
  ["строчный код", "Напиши `[laughs]` как есть."],
  ["блок кода", "Пример:\n```\n[laughs]\nx = [sighs]\n```\nГотово."],
  ["блок кода с тильдами", "~~~\n[laughs]\n~~~"],
  ["незакрытая скобка", "Скобка [laughs без конца."],
  ["слишком длинное", "[this is a very long bracket text that is far too long to be a voice tag]"],
  ["слишком много слов", "[one two three four five six seven eight]"],
  ["цифры внутри", "[laughs 2] и [take 5]"],
  ["знаки внутри", "[laughs!] и [what?]"],
  ["пустые скобки", "Пусто [] тут"],
  ["многоточие в скобках", "Пропуск [...] тут"],
  ["короткое слово «ok»", "Сказал [ok] и ушёл."],
];

describe.each(implementations)("правило тега голоса: %s", (_name, strip, split) => {
  it.each(STRIPPED)("вырезает: %s", (_case, source, expected) => {
    expect(strip(source)).toBe(expected);
  });

  it.each(KEPT)("не трогает: %s", (_case, source) => {
    expect(strip(source)).toBe(source);
  });

  it("недописанный тег в конце вырезается только по просьбе (поток)", () => {
    expect(strip("Привет [laug")).toBe("Привет [laug");
    expect(strip("Привет [laug", { partialTail: true })).toBe("Привет");
    expect(strip("Привет [", { partialTail: true })).toBe("Привет");
    expect(strip("Привет [1", { partialTail: true })).toBe("Привет [1");
    expect(strip("Привет [laughs] ещё [wh", { partialTail: true })).toBe("Привет ещё");
  });

  it("недописанный тег внутри кода остаётся", () => {
    expect(strip("```\n[laug", { partialTail: true })).toBe("```\n[laug");
  });

  it("сообщает, какие теги были и где они стояли в тексте без них", () => {
    expect(split("Привет [laughs] мир [Sighs] да [sighs].")).toEqual({
      plain: "Привет мир да.",
      tags: [
        { at: 7, name: "laughs" },
        { at: 11, name: "sighs" },
        { at: 13, name: "sighs" },
      ],
    });
    expect(split("[warm,   quiet voice] Здравствуй").tags).toEqual([{ at: 0, name: "warm, quiet voice" }]);
    expect(split("Без тегов").tags).toEqual([]);
  });
});

const CORPUS_PIECES = [
  "Привет", "ну", "да.", "Ладно,", "[laughs]", "[sighs]", "[Laughs]", "[whispers]", "[/whispers]", "[warm, quiet voice]", "*[laughs]*", "_[sighs]_",
  "**[excited]**", "[1]", "[sic]", "[x]", "[ ]", "[docs](http://x)", "[ref]: http://x", "`[laughs]`", "arr[index]", "слово[laughs]", "[laughs]слово",
  "[TODO]", "[Google]", "[ laughs ]", "[laughs.]", "[laug", "[", "]", "\n", "\r\n", "\n\n", "```\n[sighs]\n```", "- ", "> ", "# ", "*", "_", "~~",
];

function corpus(count: number): string[] {
  let seed = 20260101;
  const next = (limit: number) => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed % limit;
  };
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + next(7) }, () => CORPUS_PIECES[next(CORPUS_PIECES.length)]! + (next(3) === 0 ? "" : " ")).join(""),
  );
}

describe("копии правила согласованы", () => {
  it("тела файлов совпадают буква в букву (отличается только пояснение в шапке)", () => {
    const body = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/^\/\*[\s\S]*?\*\//, "");
    expect(body("../../react/src/voice-tags.ts")).toBe(body("../../core/src/voice-tags.ts"));
  });

  it("ядро и экран отвечают одинаково на таблицы и на тысячу случайных склеек", () => {
    const sources = [...STRIPPED, ...KEPT].map(([, source]) => source).concat(corpus(1000));
    for (const source of sources) {
      for (const options of [undefined, { partialTail: true }]) {
        expect(reactSplit(source, options), JSON.stringify(source)).toEqual(coreSplit(source, options));
      }
    }
  });
});
