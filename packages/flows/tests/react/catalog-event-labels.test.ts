import { describe, expect, it } from "vitest";
import { catalogEventLabel, catalogEventNames, checkFlow, type FlowCatalog, type FlowCondition } from "../../src/format";
import { describeCondition } from "../../src/engine/next-transition";
import { russianFlowEditorLabels as labels } from "../../src/labels/editor";
import { conditionText } from "../../src/react/editor/exit-text";
import { fixtureFlow, stateOf } from "../flow-fixtures";

// Подписи событий приложения: каталог даёт `{ name, label }` вместо строки — доска и описание условия показывают подпись.
// Строки по-прежнему годятся; без подписи — имя, как раньше.

const catalog: FlowCatalog = {
  tools: ["give_booking_link", "call_expert"],
  events: ["booking_link", { name: "paid", label: "Оплачено" }, { name: "refund" }],
  widgets: [],
};
const paid: FlowCondition = { type: "event", event: "app", name: "paid" };
const paidButton: FlowCondition = { type: "event", event: "button", name: "paid" };
const plain: FlowCondition = { type: "event", event: "app", name: "booking_link" };

describe("подписи событий приложения", () => {
  it("каталог принимает строки и объекты: имена и подписи", () => {
    expect(catalogEventNames(catalog)).toEqual(["booking_link", "paid", "refund"]);
    expect(catalogEventLabel(catalog, "paid")).toBe("Оплачено");
    expect(catalogEventLabel(catalog, "refund")).toBeUndefined();
    expect(catalogEventLabel(catalog, "booking_link")).toBeUndefined();
    expect(catalogEventLabel(undefined, "paid")).toBeUndefined();
  });

  it("checkFlow знает события из объектов каталога", () => {
    const flow = fixtureFlow("sales-review", (json) => {
      stateOf(json, "block").exits.push({ id: "block_paid", when: paid, to: "offer" }, { id: "block_paid_button", when: paidButton, to: "offer" });
    });
    expect(checkFlow(flow, catalog).filter((issue) => issue.code === "unknown_event")).toEqual([]);
    const without = { ...catalog, events: ["booking_link"] };
    expect(checkFlow(flow, without).filter((issue) => issue.code === "unknown_event").map((issue) => issue.place.exitId)).toEqual(["block_paid", "block_paid_button"]);
  });

  it("доска: подпись вместо имени; без подписи или без каталога — имя", () => {
    const flow = fixtureFlow("sales-review");
    expect(conditionText(flow, paid, labels, catalog)).toBe("Событие приложения «Оплачено»");
    expect(conditionText(flow, paidButton, labels, catalog)).toBe("Нажата кнопка «Оплачено»");
    expect(conditionText(flow, plain, labels, catalog)).toBe("Событие приложения «booking_link»");
    expect(conditionText(flow, paid, labels)).toBe("Событие приложения «paid»");
  });

  it("describeCondition: подпись из каталога; без каталога — имя", () => {
    const flow = fixtureFlow("sales-review");
    expect(describeCondition(flow, paid, catalog)).toBe("событие «Оплачено»");
    expect(describeCondition(flow, paidButton, catalog)).toBe("нажата кнопка «Оплачено»");
    expect(describeCondition(flow, paid)).toBe("событие «paid»");
  });
});
