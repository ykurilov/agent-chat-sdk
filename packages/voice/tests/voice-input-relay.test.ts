import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceInput } from "../src/index";
import { createHarness, FakeWebSocket, settle } from "./support/fakes";
import type { Harness } from "./support/fakes";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const relayOptions = (harness: Harness) => ({ ...harness.options, mode: "relay" as const, relayUrl: "wss://app.test/api/voice/stream" });
const ready = { ready: true, max_session_seconds: 300 };
const decoded = async (sent: string | ArrayBuffer | Blob) =>
  typeof sent === "string" ? sent : Array.from(new Uint8Array(await new Blob([sent]).arrayBuffer()));

/** Диктовка через сервер доведена до идущей записи. */
async function startRelayed(harness: Harness, options: Partial<ReturnType<typeof relayOptions>> = {}) {
  const session = createVoiceInput({ ...relayOptions(harness), ...options }).start(harness.listener);
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  harness.socket().open();
  await settle();
  harness.socket().receive(ready);
  await settle();
  return session;
}

describe("диктовка через сервер приложения", () => {
  it("микрофон → соединение с сервером (не с Soniox, ключа не спрашивает) → приветствие → запись только после «готово»", async () => {
    const harness = createHarness();
    createVoiceInput(relayOptions(harness)).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.socket().url).toBe("wss://app.test/api/voice/stream");

    harness.socket().open();
    await settle();
    expect(JSON.parse(harness.socket().sent[0] as string)).toEqual({ audio_format: "auto" });
    expect(harness.events).toEqual([]);

    harness.socket().receive(ready);
    await settle();
    expect(harness.events).toEqual(["connected"]);
    expect(harness.recorder().startedWithChunkMs).toBe(120);
  });

  it("звук и команда «закрепи всё» идут на сервер; слова приходят как от Soniox, метка <fin> завершает диктовку", async () => {
    const harness = createHarness();
    const session = await startRelayed(harness);

    harness.recorder().produceChunk(1, 2);
    await settle();
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }, { text: " ми", is_final: false }] });
    session.stop();
    await settle();
    harness.socket().receive({ tokens: [{ text: " мир", is_final: true }, { text: "<fin>", is_final: true }] });
    await settle();

    expect(await Promise.all(harness.socket().sent.slice(1).map(decoded))).toEqual([[1, 2], [9, 9], JSON.stringify({ type: "finalize" })]);
    expect(harness.events).toEqual(["connected", "text:Привет| ми", "text:Привет мир|", "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it("адрес сервера по умолчанию строится от `api` и адреса страницы", async () => {
    vi.stubGlobal("location", { protocol: "https:", host: "app.test" });
    const harness = createHarness();

    createVoiceInput({ ...harness.options, mode: "relay" }).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    expect(harness.socket().url).toBe("wss://app.test/api/voice/stream");
  });

  it.each([
    [4401, "service_unavailable"],
    [4429, "rate_limited"],
    [4502, "service_unavailable"],
    [4400, "other"],
    [1006, "network"],
  ])("сервер закрыл соединение кодом %i — %s", async (code, kind) => {
    const harness = createHarness();
    await startRelayed(harness);

    harness.socket().closeFromServer(code);
    await settle();

    expect(harness.events.slice(-2)).toEqual([`error:${kind}`, "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it("отказ до «готово» (сервер закрыл сразу) — ошибка, запись не началась", async () => {
    const harness = createHarness();
    createVoiceInput(relayOptions(harness)).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    harness.socket().open();
    await settle();

    harness.socket().closeFromServer(4429);
    await settle();

    expect(harness.events).toEqual(["error:rate_limited", "end"]);
    expect(harness.stream.released).toBe(true);
  });

  it("сервер закрыл по пределу (4408): остаток слов сохранён, человек видит причину", async () => {
    const harness = createHarness();
    await startRelayed(harness);
    harness.socket().receive({ tokens: [{ text: "Привет", is_final: true }] });

    harness.socket().closeFromServer(4408);
    await settle();

    expect(harness.events.slice(-3)).toEqual(["text:Привет|", "error:time_limit", "end"]);
  });

  it("свой таймер предела: сервер назвал 10 секунд — за две до них запись останавливается", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    createVoiceInput(relayOptions(harness)).start(harness.listener);
    // Часы подменены: время двигаем сами.
    await vi.advanceTimersByTimeAsync(0);
    harness.socket().open();
    await vi.advanceTimersByTimeAsync(0);
    harness.socket().receive({ ready: true, max_session_seconds: 10 });
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(8_100);

    expect(harness.recorder().state).toBe("inactive");
  });

  it("отмена во время подключения закрывает соединение с сервером и молчит", async () => {
    const harness = createHarness();
    const session = createVoiceInput(relayOptions(harness)).start(harness.listener);
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    session.cancel();
    await settle();

    expect(harness.socket().closedByClient).toBe(true);
    expect(harness.events).toEqual([]);
    expect(harness.stream.released).toBe(true);
  });

  describe("чистка текста сервером", () => {
    const readyWithPolish = { ...ready, polish: true };

    /** Диктовка с чисткой: «стоп» нажат, метка <fin> пришла. */
    async function stoppedAndFinalized(harness: Harness, options: Partial<ReturnType<typeof relayOptions>> = {}) {
      const session = createVoiceInput({ ...relayOptions(harness), ...options }).start(harness.listener);
      await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      harness.socket().open();
      await settle();
      harness.socket().receive(readyWithPolish);
      await settle();
      harness.socket().receive({ tokens: [{ text: "ну э-э привет", is_final: true }] });
      session.stop();
      await settle();
      harness.socket().receive({ tokens: [{ text: "<fin>", is_final: true }] });
      await settle();
      return session;
    }

    it("после <fin> диктовка ждёт чистку: слушателю — «идёт чистка», микрофон уже свободен, конец ещё не объявлен", async () => {
      const harness = createHarness();
      await stoppedAndFinalized(harness);

      expect(harness.events).toEqual(["connected", "text:ну э-э привет|", "text:ну э-э привет|", "polishing"]);
      expect(harness.stream.released).toBe(true);
    });

    it("пришла чистка — слушателю исправленный текст, затем конец", async () => {
      const harness = createHarness();
      await stoppedAndFinalized(harness);

      harness.socket().receive({ polished: { text: "Привет." } });
      await settle();

      expect(harness.events.slice(-2)).toEqual(["polished:Привет.", "end"]);
      expect(harness.socket().closedByClient).toBe(true);
    });

    it("чистка вернула null — просто конец, текст Soniox остаётся", async () => {
      const harness = createHarness();
      await stoppedAndFinalized(harness);

      harness.socket().receive({ polished: { text: null } });
      await settle();

      expect(harness.events.slice(-2)).toEqual(["polishing", "end"]);
    });

    it("чистка не пришла за polishTimeoutMs (по умолчанию 7 с) — конец без ошибки", async () => {
      vi.useFakeTimers();
      const harness = createHarness();
      const session = createVoiceInput(relayOptions(harness)).start(harness.listener);
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().open();
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().receive(readyWithPolish);
      await vi.advanceTimersByTimeAsync(0);
      session.stop();
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().receive({ tokens: [{ text: "привет", is_final: true }, { text: "<fin>", is_final: true }] });
      await vi.advanceTimersByTimeAsync(6_999);
      expect(harness.events).not.toContain("end");

      await vi.advanceTimersByTimeAsync(2);

      expect(harness.events.slice(-2)).toEqual(["polishing", "end"]);
      expect(harness.events.some((event) => event.startsWith("error:"))).toBe(false);
    });

    it("свой срок ожидания чистки", async () => {
      vi.useFakeTimers();
      const harness = createHarness();
      const session = createVoiceInput({ ...relayOptions(harness), polishTimeoutMs: 1_000 }).start(harness.listener);
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().open();
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().receive(readyWithPolish);
      await vi.advanceTimersByTimeAsync(0);
      session.stop();
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().receive({ tokens: [{ text: "привет", is_final: true }, { text: "<fin>", is_final: true }] });

      await vi.advanceTimersByTimeAsync(1_001);

      expect(harness.events.at(-1)).toBe("end");
    });

    it("сервер без чистки (в «готово» нет polish) — конец сразу после <fin>, как раньше", async () => {
      const harness = createHarness();
      const session = await startRelayed(harness);
      session.stop();
      await settle();

      harness.socket().receive({ tokens: [{ text: "привет", is_final: true }, { text: "<fin>", is_final: true }] });
      await settle();

      expect(harness.events.slice(-2)).toEqual(["text:привет|", "end"]);
    });

    it("«стоп» без ответа Soniox на finalize — конец по stopTimeoutMs без ожидания чистки", async () => {
      vi.useFakeTimers();
      const harness = createHarness();
      const session = createVoiceInput({ ...relayOptions(harness), stopTimeoutMs: 500 }).start(harness.listener);
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().open();
      await vi.advanceTimersByTimeAsync(0);
      harness.socket().receive(readyWithPolish);
      await vi.advanceTimersByTimeAsync(0);
      session.stop();

      await vi.advanceTimersByTimeAsync(501);

      expect(harness.events.slice(-1)).toEqual(["end"]);
      expect(harness.events).not.toContain("polishing");
    });

    it("отмена во время чистки: слушателя больше не зовём", async () => {
      const harness = createHarness();
      const session = await stoppedAndFinalized(harness);
      const before = harness.events.length;

      session.cancel();
      harness.socket().receive({ polished: { text: "Привет." } });
      await settle();

      expect(harness.events).toHaveLength(before);
    });

    it("сервер оборвал связь во время чистки — конец без ошибки: текст уже закреплён", async () => {
      const harness = createHarness();
      await stoppedAndFinalized(harness);

      harness.socket().closeFromServer(1006);
      await settle();

      expect(harness.events.slice(-1)).toEqual(["end"]);
      expect(harness.events.some((event) => event.startsWith("error:"))).toBe(false);
    });
  });
});
