import { beforeEach, describe, expect, it } from "vitest";
import { createBargeInFilter } from "../src/browser/barge-in-filter";
import type { BargeInFilter, BargeInFilterOptions } from "../src/browser/barge-in-filter";
import type { HeardWord } from "../src/protocol";

let clock = 0;
const now = () => clock;

beforeEach(() => {
  clock = 0;
});

const word = (text: string, confidence = 0.9): HeardWord => ({ text, confidence });
const words = (text: string, confidence = 0.9): HeardWord[] => text.split(/\s+/).filter(Boolean).map((w) => word(w, confidence));
const make = (options: BargeInFilterOptions = {}) => createBargeInFilter({ now, ...options });
const interim = (filter: BargeInFilter, text: string, confidence = 0.9) =>
  filter.feed({ settled: [], interim: words(text, confidence) }).interrupt;
const settled = (filter: BargeInFilter, text: string, confidence = 0.9) =>
  filter.feed({ settled: words(text, confidence), interim: [] }).interrupt;

describe("порог уверенности", () => {
  it("слово с уверенностью ниже порога не перебивает; на пороге и выше — перебивает", () => {
    expect(interim(make(), "погода", 0.59)).toBe(false);
    expect(interim(make(), "погода", 0.6)).toBe(true);
    expect(interim(make(), "погода", 0.95)).toBe(true);
  });

  it("порог настраивается", () => {
    expect(interim(make({ minConfidence: 0.9 }), "погода", 0.8)).toBe(false);
    expect(interim(make({ minConfidence: 0.3 }), "погода", 0.4)).toBe(true);
  });

  it("сомнительное слово не перебивает, а уверенное рядом — перебивает", () => {
    const filter = make();
    expect(filter.feed({ settled: [], interim: [word("шум", 0.2)] }).interrupt).toBe(false);
    expect(filter.feed({ settled: [], interim: [word("шум", 0.2), word("расскажи", 0.9)] }).interrupt).toBe(true);
  });

  it("пустой ввод не перебивает", () => {
    expect(make().feed({ settled: [], interim: [] })).toEqual({ interrupt: false });
  });
});

describe("эхо: слова из только что озвученного", () => {
  it("слово из озвученного окна — эхо, не перебивает", () => {
    const filter = make();
    filter.noteSpoken("Сегодня в Москве облачно");
    expect(interim(filter, "сегодня в москве")).toBe(false);
  });

  it("регистр, знаки препинания и «ё» не мешают сверке", () => {
    const filter = make();
    filter.noteSpoken("Всё будет хорошо, обещаю.");
    expect(interim(filter, "Все будет, хорошо")).toBe(false);
  });

  it("слово, которого агент не говорил, перебивает", () => {
    const filter = make();
    filter.noteSpoken("Сегодня в Москве облачно");
    expect(interim(filter, "сегодня в москве а как же питер")).toBe(true);
  });

  it("окно ≈ 5 с: по истечении то же слово уже не эхо", () => {
    const filter = make({ echoWindowMs: 5000 });
    filter.noteSpoken("облачно");
    clock = 4999;
    expect(interim(filter, "облачно")).toBe(false);
    clock = 5001;
    expect(interim(filter, "облачно")).toBe(true);
  });

  it("окно по умолчанию — 5 с", () => {
    const filter = make();
    filter.noteSpoken("облачно");
    clock = 4900;
    expect(interim(filter, "облачно")).toBe(false);
    clock = 5100;
    expect(interim(filter, "облачно")).toBe(true);
  });

  it("озвученное дописывается по ходу: длинное предложение не выпадает из окна", () => {
    const filter = make({ echoWindowMs: 5000 });
    filter.noteSpoken("первая часть длинного предложения");
    clock = 4000;
    filter.noteSpoken("вторая часть предложения");
    clock = 8000;
    expect(interim(filter, "вторая часть")).toBe(false);
    expect(interim(filter, "первая часть")).toBe(true);
  });

  it("слово, отличающееся от озвученного на одну букву (ошибка распознавания), — тоже эхо", () => {
    const filter = make();
    filter.noteSpoken("температура воздуха плюс двадцать");
    expect(interim(filter, "температуры воздуха")).toBe(false);
  });

  it("короткие слова сверяются точно: «да» не принимается за «два»", () => {
    const filter = make();
    filter.noteSpoken("два часа");
    expect(interim(filter, "дна")).toBe(true);
  });

  it("эхо, закреплённое в окне, остаётся эхом, когда окно уже прошло", () => {
    const filter = make({ echoWindowMs: 5000 });
    filter.noteSpoken("облачно");
    expect(settled(filter, "облачно")).toBe(false);
    clock = 9000;
    expect(interim(filter, "угу")).toBe(false);
  });

  it("reset забывает накопленные слова, но не озвученное", () => {
    const filter = make();
    filter.noteSpoken("облачно");
    settled(filter, "угу");
    filter.reset();
    expect(interim(filter, "ага")).toBe(false);
    expect(interim(filter, "облачно")).toBe(false);
  });
});

