import type { ComponentType, ReactNode } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";
import { englishSandboxLabels, russianSandboxLabels, useSandboxLabels } from "../src/react";
import type { AnswerEditorToolOutputView, JournalRowView, ModelCallDetailsView, PeopleChatsView, SandboxLabels, SandboxSkin, ToolCallDetailsView } from "../src/react";

type Props<Part extends keyof SandboxSkin> = NonNullable<SandboxSkin[Part]> extends ComponentType<infer P> ? P : never;

describe("договор скина песочницы, версия 1 (типы проверяет typecheck)", () => {
  it("шесть обязательных частей скина и три необязательные (раздел «Чаты людей», «Открыть чат снова»)", () => {
    expectTypeOf<keyof SandboxSkin>().toEqualTypeOf<
      "SandboxLayout" | "JournalList" | "ModelCallDetails" | "ToolCallDetails" | "InstructionEditor" | "AnswerEditor" | "SandboxSections" | "PeopleChats" | "ChatReopen"
    >();
    expectTypeOf<SandboxSkin["PeopleChats"]>().toEqualTypeOf<ComponentType<PeopleChatsView> | undefined>();
    expectTypeOf<Props<"ChatReopen">>().toEqualTypeOf<{ onReopen: () => void; pending: boolean; error?: string }>();
    expectTypeOf<Props<"SandboxSections">["section"]>().toEqualTypeOf<"sandbox" | "people">();
    expectTypeOf<Props<"ModelCallDetails">>().toEqualTypeOf<ModelCallDetailsView>();
    expectTypeOf<Props<"ToolCallDetails">>().toEqualTypeOf<ToolCallDetailsView>();
    expect(true).toBe(true);
  });

  it("SandboxLayout: чат, журнал и выдвижная панель", () => {
    expectTypeOf<Props<"SandboxLayout">>().toEqualTypeOf<{
      header: ReactNode;
      chat: ReactNode;
      journal: ReactNode;
      journalOpen: boolean;
      onJournalOpenChange: (open: boolean) => void;
    }>();
    expect(true).toBe(true);
  });

  it("JournalList: строки обращений и вызовов, состояние и выбор хода", () => {
    expectTypeOf<Props<"JournalList">["state"]>().toEqualTypeOf<"loading" | "ready" | "failed" | "empty">();
    expectTypeOf<Props<"JournalList">["rows"]>().toEqualTypeOf<JournalRowView[]>();
    expectTypeOf<JournalRowView["kind"]>().toEqualTypeOf<"model" | "tool">();
    expectTypeOf<Extract<JournalRowView, { kind: "tool" }>["source"]>().toEqualTypeOf<"server" | "message">();
    expectTypeOf<Extract<JournalRowView, { kind: "model" }>["instructionsChanged"]>().toEqualTypeOf<boolean>();
    expect(true).toBe(true);
  });

  it("InstructionEditor: черновик, боевая для сравнения, сохранить и вернуть боевую", () => {
    expectTypeOf<Props<"InstructionEditor">["appInstructions"]>().toEqualTypeOf<string>();
    expectTypeOf<Props<"InstructionEditor">["onReset"]>().toEqualTypeOf<(() => void) | undefined>();
    expectTypeOf<Props<"InstructionEditor">["maxLength"]>().toEqualTypeOf<number>();
    expect(true).toBe(true);
  });

  it("AnswerEditor: текст ответа и JSON результата у каждого обычного вызова", () => {
    expectTypeOf<Props<"AnswerEditor">["text"]>().toEqualTypeOf<string>();
    expectTypeOf<Props<"AnswerEditor">["toolOutputs"]>().toEqualTypeOf<AnswerEditorToolOutputView[]>();
    expectTypeOf<AnswerEditorToolOutputView["value"]>().toEqualTypeOf<string>();
    expectTypeOf<AnswerEditorToolOutputView["error"]>().toEqualTypeOf<string | undefined>();
    expect(true).toBe(true);
  });
});

describe("надписи песочницы", () => {
  it("русский и английский словари с одинаковыми ключами", () => {
    expectTypeOf(russianSandboxLabels).toEqualTypeOf<SandboxLabels>();
    expectTypeOf(englishSandboxLabels).toEqualTypeOf<SandboxLabels>();
    expect(Object.keys(englishSandboxLabels).sort()).toEqual(Object.keys(russianSandboxLabels).sort());
    expect(Object.keys(englishSandboxLabels.purposes).sort()).toEqual(Object.keys(russianSandboxLabels.purposes).sort());
    expect(Object.keys(englishSandboxLabels.peopleChats!).sort()).toEqual(Object.keys(russianSandboxLabels.peopleChats!).sort());
    expect(Object.keys(englishSandboxLabels.chatReopen!).sort()).toEqual(Object.keys(russianSandboxLabels.chatReopen!).sort());
  });

  it("надписи с числами", () => {
    expect(russianSandboxLabels.turnLabel(2)).toBe("Ответ 2");
    expect(englishSandboxLabels.turnLabel(2)).toBe("Answer 2");
    expect(russianSandboxLabels.durationMs(1500)).toBe("1.5 с");
    expect(russianSandboxLabels.instructionsTooLong(20000)).toBe("Не длиннее 20000 знаков");
  });

  it("useSandboxLabels — функция для компонентов скина", () => {
    expect(typeof useSandboxLabels).toBe("function");
  });
});
