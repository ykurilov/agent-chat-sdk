import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHumanSounds, ECHO_BEFORE_MS, ECHO_TAIL_MS, SOUND_MAX_AGE_MS } from "../src/browser/human-sounds";
import { soundKindsOfTag, soundKindsOfText } from "../src/browser/voice-tag-sounds";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

const sounds = (echoTailMs?: number) => createHumanSounds({ now: () => Date.now(), ...(echoTailMs !== undefined && { echoTailMs }) });

describe("звуки человека на клиенте: копятся до следующего сообщения", () => {
  it("услышанное забирается один раз; список пуст, когда звуков не было", () => {
    const heard = sounds();
    expect(heard.take()).toEqual([]);
    heard.hear([{ kind: "laughter", agoMs: 300 }]);
    expect(heard.take()).toEqual(["laughter"]);
    expect(heard.take()).toEqual([]);
  });

  it("виды не повторяются, порядок — по первому появлению", () => {
    const heard = sounds();
    heard.hear([{ kind: "sigh", agoMs: 900 }, { kind: "laughter", agoMs: 600 }, { kind: "sigh", agoMs: 300 }]);
    heard.hear([{ kind: "laughter", agoMs: 0 }, { kind: "cough", agoMs: 0 }]);
    expect(heard.take()).toEqual(["sigh", "laughter", "cough"]);
  });

  it("мусор от сервера (неизвестный вид, нет agoMs, не число) отбрасывается без исключений", () => {
    const heard = sounds();
    heard.hear([{ kind: "dance", agoMs: 1 }, { kind: "laughter" }, { kind: "sigh", agoMs: "5" }, null, 7, { kind: "gasp", agoMs: -5 }] as never);
    heard.hear(undefined as never);
    expect(heard.take()).toEqual(["gasp"]);
  });

  it("звук старше SOUND_MAX_AGE_MS не передаётся (человек уже о другом); ровно на границе — ещё передаётся", () => {
    expect(SOUND_MAX_AGE_MS).toBe(30_000);
    const heard = sounds();
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    vi.setSystemTime(1_000_000 + SOUND_MAX_AGE_MS);
    expect(heard.take()).toEqual(["laughter"]);

    heard.hear([{ kind: "sigh", agoMs: 0 }]);
    vi.setSystemTime(1_000_000 + SOUND_MAX_AGE_MS * 2 + 1);
    expect(heard.take()).toEqual([]);
  });

  it("возраст считается от начала звука, а не от прихода: agoMs уменьшает срок", () => {
    const heard = sounds();
    heard.hear([{ kind: "laughter", agoMs: 29_000 }]);
    vi.setSystemTime(1_000_000 + 1_001);
    expect(heard.take()).toEqual([]);
  });

  it("restore возвращает забранное (отправка не вышла): оно идёт впереди нового, без повторов", () => {
    const heard = sounds();
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    const taken = heard.take();
    heard.hear([{ kind: "sigh", agoMs: 0 }, { kind: "laughter", agoMs: 0 }]);
    heard.restore(taken);
    expect(heard.take()).toEqual(["laughter", "sigh"]);
  });

  it("restore пустого списка ничего не меняет", () => {
    const heard = sounds();
    heard.restore([]);
    expect(heard.take()).toEqual([]);
  });

  it("reset забывает всё услышанное (режим выключили)", () => {
    const heard = sounds();
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    heard.reset();
    expect(heard.take()).toEqual([]);
  });
});

