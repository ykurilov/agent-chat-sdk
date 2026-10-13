import { describe, expect, it, vi } from "vitest";
import { createDataChangeNotifier } from "../../../src/agent-run/data-changes";

function notifier() {
  const emitted: unknown[] = [];
  const logError = vi.fn();
  const turn = createDataChangeNotifier({ emit: (chunk) => emitted.push(chunk), logError, chatId: "chat-1" });
  return { turn, emitted, logError };
}

describe("createDataChangeNotifier", () => {
  it("кусок data-app-change: временный, метка и подробности внутри, id новый на каждый вызов", () => {
    const { turn, emitted } = notifier();
    turn.notify({ tag: "tasks", details: { taskId: 7 } });
    turn.notify({ tag: "tasks" });
    expect(emitted).toHaveLength(2);
    const [first, second] = emitted as Array<{ type: string; id: string; data: unknown; transient: boolean }>;
    expect(first).toMatchObject({ type: "data-app-change", transient: true, data: { tag: "tasks", details: { taskId: 7 } } });
    expect(second).toMatchObject({ type: "data-app-change", transient: true, data: { tag: "tasks" } });
    expect(second!.data).not.toHaveProperty("details");
    expect(first!.id).toEqual(expect.any(String));
    expect(second!.id).not.toBe(first!.id);
  });

  it.each([
    ["метка не строка", { tag: 5 }],
    ["пустая метка", { tag: "" }],
    ["метка длиннее 100 знаков", { tag: "т".repeat(101) }],
    ["нет метки", {}],
    ["не объект", "tasks"],
    ["null", null],
    ["подробности не в JSON (цикл)", (() => { const loop: Record<string, unknown> = {}; loop.self = loop; return { tag: "tasks", details: loop }; })()],
    ["подробности больше 4 КБ", { tag: "tasks", details: "я".repeat(4100) }],
  ])("неверная форма — TypeError, ничего не отправлено: %s", (_name, change) => {
    const { turn, emitted } = notifier();
    expect(() => turn.notify(change as never)).toThrow(TypeError);
    expect(emitted).toEqual([]);
  });

  it("метка в 100 знаков и подробности в пределах 4 КБ проходят", () => {
    const { turn, emitted } = notifier();
    turn.notify({ tag: "т".repeat(100), details: "a".repeat(4000) });
    expect(emitted).toHaveLength(1);
  });

  it("после конца хода: ничего не отправляется, не бросает, запись в журнал без подробностей", () => {
    const { turn, emitted, logError } = notifier();
    turn.close();
    expect(() => turn.notify({ tag: "tasks", details: { secret: "x" } })).not.toThrow();
    expect(emitted).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toContain("chat-1");
    expect(logError.mock.calls[0]![0]).toContain("tasks");
    expect(logError.mock.calls[0]![0]).not.toContain("secret");
  });
});
