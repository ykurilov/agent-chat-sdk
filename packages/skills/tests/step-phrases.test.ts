import { describe, expect, it } from "vitest";
import { englishSkillsStepPhrases, skillsStepPhrases } from "../src/labels";

describe("фраза шага навыка", () => {
  it("с именем навыка и значком «навык»", () => {
    expect(skillsStepPhrases.use_skill!({ input: { name: "game-dev" } })).toEqual({ running: "Открываю навык game-dev", done: "Открыл навык game-dev", icon: "skill" });
    expect(englishSkillsStepPhrases.use_skill!({ input: { name: "game-dev" } })).toEqual({ running: "Opening skill game-dev", done: "Opened skill game-dev", icon: "skill" });
  });

  it("имени нет (вход ещё пишется, скрыт правами) или оно странное — без имени", () => {
    expect(skillsStepPhrases.use_skill!({})).toEqual({ running: "Открываю навык", done: "Открыл навык", icon: "skill" });
    expect(skillsStepPhrases.use_skill!({ input: { name: "x".repeat(80) } }).done).toBe("Открыл навык");
  });
});
