import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWebSocket, harness } from "./support/engine-harness";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof harness>;

/** Сколько сокетов открывал режим. */
const sockets = () => FakeWebSocket.instances.length;

/** Агент отвечает первой репликой и звук пошёл: режим в состоянии «говорит». */
async function speaking(h: Harness, answer = "Сегодня будет солнечно. Днём тепло.") {
  await h.start();
  await h.saySomething("Привет");
  h.bridge.say(answer);
  h.socket().receiveSpeech(1);
  await h.flushPromises();
}

const states = (h: Harness) => h.views.map((view) => view.state);

describe("включение и обычный ход", () => {
  it("нажатие: звук разблокируется и микрофон запрашивается сразу, внутри вызова open; сокет идёт на путь чата", () => {
    const h = harness();

    h.engine.open({ chatId: "чат 1", chat: h.bridge, onView: (view) => h.views.push(view) });

    expect(h.player.unlocks).toBe(1);
    expect(h.microphone.starts).toBe(1);
    expect(h.lifecycle.starts).toBe(1);
    expect(h.socket().url).toBe("ws://test/api/voice-dialog/stream?chatId=%D1%87%D0%B0%D1%82%201");
    expect(h.socket().binaryType).toBe("arraybuffer");
    expect(states(h)).toEqual(["connecting"]);
  });

  it("сокет открылся: первым уходит start с параметрами звука; «слушаю» — когда готовы и сервер, и микрофон", async () => {
    const h = harness();
    h.engine.open({ chatId: "c1", chat: h.bridge, onView: (view) => h.views.push(view) });

    h.socket().open();
    expect(h.socket().messages[0]).toEqual({ type: "start", audio: { format: "pcm_s16le", sampleRate: 16000, channels: 1 } });
    h.socket().receive({ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "anna", speech: true });
    await h.flushPromises();
    expect(h.view()?.state).toBe("connecting");

    h.microphone.granted();
    await h.flushPromises();
    expect(h.view()?.state).toBe("listening");
    expect(h.view()?.speechAvailable).toBe(true);
  });

  it("звук микрофона уходит на сервер кусками после start; до открытия сокета не уходит", async () => {
    const h = harness();
    h.engine.open({ chatId: "c1", chat: h.bridge, onView: (view) => h.views.push(view) });
    h.microphone.granted();
    await h.flushPromises();
    h.microphone.feed();
    expect(h.socket().audio).toHaveLength(0);

    h.socket().open();
    h.socket().receive({ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "anna", speech: true });
    h.microphone.feed();
    h.microphone.feed();

    expect(h.socket().audio).toHaveLength(2);
  });

  it("конец фразы → слова уходят агенту через мост, prepare идёт раньше, состояние «думает»", async () => {
    const h = harness();
    await h.start();

    await h.saySomething("Расскажи про погоду");

    expect(h.bridge.sent).toEqual(["Расскажи про погоду"]);
    expect(h.view()?.state).toBe("thinking");
    expect(h.socket().ofType("prepare")).toEqual([{ type: "prepare", replyId: 1 }]);
    expect(h.log.indexOf("ws:prepare")).toBeLessThan(h.log.indexOf("chat:send:Расскажи про погоду"));
  });

  it("предложения ответа уходят на озвучку по мере готовности, с номером реплики и id сообщения; конец ответа шлёт end_reply", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();

    h.bridge.say("Сегодня будет ");
    expect(h.socket().ofType("speak")).toEqual([]);
    h.bridge.say("солнечно. Днём тепло");
    expect(h.socket().ofType("speak")).toEqual([{ type: "speak", replyId: 1, text: "Сегодня будет солнечно.", messageId: "a1" }]);

    h.bridge.say(".");
    h.bridge.finish();
    expect(h.socket().ofType("speak").map((message) => message.text)).toEqual(["Сегодня будет солнечно.", "Днём тепло."]);
    expect(h.socket().ofType("end_reply")).toEqual([{ type: "end_reply", replyId: 1 }]);
  });

  it("звук ответа идёт в плеер, первый кадр — «говорит»; конец озвучки и доигранный звук — снова «слушаю»", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.bridge.say("Сегодня будет солнечно. Днём тепло.");
    h.bridge.finish();

    h.socket().receiveSpeech(1, 200);
    expect(h.player.queue).toHaveLength(1);
    expect(h.view()?.state).toBe("speaking");

    h.socket().receive({ type: "speech_done", replyId: 1, spokenChars: 34 });
    expect(h.view()?.state).toBe("speaking");
    h.player.drain();
    expect(h.view()?.state).toBe("listening");
  });

  it("порядок номеров: следующая реплика получает следующий номер и начинает счёт проигранного заново", async () => {
    const h = harness();
    await h.start();
    await h.saySomething("Первое");
    h.bridge.say("Ответ раз. ");
    h.bridge.finish();
    h.socket().receive({ type: "speech_done", replyId: 1, spokenChars: 9 });
    h.player.drain();

    await h.saySomething("Второе");

    expect(h.socket().ofType("prepare").map((message) => message.replyId)).toEqual([1, 2]);
  });

  it("части ответа разделены пустой строкой: предложения разных частей не склеиваются", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();

    h.bridge.say("Первая часть без точки", 0);
    h.bridge.say("Вторая часть без точки", 1);
    h.bridge.finish();

    expect(h.socket().ofType("speak").map((message) => message.text)).toEqual(["Первая часть без точки", "Вторая часть без точки"]);
  });

  it("код в ответе не читается: вместо блока звучит «код на экране»", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();

    h.bridge.say("Вот пример.\n```js\nconst a = 1;\n```\nГотово.");
    h.bridge.finish();

    expect(h.socket().ofType("speak").map((message) => message.text)).toEqual(["Вот пример.", "код на экране", "Готово."]);
  });

  it("пустая фраза не уходит: ни слов агенту, ни prepare, режим остаётся в «слушаю»", async () => {
    const h = harness();
    await h.start();

    await h.saySomething("");
    await h.saySomething("   ");

    expect(h.bridge.sent).toEqual([]);
    expect(h.socket().ofType("prepare")).toEqual([]);
    expect(h.view()?.state).toBe("listening");
  });

  it("выход по кнопке освобождает микрофон, сокет и звук, а ответ агента не отменяет", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.bridge.say("Сегодня будет солнечно. Днём тепло.");
    h.socket().receiveSpeech(1);

    h.engine.close();
    await vi.advanceTimersByTimeAsync(2000);

    expect(h.microphone.stops).toBe(1);
    expect(h.socket().closedWith).not.toBeNull();
    expect(h.player.closed).toBe(true);
    expect(h.lifecycle.stops).toBe(1);
    expect(h.bridge.stops).toBe(0);
    expect(h.bridge.subscribers).toBe(0);
    expect(h.view()?.state).toBe("off");
  });

  it("выход из «подключаюсь» до открытия микрофона: когда он всё же открылся, его тут же отпускают", async () => {
    const h = harness();
    h.engine.open({ chatId: "c1", chat: h.bridge, onView: (view) => h.views.push(view) });

    h.engine.close();
    h.microphone.granted();
    await h.flushPromises();

    expect(h.microphone.stops).toBe(1);
  });

  it("повторное включение после выхода работает: новый сокет, снова разблокировка звука", async () => {
    const h = harness();
    await h.start();
    h.engine.close();

    await h.start();

    expect(h.view()?.state).toBe("listening");
    expect(h.player.unlocks).toBe(2);
    expect(h.microphone.starts).toBe(2);
  });

  it("сервер без озвучки (speech: false): режим слушает и пишет, prepare и speak не уходят, ответ кончается без звука", async () => {
    const h = harness();
    await h.start({ speech: false });
    expect(h.view()?.speechAvailable).toBe(false);
    await h.saySomething();

    h.bridge.say("Сегодня будет солнечно. Днём тепло.");
    h.bridge.finish();

    expect(h.socket().ofType("prepare")).toEqual([]);
    expect(h.socket().ofType("speak")).toEqual([]);
    expect(h.socket().ofType("end_reply")).toEqual([]);
    expect(h.view()?.state).toBe("listening");
  });
});

