import { describe, expect, it } from "vitest";
import { stripVoiceTags } from "@ykurilov/agent-chat-react";
import { createSpokenText, sourcePositionAtSpoken } from "../src/browser/spoken-text";
import type { SpokenSentence, SpokenTextOptions } from "../src/browser/spoken-text";

function speak(source: string, options?: SpokenTextOptions, cuts: number[] = []): SpokenSentence[] {
  const spoken = createSpokenText(options);
  const out: SpokenSentence[] = [];
  let from = 0;
  for (const cut of [...cuts, source.length]) {
    out.push(...spoken.push(source.slice(from, cut)));
    from = cut;
  }
  out.push(...spoken.finish());
  return out;
}

const texts = (sentences: SpokenSentence[]) => sentences.map((s) => s.text);

const TWELVE = "Один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать";

const SAMPLES: Array<[name: string, source: string, expected: string[]]> = [
  ["обычный текст", "Привет. Как дела?", ["Привет.", "Как дела?"]],
  ["восклицание и многоточие", "Ура! Получилось… Дальше", ["Ура!", "Получилось…", "Дальше"]],
  ["перевод строки заканчивает предложение", "Первая строка\nВторая строка", ["Первая строка", "Вторая строка"]],
  ["перевод строки Windows", "Раз.\r\nДва.", ["Раз.", "Два."]],
  ["сокращение «т. е.» не режет", "Это, т. е. пример, работает. Дальше.", ["Это, т. е. пример, работает.", "Дальше."]],
  ["число 3.14 не режет", "Число пи равно 3.14 примерно. Хорошо.", ["Число пи равно 3.14 примерно.", "Хорошо."]],
  ["«стр. 5» не режет", "Смотри стр. 5 в книге. Готово.", ["Смотри стр. 5 в книге.", "Готово."]],
  ["инициалы не режут", "Писал А. С. Пушкин давно. Да.", ["Писал А. С. Пушкин давно.", "Да."]],
  ["блок кода", "Вот код:\n```js\nconst a = 1;\nconst b = 2;\n```\nГотово.", ["Вот код:", "код на экране", "Готово."]],
  ["блок кода без языка и с точками внутри", "Так.\n```\nx. y. z.\n```\nВсё.", ["Так.", "код на экране", "Всё."]],
  ["только код", "```py\nprint(1)\n```", ["код на экране"]],
  ["недописанное закрытие блока кода", "Смотри.\n```py\nprint(1)\nprint(2)", ["Смотри.", "код на экране"]],
  ["два блока кода — два раза", "А.\n```\nx\n```\nБ.\n```\ny\n```\nВ.", ["А.", "код на экране", "Б.", "код на экране", "В."]],
  ["блок кода с тильдами", "~~~\ncode\n~~~\nТекст.", ["код на экране", "Текст."]],
  ["схема mermaid — «схема на экране», исходник не читается", "Вот так:\n```mermaid\ngraph TD\nA-->B\n```\nГотово.", ["Вот так:", "схема на экране", "Готово."]],
  ["схема mermaid с заглавными и тильдами", "~~~ Mermaid\nA-->B\n~~~", ["схема на экране"]],
  ["недописанная схема", "Смотри.\n```mermaid\ngraph TD\nA-->", ["Смотри.", "схема на экране"]],
  ["таблица", "Итог:\n| а | б |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\nКонец.", ["Итог:", "таблица на экране", "Конец."]],
  ["две таблицы — два раза", "| а |\n|---|\n| 1 |\n\nТекст.\n\n| б |\n|---|\n| 2 |", ["таблица на экране", "Текст.", "таблица на экране"]],
  ["таблица и код рядом", "| а |\n|---|\n| 1 |\n```\nx\n```", ["таблица на экране", "код на экране"]],
  ["маркированный список", "- Один\n- Два\n- Три", ["Один", "Два", "Три"]],
  ["список со звёздочками", "* Один\n* Два", ["Один", "Два"]],
  ["нумерованный список", "1. Раз\n2. Два\n3) Три", ["Раз", "Два", "Три"]],
  ["заголовки", "# Заголовок\n## Второй\nТекст.", ["Заголовок", "Второй", "Текст."]],
  ["жирный и курсив", "Это **важно** и *очень* тут.", ["Это важно и очень тут."]],
  ["курсив в начале строки — не список", "*Курсив* текст.", ["Курсив текст."]],
  ["подчёркивания внутри слов остаются", "Файл snake_case_name тут.", ["Файл snake_case_name тут."]],
  ["строчный код без кавычек", "Вызови `npm install` сейчас.", ["Вызови npm install сейчас."]],
  ["точка внутри строчного кода не режет", "Файл `a.b. c` есть.", ["Файл a.b. c есть."]],
  ["ссылка — подпись", "Смотри [документацию](https://example.com/docs) тут.", ["Смотри документацию тут."]],
  ["точка в подписи ссылки не режет", "[Привет. Мир](http://x.com) конец.", ["Привет. Мир конец."]],
  ["голый адрес не читается", "Адрес https://example.com/a?b=1 здесь.", ["Адрес здесь."]],
  ["изображение с подписью", "![Схема](a.png)", ["Схема"]],
  ["изображение без подписи", "![](a.png)", []],
  ["цитата", "> Цитата тут.", ["Цитата тут."]],
  ["горизонтальная черта", "Текст.\n---\nЕщё.", ["Текст.", "Ещё."]],
  ["лишние пробелы и пустые строки", "\n\n  Привет   мир.  \n\n", ["Привет мир."]],
  ["пусто", "", []],
  ["одна разметка", "**", []],
  [
    "первое предложение режется по запятой после 12 слов",
    `${TWELVE}, тринадцать четырнадцать.`,
    [`${TWELVE},`, "тринадцать четырнадцать."],
  ],
  ["первое предложение режется по тире после 12 слов", `${TWELVE} — тринадцать четырнадцать.`, [TWELVE, "тринадцать четырнадцать."]],
  ["запятая раньше 12 слов не режет", "Раз, два, три четыре пять.", ["Раз, два, три четыре пять."]],
  [
    "режется только первое предложение",
    `Коротко. ${TWELVE}, тринадцать четырнадцать.`,
    ["Коротко.", `${TWELVE}, тринадцать четырнадцать.`],
  ],
  // Теги голоса идут в озвучку как есть, но никогда не становятся отдельным «предложением».
  ["тег в начале предложения", "[laughs] Привет. Как дела?", ["[laughs] Привет.", "Как дела?"]],
  ["тег внутри предложения", "Ну [sighs] ладно. Дальше.", ["Ну [sighs] ладно.", "Дальше."]],
  ["тег после конца предложения прилипает к следующему", "Ура! [laughs] Получилось.", ["Ура!", "[laughs] Получилось."]],
  ["тег одиночкой на своей строке прилипает к следующему тексту", "Привет.\n[sighs]\nЛадно.", ["Привет.", "[sighs] Ладно."]],
  ["тег с точкой после него", "[sighs]. Ладно.", ["[sighs]. Ладно."]],
  ["теги на отдельных строках склеиваются со следующим текстом", "[sighs]\n[softly]\nЛадно.", ["[sighs] [softly] Ладно."]],
  ["тег в конце ответа клеится к последнему предложению: смех в конце звучит", "Привет! [laughs]", ["Привет! [laughs]"]],
  ["тег в конце ответа и перевод строки после него", "Да. [laughs]\n", ["Да. [laughs]"]],
  ["несколько тегов в конце ответа", "Да. [laughs] [sighs]", ["Да. [laughs] [sighs]"]],
  ["тег в конце строки, а текст дальше — тег идёт к следующему тексту", "Да. [laughs]\nВторая строка.", ["Да.", "[laughs] Вторая строка."]],
  ["тег в конце ответа после длинного предложения", "Сначала одно. Потом второе длинное предложение, да. [whispers]", ["Сначала одно.", "Потом второе длинное предложение, да. [whispers]"]],
  ["тег в конце ответа без точки у предложения", "Ну ладно [sighs]", ["Ну ладно [sighs]"]],
  ["закрывающий тег в конце ответа", "[whispers] Тише. [/whispers]", ["[whispers] Тише. [/whispers]"]],
  ["только тег", "[sighs]", []],
  ["описательный тег", "[warm, quiet voice] Добрый вечер.", ["[warm, quiet voice] Добрый вечер."]],
  ["тег в пункте списка", "- [laughs] Один\n- Два", ["[laughs] Один", "Два"]],
  ["тег в курсиве", "*[whispers] тихо* и дальше.", ["[whispers] тихо и дальше."]],
  ["разметка и тег вместе", "**Да** [laughs] [точно](http://x.com) так.", ["Да [laughs] точно так."]],
  ["сноска [1] — не тег, остаётся словом предложения", "Так [1] сказано.", ["Так [1] сказано."]],
  ["ссылка с латиницей не ломается тегом", "Смотри [docs](http://x.com) тут.", ["Смотри docs тут."]],
];

