import { describe, expect, it } from "vitest";
import { buildFinalizeMessage, buildStartMessage, createTranscript } from "../src/soniox-messages";

const tokens = (...items: Array<[string, boolean]>) =>
  JSON.stringify({ tokens: items.map(([text, is_final]) => ({ text, is_final })) });

describe("первое сообщение Soniox", () => {
  it("ключ, модель, автоопределение формата, подсказки языка и границы фраз", () => {
    expect(buildStartMessage({ apiKey: "temp:1", model: "stt-rt-v5", languageHints: ["ru"] })).toEqual({
      api_key: "temp:1",
      model: "stt-rt-v5",
      audio_format: "auto",
      language_hints: ["ru"],
      enable_endpoint_detection: true,
    });
  });

  it("команда «закрепить всё сказанное» — как в документации Soniox", () => {
    expect(buildFinalizeMessage()).toEqual({ type: "finalize" });
  });

  it("подсказка-контекст уходит как есть", () => {
    const context = { text: "Бухгалтерия", terms: ["УСН"] };

    expect(buildStartMessage({ apiKey: "k", model: "m", languageHints: ["ru"], context })).toMatchObject({ context });
  });
});

describe("разбор ответов Soniox", () => {
  it("финальный текст только растёт, промежуточный заменяется целиком", () => {
    const transcript = createTranscript();

    expect(transcript.accept(tokens(["При", false], ["вет", false]))).toEqual({
      type: "text",
      text: { finalText: "", interimText: "Привет" },
    });
    expect(transcript.accept(tokens(["Привет", true], [" ми", false]))).toEqual({
      type: "text",
      text: { finalText: "Привет", interimText: " ми" },
    });
    expect(transcript.accept(tokens([" мир", true]))).toEqual({
      type: "text",
      text: { finalText: "Привет мир", interimText: "" },
    });
  });

  it("служебные токены <fin> и <end> в текст не попадают", () => {
    const transcript = createTranscript();

    const event = transcript.accept(tokens(["Да", true], ["<end>", true], ["<fin>", true]));

    expect(event).toEqual({ type: "text", text: { finalText: "Да", interimText: "" }, finalized: true });
  });

  it("метка <end> (конец фразы) — не «закреплено по команде»: finalized не ставится", () => {
    const transcript = createTranscript();

    expect(transcript.accept(tokens(["Да", true], ["<end>", true]))).toEqual({ type: "text", text: { finalText: "Да", interimText: "" } });
  });

  it("метка <fin> без слов (тишина) тоже говорит, что закрепление закончено", () => {
    const transcript = createTranscript();

    expect(transcript.accept(tokens(["<fin>", true]))).toEqual({ type: "text", text: { finalText: "", interimText: "" }, finalized: true });
  });

  it("ответ без токенов не меняет текст", () => {
    const transcript = createTranscript();
    transcript.accept(tokens(["Да", true]));

    expect(transcript.accept(JSON.stringify({ tokens: [], total_audio_proc_ms: 100 }))).toEqual({
      type: "text",
      text: { finalText: "Да", interimText: "" },
    });
  });

  it("конец потока", () => {
    expect(createTranscript().accept(JSON.stringify({ tokens: [], finished: true }))).toEqual({ type: "finished" });
  });

  it("конец потока вместе с последними словами", () => {
    const transcript = createTranscript();

    expect(transcript.accept(JSON.stringify({ tokens: [{ text: "Всё", is_final: true }], finished: true }))).toEqual({
      type: "finished",
      text: { finalText: "Всё", interimText: "" },
    });
  });

  it("ошибка сервиса — код и сообщение", () => {
    expect(
      createTranscript().accept(JSON.stringify({ error_code: 401, error_message: "Invalid API key" })),
    ).toEqual({ type: "error", code: 401, message: "Invalid API key" });
  });

  it("мусор вместо JSON игнорируется", () => {
    expect(createTranscript().accept("не json")).toEqual({ type: "ignored" });
    expect(createTranscript().accept(JSON.stringify({ something: "else" }))).toEqual({ type: "ignored" });
  });

  it("при завершении промежуточный текст становится окончательным", () => {
    const transcript = createTranscript();
    transcript.accept(tokens(["Привет", true], [" ми", false]));

    expect(transcript.settle()).toEqual({ finalText: "Привет ми", interimText: "" });
  });
});