describe("голоса", () => {
  it("список голосов из HTTP доходит до вида, меню — когда голосов два и больше", async () => {
    const h = harness();
    await h.start();
    await h.flushPromises();

    expect(h.requests[0]).toMatchObject({ url: "http://test/api/voice-dialog/voices", method: "GET" });
    expect(h.view()?.voices).toEqual([{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }]);
    expect(h.view()?.currentVoiceId).toBe("anna");
  });

  it("один голос — меню нет; список не загрузился — режим работает без меню", async () => {
    const one = harness({ voices: { voices: [{ id: "anna", name: "Анна" }], current: "anna", persisted: true } });
    await one.start();
    await one.flushPromises();
    expect(one.view()?.voices).toBeUndefined();

    const broken = harness({ voices: null });
    await broken.start();
    await broken.flushPromises();
    expect(broken.view()?.state).toBe("listening");
    expect(broken.view()?.voices).toBeUndefined();
  });

  it("выбор голоса: PUT на сервер и команда voice в открытый сокет; в виде новый голос", async () => {
    const h = harness();
    await h.start();
    await h.flushPromises();

    h.view()?.onSelectVoice?.("boris");
    await h.flushPromises();

    expect(h.requests.find((request) => request.method === "PUT")).toMatchObject({ url: "http://test/api/voice-dialog/voice", body: { voiceId: "boris" } });
    expect(h.socket().ofType("voice")).toEqual([{ type: "voice", voiceId: "boris" }]);
    expect(h.view()?.currentVoiceId).toBe("boris");
  });

  it("движок отдаёт список и выбор и без включённого режима", async () => {
    const h = harness();

    expect(await h.engine.loadVoices()).toEqual({ voices: [{ id: "anna", name: "Анна" }, { id: "boris", name: "Борис" }], current: "anna", persisted: true });
    await h.engine.selectVoice("boris");
    expect(h.requests.at(-1)).toMatchObject({ method: "PUT" });
  });
});