describe("говоримый текст: образцы", () => {
  it("набор образцов не меньше 30", () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(30);
  });

  it("ни одно предложение не состоит из одних тегов: такое озвучка отвергает (input_text_empty)", () => {
    for (const [name, source] of SAMPLES) {
      for (const sentence of speak(source)) {
        expect(/[\p{L}\p{N}]/u.test(stripVoiceTags(sentence.text)), `${name}: «${sentence.text}»`).toBe(true);
      }
    }
  });

  it.each(SAMPLES)("%s", (_name, source, expected) => {
    expect(texts(speak(source))).toEqual(expected);
  });

  describe("разрез на куски не меняет результат", () => {
    it.each(SAMPLES)("%s", (_name, source) => {
      const whole = speak(source);
      for (let cut = 1; cut < source.length; cut++) {
        expect(speak(source, undefined, [cut]), `разрез на ${cut}`).toEqual(whole);
      }
      const charByChar = speak(source, undefined, [...Array(source.length).keys()].slice(1));
      expect(charByChar).toEqual(whole);
    });
  });

  it("случайные куски на текстах с тегами в разных местах не меняют результат", () => {
    const sources = [
      "Ну вот [laughs] и всё. [whispers] Тише.\nВторая строка [sighs]\nТретья.",
      "Привет!\n[sighs]\nКак дела?",
      "Да. [laughs]\n",
      "[laughs] [sighs]",
      "Первое. [warm, quiet voice] Второе предложение здесь, да.",
      "Смотри [1] и [sic]. Потом [laughs harder] ха. [sighs]",
      "Один два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать, [excited] тринадцать четырнадцать. [laughs]",
      "[sighs]\n\n[laughs]\nПривет.",
      "Текст [whispers]\n\nАбзац два. [/whispers]",
      "- [laughs] пункт\n- [sighs] второй [laughs]",
      "*[laughs]* ну. _[sighs]_",
    ];
    let seed = 7;
    const next = (limit: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed % limit;
    };
    for (const source of sources) {
      const whole = speak(source);
      for (let attempt = 0; attempt < 300; attempt++) {
        const cuts = [...new Set(Array.from({ length: 1 + next(6) }, () => 1 + next(source.length - 1)))].sort((a, b) => a - b);
        expect(speak(source, undefined, cuts), `${JSON.stringify(source)} / ${cuts}`).toEqual(whole);
      }
    }
  });

  it("разрез сразу в нескольких местах (три куска) тоже не меняет результат", () => {
    const source = "Вот код:\n```js\nconst a = 1;\n```\nГотово. Ещё **раз**.\n| а |\n|---|\n| 1 |\n";
    const whole = speak(source);
    for (let first = 1; first < source.length; first += 3) {
      for (let second = first + 1; second < source.length; second += 4) {
        expect(speak(source, undefined, [first, second])).toEqual(whole);
      }
    }
  });
});

