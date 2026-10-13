import { describe, expect, it } from "vitest";
import { isVoiceMessage, voiceModePart, voiceOfMessage, withModeNotes } from "../../../src/agent-run/mode-notes";
import type { AgentChatMessage } from "../../../src/conversation/types";

const notes = { voice: "ВХОД В ГОЛОС", text: "ВОЗВРАТ К ТЕКСТУ" };

const human = (id: string, value: string, voice = false): AgentChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: value }, ...(voice ? [voiceModePart()] : [])],
});
const agent = (id: string, value = "ответ"): AgentChatMessage => ({ id, role: "assistant", parts: [{ type: "text", text: value }] });

const texts = (message: AgentChatMessage) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []));

describe("isVoiceMessage", () => {
  it("узнаёт сообщение человека с отметкой голосового режима", () => {
    expect(isVoiceMessage(human("u1", "привет", true))).toBe(true);
    expect(isVoiceMessage(human("u1", "привет"))).toBe(false);
  });
});

describe("withModeNotes: пометки входа и возврата", () => {
  it("первое голосовое сообщение получает пометку входа отдельной текстовой частью в конце", () => {
    const [first] = withModeNotes([human("u1", "привет", true)], notes);
    expect(texts(first!)).toEqual(["привет", notes.voice]);
    expect(first!.parts.at(-1)).toEqual({ type: "text", text: notes.voice });
  });

  it("пометка входа один раз: следующие голосовые сообщения идут без неё", () => {
    const result = withModeNotes([human("u1", "раз", true), agent("a1"), human("u2", "два", true), agent("a2"), human("u3", "три", true)], notes);
    expect(texts(result[0]!)).toEqual(["раз", notes.voice]);
    expect(texts(result[2]!)).toEqual(["два"]);
    expect(texts(result[4]!)).toEqual(["три"]);
  });

  it("пометка возврата — у первого текстового сообщения после голосового, один раз", () => {
    const result = withModeNotes(
      [human("u1", "раз", true), agent("a1"), human("u2", "два"), agent("a2"), human("u3", "три")],
      notes,
    );
    expect(texts(result[2]!)).toEqual(["два", notes.text]);
    expect(texts(result[4]!)).toEqual(["три"]);
  });

  it("возврат и повторный вход: каждая смена режима — своя пометка", () => {
    const result = withModeNotes(
      [human("u1", "раз", true), agent("a1"), human("u2", "два"), agent("a2"), human("u3", "три", true)],
      notes,
    );
    expect(result.filter((message) => message.role === "user").map(texts)).toEqual([
      ["раз", notes.voice],
      ["два", notes.text],
      ["три", notes.voice],
    ]);
  });

  it("чат без голосовых сообщений: история не меняется", () => {
    const history = [human("u1", "раз"), agent("a1"), human("u2", "два")];
    expect(withModeNotes(history, notes)).toEqual(history);
  });

  it("предыдущее сообщение человека считается по ветке, ответы агента смены режима не дают", () => {
    const result = withModeNotes([human("u1", "раз", true), agent("a1"), agent("a2"), human("u2", "два", true)], notes);
    expect(texts(result[3]!)).toEqual(["два"]);
  });

  it("пометки не заданы — история как есть", () => {
    const history = [human("u1", "раз", true)];
    expect(withModeNotes(history, undefined)).toBe(history);
  });

  it("исходные сообщения не изменяются", () => {
    const history = [human("u1", "раз", true)];
    const before = JSON.stringify(history);
    withModeNotes(history, notes);
    expect(JSON.stringify(history)).toBe(before);
  });

  it("детерминизм: начало истории даёт те же сообщения, сколько бы ни было хвоста (кэш модели)", () => {
    const base = [human("u1", "раз", true), agent("a1"), human("u2", "два"), agent("a2")];
    const longer = [...base, human("u3", "три", true), agent("a3"), human("u4", "четыре", true)];
    const shortResult = withModeNotes(base, notes);
    const longResult = withModeNotes(longer, notes);
    expect(JSON.stringify(longResult.slice(0, base.length))).toBe(JSON.stringify(shortResult));
  });
});

