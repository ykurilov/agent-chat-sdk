import { describe, expect, it } from "vitest";
import { createFillerScheduler, DEFAULT_FILLER_SETTINGS } from "../src/browser/filler-scheduler";
import type { FillerCategory, FillerPhrase, FillerSchedulerSettings } from "../src/browser/filler-scheduler";

/** Ручные часы: время стоит, пока тест его не подвинет; сработавшие таймеры идут по порядку. */
function manualClock() {
  let time = 0;
  let counter = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => time,
    setTimeout: (run: () => void, ms: number) => {
      counter += 1;
      timers.set(counter, { at: time + ms, run });
      return counter;
    },
    clearTimeout: (id: unknown) => void timers.delete(id as number),
    advance(ms: number) {
      const target = time + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        timers.delete(next[0]);
        time = next[1].at;
        next[1].run();
      }
      time = target;
    },
    get pending() {
      return timers.size;
    },
  };
}

const CATEGORIES: FillerCategory[] = ["thinking", "reasoning", "web", "page", "memory", "tool", "long"];

/** По две фразы на категорию: `thinking-a`, `thinking-b` и так далее; каждая звучит 800 мс. */
const catalog = (): Record<FillerCategory, FillerPhrase[]> =>
  Object.fromEntries(CATEGORIES.map((category) => [category, ["a", "b"].map((suffix) => ({ id: `${category}-${suffix}`, category, text: `${category} ${suffix}`, durationMs: 800 }))])) as Record<
    FillerCategory,
    FillerPhrase[]
  >;

function setup(
  options: { settings?: Partial<FillerSchedulerSettings>; phrases?: Partial<Record<FillerCategory, FillerPhrase[]>>; random?: () => number; speakResult?: boolean } = {},
) {
  const clock = manualClock();
  const spoken: Array<{ at: number; id: string }> = [];
  const state = { audioPlaying: false, speakResult: options.speakResult ?? true };
  const phrases = { ...catalog(), ...options.phrases };
  const scheduler = createFillerScheduler({
    settings: { ...DEFAULT_FILLER_SETTINGS, ...options.settings },
    clock,
    random: options.random ?? (() => 0),
    phrases: (category) => phrases[category],
    isAnswerAudioPlaying: () => state.audioPlaying,
    speak: (phrase) => {
      if (!state.speakResult) return false;
      spoken.push({ at: clock.now(), id: phrase.id });
      return true;
    },
  });
  return { clock, scheduler, spoken, state, phrases };
}

const ids = (spoken: Array<{ id: string }>) => spoken.map((item) => item.id);

describe("«просто думает»: тишина после конца фразы человека", () => {
  it("через 1,5 с без текста говорит фразу из «думает», раньше — молчит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();

    clock.advance(1499);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(spoken).toEqual([{ at: 1500, id: "thinking-a" }]);
  });

  it("текст ответа пошёл раньше — не говорит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(1000);

    scheduler.answerText();
    clock.advance(10_000);

    expect(spoken).toEqual([]);
  });

  it("порог берётся из настроек", () => {
    const { clock, scheduler, spoken } = setup({ settings: { thinkingAfterMs: 400 } });
    scheduler.turnStarted();

    clock.advance(400);

    expect(ids(spoken)).toEqual(["thinking-a"]);
  });

  it("конец хода снимает все ожидания", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();

    scheduler.turnEnded();
    clock.advance(20_000);

    expect(spoken).toEqual([]);
    expect(clock.pending).toBe(0);
  });
});

describe("размышление модели", () => {
  it("идёт 2,5 с — фраза из «размышляет»", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(100);
    scheduler.activityStarted("p0", "reasoning");

    clock.advance(2499);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(spoken).toEqual([{ at: 2600, id: "reasoning-a" }]);
  });

  it("закончилось раньше порога — молчит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p0", "reasoning");
    clock.advance(2000);

    scheduler.activityEnded("p0");
    clock.advance(1499);

    expect(spoken).toEqual([]);
  });

  it("начало размышления отменяет «просто думает»: две фразы подряд не звучат", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(500);
    scheduler.activityStarted("p0", "reasoning");

    clock.advance(1500);

    expect(spoken).toEqual([]);
  });
});

describe("вызовы инструментов", () => {
  const cases: Array<[string, FillerCategory]> = [
    ["web_search", "web"],
    ["read_page", "page"],
    ["page_screenshot", "page"],
    ["manage_memory", "memory"],
    ["search_earlier_conversation", "memory"],
    ["something_new", "tool"],
  ];
  it.each(cases)("%s через 0,7 с → категория «%s»", (toolName, category) => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", toolName);

    clock.advance(699);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(ids(spoken)).toEqual([`${category}-a`]);
  });

  it("инструмент закончился быстрее 0,7 с — молчит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(500);

    scheduler.activityEnded("p1");
    clock.advance(1499);

    expect(spoken).toEqual([]);
  });

  it("свои соответствия имён и категорий из настроек", () => {
    const { clock, scheduler, spoken } = setup({ settings: { toolCategories: { find_recipe: "web" } } });
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "find_recipe");

    clock.advance(700);

    expect(ids(spoken)).toEqual(["web-a"]);
  });

  it("пороги инструментов и размышления настраиваются", () => {
    const { clock, scheduler, spoken } = setup({ settings: { toolAfterMs: 200 } });
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");

    clock.advance(200);

    expect(ids(spoken)).toEqual(["web-a"]);
  });

  it("начало инструмента отменяет «просто думает»", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(1000);
    scheduler.activityStarted("p1", "tool", "web_search");

    clock.advance(500);

    expect(spoken).toEqual([]);
    clock.advance(200);
    expect(ids(spoken)).toEqual(["web-a"]);
  });
});