describe("говоримый текст: выдача по мере прихода", () => {
  it("конец предложения без следующего символа ждёт: «3.14» может продолжиться", () => {
    const spoken = createSpokenText();
    expect(spoken.push("Привет.")).toEqual([]);
    expect(texts(spoken.push(" Как"))).toEqual(["Привет."]);
    expect(texts(spoken.finish())).toEqual(["Как"]);
  });

  it("повторный finish ничего не добавляет", () => {
    const spoken = createSpokenText();
    spoken.push("Раз. Два");
    expect(texts(spoken.finish())).toEqual(["Два"]);
    expect(spoken.finish()).toEqual([]);
  });

  it("недописанная конструкция не озвучивается, пока не закончится", () => {
    const spoken = createSpokenText();
    expect(texts(spoken.push("Раз. Смотри [док"))).toEqual(["Раз."]);
    expect(spoken.push("ументацию](http://x")).toEqual([]);
    expect(texts([...spoken.push(") тут. Дальше "), ...spoken.finish()])).toEqual(["Смотри документацию тут.", "Дальше"]);
  });

  it("недописанный строчный код не озвучивается до закрытия кавычки", () => {
    const spoken = createSpokenText();
    expect(spoken.push("Вызови `npm. ")).toEqual([]);
    expect(texts([...spoken.push("install` сейчас. "), ...spoken.finish()])).toEqual(["Вызови npm. install сейчас."]);
  });

  it("предложение, начатое до блока кода, выходит без ожидания конца ответа", () => {
    const spoken = createSpokenText();
    expect(texts(spoken.push("Вот код:\n```js\nconst"))).toEqual(["Вот код:", "код на экране"]);
    expect(spoken.push(" a = 1;\n")).toEqual([]);
    expect(texts(spoken.push("```\nГотово.\n"))).toEqual(["Готово."]);
  });
});

