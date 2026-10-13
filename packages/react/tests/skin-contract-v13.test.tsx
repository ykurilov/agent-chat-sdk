import type { ComponentType } from "react";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { MessageAttachmentItem } from "../src/attachments-contract";
import type { MediaViewerItem } from "../src/media-viewer/media-viewer-types";
import type {
  ChatSkin,
  CustomWidgetProps,
  DiagramColors,
  DiagramView,
  FormFieldView,
  GeneratedImagesView,
  MediaViewerProps,
  WidgetView,
} from "../src/skin-contract";
import { stubSkin } from "./support/stub-skin";

/** Скин версии 10: ни одной из частей версии 13. Проверка типов (`pnpm typecheck`) падает, если новая часть стала обязательной. */
type SkinV10 = Omit<ChatSkin, "Widget" | "SuggestedReplies" | "GeneratedImages" | "MediaViewer" | "diagramColors">;

describe("договор скина, версия 13: типы (проверяет typecheck)", () => {
  it("скин версии 10 остаётся скином: новые части необязательные", () => {
    expectTypeOf<SkinV10>().toExtend<ChatSkin>();
    const v10: ChatSkin = stubSkin;
    expect(v10.Widget).toBeUndefined();
    expect(v10.SuggestedReplies).toBeUndefined();
    expect(v10.GeneratedImages).toBeUndefined();
    expect(v10.MediaViewer).toBeUndefined();
    expect(v10.diagramColors).toBeUndefined();
  });

  it("новые части скина и их свойства", () => {
    expectTypeOf<NonNullable<ChatSkin["Widget"]>>().toEqualTypeOf<ComponentType<WidgetView>>();
    expectTypeOf<NonNullable<ChatSkin["SuggestedReplies"]>>().toEqualTypeOf<
      ComponentType<{ replies: string[]; onPick: (text: string) => void; disabled: boolean }>
    >();
    expectTypeOf<NonNullable<ChatSkin["GeneratedImages"]>>().toEqualTypeOf<ComponentType<GeneratedImagesView>>();
    expectTypeOf<NonNullable<ChatSkin["MediaViewer"]>>().toEqualTypeOf<ComponentType<MediaViewerProps>>();
    expectTypeOf<NonNullable<ChatSkin["diagramColors"]>>().toEqualTypeOf<(dark: boolean) => DiagramColors>();
    expect(true).toBe(true);
  });

  it("AgentText получает необязательные renderDiagram и onOpenDiagram", () => {
    type AgentTextProps = ChatSkin["AgentText"] extends ComponentType<infer P> ? P : never;
    expectTypeOf<AgentTextProps["markdown"]>().toEqualTypeOf<string>();
    expectTypeOf<AgentTextProps["streaming"]>().toEqualTypeOf<boolean>();
    expectTypeOf<AgentTextProps["renderDiagram"]>().toEqualTypeOf<((source: string, blockIndex: number) => DiagramView) | undefined>();
    expectTypeOf<AgentTextProps["onOpenDiagram"]>().toEqualTypeOf<((blockIndex: number, trigger: HTMLElement) => void) | undefined>();
    // Скин версии 10 по-прежнему принимает AgentText только с markdown и streaming.
    const oldAgentText: ChatSkin["AgentText"] = ({ markdown }: { markdown: string; streaming: boolean }) => <p>{markdown}</p>;
    expect(typeof oldAgentText).toBe("function");
  });

  it("вложение человека получает необязательный onOpen", () => {
    expectTypeOf<MessageAttachmentItem["onOpen"]>().toEqualTypeOf<((trigger: HTMLElement) => void) | undefined>();
    const old: MessageAttachmentItem = { id: "a", name: "a.png", kind: "image", url: "/a", mediaType: "image/png" };
    expect(old.onOpen).toBeUndefined();
  });

  it("WidgetView: общие поля и пять видов", () => {
    const base = { toolCallId: "call-1", active: true, pending: false, answeredByMessage: false } as const;
    const views: WidgetView[] = [
      { ...base, kind: "choice", question: "Тариф?", options: ["A", "B"], onChoose: () => {} },
      { ...base, kind: "multi_choice", question: "Что?", options: ["A", "B"], min: 1, max: 2, chosen: ["A"], onSubmit: () => {} },
      { ...base, kind: "rating", question: "Оцените", scale: "stars", from: 1, to: 5, value: 4, onRate: () => {} },
      { ...base, kind: "rating", question: "Оцените", scale: "range", from: 0, to: 10, fromLabel: "плохо", toLabel: "отлично" },
      {
        ...base,
        kind: "form",
        title: "Контакты",
        fields: [{ name: "email", label: "Почта", kind: "text", required: true, error: "Обязательное поле" }],
        values: { email: "a@b.c" },
        onSubmit: () => {},
      },
      { ...base, kind: "custom", name: "pick_slot", question: "Выберите время" },
    ];
    for (const view of views) {
      if (view.kind === "choice") expectTypeOf(view.options).toEqualTypeOf<string[]>();
      if (view.kind === "rating") expectTypeOf(view.scale).toEqualTypeOf<"stars" | "range">();
      if (view.kind === "form") expectTypeOf(view.fields).toEqualTypeOf<FormFieldView[]>();
    }
    expect(views.map((view) => view.kind)).toEqual(["choice", "multi_choice", "rating", "rating", "form", "custom"]);
  });

  it("FormFieldView: вид поля, пределы, варианты и ошибка", () => {
    expectTypeOf<FormFieldView["kind"]>().toEqualTypeOf<"text" | "number" | "date" | "select">();
    expectTypeOf<FormFieldView["error"]>().toEqualTypeOf<string | undefined>();
    const select: FormFieldView = { name: "plan", label: "План", kind: "select", required: false, options: ["Basic", "Pro"] };
    expect(select.options).toEqual(["Basic", "Pro"]);
  });

  it("DiagramView: три состояния", () => {
    const states: DiagramView[] = [{ state: "streaming" }, { state: "ready", svg: "<svg/>", source: "graph TD" }, { state: "failed", source: "graph TD" }];
    expect(states.map((view) => view.state)).toEqual(["streaming", "ready", "failed"]);
    const colors: DiagramColors = { background: "#fff", text: "#000", line: "#333", node: "#eee", accent: "#06c", dark: false };
    expect(colors.dark).toBe(false);
  });

  it("GeneratedImagesView: заглушка, готовая и упавшая картинка", () => {
    const view: GeneratedImagesView = {
      ordered: 3,
      aspectRatio: "16:9",
      stopped: false,
      items: [
        { state: "loading", key: "1" },
        { state: "ready", key: "2", src: "/api/chat/c1/attachments/a2", alt: "кот", width: 1024, height: 576, onOpen: () => {} },
        { state: "failed", key: "3", reason: "не вышло" },
      ],
    };
    expect(view.items.map((item) => item.state)).toEqual(["loading", "ready", "failed"]);
  });

  it("MediaViewerProps и MediaViewerItem: картинка и схема", () => {
    const items: MediaViewerItem[] = [
      { kind: "image", key: "a1", src: "/a1", alt: "кот", width: 800, height: 600 },
      { kind: "image", key: "a2", src: "/a2", alt: "пёс" },
      { kind: "diagram", key: "m1:0", svg: "<svg/>", source: "graph TD" },
    ];
    const props: MediaViewerProps = { items, index: 0, onIndexChange: () => {}, onClose: () => {} };
    expectTypeOf(props.items).toEqualTypeOf<MediaViewerItem[]>();
    expect(props.items).toHaveLength(3);
  });

  it("CustomWidgetProps: onAnswer только у активного, остальное обязательное", () => {
    expectTypeOf<CustomWidgetProps["state"]>().toEqualTypeOf<"pending" | "answered" | "answered_by_message" | "closed">();
    expectTypeOf<CustomWidgetProps<{ slots: string[] }, { slot: string }>["onAnswer"]>().toEqualTypeOf<((answer: { slot: string }) => void) | undefined>();
    const props: CustomWidgetProps<{ slots: string[] }, { slot: string }> = { input: { slots: ["10:00"] }, state: "pending", pending: false };
    expect(props.onAnswer).toBeUndefined();
  });
});
