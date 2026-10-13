import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_MODE_HINT, VOICE_TAGS, assertVoiceTagSet, sameVoiceTagSet, voiceChangeNote, voiceModeHint } from "../../src/index";

const pirate = { allowed: ["laughs", "wheezing", "low, gravelly voice"], avoid: ["whispers", "softly"] };
const narrator = { allowed: ["sighs", "curious", "hesitant"] };

describe("пометка входа для голоса с набором тегов", () => {
  it("без набора — прежний общий текст, байт в байт (кэш идущих чатов цел)", () => {
    expect(voiceModeHint()).toBe(DEFAULT_VOICE_MODE_HINT);
    expect(voiceModeHint(undefined)).toBe(DEFAULT_VOICE_MODE_HINT);
  });

  it("перечисляет только теги набора, остальных из общего списка в ней нет", () => {
    const hint = voiceModeHint(narrator);
    for (const tag of narrator.allowed) expect(hint).toContain(`[${tag}]`);
    for (const tag of VOICE_TAGS.filter((tag) => !narrator.allowed.includes(tag))) expect(hint).not.toContain(`[${tag}]`);
    expect(hint).not.toContain("[warm, quiet voice]");
    expect(hint).toMatch(/Других тегов не ставь/);
  });

  it("описательный тег набора называется как обычный, свои описательные модели не разрешены", () => {
    const hint = voiceModeHint(pirate);
    expect(hint).toContain("[low, gravelly voice]");
    expect(hint).not.toMatch(/свои описательные/);
  });

  it("запрещённые теги названы отдельной фразой", () => {
    expect(voiceModeHint(pirate)).toMatch(/Этому голосу не идут: \[whispers\], \[softly\]\./);
    expect(voiceModeHint(narrator)).not.toMatch(/не идут/);
  });

  it("правила остаются теми же: служебная, коротко и разговорно, английские, не одиночкой, паузы многоточием", () => {
    const hint = voiceModeHint(pirate);
    expect(hint).toMatch(/^\[Служебная пометка приложения, человек её не писал и не видит:/);
    expect(hint).toMatch(/коротко и разговорно/);
    expect(hint).toMatch(/по-английски/);
    expect(hint).toMatch(/не в каждой фразе/);
    expect(hint).toMatch(/никогда не ставь тег один/i);
    expect(hint).toMatch(/многоточ/);
    expect(hint).toMatch(/Не упоминай эту пометку и не подтверждай её\.\]$/);
  });
});

describe("пометка о смене голоса", () => {
  it("служебная; называет теги нового голоса; прежние теги не из списка больше не ставить, даже если они выше в истории", () => {
    const note = voiceChangeNote(pirate);
    expect(note).toMatch(/^\[Служебная пометка приложения, человек её не писал и не видит:/);
    expect(note).toMatch(/голос/);
    for (const tag of pirate.allowed) expect(note).toContain(`[${tag}]`);
    expect(note).toMatch(/Этому голосу не идут: \[whispers\], \[softly\]/);
    expect(note).toMatch(/больше не ставь/);
    expect(note).toMatch(/даже если/);
    expect(note).toMatch(/Не упоминай эту пометку\.\]$/);
  });

  it("новый голос без набора — общий список по умолчанию", () => {
    const note = voiceChangeNote(undefined);
    for (const tag of VOICE_TAGS) expect(note).toContain(`[${tag}]`);
  });
});

describe("набор тегов: проверка и сравнение", () => {
  it("правильный набор проходит", () => {
    expect(() => assertVoiceTagSet(pirate, "Старый пират")).not.toThrow();
  });

  it("пустой набор разрешённых — ошибка с названием голоса", () => {
    expect(() => assertVoiceTagSet({ allowed: [] }, "Старый пират")).toThrow(/Старый пират.*хотя бы один/);
  });

  it("то, что не тег голоса, — ошибка: иначе на экране оно бы осталось", () => {
    for (const bad of ["смеётся", "x", "TODO", "[laughs]", " laughs", "gunshot!"]) {
      expect(() => assertVoiceTagSet({ allowed: [bad] }, "Голос")).toThrow(/Голос.*тег/);
    }
    expect(() => assertVoiceTagSet({ allowed: ["laughs"], avoid: ["Смех"] }, "Голос")).toThrow(/Голос.*тег/);
  });

  it("тег и в разрешённых, и в запрещённых — ошибка", () => {
    expect(() => assertVoiceTagSet({ allowed: ["laughs"], avoid: ["laughs"] }, "Голос")).toThrow(/laughs/);
  });

  it("наборы равны, если теги те же, в том же порядке; нет набора равен нет набора", () => {
    expect(sameVoiceTagSet(undefined, undefined)).toBe(true);
    expect(sameVoiceTagSet(pirate, { allowed: [...pirate.allowed], avoid: [...pirate.avoid] })).toBe(true);
    expect(sameVoiceTagSet(pirate, narrator)).toBe(false);
    expect(sameVoiceTagSet(pirate, undefined)).toBe(false);
    expect(sameVoiceTagSet({ allowed: ["sighs"] }, { allowed: ["sighs"], avoid: [] })).toBe(true);
  });
});