describe("задержка", () => {
  it("метки хода от конца фразы до первого звука уходят в onMetrics", async () => {
    let clock = 1000;
    const h = harness({ now: () => clock });
    await h.start();

    await h.saySomething();
    clock = 1400;
    h.bridge.say("Сегодня будет солнечно.");
    clock = 1500;
    h.bridge.say(" Днём тепло.");
    clock = 1700;
    h.socket().receive({ type: "speech_started", replyId: 1, serverTimeMs: 5 });
    clock = 1800;
    h.socket().receiveSpeech(1);

    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]?.marks).toEqual({ phraseEndAt: 1000, firstTextAt: 1400, firstSentenceAt: 1500, speechStartedAt: 1700, firstSampleAt: 1800 });
    expect(h.reports[0]?.totalMs).toBe(800);
  });
});

describe("перебивание", () => {
  it("слово прошло фильтр: тишина в плеере, interrupt с проигранным, стоп ответа; слова фразы уходят следующим сообщением после остановки", async () => {
    const h = harness();
    await speaking(h);
    h.player.played = 1200;
    let release!: () => void;
    h.bridge.stopGate = new Promise<void>((resolve) => (release = resolve));

    h.heard("подожди");

    expect(h.view()?.state).toBe("interrupted");
    expect(h.socket().ofType("interrupt")).toEqual([{ type: "interrupt", replyId: 1, playedMs: 1200 }]);
    const order = h.log.filter((entry) => ["player:flush", "ws:interrupt", "chat:stop"].includes(entry));
    expect(order).toEqual(["player:flush", "ws:interrupt", "chat:stop"]);

    await h.saySomething("подожди а как насчёт завтра");
    expect(h.bridge.sent).toEqual(["Привет"]);

    release();
    await h.flushPromises();
    expect(h.bridge.sent).toEqual(["Привет", "подожди а как насчёт завтра"]);
    expect(h.log.indexOf("chat:stopped")).toBeLessThan(h.log.indexOf("chat:send:подожди а как насчёт завтра"));
    expect(h.view()?.state).toBe("thinking");
    expect(h.socket().ofType("prepare").map((message) => message.replyId)).toEqual([1, 2]);
  });

  it("две фразы, пришедшие, пока идёт остановка прежнего ответа, уходят одним сообщением, слова не теряются", async () => {
    const h = harness();
    await speaking(h);
    let release!: () => void;
    h.bridge.stopGate = new Promise<void>((resolve) => (release = resolve));
    h.heard("стоп");

    await h.saySomething("подожди");
    await h.saySomething("давай про завтра");
    expect(h.bridge.sent).toEqual(["Привет"]);

    release();
    await h.flushPromises();

    expect(h.bridge.sent).toEqual(["Привет", "подожди давай про завтра"]);
    expect(h.socket().ofType("prepare").map((message) => message.replyId)).toEqual([1, 2]);
    expect(h.view()?.state).toBe("thinking");
  });

  it("фраза после склеенных уходит отдельным сообщением: ничего не пропадает и не склеивается лишнего", async () => {
    const h = harness();
    await speaking(h);
    let release!: () => void;
    h.bridge.stopGate = new Promise<void>((resolve) => (release = resolve));
    h.heard("стоп");
    await h.saySomething("подожди");
    await h.saySomething("ещё слово");
    release();
    await h.flushPromises();
    h.bridge.say("Хорошо. Слушаю.", 0, "a2");
    h.bridge.finish("complete", "a2");
    h.socket().receive({ type: "speech_done", replyId: 2, spokenChars: 0 });
    await h.flushPromises();
    await h.saySomething("и последнее");
    expect(h.bridge.sent).toEqual(["Привет", "подожди ещё слово", "и последнее"]);
  });

  it("перебивание в «думает» (звука ещё нет): interrupt с нулём, ответ останавливается", async () => {
    const h = harness();
    await h.start();
    await h.saySomething("Расскажи");

    h.heard("стоп");
    await h.flushPromises();

    expect(h.socket().ofType("interrupt")).toEqual([{ type: "interrupt", replyId: 1, playedMs: 0 }]);
    expect(h.bridge.stops).toBe(1);
    expect(h.view()?.state).toBe("interrupted");
  });

  it("после перебивания приходит пустая фраза: агент остановлен, режим снова слушает, ничего не отправлено", async () => {
    const h = harness();
    await speaking(h);
    h.heard("стоп");

    await h.saySomething("");

    expect(h.bridge.sent).toEqual(["Привет"]);
    expect(h.view()?.state).toBe("listening");
  });

  it("два перебивания подряд: каждая фраза уходит один раз, interrupt и остановка — по одному на перебивание", async () => {
    const h = harness();
    await speaking(h);
    h.heard("стоп");
    await h.saySomething("стоп давай про завтра");
    expect(h.bridge.sent).toEqual(["Привет", "стоп давай про завтра"]);

    h.bridge.say("Завтра будет дождь. Возьмите зонт.");
    h.socket().receiveSpeech(2);
    h.heard("подожди");
    h.heard("ещё");
    await h.saySomething("подожди а послезавтра");
    await h.flushPromises();

    expect(h.bridge.sent).toEqual(["Привет", "стоп давай про завтра", "подожди а послезавтра"]);
    expect(h.socket().ofType("interrupt").map((message) => message.replyId)).toEqual([1, 2]);
    expect(h.bridge.stops).toBe(2);
    expect(h.socket().ofType("prepare").map((message) => message.replyId)).toEqual([1, 2, 3]);
  });

  it("эхо не перебивает: слова только что озвученного из микрофона — не перебивание", async () => {
    const h = harness();
    await speaking(h, "Сегодня в Москве будет облачно без дождя. Вечером похолодает.");
    h.player.played = 1000;
    await vi.advanceTimersByTimeAsync(500);

    h.heard("в Москве будет");

    expect(h.view()?.state).toBe("speaking");
    expect(h.socket().ofType("interrupt")).toEqual([]);
  });

  it("озвученное отмечается понемногу по ходу проигрывания: эхо слова из середины длинного предложения узнаётся и через 8 секунд", async () => {
    const sentence = "Сегодня утром над рекой стоял густой туман а потом поднялся лёгкий ветер и туман медленно рассеялся над лугами где пасутся коровы и бегают маленькие смешные ягнята рядом с большим старым дубом.";
    const position = sentence.indexOf("лугами");
    expect(position).toBeGreaterThan(95);
    expect(position).toBeLessThan(115);
    const h = harness();
    await speaking(h, `${sentence} Дальше.`);
    for (let elapsed = 400; elapsed <= 8000; elapsed += 400) {
      h.player.played = elapsed;
      await vi.advanceTimersByTimeAsync(400);
    }

    h.heard("лугами");

    expect(h.socket().ofType("interrupt")).toEqual([]);
    expect(h.view()?.state).toBe("speaking");
  });

  describe("теги голоса и эхо", () => {
    it("смех модели в микрофоне («Ха-ха») после тега [laughs] — эхо, а не перебивание", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь! [laughs] Вот это да. Ладно.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      h.heard("Ха-ха");

      expect(h.view()?.state).toBe("speaking");
      expect(h.socket().ofType("interrupt")).toEqual([]);
    });

    it("длинный смех на слух («Ха-ха-ха-ха»), вздох («Ооох») и «Хи-хи-хи» после тегов — эхо по шаблону, не по списку", async () => {
      for (const [text, heard] of [
        ["Ну ты даёшь! [laughs] Вот это да. Ладно.", "Ха-ха-ха-ха"],
        ["Ну ты даёшь! [chuckles] Вот это да. Ладно.", "Хи-хи-хи-хи"],
        ["Ладно. [sighs] Что поделаешь. Дальше.", "Оох"],
      ] as const) {
        const h = harness();
        await speaking(h, text);
        h.player.played = 1000;
        await vi.advanceTimersByTimeAsync(500);

        h.heard(heard);

        expect(h.socket().ofType("interrupt"), heard).toEqual([]);
      }
    });

    it("вздох модели в микрофоне («Эх») после тега [sighs] — не перебивание", async () => {
      const h = harness();
      await speaking(h, "Ладно. [sighs] Что поделаешь. Дальше.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      h.heard("Фух");

      expect(h.socket().ofType("interrupt")).toEqual([]);
    });

    it("смех до того, как озвучка дошла до тега, ещё не ждали: «ха-ха» перебивает", async () => {
      const h = harness();
      await speaking(h, "Ну ты даёшь, друг мой дорогой, неужели. [laughs] Вот это да.");
      h.player.played = 0;
      await vi.advanceTimersByTimeAsync(400);

      h.heard("Ха-ха");

      expect(h.view()?.state).toBe("interrupted");
    });

    it("слова тега («laughs», «whispers») не ждутся как озвученные: «laughs» из микрофона — новое слово", async () => {
      const h = harness();
      await speaking(h, "[whispers] Сегодня в Москве будет облачно без дождя. Вечером похолодает.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      h.heard("whispers");

      expect(h.view()?.state).toBe("interrupted");
    });

    it("счёт скорости речи — без знаков тегов: тег не съедает озвученный текст", async () => {
      // 1000 мс + запас 500 мс при 15 знаках/с — 22 знака текста без тегов: «Сегодня в Москве будет».
      const h = harness();
      await speaking(h, "[whispers] Сегодня в Москве будет облачно без дождя. Вечером похолодает.");
      h.player.played = 1000;
      await vi.advanceTimersByTimeAsync(500);

      h.heard("будет");

      expect(h.socket().ofType("interrupt")).toEqual([]);
      expect(h.view()?.state).toBe("speaking");
    });

    it("в озвучку тег уходит как есть: сервер получает текст с тегом", async () => {
      const h = harness();
      await speaking(h, "[whispers] Тихо. Дальше.");
      expect(h.socket().ofType("speak").map((message) => message.text)).toContain("[whispers] Тихо.");
    });
  });

  it("слово, которое агент ещё не произнёс, — не эхо: перебивает", async () => {
    const h = harness();
    await speaking(h, "Сегодня в Москве будет облачно без дождя. Вечером похолодает.");
    h.player.played = 500;
    await vi.advanceTimersByTimeAsync(400);

    h.heard("похолодает");

    expect(h.view()?.state).toBe("interrupted");
  });

  it("фраза кончилась, а перебивания по словам не было: слова эха отбрасываются, новые слова перебивают", async () => {
    const h = harness();
    await speaking(h, "Сегодня в Москве будет облачно без дождя. Вечером похолодает.");
    h.player.played = 1000;
    await vi.advanceTimersByTimeAsync(500);

    await h.saySomething("в Москве будет");
    expect(h.bridge.sent).toEqual(["Привет"]);
    expect(h.view()?.state).toBe("speaking");

    await h.saySomething("а завтра что");
    expect(h.bridge.sent).toEqual(["Привет", "а завтра что"]);
  });

  it("звук старой реплики, пришедший после перебивания, не играет; текст старого ответа не озвучивается", async () => {
    const h = harness();
    await speaking(h);
    h.heard("стоп");
    const queued = h.player.queue.length;

    h.socket().receiveSpeech(1);
    h.bridge.say(" Ещё одно предложение. И ещё.");
    h.bridge.finish("stopped");

    expect(h.player.queue).toHaveLength(queued);
    expect(h.socket().ofType("speak")).toHaveLength(1);
    expect(h.socket().ofType("end_reply")).toEqual([]);
    expect(h.view()?.state).toBe("interrupted");
  });

  it("конец прежнего (перебитого) ответа, пришедший уже после отправки новой фразы, не закрывает новую реплику", async () => {
    const h = harness();
    await speaking(h);
    h.heard("стоп");
    await h.saySomething("давай про завтра");
    expect(h.view()?.state).toBe("thinking");

    h.bridge.finish("stopped", "a1");
    await h.flushPromises();

    expect(h.view()?.state).toBe("thinking");
    expect(h.socket().ofType("end_reply")).toEqual([]);
    // Новый ответ идёт как обычно и заканчивается своим концом.
    h.bridge.say("Завтра дождь.", 0, "a2");
    h.socket().receiveSpeech(2);
    h.bridge.finish("complete", "a2");
    expect(h.socket().ofType("end_reply")).toEqual([{ type: "end_reply", replyId: 2 }]);
  });

  it("текст прежнего ответа, дописанный после отправки новой фразы, не озвучивается в новой реплике", async () => {
    const h = harness();
    await speaking(h);
    h.heard("стоп");
    await h.saySomething("давай про завтра");
    const spoken = h.socket().ofType("speak").length;

    h.bridge.say(" Хвост старого ответа.", 0, "a1");
    expect(h.socket().ofType("speak")).toHaveLength(spoken);

    h.bridge.say("Завтра дождь. Потом", 0, "a2");
    const texts = h.socket().ofType("speak").slice(spoken);
    expect(texts).toEqual([{ type: "speak", replyId: 2, text: "Завтра дождь.", messageId: "a2" }]);
  });

  it("у реплики уже есть ответ a2: конец другого сообщения не закрывает её, конец a2 закрывает", async () => {
    const h = harness();
    await h.start();
    await h.saySomething("Привет");
    h.bridge.say("Отвечаю.", 0, "a2");
    h.socket().receiveSpeech(1);

    h.bridge.finish("complete", "a1");
    expect(h.socket().ofType("end_reply")).toEqual([]);

    h.bridge.finish("complete", "a2");
    expect(h.socket().ofType("end_reply")).toEqual([{ type: "end_reply", replyId: 1 }]);
  });

  it("отказ отправки (messageId пустой) по-прежнему закрывает реплику", async () => {
    const h = harness();
    await h.start();
    await h.saySomething("Привет");

    h.bridge.finish("error", "");

    expect(h.view()?.state).toBe("listening");
  });

  it("speech_cut: позиция обрыва по карте текста уходит на сервер (mark_cut) и показывается на экране сразу", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.bridge.say("Первый абзац закончен.", 0);
    h.bridge.say("Второй абзац идёт дальше.", 1);
    h.bridge.finish();
    h.socket().receiveSpeech(1);
    h.heard("стоп");

    // 22 знака первого предложения, пробел и «Второй » — 30 озвученных знаков
    h.socket().receive({ type: "speech_cut", replyId: 1, spokenChars: 30, spokenTail: "…закончен. Второй" });

    const cut = { partIndex: 1, charOffset: 7, spokenTail: "…закончен. Второй" };
    expect(h.socket().ofType("mark_cut")).toEqual([{ type: "mark_cut", replyId: 1, messageId: "a1", ...cut }]);
    expect(h.bridge.cuts).toEqual([{ messageId: "a1", cut }]);
  });

  it("обрыв внутри первой части: partIndex 0", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.bridge.say("Первый абзац закончен.", 0);
    h.bridge.say("Второй абзац идёт дальше.", 1);
    h.bridge.finish();
    h.socket().receiveSpeech(1);
    h.heard("стоп");

    h.socket().receive({ type: "speech_cut", replyId: 1, spokenChars: 6, spokenTail: "Первый" });

    expect(h.socket().ofType("mark_cut")[0]).toMatchObject({ partIndex: 0, charOffset: 6 });
  });

  it("ничего не озвучено (spokenChars 0): отметки нет ни на сервере, ни на экране", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.heard("стоп");

    h.socket().receive({ type: "speech_cut", replyId: 1, spokenChars: 0, spokenTail: "" });

    expect(h.socket().ofType("mark_cut")).toEqual([]);
    expect(h.bridge.cuts).toEqual([]);
  });

  it("ответ сервера cut_saved и cut_rejected режим не ломает", async () => {
    const h = harness();
    await speaking(h);

    h.socket().receive({ type: "cut_saved", messageId: "a1" });
    h.socket().receive({ type: "cut_rejected", messageId: "a1" });

    expect(h.view()?.state).toBe("speaking");
  });
});

