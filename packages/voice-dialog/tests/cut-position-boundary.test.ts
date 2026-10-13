import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpokenText, sourcePositionAtSpoken } from "../src/browser/spoken-text";
import type { SpokenSentence } from "../src/browser/spoken-text";
import { speechChunk } from "./support/fake-socket";
import { streamWith } from "./support/speech-harness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Сервер считает `spokenChars` с завершающим пробелом каждого предложения (как ElevenLabs), браузер склеивает предложения через пробел. */
const SOURCE = "Привет. Как дела? Хорошо, спасибо.";

function sentencesOf(source: string): SpokenSentence[] {
  const spoken = createSpokenText();
  return [...spoken.push(source), ...spoken.finish()];
}

/** Сервер считает озвученным каждый знак, начавшийся раньше `playedMs`; знак номер i начинается на 50·i мс. */
const playedAfter = (chars: number) => chars * 50;

function serverCutAt(sentences: SpokenSentence[], playedMs: number) {
  const { stream, socket } = streamWith();
  socket.open();
  for (const sentence of sentences) stream.speak(sentence.text);
  const sent = sentences.map((sentence) => `${sentence.text} `).join("");
  // Один кусок звука на всё: по 50 мс на знак.
  socket.receive(speechChunk(sent, sent.length * 50));
  return stream.cut(playedMs);
}

describe("позиция обрыва на стыке предложений: сервер (spokenChars) и браузер (sourcePositionAtSpoken)", () => {
  const sentences = sentencesOf(SOURCE);

  it("предложения разобраны как ждём", () => {
    expect(sentences.map((sentence) => sentence.text)).toEqual(["Привет.", "Как дела?", "Хорошо, спасибо."]);
  });

  it("оборвали ровно после точки первого предложения: конец первого предложения в тексте", () => {
    const cut = serverCutAt(sentences, playedAfter("Привет.".length));
    expect(cut.spokenChars).toBe("Привет.".length);
    expect(sourcePositionAtSpoken(sentences, cut.spokenChars)).toBe(sentences[0]!.sourceEnd);
  });

  it("оборвали после пробела-стыка: начало второго предложения, а не «внутри» него и не конец первого", () => {
    const cut = serverCutAt(sentences, playedAfter("Привет. ".length));
    expect(cut.spokenChars).toBe("Привет. ".length);
    expect(sourcePositionAtSpoken(sentences, cut.spokenChars)).toBe(sentences[1]!.sourceStart);
  });

  it("на втором стыке то же самое: позиция не сползает на длину пробелов", () => {
    const joined = "Привет. Как дела? ".length;
    const atEnd = serverCutAt(sentences, playedAfter(joined - 1));
    expect(atEnd.spokenChars).toBe(joined - 1);
    expect(sourcePositionAtSpoken(sentences, atEnd.spokenChars)).toBe(sentences[1]!.sourceEnd);
    const atStart = serverCutAt(sentences, playedAfter(joined));
    expect(atStart.spokenChars).toBe(joined);
    expect(sourcePositionAtSpoken(sentences, atStart.spokenChars)).toBe(sentences[2]!.sourceStart);
  });

  it("хвост озвученного у сервера кончается на последнем озвученном знаке, без пробела на стыке", () => {
    expect(serverCutAt(sentences, playedAfter("Привет. ".length)).spokenTail).toBe("Привет.");
  });
});
