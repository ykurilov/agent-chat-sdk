import { describe, expect, it } from "vitest";
import { buildStartMessage, createTranscript } from "../src/soniox-messages";

const tokens = (...items: Array<[string, boolean]>) =>
  JSON.stringify({ tokens: items.map(([text, is_final]) => ({ text, is_final })) });

describe("первое сообщение Soniox: параметры конца фразы", () => {
  it("уровень задержки и предел ожидания конца фразы уходят в Soniox под его именами", () => {
    expect(
      buildStartMessage({ apiKey: "k", model: "stt-rt-v5", languageHints: ["ru"], endpointLatencyLevel: 2, maxEndpointDelayMs: 1500 }),
    ).toEqual({
      api_key: "k",
      model: "stt-rt-v5",
      audio_format: "auto",
      language_hints: ["ru"],
      enable_endpoint_detection: true,
      endpoint_latency_adjustment_level: 2,
      max_endpoint_delay_ms: 1500,
    });
  });

  it("уровень 0 — тоже значение: уходит; не заданы — в сообщении их нет", () => {
    expect(buildStartMessage({ apiKey: "k", model: "m", languageHints: ["ru"], endpointLatencyLevel: 0 })).toMatchObject({
      endpoint_latency_adjustment_level: 0,
    });
    const plain = buildStartMessage({ apiKey: "k", model: "m", languageHints: ["ru"] });
    expect(plain).not.toHaveProperty("endpoint_latency_adjustment_level");
    expect(plain).not.toHaveProperty("max_endpoint_delay_ms");
  });
});

describe("конец фразы (<end>) в разборе ответов", () => {
  it("по умолчанию события прежние: поля конца фразы нет", () => {
    const event = createTranscript().accept(tokens(["Да", true], ["<end>", true]));
    expect(event).not.toHaveProperty("endedPhrases");
  });

  it("с phraseEnds: метка <end> выдаёт текст закреплённых слов закончившейся фразы", () => {
    const transcript = createTranscript({ phraseEnds: true });

    expect(transcript.accept(tokens(["Привет", true], [" мир", true]))).not.toHaveProperty("endedPhrases");
    expect(transcript.accept(tokens(["<end>", true]))).toMatchObject({
      type: "text",
      text: { finalText: "Привет мир", interimText: "" },
      endedPhrases: ["Привет мир"],
    });
  });

  it("следующая фраза начинается с чистого листа: в неё не попадает прошлая", () => {
    const transcript = createTranscript({ phraseEnds: true });
    transcript.accept(tokens(["Привет", true], ["<end>", true]));

    const event = transcript.accept(tokens([" Как", true], [" дела", true], ["<end>", true]));

    expect(event).toMatchObject({ endedPhrases: ["Как дела"], text: { finalText: "Привет Как дела" } });
  });

  it("слова после <end> в том же ответе относятся к следующей фразе", () => {
    const transcript = createTranscript({ phraseEnds: true });

    const first = transcript.accept(tokens(["Да", true], ["<end>", true], [" Нет", true]));
    const second = transcript.accept(tokens([" точно", true], ["<end>", true]));

    expect(first).toMatchObject({ endedPhrases: ["Да"] });
    expect(second).toMatchObject({ endedPhrases: ["Нет точно"] });
  });

  it("два <end> в одном ответе — две фразы по порядку", () => {
    const transcript = createTranscript({ phraseEnds: true });

    const event = transcript.accept(tokens(["Раз", true], ["<end>", true], [" Два", true], ["<end>", true]));

    expect(event).toMatchObject({ endedPhrases: ["Раз", "Два"] });
  });

  it("предварительные слова в фразу не входят; пустая фраза отдаётся пустой строкой", () => {
    const transcript = createTranscript({ phraseEnds: true });

    expect(transcript.accept(tokens(["Привет", true], [" ми", false]))).not.toHaveProperty("endedPhrases");
    expect(transcript.accept(tokens(["<end>", true]))).toMatchObject({ endedPhrases: ["Привет"] });
    expect(transcript.accept(tokens(["<end>", true]))).toMatchObject({ endedPhrases: [""] });
  });

  it("конец фразы в последнем ответе (finished) тоже выдаётся", () => {
    const transcript = createTranscript({ phraseEnds: true });
    const event = transcript.accept(JSON.stringify({ tokens: [{ text: "Всё", is_final: true }, { text: "<end>", is_final: true }], finished: true }));

    expect(event).toMatchObject({ type: "finished", endedPhrases: ["Всё"] });
  });

  it("метка <fin> вместе с <end> не мешает: finalized и фраза приходят вместе", () => {
    const transcript = createTranscript({ phraseEnds: true });

    expect(transcript.accept(tokens(["Да", true], ["<end>", true], ["<fin>", true]))).toMatchObject({
      finalized: true,
      endedPhrases: ["Да"],
    });
  });
});
