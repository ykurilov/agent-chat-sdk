import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness } from "./support/engine-harness";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof harness>;
type Sound = { kind: string; agoMs: number };

/** Конец фразы от сервера со звуками. */
async function say(h: Harness, text: string, sounds?: Sound[]) {
  h.socket().receive({ type: "phrase_end", text, serverTimeMs: 1, ...(sounds && { sounds }) });
  await h.flushPromises();
}

/** Запоздавшие звуки отдельным сообщением. */
async function lateSounds(h: Harness, sounds: Sound[]) {
  h.socket().receive({ type: "sounds", sounds });
  await h.flushPromises();
}

const laugh = (agoMs = 300): Sound => ({ kind: "laughter", agoMs });
const sigh = (agoMs = 300): Sound => ({ kind: "sigh", agoMs });

/** Озвучки нет: ответ заканчивается, как только модель закончила текст. */
async function answered(h: Harness) {
  h.bridge.say("Понятно.");
  h.bridge.finish();
  await h.flushPromises();
}

/** Агент отвечает и звук идёт: «говорит». */
async function speaking(h: Harness, answer: string) {
  await h.start();
  await say(h, "Привет");
  h.bridge.say(answer);
  h.socket().receiveSpeech(1);
  await h.flushPromises();
}

describe("звуки человека в движке (FR-027)", () => {
  it("конец фразы со звуками: звуки уходят вместе со словами одним сообщением в чат", async () => {
    const h = harness();
    await h.start({ speech: false });

    await say(h, "Ха, смешно", [laugh()]);

    expect(h.bridge.sent).toEqual(["Ха, смешно"]);
    expect(h.bridge.sentSounds).toEqual([["laughter"]]);
  });

  it("без звуков в сообщении сервера мост получает фразу без звуков", async () => {
    const h = harness();
    await h.start({ speech: false });

    await say(h, "Привет");

    expect(h.bridge.sentSounds).toEqual([undefined]);
  });

  it("запоздавшие звуки (сообщение sounds) приклеиваются к следующей фразе, а не уходят отдельным сообщением", async () => {
    const h = harness();
    await h.start({ speech: false });
    await say(h, "Привет");
    await answered(h);
    await lateSounds(h, [sigh()]);
    expect(h.bridge.sent).toEqual(["Привет"]);

    await say(h, "Ну ладно");

    expect(h.bridge.sentSounds).toEqual([undefined, ["sigh"]]);
  });

  it("звук без слов хода не запускает: ни сообщения в чат, ни смены состояния; состояние «слушаю» остаётся", async () => {
    const h = harness();
    await h.start({ speech: false });
    const views = h.views.length;

    await lateSounds(h, [laugh()]);

    expect(h.bridge.sent).toEqual([]);
    expect(h.views.length).toBe(views);
    expect(h.view()?.state).toBe("listening");
  });

  it("звуки без слов копятся и уходят со следующей фразой: смех, потом вздох, потом слова", async () => {
    const h = harness();
    await h.start({ speech: false });
    await lateSounds(h, [laugh()]);
    await lateSounds(h, [sigh(), laugh()]);

    await say(h, "Так вот");

    expect(h.bridge.sentSounds).toEqual([["laughter", "sigh"]]);
  });

  it("звук, поздний для хода, уже ушедшего в чат, не добавляется к нему задним числом", async () => {
    const h = harness();
    await h.start({ speech: false });
    await say(h, "Привет");

    await lateSounds(h, [laugh()]);

    expect(h.bridge.sent).toEqual(["Привет"]);
    expect(h.bridge.sentSounds).toEqual([undefined]);
    expect(h.bridge.replaced).toEqual([]);
  });

  it("звук старше 30 секунд к следующей фразе не клеится", async () => {
    const h = harness();
    await h.start({ speech: false });
    await lateSounds(h, [laugh()]);
    await vi.advanceTimersByTimeAsync(31_000);

    await say(h, "Привет");

    expect(h.bridge.sentSounds).toEqual([undefined]);
  });

  it("после отправки звуки не повторяются в следующих сообщениях", async () => {
    const h = harness();
    await h.start({ speech: false });
    await say(h, "Ха", [laugh()]);
    await answered(h);

    await say(h, "Дальше");

    expect(h.bridge.sentSounds).toEqual([["laughter"], undefined]);
  });

  describe("склейка фраз", () => {
    it("новая фраза склеивается с прежней, пока модель думает: новые звуки уходят с правкой, прежние уже в сообщении", async () => {
      const h = harness();
      await h.start({ speech: false });
      await say(h, "Так.", [laugh()]);

      await say(h, "Дай-ка подумать.", [sigh()]);

      expect(h.bridge.replaced).toEqual(["Так. Дай-ка подумать."]);
      expect(h.bridge.replacedSounds).toEqual([["sigh"]]);
      expect(h.bridge.sentSounds).toEqual([["laughter"]]);
    });

    it("склейка без новых звуков — правка без звуков", async () => {
      const h = harness();
      await h.start({ speech: false });
      await say(h, "Так.", [laugh()]);

      await say(h, "Дай-ка подумать.");

      expect(h.bridge.replacedSounds).toEqual([undefined]);
    });

    it("склейка не вышла: новые звуки уходят в отдельном сообщении, не теряются", async () => {
      const h = harness();
      await h.start({ speech: false });
      h.bridge.replaceResult = false;
      await say(h, "Так.");

      await say(h, "Дай-ка подумать.", [sigh()]);
      await h.flushPromises();

      expect(h.bridge.sent).toEqual(["Так.", "Дай-ка подумать."]);
      expect(h.bridge.sentSounds).toEqual([undefined, ["sigh"]]);
    });

    it("мост без склейки: новая фраза уходит отдельным сообщением со звуками", async () => {
      const h = harness();
      await h.start({ speech: false });
      h.bridge.withoutReplace = true;
      await say(h, "Так.");

      await say(h, "Дай-ка подумать.", [sigh()]);
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, ["sigh"]]);
    });
  });

  it("перебивание: фраза со звуками, ушедшая после остановки, несёт звуки", async () => {
    const h = harness();
    await speaking(h, "Сегодня будет солнечно. Днём тепло.");
    h.heard("стоп");

    await say(h, "стоп давай про завтра", [sigh()]);
    await h.flushPromises();

    expect(h.bridge.sent).toEqual(["Привет", "стоп давай про завтра"]);
    expect(h.bridge.sentSounds).toEqual([undefined, ["sigh"]]);
  });

  describe("эхо: звук агента в микрофоне не звук человека", () => {
    it("агент засмеялся ([laughs]) — смех в микрофоне сразу после тега отброшен: следующая фраза без звуков", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! [laughs] Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      await lateSounds(h, [laugh(200)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, undefined]);
    });

    it("тот же смех при ответе без тега — звук человека: он смеётся над шуткой, звук приклеится к следующей фразе", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      await lateSounds(h, [laugh(200)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, ["laughter"]]);
    });

    it("агент засмеялся, а человек кашлянул — кашель принят", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! [laughs] Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      await lateSounds(h, [{ kind: "cough", agoMs: 200 }, laugh(200)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, ["cough"]]);
    });

    it("смех человека после того, как эхо тега давно прошло, принимается", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! [laughs] Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(6000);

      await lateSounds(h, [laugh(0)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, ["laughter"]]);
    });

    it("агент договорил «…[laughs]», через секунду человек смеётся в ответ — смех доходит, а не считается эхом", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! [laughs] Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(400);
      await vi.advanceTimersByTimeAsync(1800);

      await lateSounds(h, [laugh(0)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, ["laughter"]]);
    });

    it("тег в самом конце ответа («…[laughs]») тоже отмечается: смех сразу после него — эхо", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! Вот это да! [laughs]");
      h.bridge.finish();
      await h.flushPromises();
      h.player.played = 1500;
      await vi.advanceTimersByTimeAsync(400);

      await lateSounds(h, [laugh(100)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, undefined]);
    });

    it("слово «ах» внутри предложения — не звук агента: вздох человека в это время принимается", async () => {
      const h = harness();
      await speaking(h, "Ах, как красиво! Ну ты даёшь. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      await lateSounds(h, [sigh(200)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, ["sigh"]]);
    });

    it("отдельное звуковое междометие «Эх…» в речи агента — звук агента: вздох в микрофоне в это время эхо", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь. Эх… Ладно, давай дальше.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      await lateSounds(h, [sigh(200)]);
      h.heard("стоп");
      await say(h, "стоп давай про завтра");
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, undefined]);
    });

    it("эхо фильтруется и в звуках, пришедших вместе с концом фразы", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! [laughs] Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);
      h.heard("стоп");

      await say(h, "стоп давай про завтра", [laugh(200)]);
      await h.flushPromises();

      expect(h.bridge.sentSounds).toEqual([undefined, undefined]);
    });
  });

  it("выключение режима забывает копившиеся звуки: после повторного включения они не всплывают", async () => {
    const h = harness();
    await h.start({ speech: false });
    await lateSounds(h, [laugh()]);
    h.engine.close();

    await h.start({ speech: false });
    await say(h, "Привет");

    expect(h.bridge.sentSounds.at(-1)).toBeUndefined();
  });
});
