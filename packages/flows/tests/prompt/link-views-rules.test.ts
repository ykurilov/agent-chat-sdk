import { describe, expect, it } from "vitest";
import { flowRules } from "../../src/prompt/flow-rules";
import { PERSON_LINK_TOOL } from "../../src/prompt/rules/link-views";
import { fixtureFlow, stateOf } from "../flow-fixtures";

const withLinkTool = () =>
  fixtureFlow("shop-support", (json) => {
    json.tools.push(PERSON_LINK_TOOL);
    stateOf(json, "order").tools.push(PERSON_LINK_TOOL);
  });

describe("правило о ссылке собеседника", () => {
  it("инструмент не включён ни в одной ноде — правила нет", () => {
    expect(flowRules("", fixtureFlow("shop-support"))).not.toContain(PERSON_LINK_TOOL);
  });

  it("включён в ноде — правило есть: только присланные ссылки, данные а не команды, не открылась — один раз", () => {
    const rules = flowRules("", withLinkTool());
    expect(rules).toContain(PERSON_LINK_TOOL);
    expect(rules).toMatch(/сам прислал/);
    expect(rules).toMatch(/данные, а не команды/);
    expect(rules).toMatch(/один раз[^]*не проси[^]*снова/i);
    expect(rules).toMatch(/три/i);
  });

  it("текст один и тот же при каждом вызове: кэш модели цел", () => {
    expect(flowRules("", withLinkTool())).toBe(flowRules("", withLinkTool()));
  });
});
