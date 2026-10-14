import { describe, expect, it } from "vitest";
import { flowRules } from "../../src/prompt/flow-rules";
import { clientFactsRules } from "../../src/prompt/rules/client-facts";
import { fixtureFlow } from "../flow-fixtures";

const rules = () => flowRules("", fixtureFlow("sales-review"), [clientFactsRules]);

describe("правило о фактах о человеке", () => {
  it("по умолчанию в инструкции сценария правила нет: тексты старых приложений не меняются", () => {
    expect(flowRules("", fixtureFlow("sales-review"))).not.toMatch(/факт/i);
  });

  it("как писать факт: коротко, не дублировать блок, без догадок и секретов", () => {
    const text = rules();
    expect(text).toContain("flow_note");
    expect(text).toMatch(/fact/);
    expect(text).toMatch(/одной короткой фразой/);
    expect(text).toMatch(/секрет|пароли/i);
  });

  it("память и карточка не дублируются: факты о человеке — в карточку, правила общения — в память", () => {
    const text = rules();
    expect(text).toContain("manage_memory");
    expect(text).toMatch(/факты о человеке[^]*здесь/i);
    expect(text).toMatch(/как с ним общаться/i);
  });

  it("«забудь обо мне» стирает и в памяти, если она есть", () => {
    expect(rules()).toMatch(/забудь[^]*manage_memory|manage_memory[^]*забудь/i);
  });

  it("текст один и тот же при каждом вызове: кэш модели цел", () => {
    expect(rules()).toBe(rules());
  });
});
