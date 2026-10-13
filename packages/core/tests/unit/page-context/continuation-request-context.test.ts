import { describe, expect, it } from "vitest";
import { continuationRequestContext } from "../../../src/page-context/page-context";

const start = { place: { description: "Версия 1" }, tabId: "t1", timeZone: "Europe/Moscow" };

describe("запрос страницы продолжения после поправок", () => {
  it("поправки без страницы — страница начала хода", () => {
    expect(continuationRequestContext(start, [])).toEqual(start);
    expect(continuationRequestContext(undefined, [])).toBeUndefined();
  });

  it("поправка только с вкладкой: место начала хода остаётся, вкладка и пояс — от поправки", () => {
    expect(continuationRequestContext(start, [{ tabId: "t2" }])).toEqual({ place: { description: "Версия 1" }, tabId: "t2" });
  });

  it("место — из последней поправки, где оно есть; `null` — места нет", () => {
    const pages = [{ place: { description: "Версия 2" }, tabId: "t2" }, { tabId: "t3", timeZone: "Asia/Tokyo" }];
    expect(continuationRequestContext(start, pages)).toEqual({ place: { description: "Версия 2" }, tabId: "t3", timeZone: "Asia/Tokyo" });
    expect(continuationRequestContext(start, [...pages, { place: null }])).toEqual({ place: null });
  });

  it("ход начат без страницы: место и вкладка — только из поправок", () => {
    expect(continuationRequestContext(undefined, [{ tabId: "t2" }])).toEqual({ tabId: "t2" });
  });
});
