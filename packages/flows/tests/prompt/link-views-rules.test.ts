import { describe, expect, it } from "vitest";
import { flowRules } from "../../src/prompt/flow-rules";
import { fixtureFlow, stateOf } from "../flow-fixtures";

// Правила просмотра ссылки живут в описании инструмента (`@ykurilov/agent-chat-web-tools`): инструмента в наборе
// модели нет — нет и правил. Инструкция сценария набора хода не знает и инструмент не называет.
describe("правило о ссылке собеседника", () => {
  it("инструмент включён в ноде — инструкция сценария его всё равно не называет", () => {
    const flow = fixtureFlow("shop-support", (json) => {
      json.tools.push("person_link_view");
      stateOf(json, "order").tools.push("person_link_view");
    });
    expect(flowRules("", flow)).not.toContain("person_link_view");
    expect(flowRules("", flow)).not.toContain("Ссылки человека");
  });
});
