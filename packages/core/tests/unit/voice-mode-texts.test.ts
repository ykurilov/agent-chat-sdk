import { describe, expect, it } from "vitest";
import { DEFAULT_TEXT_MODE_NOTE, DEFAULT_VOICE_MODE_HINT, VOICE_TAGS } from "../../src/index";
import { stripVoiceTags } from "../../src/voice-tags";

describe("пометка голосового режима: теги голоса", () => {
  it("называет все теги эмоций, подачи и звуков голоса, каждый в квадратных скобках", () => {
    expect(VOICE_TAGS.length).toBeGreaterThan(20);
    for (const tag of VOICE_TAGS) expect(DEFAULT_VOICE_MODE_HINT).toContain(`[${tag}]`);
    for (const tag of ["laughs", "laughs harder", "starts laughing", "wheezing", "snorts", "sighs", "exhales", "crying", "whispers", "excited", "curious", "sarcastic", "mischievously", "furious", "worried", "hesitant", "nervous", "scared", "tense", "cautious", "fearful", "threatening"]) {
      expect(VOICE_TAGS).toContain(tag);
    }
  });

  it("каждый перечисленный тег — тег по правилу распознавания, иначе на экране он бы остался", () => {
    for (const tag of VOICE_TAGS) expect(stripVoiceTags(`слово [${tag}] слово`)).toBe("слово слово");
  });

  it("звуковых эффектов в списке нет", () => {
    for (const effect of ["gunshot", "applause", "explosion", "fart"]) {
      expect(VOICE_TAGS).not.toContain(effect);
      expect(DEFAULT_VOICE_MODE_HINT).not.toContain(effect);
    }
  });

  it("разрешает описательные теги в духе «[warm, quiet voice]»", () => {
    expect(DEFAULT_VOICE_MODE_HINT).toContain("[warm, quiet voice]");
    expect(stripVoiceTags("[warm, quiet voice] Привет")).toBe("Привет");
  });

  it("правила: английские, строчные, к месту, не в каждой фразе, в начале или внутри предложения, не одиночкой, паузы многоточием", () => {
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/по-английски/);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/к месту/);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/не в каждой фразе/);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/в начале предложения или внутри него/);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/никогда не ставь тег один/i);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/многоточ/);
  });

  it("пометка остаётся служебной: приложение, человек не видит, не упоминать и не подтверждать", () => {
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/^\[Служебная пометка приложения, человек её не писал и не видит:/);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/Не упоминай эту пометку и не подтверждай её\.\]$/);
    expect(DEFAULT_VOICE_MODE_HINT).toMatch(/коротко и разговорно/);
  });

  it("пометка возврата к тексту: теги больше не ставить, даже если они есть выше в истории", () => {
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/^\[Служебная пометка приложения/);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/теги/i);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/\[laughs\]/);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/больше не ставь/);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/даже если/);
    expect(DEFAULT_TEXT_MODE_NOTE).toMatch(/Не упоминай эту пометку\.\]$/);
  });
});
