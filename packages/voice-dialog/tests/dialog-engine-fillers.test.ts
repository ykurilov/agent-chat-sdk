import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FILLER_SETTINGS } from "../src/browser/filler-scheduler";
import { FILLER_PHRASES, harness } from "./support/engine-harness";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof harness>;

const SERVER = { phrases: FILLER_PHRASES, audioMs: 1000 };

/** Дать загрузке (список голосов → список фраз → звук) дойти до конца: часы не двигаем. */
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

/** Режим включён, фразы загружены, человек договорил: модель думает. */
async function thinking(overrides: Parameters<typeof harness>[0] = {}) {
  const h = harness({ fillersServer: SERVER, ...overrides });
  await h.start();
  await settle();
  await h.saySomething("Найди новости");
  return h;
}

const fillerUrls = (h: Harness) => h.requests.filter((request) => request.url.includes("/fillers")).map((request) => request.url);

describe("заполнители: загрузка", () => {
  it("после «готов» и списка голосов тянет фразы голоса человека для этого чата", async () => {
    const h = harness({ fillersServer: SERVER });

    await h.start();
    await settle();

    const urls = fillerUrls(h);
    expect(urls[0]).toBe("http://test/api/voice-dialog/fillers");
    expect(urls).toContain("http://test/api/voice-dialog/fillers/web-0?voiceId=anna&chatId=c1");
    expect(urls).toHaveLength(1 + FILLER_PHRASES.length);
  });

  it("список голосов не получен: фразы всё равно грузятся голосом, который назвал сервер в «готов», и звучат", async () => {
    const h = harness({ fillersServer: SERVER, voices: null });
    await h.start({ voiceId: "anna" });
    await settle();
    expect(fillerUrls(h)).toContain("http://test/api/voice-dialog/fillers/web-0?voiceId=anna&chatId=c1");

    await h.saySomething("Найди новости");
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs);

    expect(h.player.fillers).toHaveLength(1);
  });

  it("выбор другого голоса догружает фразы нового голоса", async () => {
    const h = harness({ fillersServer: SERVER });
    await h.start();
    await settle();

    h.view()?.onSelectVoice?.("boris");
    await settle();

    expect(fillerUrls(h)).toContain("http://test/api/voice-dialog/fillers/web-0?voiceId=boris&chatId=c1");
  });

  it("озвучки на сервере нет — фразы не качаются и не звучат", async () => {
    const h = harness({ fillersServer: SERVER });
    await h.start({ speech: false });
    await settle();
    await h.saySomething();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(fillerUrls(h)).toEqual([]);
    expect(h.player.fillers).toHaveLength(0);
  });

  it("настройка fillers: false — ни загрузки, ни звука", async () => {
    const h = harness({ fillersServer: SERVER, fillers: false });
    await h.start();
    await settle();
    await h.saySomething();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(fillerUrls(h)).toEqual([]);
    expect(h.player.fillers).toHaveLength(0);
    expect(h.bridge.activitySubscribers).toBe(0);
  });

  it("сервер без заполнителей (404) — режим работает как раньше", async () => {
    const h = harness({ fillersServer: null });
    await h.start();
    await settle();
    await h.saySomething();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(h.player.fillers).toHaveLength(0);
    expect(h.view()?.state).toBe("thinking");
  });

  it("фраза не загрузилась — её просто нет, остальные звучат", async () => {
    const h = await thinking({ fillersServer: { ...SERVER, broken: ["thinking-0"] } });

    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 100);
    expect(h.player.fillers).toHaveLength(0);

    h.bridge.activity("tool", "start", { toolName: "web_search" });
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.toolAfterMs + 50);
    expect(h.player.fillers).toHaveLength(1);
  });
});