describe("ошибки", () => {
  it("озвучка недоступна: текст остаётся, режим продолжает слушать, новых предложений на озвучку нет", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.bridge.say("Сегодня будет солнечно. Днём тепло.");
    h.socket().receive({ type: "speech_failed", replyId: 1, kind: "unavailable" });

    h.bridge.say(" Ночью прохладно.");
    h.bridge.finish();

    expect(h.socket().ofType("speak")).toHaveLength(1);
    expect(h.view()?.state).toBe("listening");
    expect(h.view()?.speechAvailable).toBe(false);
  });

  it("потолок знаков (cap): режим слушает дальше, озвучка следующей реплики остаётся доступной", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();
    h.bridge.say("Сегодня будет солнечно. Днём тепло.");
    h.socket().receive({ type: "speech_failed", replyId: 1, kind: "cap" });
    h.bridge.finish();
    expect(h.view()?.state).toBe("listening");
    expect(h.view()?.speechAvailable).toBe(true);

    await h.saySomething("Ещё");
    expect(h.socket().ofType("prepare").map((message) => message.replyId)).toEqual([1, 2]);
  });

  it("ошибка ответа агента: режим возвращается в «слушаю»", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();

    h.bridge.finish("error");

    expect(h.view()?.state).toBe("listening");
  });

  it("слова не ушли (мост сообщил об отказе): режим возвращается в «слушаю»", async () => {
    const h = harness();
    await h.start();
    await h.saySomething();

    h.bridge.finish("error", "");

    expect(h.view()?.state).toBe("listening");
  });

  it("обрыв распознавания (сообщение error): выход с надписью «связь потеряна», всё освобождено", async () => {
    const h = harness();
    await h.start();

    h.socket().receive({ type: "error", kind: "recognition_lost" });

    expect(h.view()).toMatchObject({ state: "error", error: "recognition_lost" });
    expect(h.microphone.stops).toBe(1);
    expect(h.socket().closedWith).not.toBeNull();
    expect(h.player.closed).toBe(true);
  });

  it.each([
    [4502, "recognition_lost"],
    [4402, "limit"],
    [4429, "rate_limited"],
    [4408, "idle"],
    [4403, "service_unavailable"],
    [4401, "service_unavailable"],
    [4400, "service_unavailable"],
  ] as const)("закрытие сервером с кодом %i — ошибка %s без попыток переподключения", async (code, error) => {
    const h = harness();
    await h.start();

    h.socket().drop(code);
    await vi.advanceTimersByTimeAsync(5000);

    expect(h.view()).toMatchObject({ state: "error", error });
    expect(sockets()).toBe(1);
    expect(h.microphone.stops).toBe(1);
  });

  it("сообщение rate_limited от сервера: ошибка rate_limited", async () => {
    const h = harness();
    await h.start();

    h.socket().receive({ type: "error", kind: "rate_limited" });

    expect(h.view()).toMatchObject({ state: "error", error: "rate_limited" });
  });

  it("обрыв связи: сокет открывается заново, микрофон остаётся, режим продолжает слушать", async () => {
    const h = harness();
    await h.start();
    const first = h.socket();

    first.drop(1006);
    expect(h.view()?.state).toBe("listening");
    await vi.advanceTimersByTimeAsync(300);
    expect(sockets()).toBe(2);
    h.socket().open();
    expect(h.socket().messages[0]?.type).toBe("start");
    h.socket().receive({ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "anna", speech: true });
    h.microphone.feed();

    expect(h.view()?.state).toBe("listening");
    expect(h.microphone.stops).toBe(0);
    expect(h.socket().audio).toHaveLength(1);
  });

  it("связь не возвращается: три попытки, потом ошибка «нет связи»", async () => {
    const h = harness();
    await h.start();

    h.socket().drop(1006);
    await vi.advanceTimersByTimeAsync(300);
    h.socket().fail();
    await vi.advanceTimersByTimeAsync(1000);
    h.socket().fail();
    await vi.advanceTimersByTimeAsync(2000);
    expect(sockets()).toBe(4);
    h.socket().fail();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sockets()).toBe(4);
    expect(h.view()).toMatchObject({ state: "error", error: "network" });
    expect(h.microphone.stops).toBe(1);
  });

  it("после удачного возвращения связи счёт попыток начинается заново", async () => {
    const h = harness();
    await h.start();
    for (let round = 0; round < 4; round++) {
      h.socket().drop(1006);
      await vi.advanceTimersByTimeAsync(300);
      h.socket().open();
      h.socket().receive({ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "anna", speech: true });
    }

    expect(h.view()?.state).toBe("listening");
  });

  it("обрыв связи во время ответа: озвучка этого ответа прекращается, текст доходит, режим возвращается к слушанию", async () => {
    const h = harness();
    await speaking(h);

    h.socket().drop(1006);
    expect(h.player.flushes).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    h.socket().open();
    h.socket().receive({ type: "ready", maxSessionSeconds: 1800, idleSeconds: 180, voiceId: "anna", speech: true });
    h.bridge.say(" Ночью прохладно.");
    h.bridge.finish();

    expect(h.socket().ofType("speak")).toEqual([]);
    expect(h.view()?.state).toBe("listening");
  });

  it("микрофон запрещён: ошибка microphone_denied, сокет закрыт", async () => {
    const h = harness();
    h.engine.open({ chatId: "c1", chat: h.bridge, onView: (view) => h.views.push(view) });
    h.socket().open();

    h.microphone.refused("microphone_denied");
    await h.flushPromises();

    expect(h.view()).toMatchObject({ state: "error", error: "microphone_denied" });
    expect(h.socket().closedWith).not.toBeNull();
    expect(h.player.closed).toBe(true);
  });

  it("микрофона нет: ошибка microphone_missing", async () => {
    const h = harness();
    h.engine.open({ chatId: "c1", chat: h.bridge, onView: (view) => h.views.push(view) });

    h.microphone.refused("microphone_missing");
    await h.flushPromises();

    expect(h.view()).toMatchObject({ state: "error", error: "microphone_missing" });
  });

  it("после ошибки режим включается снова одним нажатием", async () => {
    const h = harness();
    await h.start();
    h.socket().receive({ type: "error", kind: "recognition_lost" });

    await h.start();

    expect(h.view()?.state).toBe("listening");
  });
});

