import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type { AgentWidgetSettings, BasicWidgetName, UsageSource, WidgetDescription } from "../../../src/index";

// Типы проверяет `pnpm typecheck` (тесты входят в tsconfig пакета): рантайм здесь только подтверждает, что файл выполнился.
describe("типы виджетов в ядре", () => {
  it("BasicWidgetName — ровно пять базовых виджетов", () => {
    expectTypeOf<BasicWidgetName>().toEqualTypeOf<"ask_choice" | "ask_multi_choice" | "ask_rating" | "ask_form" | "suggest_replies">();
    expect(true).toBe(true);
  });

  it("WidgetDescription: имя, описание и обе схемы обязательны, question необязателен", () => {
    expectTypeOf<WidgetDescription["name"]>().toEqualTypeOf<string>();
    expectTypeOf<WidgetDescription["description"]>().toEqualTypeOf<string>();
    expectTypeOf<WidgetDescription>().toHaveProperty("inputSchema");
    expectTypeOf<WidgetDescription>().toHaveProperty("answerSchema");
    const minimal = {
      name: "pick_slot",
      description: "Выбрать время",
      inputSchema: z.object({ slots: z.array(z.string()) }),
      answerSchema: z.object({ slot: z.string() }),
    } satisfies WidgetDescription;
    const withQuestion = { ...minimal, question: (input: { slots: string[] }) => input.slots.join(",") } satisfies WidgetDescription;
    expect([minimal.name, withQuestion.question({ slots: ["a", "b"] })]).toEqual(["pick_slot", "a,b"]);
  });

  it("AgentWidgetSettings: basic — true или список имён, custom — список описаний; всё необязательно", () => {
    const empty = {} satisfies AgentWidgetSettings;
    const all = { basic: true } satisfies AgentWidgetSettings;
    const some = { basic: ["ask_choice", "suggest_replies"] } satisfies AgentWidgetSettings;
    // @ts-expect-error: `false` не настройка — виджеты выключаются отсутствием `widgets`
    const off: AgentWidgetSettings = { basic: false };
    // @ts-expect-error: чужого базового виджета нет
    const unknown: AgentWidgetSettings = { basic: ["ask_everything"] };
    expectTypeOf<AgentWidgetSettings["basic"]>().toEqualTypeOf<true | BasicWidgetName[] | undefined>();
    expectTypeOf<AgentWidgetSettings["custom"]>().toEqualTypeOf<WidgetDescription[] | undefined>();
    expect([empty, all, some, off, unknown].length).toBe(5);
  });

  it('UsageSource принимает "images" и прежние значения', () => {
    const images: UsageSource = "images";
    const sources: UsageSource[] = ["answer", "answer_correction", "compaction", "memory", "speech", "sounds", "web_tools", images];
    expect(sources).toContain("images");
  });
});