describe("голос хода в отметке", () => {
  it("отметка хранит голос; без голоса — как раньше (true)", () => {
    expect(voiceModePart("pirate")).toEqual({ type: "data-voice-mode", data: { voice: "pirate" } });
    expect(voiceModePart()).toEqual({ type: "data-voice-mode", data: true });
  });

  it("голос читается из сообщения; у сообщений без голоса и текстовых — undefined", () => {
    expect(voiceOfMessage(humanOf("u1", "раз", "pirate"))).toBe("pirate");
    expect(voiceOfMessage(human("u1", "раз", true))).toBeUndefined();
    expect(voiceOfMessage(human("u1", "раз"))).toBeUndefined();
    expect(voiceOfMessage({ parts: [{ type: "data-voice-mode", data: { voice: 5 } }] })).toBeUndefined();
    expect(isVoiceMessage(humanOf("u1", "раз", "pirate"))).toBe(true);
  });
});

const humanOf = (id: string, value: string, voice: string): AgentChatMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: value }, voiceModePart(voice)],
});

describe("withModeNotes: голос в пометке входа и смена голоса", () => {
  const perVoice = {
    voice: (voice: string | undefined) => `ВХОД ${voice ?? "без голоса"}`,
    text: "ВОЗВРАТ К ТЕКСТУ",
    voiceChanged: (from: string, to: string) => `СМЕНА ${from}>${to}`,
  };
  const turns = (history: readonly AgentChatMessage[]) => withModeNotes(history, perVoice).filter((message) => message.role === "user").map(texts);

  it("пометка входа получает голос сообщения", () => {
    expect(turns([humanOf("u1", "раз", "pirate")])).toEqual([["раз", "ВХОД pirate"]]);
    expect(turns([human("u1", "раз", true)])).toEqual([["раз", "ВХОД без голоса"]]);
  });

  it("голос сменился посреди разговора — пометка один раз на первом сообщении с новым голосом", () => {
    const history = [humanOf("u1", "раз", "a"), agent("a1"), humanOf("u2", "два", "a"), agent("a2"), humanOf("u3", "три", "b"), agent("a3"), humanOf("u4", "четыре", "b")];
    expect(turns(history)).toEqual([["раз", "ВХОД a"], ["два"], ["три", "СМЕНА a>b"], ["четыре"]]);
  });

  it("смена туда и обратно — две пометки", () => {
    const history = [humanOf("u1", "раз", "a"), humanOf("u2", "два", "b"), humanOf("u3", "три", "a")];
    expect(turns(history)).toEqual([["раз", "ВХОД a"], ["два", "СМЕНА a>b"], ["три", "СМЕНА b>a"]]);
  });

  it("между голосовыми был текст: пометка входа с новым голосом, а не смены", () => {
    const history = [humanOf("u1", "раз", "a"), agent("a1"), human("u2", "два"), agent("a2"), humanOf("u3", "три", "b")];
    expect(turns(history)).toEqual([["раз", "ВХОД a"], ["два", "ВОЗВРАТ К ТЕКСТУ"], ["три", "ВХОД b"]]);
  });

  it("сообщение без голоса (старое) смены не даёт и прежний голос помнит", () => {
    const history = [humanOf("u1", "раз", "a"), human("u2", "два", true), humanOf("u3", "три", "a"), humanOf("u4", "четыре", "b")];
    expect(turns(history)).toEqual([["раз", "ВХОД a"], ["два"], ["три"], ["четыре", "СМЕНА a>b"]]);
  });

  it("voiceChanged вернул undefined (наборы тегов у голосов одинаковые) — пометки нет", () => {
    const quiet = { ...perVoice, voiceChanged: () => undefined };
    const history = [humanOf("u1", "раз", "a"), humanOf("u2", "два", "b")];
    expect(withModeNotes(history, quiet).map(texts)).toEqual([["раз", "ВХОД a"], ["два"]]);
  });

  it("voiceChanged не задан — смен нет", () => {
    const { voiceChanged: _unused, ...plain } = perVoice;
    expect(withModeNotes([humanOf("u1", "раз", "a"), humanOf("u2", "два", "b")], plain).map(texts)).toEqual([["раз", "ВХОД a"], ["два"]]);
  });

  it("кэш: начало истории любой длины даёт те же сообщения (детерминизм по сохранённым отметкам)", () => {
    const history = [
      humanOf("u1", "раз", "a"), agent("a1"), humanOf("u2", "два", "b"), agent("a2"), human("u3", "три"), agent("a3"),
      humanOf("u4", "четыре", "b"), humanOf("u5", "пять", "a"), agent("a4"), humanOf("u6", "шесть", "a"),
    ];
    const full = JSON.stringify(withModeNotes(history, perVoice));
    for (let length = 1; length <= history.length; length++) {
      const prefix = JSON.stringify(withModeNotes(history.slice(0, length), perVoice)).slice(0, -1);
      expect(full.startsWith(prefix)).toBe(true);
    }
  });
});
