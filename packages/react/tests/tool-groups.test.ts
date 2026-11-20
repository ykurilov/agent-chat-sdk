import { describe, expect, it } from "vitest";
import { detailedItemsOf } from "../src/work-view/tool-groups";
import type { DetailedEntry } from "../src/work-view/tool-groups";

// Подробный вид (договор 37): одинаковые законченные вызовы подряд — одна строка. Пока ответ идёт, серия в хвосте ответа
// ещё растёт: её не сворачивать, иначе каждый новый вызов то добавляет строку, то убирает — лента скачет.

const call = (id: string): DetailedEntry<string> => ({ node: id, call: { toolName: "view_result", partId: `a1:${id}` } });
const running: DetailedEntry<string> = { node: "running", pending: true };
const blank: DetailedEntry<string> = { node: "blank", blank: true };
const text: DetailedEntry<string> = { node: "text" };
const kindsOf = (items: ReturnType<typeof detailedItemsOf<string>>) => items.map((item) => (item.kind === "group" ? `group×${item.nodes.length}` : item.node));

describe("detailedItemsOf: серия в хвосте идущего ответа", () => {
  it("ответ закончен — серия свёрнута, в группе id всех её строк", () => {
    const items = detailedItemsOf([call("1"), call("2")], { streaming: false });
    expect(kindsOf(items)).toEqual(["group×2"]);
    expect(items[0]).toMatchObject({ partId: "a1:1", partIds: ["a1:1", "a1:2"] });
  });

  it("ответ идёт, после серии ничего — строки по одной", () => {
    expect(kindsOf(detailedItemsOf([call("1"), call("2")], { streaming: true }))).toEqual(["1", "2"]);
  });

  it("ответ идёт, после серии только идущий вызов или пустой текст — строки по одной", () => {
    expect(kindsOf(detailedItemsOf([call("1"), call("2"), running], { streaming: true }))).toEqual(["1", "2", "running"]);
    expect(kindsOf(detailedItemsOf([call("1"), call("2"), blank], { streaming: true }))).toEqual(["1", "2", "blank"]);
  });

  it("ответ идёт, но агент уже пошёл дальше (текст) — серия свёрнута", () => {
    expect(kindsOf(detailedItemsOf([call("1"), call("2"), text], { streaming: true }))).toEqual(["group×2", "text"]);
  });
});
