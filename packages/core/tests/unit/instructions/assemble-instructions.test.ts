import { describe, expect, it } from "vitest";
import { diagramsInstructions } from "../../../src/widgets/diagrams-instructions";
import { assembleInstructions, createInstructionsAssembler } from "../../../src/instructions/assemble-instructions";

describe("assembleInstructions: служебные блоки к инструкции", () => {
  it("вложения, схемы, память — по порядку, через перевод строки", () => {
    expect(assembleInstructions("Ты помощник.", { attachments: "Вложения.", diagrams: true, memory: "Память." })).toBe(
      `Ты помощник.\nВложения.\n${diagramsInstructions}\nПамять.`,
    );
  });

  it("блок уже есть в инструкции — не дублируется; блоков нет — инструкция как есть", () => {
    expect(assembleInstructions("Ты помощник.\nПамять.", { memory: "Память." })).toBe("Ты помощник.\nПамять.");
    expect(assembleInstructions(`Ты.\n${diagramsInstructions}`, { diagrams: true })).toBe(`Ты.\n${diagramsInstructions}`);
    expect(assembleInstructions("Ты помощник.", {})).toBe("Ты помощник.");
    expect(assembleInstructions("Ты помощник.", { diagrams: false, attachments: "" })).toBe("Ты помощник.");
  });
});

describe("createInstructionsAssembler: сборка на ход с запоминанием", () => {
  it("тот же текст базы — та же строка; другой — своя", () => {
    const assembler = createInstructionsAssembler({ memory: "Память." });
    const first = assembler.forBase("Песочная инструкция.");
    expect(first).toBe("Песочная инструкция.\nПамять.");
    expect(assembler.forBase("Песочная инструкция.")).toBe(first);
    expect(assembler.forBase("Другая.")).toBe("Другая.\nПамять.");
  });
});
