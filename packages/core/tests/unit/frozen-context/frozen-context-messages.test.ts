import { describe, expect, it } from "vitest";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import type { FrozenContextData } from "../../../src/frozen-context/context-blocks";
import { frozenContextBase, withFrozenContext } from "../../../src/frozen-context/frozen-context-messages";
import type { AgentChatMessage } from "../../../src/conversation/types";

const TODAY = "Сегодня: четверг, 1 января 2026 г.";
const MEMORY_A = "<agent_memory>A</agent_memory>";
const MEMORY_B = "<agent_memory>B</agent_memory>";

const full: FrozenContextData = {
  blocks: [
    { key: "memory", text: MEMORY_A, private: true },
    { key: "today", text: TODAY },
    { key: "screen_place", text: "<screen_place>Карточка</screen_place>" },
  ],
  sent: "all",
  base: null,
};
const changed: FrozenContextData = {
  blocks: [
    { key: "memory", text: MEMORY_B, private: true },
    { key: "today", text: TODAY },
  ],
  sent: { changed: ["memory"], removed: ["screen_place"] },
  base: "a1",
};

const user = (id: string, text: string): AgentChatMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const answer = (id: string, text: string, data?: FrozenContextData): AgentChatMessage => ({
  id,
  role: "assistant",
  parts: [...(data ? [{ type: FROZEN_CONTEXT_PART_TYPE, data } as never] : []), { type: "step-start" }, { type: "text", text, state: "done" }],
});
const texts = (message: AgentChatMessage | undefined) => message?.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])) ?? [];

describe("withFrozenContext: застывшие блоки в вопросе перед своим ответом", () => {
  it("первый запрос хода: ответа в истории ещё нет — блоки в конец последнего вопроса", () => {
    const history = withFrozenContext([user("u1", "Привет")], { current: { answerId: "a1", data: full }, group: false });
    expect(texts(history[0])).toEqual(["Привет", MEMORY_A, TODAY, "<screen_place>Карточка</screen_place>"]);
  });

  it("второй ход: первый вопрос — весь набор, второй — только изменения и одна строка про убранные", () => {
    const history = withFrozenContext([user("u1", "Привет"), answer("a1", "Здравствуй", full), user("u2", "Ещё")], {
      current: { answerId: "a2", data: changed },
      group: false,
    });
    expect(texts(history[0])).toEqual(["Привет", MEMORY_A, TODAY, "<screen_place>Карточка</screen_place>"]);
    expect(texts(history[2])).toEqual(["Ещё", MEMORY_B, "[Больше не действует: «screen_place»]"]);
  });

  it("ответ в истории сам несёт часть: те же байты, что и с явным current", () => {
    const withAnswer = withFrozenContext([user("u1", "Привет"), answer("a1", "Здравствуй", full)], { group: false });
    const first = withFrozenContext([user("u1", "Привет")], { current: { answerId: "a1", data: full }, group: false });
    expect(withAnswer[0]).toEqual(first[0]);
  });

  it("без изменений вопрос идёт без приписки", () => {
    const same: FrozenContextData = { ...full, sent: { changed: [], removed: [] }, base: "a1" };
    const history = withFrozenContext([user("u1", "Привет"), answer("a1", "Здравствуй", full), user("u2", "Ещё")], {
      current: { answerId: "a2", data: same },
      group: false,
    });
    expect(texts(history[2])).toEqual(["Ещё"]);
  });

  it("базы в истории нет (сжатие) — часть отдаётся целиком", () => {
    const history = withFrozenContext([user("u2", "Ещё")], { current: { answerId: "a2", data: changed }, group: false });
    expect(texts(history[0])).toEqual(["Ещё", MEMORY_B, TODAY]);
  });

  it("групповой ход: личные блоки не показываются ни из этого хода, ни из прошлых", () => {
    const history = withFrozenContext([user("u1", "Привет"), answer("a1", "Здравствуй", full), user("u2", "Ещё")], {
      current: { answerId: "a2", data: changed },
      group: true,
    });
    expect(JSON.stringify(history.filter((message) => message.role === "user"))).not.toContain("agent_memory");
    expect(texts(history[0])).toEqual(["Привет", TODAY, "<screen_place>Карточка</screen_place>"]);
    expect(texts(history[2])).toEqual(["Ещё", "[Больше не действует: «screen_place»]"]);
  });

  it("перед ответом нет вопроса (агент говорит первым) — отдельное сообщение человека с блоками", () => {
    const history = withFrozenContext([answer("a1", "Здравствуй", full)], { group: false });
    expect(history).toHaveLength(2);
    expect(history[0]!.role).toBe("user");
    expect(texts(history[0]).slice(-3)).toEqual([MEMORY_A, TODAY, "<screen_place>Карточка</screen_place>"]);
  });

  it("без части и без current — история как есть", () => {
    const source = [user("u1", "Привет"), answer("a1", "Здравствуй")];
    expect(withFrozenContext(source, { group: false })).toEqual(source);
  });

  it("сама часть из ответа не выкидывается: её отбросит сборка запроса", () => {
    const history = withFrozenContext([user("u1", "Привет"), answer("a1", "Здравствуй", full)], { group: false });
    expect(history[1]!.parts[0]!.type).toBe(FROZEN_CONTEXT_PART_TYPE);
  });

  it("скрытые ради места блоки — честная строка «не показано, но действует», а не «больше не действует»", () => {
    const hidden: FrozenContextData = {
      blocks: [{ key: "today", text: TODAY }],
      sent: { changed: [], removed: ["screen_place"], hidden: ["memory"] },
      base: "a1",
    };
    const history = withFrozenContext([user("u1", "Привет"), answer("a1", "Ответ", full), user("u2", "Ещё")], { current: { answerId: "a2", data: hidden }, group: false });
    expect(texts(history.at(-1))).toEqual(["Ещё", "[Больше не действует: «screen_place»]", "[Не показано ради места, но по-прежнему действует: «memory»]"]);
  });

  it("групповой ход: строка о скрытых личных блоках не показывается", () => {
    const hidden: FrozenContextData = { blocks: [{ key: "today", text: TODAY }], sent: { changed: [], removed: [], hidden: ["memory"] }, base: "a1" };
    const history = withFrozenContext([user("u1", "Привет"), answer("a1", "Ответ", full), user("u2", "Ещё")], { current: { answerId: "a2", data: hidden }, group: true });
    expect(texts(history.at(-1))).toEqual(["Ещё"]);
  });
});

describe("frozenContextBase: база хода", () => {
  it("последний ответ со словами и с частью", () => {
    const empty: AgentChatMessage = { id: "a3", role: "assistant", parts: [{ type: FROZEN_CONTEXT_PART_TYPE, data: changed } as never] };
    const history = [user("u1", "Привет"), answer("a1", "Здравствуй", full), user("u2", "Ещё"), answer("a2", "Да"), user("u3", "И ещё"), empty, user("u4", "?")];
    expect(frozenContextBase(history)).toEqual({ id: "a1", data: full });
  });

  it("ответов с частью нет — null", () => {
    expect(frozenContextBase([user("u1", "Привет"), answer("a1", "Здравствуй")])).toBeNull();
  });
});