describe("слова остановки", () => {
  it.each(["стоп", "подожди", "погоди", "нет", "хватит", "слушай"])("«%s» перебивает", (stopWord) => {
    const filter = make();
    expect(interim(filter, stopWord)).toBe(true);
    expect(make().feed({ settled: [word(stopWord)], interim: [] })).toMatchObject({ interrupt: true, reason: "stop_word" });
  });

  it("перебивают, даже если слово только что прозвучало у агента", () => {
    const filter = make();
    filter.noteSpoken("Нет, так не получится. Стоп-кран рядом");
    expect(interim(filter, "нет")).toBe(true);
    expect(interim(make(), "стоп")).toBe(true);
  });

  it("но с низкой уверенностью — нет", () => {
    expect(interim(make(), "стоп", 0.3)).toBe(false);
  });

  it("список слов остановки настраивается", () => {
    const filter = make({ stopWords: ["замолчи"] });
    filter.noteSpoken("замолчи");
    expect(interim(filter, "замолчи")).toBe(true);
    expect(interim(make({ stopWords: ["замолчи"] }), "стоп")).toBe(true); // всё равно слово вне озвученного
  });
});

describe("междометия", () => {
  it.each(["угу", "ага", "ну", "мм", "м-м", "хм", "да"])("«%s» одиночкой не перебивает", (filler) => {
    expect(interim(make(), filler)).toBe(false);
    expect(settled(make(), filler)).toBe(false);
  });

  it("два слова подряд перебивают, даже если оба междометия", () => {
    expect(make().feed({ settled: [], interim: words("ну да") })).toMatchObject({ interrupt: true, reason: "two_words" });
  });

  it("два междометия подряд по частям (закреплено, потом ещё одно) — перебивают", () => {
    const filter = make();
    expect(settled(filter, "угу")).toBe(false);
    clock = 500;
    expect(settled(filter, "ага")).toBe(true);
  });

  it("два междометия с большой паузой между ними — это два отдельных «угу», не перебивание", () => {
    const filter = make();
    expect(settled(filter, "угу")).toBe(false);
    clock = 10_000;
    expect(settled(filter, "ага")).toBe(false);
  });

  it("эхо между междометиями обрывает «подряд»", () => {
    const filter = make();
    filter.noteSpoken("облачно");
    expect(filter.feed({ settled: [], interim: words("угу облачно ага") }).interrupt).toBe(false);
  });

  it("междометие с осмысленным словом — перебивание", () => {
    expect(interim(make(), "ну расскажи")).toBe(true);
  });

  it("список междометий настраивается", () => {
    expect(interim(make({ fillers: ["ладно"] }), "ладно")).toBe(false);
    expect(interim(make({ fillers: ["ладно"] }), "угу")).toBe(true);
  });
});

describe("слова приходят кусками", () => {
  it("предварительные слова заменяются целиком: пропавшее слово решение не держит", () => {
    const filter = make();
    expect(interim(filter, "угу")).toBe(false);
    expect(interim(filter, "угу")).toBe(false);
    expect(interim(filter, "а")).toBe(true); // «а» — слово вне междометий
  });

  it("слово из нескольких слов в одном куске разбирается по словам", () => {
    expect(interim(make(), "угу")).toBe(false);
    expect(make().feed({ settled: [], interim: [word("а как же")] }).interrupt).toBe(true);
  });

  it("отчёт о решении несёт причину", () => {
    expect(make().feed({ settled: [], interim: words("расскажи") })).toEqual({ interrupt: true, reason: "words" });
  });
});

/**
 * Наборы «записей» на потоках слов (SC-004). Эхо: агент говорит фразу, микрофон слышит её через динамики — слова приходят
 * предварительными, затем закрепляются, иногда с ошибкой распознавания и с сомнительными словами. Перебивание: человек
 * говорит поверх агента.
 */
