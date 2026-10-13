import { describe, expect, it, vi } from "vitest";
import {
  APP_STATE_MAX_BYTES,
  APP_STATE_PART_TYPE,
  APP_STATE_RECORD_MAX_BYTES,
  AppStateTooLargeError,
  appStatePart,
  createAppStateWriter,
  foldAppState,
  loadBranchAppState,
  publicAppState,
} from "../../../src/app-state/app-state";
import type { AppStateRecord } from "../../../src/app-state/app-state";
import { newStoredMessage } from "../../../src/conversation/types";
import type { StoredMessage } from "../../../src/conversation/types";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";

type Part = StoredMessage["parts"][number];

const statePart = (record: unknown): Part => ({ type: APP_STATE_PART_TYPE, data: record }) as Part;
const withParts = (...parts: Part[]) => ({ parts });

function writer(base = {}, extra: { reserved?: boolean } = {}) {
  const records: AppStateRecord[] = [];
  const logError = vi.fn();
  const state = createAppStateWriter({ base, write: (record) => records.push(record), logError, chatId: "chat-1", ...extra });
  return { state, records, logError };
}

describe("foldAppState: свёртка записей по порядку", () => {
  it("set ставит значение по пути, вложенные объекты создаются", () => {
    const values = foldAppState([withParts(statePart({ set: { "fields.email": "a@x.ru", "booking.holdId": 7 } }))]);
    expect(values).toEqual({ fields: { email: "a@x.ru" }, booking: { holdId: 7 } });
  });

  it("сообщения и части — по порядку: поздняя запись побеждает", () => {
    const values = foldAppState([
      withParts(statePart({ set: { "fields.email": "a@x.ru" } })),
      withParts({ type: "text", text: "ok" } as Part, statePart({ set: { "fields.email": "b@x.ru" } })),
    ]);
    expect(values).toEqual({ fields: { email: "b@x.ru" } });
  });

  it("unset убирает поле; внутри одной части сначала unset, потом set", () => {
    const values = foldAppState([
      withParts(statePart({ set: { "fields.email": "a@x.ru", "fields.phone": "+7" } })),
      withParts(statePart({ unset: ["fields"], set: { "fields.name": "Анна" } })),
    ]);
    expect(values).toEqual({ fields: { name: "Анна" } });
  });

  it("set объекта заменяет всё поддерево; путь через не-объект делает объект", () => {
    const values = foldAppState([
      withParts(statePart({ set: { "a.b": 1, "a.c": 2, x: 5 } })),
      withParts(statePart({ set: { a: { d: 3 }, "x.y": 1 } })),
    ]);
    expect(values).toEqual({ a: { d: 3 }, x: { y: 1 } });
  });

  it("испорченные части и чужие части пропускаются", () => {
    const values = foldAppState([
      withParts(
        statePart(null),
        statePart({ set: "строка" }),
        statePart({ set: { "": 1 } }),
        statePart({ set: { "__proto__.polluted": 1 } }),
        statePart({ unset: [5] }),
        { type: "data-app-event", data: { type: "x" } } as Part,
        statePart({ set: { ok: true } }),
      ),
    ]);
    expect(values).toEqual({ ok: true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("база не меняется свёрткой", () => {
    const base = { fields: { email: "a@x.ru" } };
    const values = foldAppState([withParts(statePart({ set: { "fields.phone": "+7" } }))], base);
    expect(values).toEqual({ fields: { email: "a@x.ru", phone: "+7" } });
    expect(base).toEqual({ fields: { email: "a@x.ru" } });
  });
});

describe("publicAppState: служебные ключи SDK не видны", () => {
  it("верхние ключи на $ убраны", () => {
    expect(publicAppState({ $closed: { code: "done" }, fields: { $x: 1 } })).toEqual({ fields: { $x: 1 } });
  });
});

describe("appStatePart", () => {
  it("часть для записи в сообщение", () => {
    expect(appStatePart({ set: { a: 1 } })).toEqual({ type: "data-app-state", data: { set: { a: 1 } } });
  });
});

describe("createAppStateWriter: запись инструмента", () => {
  it("каждый вызов — своя запись; get видит записанное сразу", () => {
    const { state, records } = writer({ fields: { email: "a@x.ru" } });
    expect(state.get("fields.email")).toBe("a@x.ru");
    state.set("fields.phone", "+7");
    state.unset("fields.email");
    expect(records).toEqual([{ set: { "fields.phone": "+7" } }, { unset: ["fields.email"] }]);
    expect(state.get()).toEqual({ fields: { phone: "+7" } });
    expect(state.get("fields.email")).toBeUndefined();
    expect(state.get("missing.deep")).toBeUndefined();
  });

  it("запись, которая ничего не меняет, не пишется", () => {
    const { state, records } = writer({ fields: { email: "a@x.ru" } });
    state.set("fields.email", "a@x.ru");
    state.unset("fields.phone");
    expect(records).toEqual([]);
  });

  it("get отдаёт копию: правка результата состояние не меняет", () => {
    const { state } = writer({ fields: { list: [1] } });
    (state.get("fields.list") as number[]).push(2);
    (state.get() as { fields: { list: number[] } }).fields.list.push(3);
    expect(state.get("fields.list")).toEqual([1]);
  });

  it("значение — копия JSON: правка исходного объекта после set не меняет состояние", () => {
    const { state, records } = writer();
    const value = { a: [1] };
    state.set("x", value);
    value.a.push(2);
    expect(state.get("x")).toEqual({ a: [1] });
    expect(records[0]).toEqual({ set: { x: { a: [1] } } });
  });

  it("неверный путь и не-JSON — TypeError, ничего не записано", () => {
    const { state, records } = writer();
    for (const path of ["", "a..b", ".a", "a.", "__proto__", "a.constructor", "a.prototype", "x".repeat(201)]) {
      expect(() => state.set(path, 1), path).toThrow(TypeError);
    }
    expect(() => state.unset("")).toThrow(TypeError);
    expect(() => state.set(5 as unknown as string, 1)).toThrow(TypeError);
    expect(() => state.set("a", undefined)).toThrow(TypeError);
    expect(() => state.set("a", () => 1)).toThrow(TypeError);
    expect(() => state.set("a", 10n)).toThrow(TypeError);
    expect(records).toEqual([]);
  });

  it("значение — только простой JSON: Map, Set, Date, класс, NaN, Infinity, круг — TypeError", () => {
    const { state, records } = writer();
    class Point {
      x = 1;
    }
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const bad: Array<[string, unknown]> = [
      ["Map", new Map([["a", 1]])],
      ["Set", new Set([1])],
      ["Date", new Date(0)],
      ["класс", new Point()],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["NaN внутри", { list: [1, Number.NaN] }],
      ["Map внутри", { deep: { map: new Map() } }],
      ["undefined в массиве", [undefined]],
      ["символ", Symbol("s")],
      ["круг", loop],
    ];
    for (const [name, value] of bad) expect(() => state.set("x", value), name).toThrow(TypeError);
    expect(records).toEqual([]);
    state.set("ok", { a: [1, "два", null, true, { b: -0.5 }], empty: {}, plain: Object.create(null) });
    expect(records).toHaveLength(1);
  });

  it("путь через не-объект — TypeError: значение не заменяется объектом молча; массив пишется целиком", () => {
    const { state, records } = writer({ fields: { report: "отчёт.pdf" }, items: [1, 2], none: null });
    expect(() => state.set("fields.report.pdf", 1)).toThrow(TypeError);
    expect(() => state.set("fields.report.pdf", 1)).toThrow(/fields\.report/);
    expect(() => state.set("items.0", 5)).toThrow(TypeError);
    expect(() => state.unset("items.0")).toThrow(TypeError);
    expect(() => state.set("none.x", 1)).toThrow(TypeError);
    expect(records).toEqual([]);
    expect(state.get()).toEqual({ fields: { report: "отчёт.pdf" }, items: [1, 2], none: null });
    // Нет промежуточного объекта — создаётся; массив и строка заменяются целиком по своему пути.
    state.set("fields.new.deep", 1);
    state.set("items", [5, 2]);
    state.set("fields.report", { pdf: 1 });
    expect(state.get()).toEqual({ fields: { report: { pdf: 1 }, new: { deep: 1 } }, items: [5, 2], none: null });
  });

  it("служебный ключ ($…) приложению не писать и не видеть", () => {
    const { state, records } = writer({ $closed: { code: "done" }, fields: {} });
    expect(() => state.set("$closed", null)).toThrow(TypeError);
    expect(() => state.unset("$closed.code")).toThrow(TypeError);
    expect(state.get()).toEqual({ fields: {} });
    expect(state.get("$closed")).toBeUndefined();
    expect(state.values()).toEqual({ $closed: { code: "done" }, fields: {} });
    expect(records).toEqual([]);
  });

  it("ядро пишет служебный ключ с reserved", () => {
    const { state, records } = writer({}, { reserved: true });
    state.set("$closed", { code: "done", message: "Готово" });
    expect(records).toEqual([{ set: { $closed: { code: "done", message: "Готово" } } }]);
    expect(state.values()).toEqual({ $closed: { code: "done", message: "Готово" } });
  });

  it("запись больше 16 КБ — AppStateTooLargeError, ничего не записано", () => {
    const { state, records } = writer();
    const big = "я".repeat(APP_STATE_RECORD_MAX_BYTES);
    expect(() => state.set("doc", big)).toThrow(AppStateTooLargeError);
    expect(records).toEqual([]);
    expect(state.get("doc")).toBeUndefined();
  });

  it("состояние больше 256 КБ — AppStateTooLargeError, прежнее состояние цело", () => {
    const chunk = "x".repeat(APP_STATE_RECORD_MAX_BYTES - 100);
    const base: Record<string, string> = {};
    for (let index = 0; index * chunk.length < APP_STATE_MAX_BYTES - chunk.length; index++) base[`k${index}`] = chunk;
    const { state, records } = writer(base);
    expect(() => state.set("more", chunk)).toThrow(AppStateTooLargeError);
    expect(() => state.set("more", chunk)).toThrow(/256/);
    expect(records).toEqual([]);
    expect(state.get("more")).toBeUndefined();
    // Удаление всегда проходит: оно состояние только уменьшает.
    state.unset("k0");
    expect(records).toEqual([{ unset: ["k0"] }]);
  });

  it("после close запись не идёт, не бросает, строка в журнал; get работает", () => {
    const { state, records, logError } = writer({ a: 1 });
    state.close();
    expect(() => state.set("b", 2)).not.toThrow();
    expect(() => state.unset("a")).not.toThrow();
    expect(records).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(logError.mock.calls[0]![0]).toContain("chat-1");
    expect(state.get("a")).toBe(1);
  });

  it("свёртка записей писателя даёт то же состояние, что видит писатель", () => {
    const base = { fields: { email: "a@x.ru" } };
    const { state, records } = writer(base);
    state.set("fields.phone", "+7");
    state.unset("fields.email");
    state.set("booking", { holdId: 3 });
    expect(foldAppState([withParts(...records.map(appStatePart))], base)).toEqual(state.values());
  });
});

describe("loadBranchAppState: состояние текущей ветки из хранилища", () => {
  async function chatWithBranches() {
    const storage = createInMemoryChatStorage();
    await storage.createChat({ id: "c", ownerId: "anna", modelId: "m", providerId: "p" });
    const at = (second: number) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
    await storage.insertMessage(newStoredMessage({ id: "u1", chatId: "c", role: "user", parts: [{ type: "text", text: "Привет" }], createdAt: at(1) }));
    await storage.insertMessage(
      newStoredMessage({ id: "a1", chatId: "c", role: "assistant", parentId: "u1", parts: [statePart({ set: { "fields.email": "a@x.ru" } })], createdAt: at(2) }),
    );
    // Сосед-ответ под тем же вопросом создан позже: он на текущей ветке.
    await storage.insertMessage(
      newStoredMessage({ id: "a2", chatId: "c", role: "assistant", parentId: "u1", parts: [statePart({ set: { "fields.name": "Анна", $closed: { code: "x" } } })], createdAt: at(3) }),
    );
    return storage;
  }

  it("свёртка только по текущей ветке, служебные ключи на месте, atMessageId — последнее сообщение", async () => {
    const storage = await chatWithBranches();
    expect(await loadBranchAppState(storage, "c")).toEqual({ values: { fields: { name: "Анна" }, $closed: { code: "x" } }, atMessageId: "a2" });
  });

  it("выбор старой ветки возвращает её записи", async () => {
    const storage = await chatWithBranches();
    await storage.insertBranchSelection({ id: "s1", chatId: "c", messageId: "a1", selectedAt: "2026-01-01T00:01:00.000Z" });
    expect(await loadBranchAppState(storage, "c")).toEqual({ values: { fields: { email: "a@x.ru" } }, atMessageId: "a1" });
  });

  it("пустой чат — пустое состояние", async () => {
    const storage = createInMemoryChatStorage();
    await storage.createChat({ id: "c", ownerId: "anna", modelId: "m", providerId: "p" });
    expect(await loadBranchAppState(storage, "c")).toEqual({ values: {}, atMessageId: null });
  });
});
