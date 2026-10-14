import { describe, expect, it } from "vitest";
import { startRun } from "../../src/engine";
import { flowRules } from "../../src/prompt/flow-rules";
import { stateCard } from "../../src/prompt/state-card";
import { fixtureFlow } from "../flow-fixtures";

describe("постоянные правила сценария", () => {
  it("правила и «Общее для всех состояний»; без «Общего» раздела нет", () => {
    const rules = flowRules("Цены не называй.");
    expect(rules).toContain("flow:state");
    expect(rules).toContain("flow_exit");
    expect(rules).toContain("client_card");
    expect(rules).toContain("## Общее для всех состояний\nЦены не называй.");
    expect(flowRules("  ")).not.toContain("Общее для всех состояний");
    expect(flowRules("Цены не называй.")).toBe(rules);
  });
});

describe("карточка состояния", () => {
  const flow = fixtureFlow("sales-review");
  const at = (state: string) => ({ ...startRun(flow, 0), state });

  it("название, цель, как вести себя, пронумерованные условия словами — свои, потом общие", () => {
    const card = stateCard(flow, at("offer"));
    expect(card).toContain("Предложение разбора");
    expect(card).toContain("Цель: Предложить бесплатный разбор и дать ссылку на запись.");
    expect(card).toContain("Коротко подведи итог");
    expect(card).toContain("1. Сомневается: время, цена, «а вдруг не поможет»");
    expect(card).toContain("2. Прямо отказался от разбора");
    expect(card).toContain("give_booking_link");
    expect(card).toMatch(/недоступн[^\n]*call_expert/);
  });

  it("что узнать здесь — по названиям полей; первого текста в карточке нет", () => {
    const card = stateCard(flow, at("intro"));
    expect(card).toContain("Тема курса");
    expect(card).toContain("Продажи курса");
    expect(card).not.toContain("Здравствуйте! Я помощник");
  });

  it("конечное состояние: условий выхода нет", () => {
    expect(stateCard(flow, at("soft"))).toContain("последнее состояние");
  });

  it("зависит только от состояния: путь и счётчики карточку не меняют", () => {
    const run = at("block");
    expect(stateCard(flow, { ...run, humanMessages: 9, path: [] })).toBe(stateCard(flow, run));
  });
});
