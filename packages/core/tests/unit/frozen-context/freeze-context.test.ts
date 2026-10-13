import { describe, expect, it, vi } from "vitest";
import { freezeContext } from "../../../src/frozen-context/freeze-context";
import type { FrozenContextData } from "../../../src/frozen-context/context-blocks";

const memory = (text: string) => async () => [{ key: "memory", text, private: true }];
const TODAY = "Сегодня: четверг, 1 января 2026 г.";

describe("freezeContext: набор блоков хода и что из него уходит модели", () => {
  it("базы нет — весь набор: память, дата, блоки приложения, место; память личная", async () => {
    const data = await freezeContext({
      chatId: "chat-1",
      sources: {
        memory: memory("<agent_memory>A</agent_memory>"),
        today: TODAY,
        app: async () => [{ key: "skills", text: "Скиллы: поиск" }],
        place: "<screen_place>Карточка</screen_place>",
      },
      base: null,
    });
    expect(data).toEqual({
      blocks: [
        { key: "memory", text: "<agent_memory>A</agent_memory>", private: true },
        { key: "today", text: TODAY },
        { key: "skills", text: "Скиллы: поиск" },
        { key: "screen_place", text: "<screen_place>Карточка</screen_place>" },
      ],
      sent: "all",
      base: null,
    });
  });

  const base: { id: string; data: FrozenContextData } = {
    id: "a1",
    data: {
      blocks: [
        { key: "memory", text: "<agent_memory>A</agent_memory>", private: true },
        { key: "today", text: TODAY },
        { key: "screen_place", text: "<screen_place>Карточка</screen_place>" },
      ],
      sent: "all",
      base: null,
    },
  };

  it("ничего не изменилось — пустая приписка против базы", async () => {
    const data = await freezeContext({
      chatId: "chat-1",
      sources: { memory: memory("<agent_memory>A</agent_memory>"), today: TODAY, place: "<screen_place>Карточка</screen_place>" },
      base,
    });
    expect(data.sent).toEqual({ changed: [], removed: [] });
    expect(data.base).toBe("a1");
    expect(data.blocks).toEqual(base.data.blocks);
  });

  it("память изменилась, места больше нет — изменённые и убранные ключи", async () => {
    const data = await freezeContext({ chatId: "chat-1", sources: { memory: memory("<agent_memory>B</agent_memory>"), today: TODAY, place: null }, base });
    expect(data.sent).toEqual({ changed: ["memory"], removed: ["screen_place"] });
    expect(data.blocks.map((block) => block.key)).toEqual(["memory", "today"]);
  });

  it("память упала — её блоки из базы без изменений, строка в журнал", async () => {
    const logError = vi.fn();
    const data = await freezeContext({
      chatId: "chat-1",
      sources: { memory: async () => Promise.reject(new Error("база легла")), today: TODAY, place: "<screen_place>Карточка</screen_place>" },
      base,
      logError,
    });
    expect(data.sent).toEqual({ changed: [], removed: [] });
    expect(data.blocks[0]).toEqual({ key: "memory", text: "<agent_memory>A</agent_memory>", private: true });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toContain("chat-1");
  });

  it("источник не спрашивался (групповой ход) — его блоки из базы, это не «убран»", async () => {
    const data = await freezeContext({ chatId: "chat-1", sources: { today: TODAY, place: "<screen_place>Карточка</screen_place>" }, base });
    expect(data.sent).toEqual({ changed: [], removed: [] });
    expect(data.blocks.map((block) => block.key)).toEqual(["memory", "today", "screen_place"]);
  });

  it("пустая память — блоки памяти убраны", async () => {
    const data = await freezeContext({ chatId: "chat-1", sources: { memory: async () => null, today: TODAY, place: "<screen_place>Карточка</screen_place>" }, base });
    expect(data.sent).toEqual({ changed: [], removed: ["memory"] });
  });

  it("блоки приложения: занятый ключ, повтор и пустой текст отбрасываются со строкой в журнал", async () => {
    const logError = vi.fn();
    const data = await freezeContext({
      chatId: "chat-1",
      sources: {
        today: TODAY,
        app: async () => [
          { key: "today", text: "чужая дата" },
          { key: "memory:1", text: "чужая память" },
          { key: "skills", text: "раз" },
          { key: "skills", text: "два" },
          { key: "empty", text: "" },
        ],
      },
      base: null,
      logError,
    });
    expect(data.blocks).toEqual([
      { key: "today", text: TODAY },
      { key: "skills", text: "раз" },
    ]);
    expect(logError).toHaveBeenCalledTimes(4);
  });

  describe("блок есть, но не показан ради места ({ key, hidden: true })", () => {
    const withNote: { id: string; data: FrozenContextData } = {
      id: "a1",
      data: {
        blocks: [
          { key: "memory", text: "<agent_memory>шапка</agent_memory>", private: true },
          { key: "memory:n1", text: "<agent_memory>запись 1</agent_memory>", private: true },
          { key: "today", text: TODAY },
          { key: "skills", text: "Скиллы: поиск" },
        ],
        sent: "all",
        base: null,
      },
    };

    it("показанный раньше блок скрыт — не «удалён»: ключ в hidden, не в removed; в наборе его нет", async () => {
      const data = await freezeContext({
        chatId: "chat-1",
        sources: {
          memory: async () => [{ key: "memory", text: "<agent_memory>шапка</agent_memory>", private: true }, { key: "memory:n1", hidden: true }],
          today: TODAY,
          app: async () => [{ key: "skills", hidden: true }],
        },
        base: withNote,
      });
      expect(data.sent).toEqual({ changed: [], removed: [], hidden: ["memory:n1", "skills"] });
      expect(data.blocks.map((block) => block.key)).toEqual(["memory", "today"]);
    });

    it("скрытый блок, которого модель не видела, — ни в hidden, ни в removed", async () => {
      const data = await freezeContext({
        chatId: "chat-1",
        sources: {
          memory: async () => [{ key: "memory", text: "<agent_memory>шапка</agent_memory>", private: true }, { key: "memory:n1", text: "<agent_memory>запись 1</agent_memory>" }, { key: "memory:n0", hidden: true }],
          today: TODAY,
          app: async () => [{ key: "skills", text: "Скиллы: поиск" }],
        },
        base: withNote,
      });
      expect(data.sent).toEqual({ changed: [], removed: [] });
    });

    it("без базы скрытые блоки просто не входят в набор", async () => {
      const data = await freezeContext({ chatId: "chat-1", sources: { memory: async () => [{ key: "memory:n1", hidden: true }], today: TODAY }, base: null });
      expect(data).toEqual({ blocks: [{ key: "today", text: TODAY }], sent: "all", base: null });
    });

    it("скрытый блок с занятым ключом или повтором ключа отбрасывается со строкой в журнал", async () => {
      const logError = vi.fn();
      await freezeContext({ chatId: "chat-1", sources: { today: TODAY, app: async () => [{ key: "today", hidden: true }, { key: "x", text: "X" }, { key: "x", hidden: true }] }, base: null, logError });
      expect(logError.mock.calls.map(([line]) => line)).toEqual([
        expect.stringContaining("ключ=«today» отброшен"),
        expect.stringContaining("ключ=«x» отброшен: повтор ключа"),
      ]);
    });
  });

  describe("память один раз на видимую историю (038)", () => {
    const readBase: { id: string; data: FrozenContextData } = { id: "a1", data: { ...base.data, memoryFrom: "u1" } };

    it("база прочитала память при том же начале истории — источник не зовётся, память из базы, приписки про неё нет", async () => {
      const source = vi.fn(memory("<agent_memory>B</agent_memory>"));
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { memory: source, today: TODAY, place: "<screen_place>Карточка</screen_place>" }, base: readBase });
      expect(source).not.toHaveBeenCalled();
      expect(data.blocks).toEqual(base.data.blocks);
      expect(data.sent).toEqual({ changed: [], removed: [] });
      expect(data.memoryFrom).toBe("u1");
    });

    it("запись памяти пропала из источника — «Больше не действует» нет: источник не зовётся", async () => {
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { memory: async () => null, today: TODAY, place: "<screen_place>Карточка</screen_place>" }, base: readBase });
      expect(data.sent).toEqual({ changed: [], removed: [] });
    });

    it("дата сменилась — приписка с датой есть, память по-прежнему из базы", async () => {
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { memory: memory("<agent_memory>B</agent_memory>"), today: "Сегодня: пятница, 2 января 2026 г.", place: "<screen_place>Карточка</screen_place>" }, base: readBase });
      expect(data.sent).toEqual({ changed: ["today"], removed: [] });
      expect(data.blocks[0]!.text).toBe("<agent_memory>A</agent_memory>");
    });

    it("начало истории другое (после сжатия) — память читается заново и сверяется с базой", async () => {
      const source = vi.fn(memory("<agent_memory>B</agent_memory>"));
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u7", sources: { memory: source, today: TODAY, place: "<screen_place>Карточка</screen_place>" }, base: readBase });
      expect(source).toHaveBeenCalledTimes(1);
      expect(data.sent).toEqual({ changed: ["memory"], removed: [] });
      expect(data.memoryFrom).toBe("u7");
    });

    it("база из старой версии (без отметки) — память читается один раз, отметка ставится", async () => {
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { memory: memory("<agent_memory>A</agent_memory>"), today: TODAY, place: "<screen_place>Карточка</screen_place>" }, base });
      expect(data.sent).toEqual({ changed: [], removed: [] });
      expect(data.memoryFrom).toBe("u1");
    });

    it("базы нет — память читается, отметка ставится", async () => {
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { memory: memory("<agent_memory>A</agent_memory>"), today: TODAY }, base: null });
      expect(data.sent).toBe("all");
      expect(data.memoryFrom).toBe("u1");
    });

    it("сбой памяти — блоки из базы, отметки нет: следующий ход попробует снова", async () => {
      const data = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { memory: async () => Promise.reject(new Error("база легла")), today: TODAY }, base, logError: vi.fn() });
      expect(data.blocks[0]).toEqual({ key: "memory", text: "<agent_memory>A</agent_memory>", private: true });
      expect(data).not.toHaveProperty("memoryFrom");
    });

    it("источника нет (групповой ход) — отметка базы переносится, если начало то же; иначе её нет", async () => {
      const same = await freezeContext({ chatId: "chat-1", memoryFrom: "u1", sources: { today: TODAY }, base: readBase });
      expect(same.memoryFrom).toBe("u1");
      const other = await freezeContext({ chatId: "chat-1", memoryFrom: "u7", sources: { today: TODAY }, base: readBase });
      expect(other).not.toHaveProperty("memoryFrom");
      expect(other.blocks[0]!.key).toBe("memory");
    });
  });
});