describe("наборы записей (SC-004)", () => {
  const AGENT_PHRASES = [
    "Сегодня в Москве облачно, температура плюс двадцать градусов.",
    "Хорошо, я запомнил ваше предпочтение и учту его в следующих ответах.",
    "Чтобы установить пакет, откройте терминал и выполните команду установки.",
    "Есть три варианта: быстрый, дешёвый и надёжный, выбирайте любые два.",
    "Ваш заказ оформлен, доставка займёт примерно два рабочих дня.",
    "К сожалению, я не нашёл такой информации, но могу поискать в другом источнике.",
    "Давайте разберём это по шагам, начнём с самого простого случая.",
    "Ошибка возникает потому, что файл настроек не был найден на диске.",
    "Отличный вопрос! Короткий ответ: да, это возможно, но с оговорками.",
    "Всё готово, можете проверять результат и говорить, что поправить.",
  ];

  /** Что услышит микрофон: слова фразы в том же порядке, часть с ошибкой распознавания и сомнительным шумом. */
  function echoStream(phrase: string, index: number): HeardWord[][] {
    const spoken = phrase.replace(/[.,:!?]/g, "").split(/\s+/);
    const heard = spoken.map((w, i) => {
      // каждое седьмое слово распознано с ошибкой в окончании, каждое пятое — с пониженной уверенностью
      const garbled = (i + index) % 7 === 0 && w.length >= 6 ? w.slice(0, -1) + "а" : w;
      const confidence = (i + index) % 5 === 0 ? 0.45 : 0.75 + ((i * 7 + index) % 20) / 100;
      return { text: garbled, confidence };
    });
    // «шум»: посторонний звук с низкой уверенностью
    heard.splice(2, 0, { text: "а", confidence: 0.3 });
    const frames: HeardWord[][] = [];
    for (let end = 1; end <= heard.length; end++) frames.push(heard.slice(0, end));
    return frames;
  }

  it("10 фраз агента в микрофон — 0 ложных перебиваний", () => {
    let falseBargeIns = 0;
    AGENT_PHRASES.forEach((phrase, index) => {
      clock = index * 60_000;
      const filter = make();
      // движок дописывает озвученное по ходу воспроизведения
      const spoken = phrase.split(/\s+/);
      spoken.forEach((w, i) => {
        clock = index * 60_000 + i * 350;
        filter.noteSpoken(w);
      });
      const frames = echoStream(phrase, index);
      frames.forEach((frame, i) => {
        clock = index * 60_000 + 800 + i * 350;
        // закреплённое слово позади и три предварительных
        const settledCount = Math.max(0, frame.length - 3);
        const result = filter.feed({
          settled: i === 0 ? [] : frame.slice(Math.max(0, settledCount - 1), settledCount),
          interim: frame.slice(settledCount),
        });
        if (result.interrupt) falseBargeIns += 1;
      });
    });
    expect(falseBargeIns).toBe(0);
  });

  const INTERRUPTIONS = [
    "стоп",
    "подожди секунду",
    "а как же погода на завтра",
    "нет нет не то",
    "хватит",
    "погоди у меня вопрос",
    "слушай а можно короче",
    "я хотел спросить другое",
    "расскажи лучше про Питер",
    "ну да ладно давай про другое",
  ];

  it("10 фраз перебивания поверх агента — не меньше 9 срабатываний", () => {
    let barged = 0;
    INTERRUPTIONS.forEach((phrase, index) => {
      clock = index * 60_000;
      const filter = make();
      filter.noteSpoken("Сегодня в Москве облачно температура плюс двадцать градусов");
      const heard = words(phrase, 0.85);
      let fired = false;
      for (let end = 1; end <= heard.length && !fired; end++) {
        clock += 300;
        fired = filter.feed({ settled: [], interim: heard.slice(0, end) }).interrupt;
      }
      if (fired) barged += 1;
    });
    expect(barged).toBeGreaterThanOrEqual(9);
  });

  it("перебивание с эхо агента вперемешку срабатывает", () => {
    const filter = make();
    filter.noteSpoken("Сегодня в Москве облачно");
    clock = 500;
    expect(filter.feed({ settled: [], interim: words("сегодня в москве") }).interrupt).toBe(false);
    clock = 900;
    expect(filter.feed({ settled: [], interim: words("сегодня в москве подожди") }).interrupt).toBe(true);
  });
});