describe("звуки человека на клиенте: эхо собственных звуков агента (FR-027)", () => {
  it("звук того же вида, что агент только что издал, — эхо и не принимается", () => {
    const heard = sounds();
    heard.noteAgentSounds(["laughter"], { from: 1_000_000, until: 1_000_000 + 1500 });
    vi.setSystemTime(1_000_000 + 1000);
    heard.hear([{ kind: "laughter", agoMs: 200 }]);
    expect(heard.take()).toEqual([]);
  });

  it("другой вид звука не эхо: агент засмеялся, человек кашлянул — кашель принят", () => {
    const heard = sounds();
    heard.noteAgentSounds(["laughter"], { from: 1_000_000, until: 1_000_000 + 1500 });
    vi.setSystemTime(1_000_000 + 1000);
    heard.hear([{ kind: "cough", agoMs: 200 }, { kind: "laughter", agoMs: 200 }]);
    expect(heard.take()).toEqual(["cough"]);
  });

  it("звук без тега у агента — человеческий (смеётся над шуткой)", () => {
    const heard = sounds();
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(heard.take()).toEqual(["laughter"]);
  });

  it("окно эха: от «начало куска − ECHO_BEFORE_MS» до «конец куска + хвост на задержку микрофона»; за границей — звук человека", () => {
    expect(ECHO_BEFORE_MS).toBe(500);
    expect(ECHO_TAIL_MS).toBe(600);
    const edge = (offset: number) => {
      vi.setSystemTime(1_000_000);
      const heard = sounds();
      // кусок озвучки со звуком играет от «сейчас + 1 с» до «сейчас + 2 с»
      heard.noteAgentSounds(["laughter"], { from: 1_000_000 + 1000, until: 1_000_000 + 2000 });
      vi.setSystemTime(1_000_000 + 10_000);
      // звук начался в момент «сейчас + offset»
      heard.hear([{ kind: "laughter", agoMs: 10_000 - offset }]);
      return heard.take();
    };
    expect(edge(1000 - ECHO_BEFORE_MS)).toEqual([]);
    expect(edge(1000 - ECHO_BEFORE_MS - 1)).toEqual(["laughter"]);
    expect(edge(2000 + ECHO_TAIL_MS)).toEqual([]);
    expect(edge(2000 + ECHO_TAIL_MS + 1)).toEqual(["laughter"]);
  });

  it("без указанного куска отметка — одна точка: окно «−ECHO_BEFORE_MS … +хвост»", () => {
    const heard = sounds();
    heard.noteAgentSounds(["laughter"]);
    vi.setSystemTime(1_000_000 + ECHO_TAIL_MS + 1);
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(heard.take()).toEqual(["laughter"]);
  });

  it("хвост на задержку микрофона настраивается", () => {
    const heard = sounds(100);
    heard.noteAgentSounds(["laughter"], { from: 1_000_000, until: 1_000_000 });
    vi.setSystemTime(1_000_000 + 101);
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(heard.take()).toEqual(["laughter"]);

    vi.setSystemTime(1_000_000);
    const longer = sounds(2000);
    longer.noteAgentSounds(["laughter"], { from: 1_000_000, until: 1_000_000 });
    vi.setSystemTime(1_000_000 + 1500);
    longer.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(longer.take()).toEqual([]);
  });

  it("человек смеётся в ответ: агент договорил (кусок со смехом закончился) секунду назад — смех принимается", () => {
    const heard = sounds();
    heard.noteAgentSounds(["laughter"], { from: 1_000_000 - 800, until: 1_000_000 });
    vi.setSystemTime(1_000_000 + 1000);
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(heard.take()).toEqual(["laughter"]);
  });

  it("смех агента ещё играет — смех в микрофоне эхо, даже если кусок длинный", () => {
    const heard = sounds();
    heard.noteAgentSounds(["laughter"], { from: 1_000_000, until: 1_000_000 + 3000 });
    vi.setSystemTime(1_000_000 + 2500);
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(heard.take()).toEqual([]);
  });

  it("агент смеялся давно (больше минуты назад), человек смеётся сейчас — звук человека; отметки не копятся без конца", () => {
    const heard = sounds();
    heard.noteAgentSounds(["laughter"]);
    vi.setSystemTime(1_000_000 + 120_000);
    heard.noteAgentSounds(["sigh"]);
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    expect(heard.take()).toEqual(["laughter"]);
  });

  it("агент отметил несколько видов сразу — эхо у каждого", () => {
    const heard = sounds();
    heard.noteAgentSounds(["sigh", "groan"]);
    vi.setSystemTime(1_000_000 + 500);
    heard.hear([{ kind: "groan", agoMs: 0 }, { kind: "sigh", agoMs: 0 }, { kind: "yawn", agoMs: 0 }]);
    expect(heard.take()).toEqual(["yawn"]);
  });

  it("звук, который человек издал ДО того, как агент отметил свой (раньше окна), — человеческий и остаётся", () => {
    const heard = sounds();
    heard.hear([{ kind: "laughter", agoMs: 0 }]);
    vi.setSystemTime(1_000_000 + 5000);
    heard.noteAgentSounds(["laughter"]);
    expect(heard.take()).toEqual(["laughter"]);
  });
});

describe("звуки по тегам и словам агента", () => {
  it.each([
    ["laughs", ["laughter"]],
    ["laughs harder", ["laughter"]],
    ["starts laughing", ["laughter"]],
    ["chuckles", ["laughter"]],
    ["snorts", ["laughter"]],
    ["wheezing", ["laughter"]],
    ["sighs", ["sigh", "groan"]],
    ["exhales", ["sigh", "groan"]],
    ["gasps", ["gasp"]],
    ["crying", ["crying"]],
    ["sobs", ["crying"]],
    ["coughs", ["cough"]],
    ["clears throat", ["cough"]],
    ["yawns", ["yawn"]],
    ["sneezes", ["sneeze"]],
    ["whispers", []],
    ["excited", []],
    ["/laughs", []],
    ["warm, quiet voice", []],
  ])("тег [%s] → %j", (tag, kinds) => {
    expect(soundKindsOfTag(tag)).toEqual(kinds);
  });

  it.each([
    ["Ха-ха!", ["laughter"]],
    ["Эх…", ["sigh", "groan"]],
    ["Ну ты даёшь. Ха-ха! Ладно.", ["laughter"]],
    ["Ха-ха, ха-ха!", ["laughter"]],
    ["Ха-ха, ну ты даёшь", []],
    ["Эх, ладно", []],
    ["Ах, как красиво!", []],
    ["Я сказал «ох» и ушёл.", []],
    ["Хмм…", []],
    ["Секунду, дай-ка подумаю.", []],
    ["", []],
  ])("слова «%s» (заполнитель, озвученный текст) → %j", (text, kinds) => {
    expect(soundKindsOfText(text)).toEqual(kinds);
  });
});
