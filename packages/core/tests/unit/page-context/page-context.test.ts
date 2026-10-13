import { describe, expect, it } from "vitest";
import { APP_CHANGE_PART_TYPE, BROWSER_CALL_PART_TYPE } from "../../../src/index";
import type { DataChange, ScreenPlace, TurnRequestContext } from "../../../src/index";

describe("общие части 021 в ядре", () => {
  it("имена кусков потока постоянны: клиент и сервер узнают их по этим строкам", () => {
    expect(APP_CHANGE_PART_TYPE).toBe("data-app-change");
    expect(BROWSER_CALL_PART_TYPE).toBe("data-browser-call");
  });

  it("типы места, изменения данных и контекста запроса собираются так, как описано в договоре", () => {
    const place: ScreenPlace = { description: "Карточка задачи «Купить молоко», id 7", data: { taskId: 7 } };
    const change: DataChange = { tag: "tasks", details: { id: 7 } };
    const context: TurnRequestContext = { place, tabId: "tab-1" };
    const withoutPlace: TurnRequestContext = { place: null };
    const empty: TurnRequestContext = {};
    expect([place.description, change.tag, context.tabId, withoutPlace.place, empty.tabId]).toEqual([
      "Карточка задачи «Купить молоко», id 7",
      "tasks",
      "tab-1",
      null,
      undefined,
    ]);
  });
});
