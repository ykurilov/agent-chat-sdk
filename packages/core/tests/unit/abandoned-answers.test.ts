import { describe, expect, it } from "vitest";
import { stateMessage } from "../../src/app-state/state-messages";
import { abandonedAnswersOf, abandonedOnRetry } from "../../src/conversation/abandoned-answers";
import { newStoredMessage } from "../../src/conversation/types";
import type { StoredMessage } from "../../src/conversation/types";

/** Ветка по цепочке: каждое сообщение — ребёнок предыдущего. */
function chain(...items: Array<{ id: string; role: "user" | "assistant" } | StoredMessage>): StoredMessage[] {
  const branch: StoredMessage[] = [];
  for (const item of items) {
    const parentId = branch.at(-1)?.id ?? null;
    branch.push("chatId" in item ? { ...item, parentId } : newStoredMessage({ ...item, chatId: "c", parentId, parts: [{ type: "text", text: item.id }] }));
  }
  return branch;
}
const user = (id: string) => ({ id, role: "user" as const });
const answer = (id: string) => ({ id, role: "assistant" as const });
const imported = () => stateMessage({ chatId: "c", parentId: null, record: { set: { stage: "импорт" } } });

describe("abandonedAnswersOf", () => {
  it("импорт: перед ответом только служебное сообщение — «Переделать» откажут, полей нет", () => {
    const branch = chain(imported(), answer("a0"), user("u1"), answer("a1"));
    expect(abandonedAnswersOf(branch, "regenerate", "a0")).toEqual({});
    // Ответ ниже вопроса человека — как обычно.
    expect(abandonedAnswersOf(branch, "regenerate", "a1")).toEqual({ abandonedAnswerIds: ["a1"], previousAnswerId: "a1" });
  });

  it("ответ в самом начале ветки — тоже отказ, полей нет", () => {
    expect(abandonedAnswersOf(chain(answer("a0"), user("u1")), "regenerate", "a0")).toEqual({});
  });

  it("правка вопроса без ответа: ушедших нет, прежнего нет", () => {
    const branch = chain(user("u1"), answer("a1"), user("u2"));
    expect(abandonedAnswersOf(branch, "edit", "u2")).toEqual({ abandonedAnswerIds: [] });
  });

  it("правка последнего вопроса с ответом: уходит только его ответ", () => {
    const branch = chain(user("u1"), answer("a1"), user("u2"), answer("a2"));
    expect(abandonedAnswersOf(branch, "edit", "u2")).toEqual({ abandonedAnswerIds: ["a2"], previousAnswerId: "a2" });
  });

  it("правка служебного сообщения — полей нет", () => {
    const state = imported();
    expect(abandonedAnswersOf(chain(state, answer("a0")), "edit", state.id)).toEqual({});
  });
});

describe("abandonedOnRetry", () => {
  const broken = (id: string, status: StoredMessage["status"] = "stopped") => ({ ...newStoredMessage({ id, chatId: "c", parentId: null, role: "assistant", parts: [] }), status });

  it("оборванный ответ: он уходит с ветки и его заменит сосед", () => {
    expect(abandonedOnRetry(chain(user("u1"), answer("a1"), user("u2"), broken("a2")))).toEqual({ abandonedAnswerIds: ["a2"], previousAnswerId: "a2" });
    expect(abandonedOnRetry(chain(user("u1"), broken("a1", "error")))).toEqual({ abandonedAnswerIds: ["a1"], previousAnswerId: "a1" });
  });

  it("служебные записи состояния после ответа не в счёт", () => {
    const state = stateMessage({ chatId: "c", parentId: null, record: { set: { stage: "после" } } });
    expect(abandonedOnRetry(chain(user("u1"), broken("a1"), state))).toEqual({ abandonedAnswerIds: ["a1"], previousAnswerId: "a1" });
  });

  it("вопрос без ответа: заменять нечего — полей нет", () => {
    expect(abandonedOnRetry(chain(user("u1"), answer("a1"), user("u2")))).toEqual({});
  });

  it("законченный ответ с текстом — «Повторить» откажут, полей нет", () => {
    expect(abandonedOnRetry(chain(user("u1"), answer("a1")))).toEqual({});
  });
});
