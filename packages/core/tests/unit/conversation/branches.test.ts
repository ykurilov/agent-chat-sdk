import { describe, expect, it } from "vitest";
import {
  branchForks,
  nextSiblingTime,
  selectCurrentBranch,
  touchedAt,
} from "../../../src/conversation/branches";

type Node = { id: string; parentId: string | null; createdAt: string };

function node(id: string, parentId: string | null, minute: number): Node {
  return { id, parentId, createdAt: `2026-09-29T10:${String(minute).padStart(2, "0")}:00.000Z` };
}

describe("selectCurrentBranch", () => {
  it("строит цепочку по parentId от первого сообщения", () => {
    const messages = [node("a1", "u1", 1), node("u1", null, 0), node("u2", "a1", 2), node("a2", "u2", 3)];
    expect(selectCurrentBranch(messages).map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("из двух веток от одного сообщения собеседника берёт последнюю", () => {
    const messages = [
      node("u1", null, 0),
      node("a1-old", "u1", 1),
      node("a1-new", "u1", 5),
      node("u2-old", "a1-old", 2),
    ];
    expect(selectCurrentBranch(messages).map((message) => message.id)).toEqual(["u1", "a1-new"]);
  });

  it("у каждого сообщения берёт самого позднего потомка", () => {
    const messages = [
      node("u1", null, 0),
      node("a1", "u1", 1),
      node("u2-late", "a1", 9),
      node("u2-early", "a1", 2),
      node("a2", "u2-early", 3),
      node("a3", "u2-late", 10),
    ];
    expect(selectCurrentBranch(messages).map((message) => message.id)).toEqual(["u1", "a1", "u2-late", "a3"]);
  });

  it("пустой список — пустая ветка", () => {
    expect(selectCurrentBranch([])).toEqual([]);
  });
});

const selected = (messageId: string, minute: number, second = 0) => ({
  messageId,
  selectedAt: `2026-09-29T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`,
});

describe("selectCurrentBranch: выбор человека", () => {
  const messages = [
    node("u1", null, 0),
    node("a1-old", "u1", 1),
    node("a1-new", "u1", 5),
    node("u2-old", "a1-old", 2),
    node("a2-old", "u2-old", 3),
  ];

  it("выбранный старый сосед побеждает более позднего и ведёт свою ветку до конца", () => {
    const branch = selectCurrentBranch(messages, [selected("a1-old", 6)]);
    expect(branch.map((message) => message.id)).toEqual(["u1", "a1-old", "u2-old", "a2-old"]);
  });

  it("выбор раньше, чем создан другой сосед, не мешает новому: побеждает более позднее касание", () => {
    const branch = selectCurrentBranch(messages, [selected("a1-old", 4)]);
    expect(branch.map((message) => message.id)).toEqual(["u1", "a1-new"]);
  });

  it("при нескольких выборах побеждает самый поздний", () => {
    const branch = selectCurrentBranch(messages, [selected("a1-old", 6), selected("a1-new", 7), selected("a1-old", 8)]);
    expect(branch.map((message) => message.id)).toEqual(["u1", "a1-old", "u2-old", "a2-old"]);
  });

  it("выбор на одной развилке не трогает выбор на другой: ниже выбранного соседа действует свой выбор", () => {
    const withSecondFork = [...messages, node("u2-newer", "a1-old", 4), node("a2-newer", "u2-newer", 4)];
    // самый поздний потомок a1-old — u2-newer, но человек выбрал u2-old
    const branch = selectCurrentBranch(withSecondFork, [selected("u2-old", 7), selected("a1-old", 8)]);
    expect(branch.map((message) => message.id)).toEqual(["u1", "a1-old", "u2-old", "a2-old"]);
  });

  it("ничья по времени — побеждает записанный позже", () => {
    const tie = [node("u1", null, 0), node("a1", "u1", 1), node("a2", "u1", 1)];
    expect(selectCurrentBranch(tie).map((message) => message.id)).toEqual(["u1", "a2"]);
  });

  it("развилка у первого сообщения: выбор работает и там", () => {
    const roots = [node("u1", null, 0), node("u1-edit", null, 3), node("a1", "u1", 1), node("a1-edit", "u1-edit", 4)];
    expect(selectCurrentBranch(roots).map((message) => message.id)).toEqual(["u1-edit", "a1-edit"]);
    expect(selectCurrentBranch(roots, [selected("u1", 5)]).map((message) => message.id)).toEqual(["u1", "a1"]);
  });

  it("выбор сообщения, которого нет, ничего не ломает", () => {
    expect(selectCurrentBranch(messages, [selected("нет-такого", 9)]).map((message) => message.id)).toEqual(["u1", "a1-new"]);
  });
});

describe("touchedAt", () => {
  it("максимум из создания и выборов сообщения", () => {
    const message = node("a", "u", 1);
    expect(touchedAt(message, [])).toBe(message.createdAt);
    expect(touchedAt(message, [selected("a", 5), selected("b", 9), selected("a", 3)])).toBe(selected("a", 5).selectedAt);
    expect(touchedAt(message, [selected("a", 0)])).toBe(message.createdAt);
  });
});

describe("branchForks", () => {
  it("даёт развилки только для сообщений ветки, у которых есть соседи; соседи по порядку создания", () => {
    const messages = [
      node("u1", null, 0),
      node("a1-b", "u1", 5),
      node("a1-a", "u1", 1),
      node("a1-c", "u1", 9),
      node("u2", "a1-b", 6),
      node("a2", "u2", 7),
      node("u2-edit", "a1-b", 8),
    ];
    const branch = selectCurrentBranch(messages, [selected("a1-b", 10)]);
    expect(branch.map((message) => message.id)).toEqual(["u1", "a1-b", "u2-edit"]);
    expect(branchForks(messages, branch)).toEqual([
      { messageId: "a1-b", siblingIds: ["a1-a", "a1-b", "a1-c"] },
      { messageId: "u2-edit", siblingIds: ["u2", "u2-edit"] },
    ]);
  });

  it("порядок соседей не зависит от выбора, у первого сообщения соседи тоже считаются", () => {
    const roots = [node("u1", null, 0), node("u1-edit", null, 3)];
    const forks = (choice: ReturnType<typeof selected>[]) => branchForks(roots, selectCurrentBranch(roots, choice));
    expect(forks([])).toEqual([{ messageId: "u1-edit", siblingIds: ["u1", "u1-edit"] }]);
    expect(forks([selected("u1", 5)])).toEqual([{ messageId: "u1", siblingIds: ["u1", "u1-edit"] }]);
  });

  it("нет соседей — нет развилок", () => {
    const line = [node("u1", null, 0), node("a1", "u1", 1)];
    expect(branchForks(line, selectCurrentBranch(line))).toEqual([]);
  });
});

describe("nextSiblingTime", () => {
  const messages = [node("u1", null, 0), node("a1", "u1", 1), node("a2", "u1", 2)];
  const at = (minute: number, second = 0) => Date.parse(`2026-09-29T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000Z`);

  it("сейчас, если оно позже всех соседей и их выборов", () => {
    expect(nextSiblingTime(messages, [], "u1", at(30))).toBe("2026-09-29T10:30:00.000Z");
  });

  it("на миллисекунду позже самого позднего касания, если часы отстают", () => {
    expect(nextSiblingTime(messages, [selected("a1", 20)], "u1", at(10))).toBe("2026-09-29T10:20:00.001Z");
  });

  it("считает только соседей этой развилки", () => {
    expect(nextSiblingTime(messages, [selected("u1", 50)], "a1", at(10))).toBe("2026-09-29T10:10:00.000Z");
  });

  it("у первого сообщения соседи — все сообщения без родителя", () => {
    expect(nextSiblingTime(messages, [], null, at(0))).toBe("2026-09-29T10:00:00.001Z");
  });
});