describe("эхо звуков: смех и вздох узнаются по шаблону, а не по списку", () => {
  const laughSounds = "Ну вот ха-ха-ха хи-хи хе";
  const sighSounds = "Ну эх ох ах";

  it.each(["Ха-ха-ха-ха", "Ха-ха-ха-ха-ха-ха", "Хахахахаха", "Ахаха", "Хи-хи-хи-хи", "Хо-хо-хо", "Ха", "А-ха-ха"])(
    "смех агента, услышанный как «%s», не перебивает",
    (heard) => {
      const filter = make();
      filter.noteSpoken(laughSounds);
      expect(filter.feed({ settled: [word(heard)], interim: [] }), heard).toEqual({ interrupt: false });
    },
  );

  it.each(["Ээх", "Оох", "Ох-х", "Эээээх", "Ух", "Уф", "Фуух"])("вздох агента, услышанный как «%s», не перебивает", (heard) => {
    const filter = make();
    filter.noteSpoken(sighSounds);
    expect(filter.feed({ settled: [word(heard)], interim: [] }), heard).toEqual({ interrupt: false });
  });

  it("несколько кусков смеха подряд — всё ещё эхо, второе слово тоже не «два слова подряд»", () => {
    const filter = make();
    filter.noteSpoken(laughSounds);
    expect(filter.feed({ settled: words("Ха-ха-ха-ха Хи-хи-хи-хи Ахаха"), interim: [] })).toEqual({ interrupt: false });
  });

  it("смех, которого агент не издавал, перебивает: шаблон работает только вместе с недавним смехом агента", () => {
    const filter = make();
    filter.noteSpoken("Ну вот и всё");
    expect(filter.feed({ settled: [word("Ха-ха-ха-ха")], interim: [] }).interrupt).toBe(true);
  });

  it("смех агента не делает эхом вздох человека, а вздох — смех", () => {
    const afterLaugh = make();
    afterLaugh.noteSpoken(laughSounds);
    expect(afterLaugh.feed({ settled: [word("Оох")], interim: [] }).interrupt).toBe(true);
    const afterSigh = make();
    afterSigh.noteSpoken(sighSounds);
    expect(afterSigh.feed({ settled: [word("Хахахаха")], interim: [] }).interrupt).toBe(true);
  });

  it("обычное слово, похожее на звук, шаблон не пропускает", () => {
    const filter = make();
    filter.noteSpoken(`${laughSounds} ${sighSounds}`);
    for (const heard of ["Охота", "Хорошо", "Ахтунг", "Хохлома", "Ухо"]) {
      expect(filter.feed({ settled: [word(heard)], interim: [] }).interrupt, heard).toBe(true);
    }
  });
});

describe("эхо заполнителей: слова через дефис разбираются по частям с обеих сторон", () => {
  it.each([
    ["Дай-ка подумаю…", "Дай ка подумаю"],
    ["Дай-ка подумаю…", "Дай-ка подумаю"],
    ["Дай ка подумаю…", "Дай-ка подумаю"],
    ["Ещё чуть-чуть…", "Ещё чуть чуть"],
    ["Ещё чуть-чуть…", "Ещё чуть-чуть"],
    ["Секунду, дай-ка подумаю.", "Секунду дай ка подумаю"],
  ])("озвучено «%s», услышано «%s» — эхо", (spoken, heard) => {
    const filter = make();
    filter.noteSpoken(spoken);
    expect(filter.feed({ settled: words(heard), interim: [] })).toEqual({ interrupt: false });
  });

  it("«Хмм…» услышано как «Хм хм» — эхо, а не два междометия подряд", () => {
    const filter = make();
    filter.noteSpoken("Хмм…");
    expect(filter.feed({ settled: words("Хм хм"), interim: [] })).toEqual({ interrupt: false });
    expect(filter.feed({ settled: [word("М-м")], interim: [] })).toEqual({ interrupt: false });
  });

  it("свои слова человека после заполнителя перебивают как раньше", () => {
    const filter = make();
    filter.noteSpoken("Дай-ка подумаю…");
    expect(filter.feed({ settled: words("Дай ка погоду"), interim: [] }).interrupt).toBe(true);
  });

  it("два «хм» человека без заполнителя перебивают (два междометия подряд)", () => {
    const filter = make();
    expect(filter.feed({ settled: words("хм хм"), interim: [] })).toEqual({ interrupt: true, reason: "two_words" });
  });
});