describe("тишина после инструмента", () => {
  it("инструмент закончился, а текста ответа нет: снова ждёт 1,5 с и говорит «думает»", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(300);
    scheduler.activityEnded("p1");

    clock.advance(1499);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(spoken).toEqual([{ at: 1800, id: "thinking-a" }]);
  });

  it("после фразы про инструмент, которая уже прозвучала, вторая — «думает» — не больше двух на ход", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(700);
    scheduler.activityEnded("p1");
    // «думает» взведён на 2200, но фраза про инструмент звучит и ещё 2 с держит паузу: до 3500
    clock.advance(2800);
    expect(spoken).toEqual([
      { at: 700, id: "web-a" },
      { at: 3500, id: "thinking-a" },
    ]);

    scheduler.activityStarted("p2", "tool", "web_search");
    clock.advance(20_000);
    expect(spoken).toHaveLength(2);
  });

  it("пошёл текст ответа раньше срока — молчит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(300);
    scheduler.activityEnded("p1");
    clock.advance(1000);

    scheduler.answerText();
    clock.advance(10_000);

    expect(spoken).toEqual([]);
  });

  it("шли два инструмента — «думает» взводится, когда кончились оба", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    scheduler.activityStarted("p2", "tool", "read_page");
    clock.advance(100);
    scheduler.activityEnded("p1");
    clock.advance(5000);
    expect(ids(spoken)).toEqual(["page-a"]);

    scheduler.activityEnded("p2");
    clock.advance(1500);
    expect(ids(spoken)).toEqual(["page-a", "thinking-a"]);
  });
});

describe("«ещё чуть-чуть» и предел на ход", () => {
  it("через 6 с после первого заполнителя, если ответа нет, говорит «долго»", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(1500);

    clock.advance(5999);
    expect(ids(spoken)).toEqual(["thinking-a"]);
    clock.advance(1);

    expect(spoken).toEqual([
      { at: 1500, id: "thinking-a" },
      { at: 7500, id: "long-a" },
    ]);
  });

  it("пошёл текст ответа — «долго» не говорит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(1500);

    clock.advance(3000);
    scheduler.answerText();
    clock.advance(20_000);

    expect(ids(spoken)).toEqual(["thinking-a"]);
  });

  it("не больше двух на ход, как бы ни тянулось", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(700);
    scheduler.activityEnded("p1");
    scheduler.activityStarted("p2", "tool", "read_page");
    clock.advance(60_000);

    expect(spoken).toHaveLength(2);
  });

  it("лимит и счётчики начинаются заново с каждым ходом", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(1500);
    clock.advance(6000);
    expect(spoken).toHaveLength(2);
    scheduler.turnEnded();

    scheduler.turnStarted();
    clock.advance(1500);

    expect(spoken).toHaveLength(3);
  });

  it("предел на ход настраивается", () => {
    const { clock, scheduler, spoken } = setup({ settings: { maxPerTurn: 1 } });
    scheduler.turnStarted();
    clock.advance(1500 + 6000);

    expect(ids(spoken)).toEqual(["thinking-a"]);
  });

  it("две фразы не идут встык: следующая ждёт, пока прошлая договорит и пройдёт пауза", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(700);
    scheduler.activityStarted("p2", "tool", "read_page");
    clock.advance(700);

    expect(ids(spoken)).toEqual(["web-a"]);
    // первая фраза началась на 700 и кончилась на 1500; пауза между фразами 2000 — значит, вторая не раньше 3500
    clock.advance(2099);
    expect(ids(spoken)).toEqual(["web-a"]);
    clock.advance(1);

    expect(spoken).toEqual([
      { at: 700, id: "web-a" },
      { at: 3500, id: "page-a" },
    ]);
  });
});

