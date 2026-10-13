import { describe, expect, it } from "vitest";
import { VOICE_SOUNDS, isVoiceSound, soundsOfMessage, voiceModePart, voiceSoundsNote } from "../../../src/index";
import { withModeNotes } from "../../../src/agent-run/mode-notes";
import type { AgentChatMessage } from "../../../src/index";
import { voiceModeHint } from "../../../src/agent-run/voice-mode-texts";

const notes = { voice: "ВХОД В ГОЛОС", text: "ВОЗВРАТ К ТЕКСТУ", sounds: (sounds: readonly string[]) => `ЗВУКИ ${sounds.join("+")}` };

const human = (id: string, value: string, mark?: ReturnType<typeof voiceModePart>): AgentChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: value }, ...(mark ? [mark] : [])],
});
const agent = (id: string): AgentChatMessage => ({ id, role: "assistant", parts: [{ type: "text", text: "ответ" }] });
const texts = (message: AgentChatMessage) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));

describe("звуки человека в отметке сообщения (FR-027)", () => {
  it("отметка хранит звуки рядом с голосом и склейкой; без звуков — как раньше", () => {
    expect(voiceModePart("pirate", undefined, ["laughter"])).toEqual({ type: "data-voice-mode", data: { voice: "pirate", sounds: ["laughter"] } });
    expect(voiceModePart(undefined, undefined, ["sigh"])).toEqual({ type: "data-voice-mode", data: { sounds: ["sigh"] } });
    expect(voiceModePart("pirate", "u0", ["laughter"])).toEqual({ type: "data-voice-mode", data: { voice: "pirate", replaces: "u0", sounds: ["laughter"] } });
    expect(voiceModePart("pirate")).toEqual({ type: "data-voice-mode", data: { voice: "pirate" } });
    expect(voiceModePart(undefined, undefined, [])).toEqual({ type: "data-voice-mode", data: true });
  });

  it("звуки читаются из сообщения; чужое, повторы и нечитаемое отбрасываются, порядок сохраняется", () => {
    expect(soundsOfMessage(human("u1", "раз", voiceModePart("v", undefined, ["laughter", "sigh"])))).toEqual(["laughter", "sigh"]);
    expect(soundsOfMessage({ parts: [{ type: "data-voice-mode", data: { sounds: ["sigh", "laughter", "sigh", "dance", 7] } }] })).toEqual(["sigh", "laughter"]);
    expect(soundsOfMessage({ parts: [{ type: "data-voice-mode", data: { sounds: "laughter" } }] })).toEqual([]);
    expect(soundsOfMessage({ parts: [{ type: "data-voice-mode", data: true }] })).toEqual([]);
    expect(soundsOfMessage(human("u1", "раз"))).toEqual([]);
  });

  it("закрытый список видов звука", () => {
    expect(VOICE_SOUNDS).toEqual(["laughter", "sigh", "cough", "sneeze", "gasp", "crying", "yawn", "groan"]);
    expect(isVoiceSound("laughter")).toBe(true);
    expect(isVoiceSound("applause")).toBe(false);
    expect(isVoiceSound(5)).toBe(false);
  });
});

describe("withModeNotes: пометка звуков", () => {
  it("сообщение со звуками получает пометку отдельной частью в конце, после пометки входа", () => {
    const [first] = withModeNotes([human("u1", "ха-ха", voiceModePart("v", undefined, ["laughter", "sigh"]))], notes);
    expect(texts(first!)).toEqual(["ха-ха", "ВХОД В ГОЛОС", "ЗВУКИ laughter+sigh"]);
  });

  it("у следующих голосовых сообщений пометка входа не повторяется, а пометка звуков — своя", () => {
    const history = [human("u1", "раз", voiceModePart()), agent("a1"), human("u2", "два", voiceModePart(undefined, undefined, ["laughter"])), agent("a2"), human("u3", "три", voiceModePart())];
    const result = withModeNotes(history, notes).filter((message) => message.role === "user").map(texts);
    expect(result).toEqual([["раз", "ВХОД В ГОЛОС"], ["два", "ЗВУКИ laughter"], ["три"]]);
  });

  it("текстовое сообщение звуков не получает: возврат к тексту даёт только свою пометку", () => {
    const history = [human("u1", "раз", voiceModePart(undefined, undefined, ["sigh"])), agent("a1"), human("u2", "два")];
    expect(withModeNotes(history, notes).filter((message) => message.role === "user").map(texts)).toEqual([["раз", "ВХОД В ГОЛОС", "ЗВУКИ sigh"], ["два", "ВОЗВРАТ К ТЕКСТУ"]]);
  });

  it("текст пометки звуков не задан — звуки в запрос не идут, история как раньше", () => {
    const { sounds: _unused, ...withoutSounds } = notes;
    const [first] = withModeNotes([human("u1", "раз", voiceModePart(undefined, undefined, ["laughter"]))], withoutSounds);
    expect(texts(first!)).toEqual(["раз", "ВХОД В ГОЛОС"]);
  });

  it("кэш: начало истории любой длины даёт те же сообщения; пометка выводится из сохранённого, а не из соседних", () => {
    const history = [
      human("u1", "раз", voiceModePart("a", undefined, ["laughter"])), agent("a1"),
      human("u2", "два", voiceModePart("a")), agent("a2"),
      human("u3", "три", voiceModePart("a", undefined, ["sigh", "cough"])), agent("a3"),
      human("u4", "четыре"), agent("a4"),
      human("u5", "пять", voiceModePart("a", undefined, ["laughter"])),
    ];
    const full = JSON.stringify(withModeNotes(history, notes));
    for (let length = 1; length <= history.length; length++) {
      const prefix = JSON.stringify(withModeNotes(history.slice(0, length), notes)).slice(0, -1);
      expect(full.startsWith(prefix)).toBe(true);
    }
  });

  it("исходные сообщения не изменяются", () => {
    const history = [human("u1", "раз", voiceModePart(undefined, undefined, ["laughter"]))];
    const before = JSON.stringify(history);
    withModeNotes(history, notes);
    expect(JSON.stringify(history)).toBe(before);
  });
});

describe("тексты для модели о звуках человека", () => {
  it("пометка звуков: служебная, называет звуки по-русски, ничего не просит упоминать", () => {
    const note = voiceSoundsNote(["laughter", "sigh"]);
    expect(note).toMatch(/^\[Служебная пометка приложения/);
    expect(note).toContain("смех");
    expect(note).toContain("вздох");
    expect(note).toMatch(/Не упоминай эту пометку/);
    expect(voiceSoundsNote(["laughter"])).toBe(voiceSoundsNote(["laughter"]));
  });

  it("каждый вид звука называется своим словом", () => {
    const names = VOICE_SOUNDS.map((sound) => voiceSoundsNote([sound]));
    expect(new Set(names).size).toBe(VOICE_SOUNDS.length);
  });

  it("пометка входа несёт короткое правило: что значат пометки звуков и что реагировать на них стоит естественно и не каждый раз", () => {
    const hint = voiceModeHint();
    expect(hint).toMatch(/слышны звуки человека/);
    expect(hint).toMatch(/естественно/);
    expect(hint).toMatch(/не каждый раз/);
  });
});