describe("заполнители: ход", () => {
  it("модель молчит дольше порога — звучит «Хмм…»; в чат и к серверу он не уходит, состояние «думает»", async () => {
    const h = await thinking();

    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs - 100);
    expect(h.player.fillers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(150);

    expect(h.player.fillers).toHaveLength(1);
    expect(h.player.fillers[0]!.length).toBe(48_000);
    expect(h.bridge.sent).toEqual(["Найди новости"]);
    expect(h.socket().ofType("speak")).toEqual([]);
    expect(h.view()?.state).toBe("thinking");
  });

  it("инструмент поиска идёт дольше порога — «Сейчас поищу в интернете.»; закончился раньше — тишина", async () => {
    const h = await thinking();
    h.bridge.activity("tool", "start", { toolName: "web_search" });
    await vi.advanceTimersByTimeAsync(300);
    h.bridge.activity("tool", "end", { toolName: "web_search" });
    await vi.advanceTimersByTimeAsync(300);
    expect(h.player.fillers).toHaveLength(0);

    h.bridge.activity("tool", "start", { toolName: "web_search", partIndex: 1 });
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.toolAfterMs + 50);

    expect(h.player.fillers).toHaveLength(1);
  });

  it("текст заполнителя в фильтре эха: его слова из микрофона не перебивают, а чужие — перебивают", async () => {
    const h = await thinking();
    h.bridge.activity("tool", "start", { toolName: "web_search" });
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.toolAfterMs + 50);
    expect(h.player.fillers).toHaveLength(1);

    h.heard("Сейчас поищу в интернете");
    expect(h.socket().ofType("interrupt")).toEqual([]);
    expect(h.player.flushes).toBe(0);

    h.heard("Нет подожди совсем другое");
    expect(h.socket().ofType("interrupt")).toHaveLength(1);
  });

  it("человек перебил заполнитель — он глохнет, новых не будет", async () => {
    const h = await thinking();
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);
    expect(h.player.fillerPlaying).toBe(true);

    h.heard("Стоп подожди пожалуйста");
    await h.flushPromises();

    expect(h.player.fillerPlaying).toBe(false);
    expect(h.player.flushes).toBeGreaterThan(0);
    h.bridge.activity("tool", "start", { toolName: "web_search" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.player.fillers).toHaveLength(1);
  });

  it("пошёл текст ответа раньше порога — заполнителя нет", async () => {
    const h = await thinking();
    await vi.advanceTimersByTimeAsync(1000);

    h.bridge.say("Вот что нашёл.");
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs * 3);

    expect(h.player.fillers).toHaveLength(0);
  });

  it("настоящий звук ответа идёт как обычно: кадры озвучки встают в очередь, заполнитель в неё не попадает", async () => {
    const h = await thinking();
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);

    h.bridge.say("Вот что нашёл.");
    h.socket().receiveSpeech(1, 200);
    await h.flushPromises();

    expect(h.player.queue).toHaveLength(1);
    expect(h.player.fillers).toHaveLength(1);
    expect(h.view()?.state).toBe("speaking");
  });

  it("ответ кончился без текста — ожидания сняты", async () => {
    const h = await thinking();

    h.bridge.finish("complete");
    await vi.advanceTimersByTimeAsync(20_000);

    expect(h.player.fillers).toHaveLength(0);
  });

  it("пока звучит настоящий ответ, инструмент ждёт тишины после него", async () => {
    const h = await thinking();
    h.bridge.say("Сейчас поищу.");
    h.socket().receiveSpeech(1, 500);
    await h.flushPromises();

    h.bridge.activity("tool", "start", { toolName: "web_search" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.player.fillers).toHaveLength(0);

    h.player.drain();
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.quietAfterAnswerMs - 100);
    expect(h.player.fillers).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.player.fillers).toHaveLength(1);
  });

  it("не больше двух заполнителей на ход, как бы долго ни думала модель", async () => {
    const h = await thinking();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.player.fillers).toHaveLength(2);
  });

  it("запоздалые события прерванного ответа новый ход не трогают", async () => {
    const h = await thinking();
    h.heard("Стоп подожди пожалуйста");
    await h.flushPromises();
    h.bridge.activity("tool", "start", { toolName: "web_search", messageId: "a1" });
    await vi.advanceTimersByTimeAsync(20_000);

    expect(h.player.fillers).toHaveLength(0);
  });

  it("закрытие режима: звук заглушён, ожидания сняты, подписка снята", async () => {
    const h = await thinking();
    expect(h.bridge.activitySubscribers).toBe(1);

    h.engine.close();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(h.player.fillers).toHaveLength(0);
    expect(h.bridge.activitySubscribers).toBe(0);
  });

  it("ход, который ждёт только заполнитель, заканчивается после того, как он договорил", async () => {
    const h = await thinking();
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);

    h.bridge.finish("complete");
    await h.flushPromises();
    expect(h.view()?.state).toBe("thinking");

    h.player.drainFiller();
    await h.flushPromises();
    expect(h.view()?.state).toBe("listening");
  });
});

describe("заполнители: речь человека, похожая на заполнитель", () => {
  const SO_SERVER = { ...SERVER, phrases: [{ id: "thinking-0", category: "thinking" as const, text: "Так…" }] };

  it("«Так.» человека, когда заполнитель давно отзвучал, уходит в чат: фильтр не считает его эхом", async () => {
    const h = harness({ fillersServer: SO_SERVER });
    await h.start();
    await settle();
    await h.saySomething("Привет");
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);
    expect(h.player.fillers).toHaveLength(1);
    h.bridge.finish("complete");
    h.player.drainFiller();
    await h.flushPromises();
    expect(h.view()?.state).toBe("listening");
    await vi.advanceTimersByTimeAsync(10_000);

    await h.saySomething("Так.");

    expect(h.bridge.sent).toEqual(["Привет", "Так."]);
  });

  it("«Дай-ка подумать.» человека, пока модель думает, дописывается к «Так.»: чат получает одно склеенное сообщение, второго хода нет", async () => {
    const h = await thinking({ fillersServer: SO_SERVER });
    await vi.advanceTimersByTimeAsync(DEFAULT_FILLER_SETTINGS.thinkingAfterMs + 50);

    h.heard("Дай-ка подумать");
    await h.saySomething("Дай-ка подумать.");
    await h.flushPromises();

    expect(h.socket().ofType("interrupt")).toHaveLength(1);
    expect(h.bridge.sent).toEqual(["Найди новости"]);
    expect(h.bridge.replaced).toEqual(["Найди новости Дай-ка подумать."]);
    expect(h.bridge.stops).toBe(0);
  });
});
