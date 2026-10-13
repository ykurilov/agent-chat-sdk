import { describe, expect, it } from "vitest";
import type { AgentChatMessage } from "../../src/chat-types";
import { suggestedRepliesOf } from "../../src/widgets/suggested-replies";

const user = (id: string): AgentChatMessage => ({ id, role: "user", parts: [{ type: "text", text: "вопрос" }] });
const answer = (parts: Array<Record<string, unknown>>, status = "complete"): AgentChatMessage =>
  ({ id: "a1", role: "assistant", parts, metadata: { status } }) as unknown as AgentChatMessage;
const suggest = (replies: unknown, toolCallId = "s1") => ({ type: "tool-suggest_replies", toolCallId, state: "output-available", input: { replies }, output: "показано" });

describe("suggestedRepliesOf: подсказки под последним ответом", () => {
  it("последний вызов suggest_replies в последнем ответе ветки", () => {
    const messages = [user("u1"), answer([suggest(["Да", "Нет"], "s1"), { type: "text", text: "Ок" }, suggest(["Дальше", "Хватит"], "s2")])];
    expect(suggestedRepliesOf(messages, false)).toEqual(["Дальше", "Хватит"]);
  });

  it("пока идёт ход — подсказок нет", () => {
    expect(suggestedRepliesOf([user("u1"), answer([suggest(["Да"])])], true)).toBeNull();
  });

  it("последнее сообщение — человека, или подсказок нет — null", () => {
    expect(suggestedRepliesOf([answer([suggest(["Да"])]), user("u2")], false)).toBeNull();
    expect(suggestedRepliesOf([user("u1"), answer([{ type: "text", text: "Ок" }])], false)).toBeNull();
    expect(suggestedRepliesOf([], false)).toBeNull();
  });

  it("подсказки виден, пока вход пишется, не берутся; пустые и не строки отбрасываются, не больше четырёх", () => {
    expect(suggestedRepliesOf([user("u1"), answer([{ ...suggest(["Да"]), state: "input-streaming" }])], false)).toBeNull();
    expect(suggestedRepliesOf([user("u1"), answer([suggest(["А", " ", 3, "Б", "В", "Г", "Д"])])], false)).toEqual(["А", "Б", "В", "Г"]);
    expect(suggestedRepliesOf([user("u1"), answer([suggest("не массив")])], false)).toBeNull();
  });
});