describe("уход со страницы", () => {
  it("страница ушла в фон: режим закрывается с ошибкой backgrounded, всё освобождено, ответ агента не отменён", async () => {
    const h = harness();
    await speaking(h);

    h.lifecycle.leave("hidden");

    expect(h.view()).toMatchObject({ state: "error", error: "backgrounded" });
    expect(h.microphone.stops).toBe(1);
    expect(h.socket().closedWith).not.toBeNull();
    expect(h.player.closed).toBe(true);
    expect(h.lifecycle.stops).toBe(1);
    expect(h.bridge.stops).toBe(0);
  });

  it.each(["pagehide", "audio_interrupted"] as const)("причина %s закрывает режим так же", async (reason) => {
    const h = harness();
    await h.start();

    h.lifecycle.leave(reason);

    expect(h.view()).toMatchObject({ state: "error", error: "backgrounded" });
  });

  it("контексты звука микрофона и плеера отданы на слежение (iOS отбирает звук)", async () => {
    const h = harness();
    await h.start();

    expect(h.lifecycle.watched).toContain(h.microphone.audioContext);
    expect(h.lifecycle.watched).toContain(h.player.audioContext);
  });

  it("после ухода в фон режим включается заново одним нажатием", async () => {
    const h = harness();
    await h.start();
    h.lifecycle.leave("hidden");

    await h.start();

    expect(h.view()?.state).toBe("listening");
    expect(h.lifecycle.starts).toBe(2);
  });
});
