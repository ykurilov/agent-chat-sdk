import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_PHRASE_END_BYTE, MOCK_SILENCE_BYTE, createMockDialogSoniox, mockDialogPhrases } from "../../../apps/demo/server/mock-soniox";
import { START, sessionWith } from "./support/session-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Сессия, у которой «Soniox» — подмена демо; ждём, пока она «откроется». */
async function withMock() {
  const setup = sessionWith({ speech: null, connectUpstream: () => createMockDialogSoniox() as never });
  setup.session.start(START);
  await vi.advanceTimersByTimeAsync(50);
  return setup;
}

const chunk = (byte: number) => new Uint8Array(640).fill(byte);
const phrases = (setup: Awaited<ReturnType<typeof withMock>>) => setup.of("phrase_end").map((message) => message.text);

describe("подмена Soniox для диалога (условный байт звука)", () => {
  it("фраза №1: слова идут по одному и закрепляются, конец фразы — по байту 255", async () => {
    const setup = await withMock();
    expect(setup.of("ready")).toHaveLength(1);
    for (let index = 0; index < 3; index += 1) setup.session.receiveAudio(chunk(1));
    setup.session.receiveAudio(chunk(MOCK_PHRASE_END_BYTE));
    expect(mockDialogPhrases[0]).toBe("привет как дела");
    expect(phrases(setup)).toEqual(["привет как дела"]);
    const settled = setup.of("heard").flatMap((message) => message.settled.map((word) => word.text));
    expect(settled).toEqual(["привет", "как", "дела"]);
    expect(setup.of("heard")[0]?.interim).toEqual([{ text: "привет", confidence: expect.any(Number) }]);
  });

  it("тишина ничего не порождает", async () => {
    const setup = await withMock();
    for (let index = 0; index < 5; index += 1) setup.session.receiveAudio(chunk(MOCK_SILENCE_BYTE));
    expect(setup.of("heard")).toEqual([]);
    expect(phrases(setup)).toEqual([]);
  });

  it("конец фразы без речи ничего не выдаёт", async () => {
    const setup = await withMock();
    setup.session.receiveAudio(chunk(MOCK_PHRASE_END_BYTE));
    expect(phrases(setup)).toEqual([]);
  });

  it("фраза №2 — слова остановки; после конца можно начать новую фразу", async () => {
    const setup = await withMock();
    setup.session.receiveAudio(chunk(2));
    setup.session.receiveAudio(chunk(2));
    setup.session.receiveAudio(chunk(MOCK_PHRASE_END_BYTE));
    setup.session.receiveAudio(chunk(1));
    setup.session.receiveAudio(chunk(MOCK_PHRASE_END_BYTE));
    expect(phrases(setup)).toEqual([mockDialogPhrases[1], mockDialogPhrases[0]]);
  });
});