describe("говоримый текст: позиции в тексте сообщения", () => {
  it("у предложения есть начало и конец в исходном тексте (конец — после знака)", () => {
    const source = "Привет. Мир.";
    expect(speak(source)).toEqual([
      { text: "Привет.", sourceStart: 0, sourceEnd: 7 },
      { text: "Мир.", sourceStart: 8, sourceEnd: 12 },
    ]);
  });

  it("«код на экране» занимает строку начала блока; следующее предложение начинается после блока", () => {
    const source = "Вот:\n```js\nx\n```\nДа.";
    const [intro, code, after] = speak(source);
    expect(intro).toMatchObject({ text: "Вот:", sourceStart: 0, sourceEnd: 4 });
    expect(code).toMatchObject({ text: "код на экране", sourceStart: source.indexOf("```js"), sourceEnd: source.indexOf("```js") + 5 });
    expect(after).toMatchObject({ text: "Да.", sourceStart: source.lastIndexOf("Да."), sourceEnd: source.length });
  });

  it("позиции идут по возрастанию и не выходят за текст", () => {
    for (const [, source] of SAMPLES) {
      let previous = 0;
      for (const sentence of speak(source)) {
        expect(sentence.sourceStart).toBeGreaterThanOrEqual(previous);
        expect(sentence.sourceEnd).toBeGreaterThan(sentence.sourceStart);
        expect(sentence.sourceEnd).toBeLessThanOrEqual(source.length);
        previous = sentence.sourceEnd;
      }
    }
  });

  it("предложение с тегом: позиции охватывают и тег, и слова; тег одиночкой входит в начало следующего", () => {
    const source = "Привет.\n[sighs]\nЛадно.";
    const [first, second] = speak(source);
    expect(first).toMatchObject({ text: "Привет.", sourceStart: 0, sourceEnd: 7 });
    expect(second).toMatchObject({ text: "[sighs] Ладно.", sourceStart: source.indexOf("[sighs]"), sourceEnd: source.length });
  });

  it("обрыв считается по знакам вместе с тегами: тег — часть озвучки, позиция в тексте остаётся верной", () => {
    const source = "[laughs] Привет. Дальше.";
    const sentences = speak(source);
    expect(texts(sentences)).toEqual(["[laughs] Привет.", "Дальше."]);
    expect(sourcePositionAtSpoken(sentences, "[laughs] Привет.".length)).toBe(source.indexOf("Дальше") - 1);
    expect(sourcePositionAtSpoken(sentences, "[laughs] Привет. ".length)).toBe(source.indexOf("Дальше"));
    expect(sourcePositionAtSpoken(sentences, 0)).toBe(0);
  });

  describe("sourcePositionAtSpoken: «сколько знаков озвучено» → позиция в тексте", () => {
    const sentences: SpokenSentence[] = [
      { text: "Привет.", sourceStart: 0, sourceEnd: 7 },
      { text: "Как дела?", sourceStart: 8, sourceEnd: 17 },
    ];

    it("ноль знаков — начало первого предложения", () => {
      expect(sourcePositionAtSpoken(sentences, 0)).toBe(0);
    });

    it("предложение озвучено целиком — его конец", () => {
      expect(sourcePositionAtSpoken(sentences, "Привет.".length)).toBe(7);
    });

    it("внутри предложения — пропорционально", () => {
      const inside = sourcePositionAtSpoken(sentences, "Привет. ".length + 4);
      expect(inside).toBeGreaterThan(8);
      expect(inside).toBeLessThan(17);
    });

    it("больше, чем есть — конец последнего; пустой список — 0", () => {
      expect(sourcePositionAtSpoken(sentences, 1000)).toBe(17);
      expect(sourcePositionAtSpoken([], 5)).toBe(0);
    });
  });
});

describe("говоримый текст: потолок знаков на ответ", () => {
  it("после потолка — «дальше на экране» один раз, остальное молчит", () => {
    const source = "Первое предложение. Второе предложение. Третье.\n```\nx\n```\nЧетвёртое.";
    expect(texts(speak(source, { maxChars: 15 }))).toEqual(["Первое предложение.", "Дальше на экране."]);
  });

  it("потолок не мешает короткому ответу", () => {
    expect(texts(speak("Коротко.", { maxChars: 100 }))).toEqual(["Коротко."]);
  });

  it("надписи можно заменить (другой язык приложения)", () => {
    const options = { maxChars: 5, phrases: { code: "code on screen", table: "table on screen", more: "more on screen" } };
    expect(texts(speak("Hello world. Next.", options))).toEqual(["Hello world.", "more on screen"]);
    expect(texts(speak("```\nx\n```", options))).toEqual(["code on screen"]);
    expect(texts(speak("| a |\n|---|\n| 1 |", options))).toEqual(["table on screen"]);
  });
});

describe("схемы (T039)", () => {
  it("фраза схемы задаётся как у кода", () => {
    expect(texts(speak("```mermaid\nA-->B\n```", { phrases: { diagram: "diagram on screen" } }))).toEqual(["diagram on screen"]);
  });
});