describe("не перебивать настоящий ответ", () => {
  it("пока звучит ответ, заполнитель ждёт; после ответа нужна тишина 1,5 с", () => {
    const { clock, scheduler, spoken, state } = setup();
    scheduler.turnStarted();
    scheduler.answerText();
    state.audioPlaying = true;
    clock.advance(200);
    scheduler.activityStarted("p1", "tool", "web_search");

    clock.advance(5000);
    expect(spoken).toEqual([]);

    // голос договорил на 5200: тишина должна выстоять 1,5 с
    state.audioPlaying = false;
    scheduler.answerAudioEnded();
    clock.advance(1499);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(spoken).toEqual([{ at: 6700, id: "web-a" }]);
  });

  it("модель сказала «сейчас поищу» и замолчала: инструмент идёт, ждём 1,5 с тишины после её текста", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(100);
    scheduler.answerText();
    clock.advance(100);
    scheduler.activityStarted("p1", "tool", "web_search");

    clock.advance(1399);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(spoken).toEqual([{ at: 1600, id: "web-a" }]);
  });

  it("порог тишины настраивается", () => {
    const { clock, scheduler, spoken } = setup({ settings: { quietAfterAnswerMs: 300 } });
    scheduler.turnStarted();
    scheduler.answerText();
    scheduler.activityStarted("p1", "tool", "web_search");

    clock.advance(700);

    expect(ids(spoken)).toEqual(["web-a"]);
  });

  it("инструмент закончился, пока ждали тишины, — молчит", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.answerText();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(1000);

    scheduler.activityEnded("p1");
    clock.advance(10_000);

    expect(spoken).toEqual([]);
  });

  it("пришло ещё слово ответа — ожидание тишины начинается заново", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.answerText();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(1200);

    scheduler.answerText();
    clock.advance(1499);
    expect(spoken).toEqual([]);
    clock.advance(1);

    expect(spoken).toEqual([{ at: 2700, id: "web-a" }]);
  });
});

describe("разнообразие", () => {
  it("не повторяет подряд одну и ту же фразу, даже если жребий выпал бы на неё", () => {
    const { clock, scheduler, spoken } = setup({ random: () => 0 });
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(700);
    scheduler.activityEnded("p1");
    scheduler.turnEnded();

    scheduler.turnStarted();
    scheduler.activityStarted("p2", "tool", "web_search");
    clock.advance(700);

    expect(ids(spoken)).toEqual(["web-a", "web-b"]);
  });

  it("выбирает по жребию из подходящих", () => {
    const { clock, scheduler, spoken } = setup({ random: () => 0.99 });
    scheduler.turnStarted();
    clock.advance(1500);

    expect(ids(spoken)).toEqual(["thinking-b"]);
  });

  it("единственная фраза вида звучит и в следующем ходу: исключать повтор можно, только если есть из чего выбрать", () => {
    const only = { id: "mem", category: "memory", text: "Дай-ка вспомню.", durationMs: 800 } as const;
    const { clock, scheduler, spoken } = setup({ phrases: { memory: [only] } });
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "manage_memory");
    clock.advance(700);
    scheduler.activityEnded("p1");
    scheduler.turnEnded();

    scheduler.turnStarted();
    scheduler.activityStarted("p2", "tool", "manage_memory");
    clock.advance(700);

    expect(ids(spoken)).toEqual(["mem", "mem"]);
  });

  it("из двух фраз вида после «a» в следующем ходу выпадает «b», хоть жребий и указывает на «a»", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    clock.advance(1500);
    scheduler.turnEnded();

    scheduler.turnStarted();
    clock.advance(1500);

    expect(ids(spoken)).toEqual(["thinking-a", "thinking-b"]);
  });
});

describe("фразы, которых нет", () => {
  it("не загрузилась ни одна фраза категории — заполнитель пропускается, ход идёт дальше", () => {
    const { clock, scheduler, spoken } = setup({ phrases: { web: [] } });
    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");

    clock.advance(10_000);

    expect(spoken).toEqual([]);
  });

  it("фразы подгрузились к следующему срабатыванию — берутся они (список спрашивается в момент срабатывания)", () => {
    const { clock, scheduler, spoken, phrases } = setup({ phrases: { thinking: [] } });
    scheduler.turnStarted();
    clock.advance(1500);
    expect(spoken).toEqual([]);
    scheduler.turnEnded();
    phrases.thinking = catalog().thinking;

    scheduler.turnStarted();
    clock.advance(1500);

    expect(ids(spoken)).toEqual(["thinking-a"]);
  });

  it("плеер отказал (`speak` вернул false) — фраза не считается сказанной", () => {
    const { clock, scheduler, spoken, state } = setup({ speakResult: false });
    scheduler.turnStarted();
    clock.advance(1500);
    state.speakResult = true;
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(700);
    scheduler.activityStarted("p2", "tool", "read_page");
    clock.advance(3000);

    expect(ids(spoken)).toEqual(["web-a", "page-a"]);
  });
});

describe("остановка", () => {
  it("dispose снимает таймеры, дальше события ничего не запускают", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.dispose();

    scheduler.turnStarted();
    scheduler.activityStarted("p1", "tool", "web_search");
    clock.advance(20_000);

    expect(spoken).toEqual([]);
    expect(clock.pending).toBe(0);
  });

  it("события вне хода (после конца) ничего не запускают", () => {
    const { clock, scheduler, spoken } = setup();
    scheduler.turnStarted();
    scheduler.turnEnded();

    scheduler.activityStarted("p1", "tool", "web_search");
    scheduler.answerText();
    clock.advance(20_000);

    expect(spoken).toEqual([]);
  });
});
