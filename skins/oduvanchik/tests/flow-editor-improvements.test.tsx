// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFlow, type AgentFlow } from "@ykurilov/agent-chat-flows/format";
import { FlowEditor, FlowLabelsProvider, russianFlowLabels, type FlowStatePanelProps } from "@ykurilov/agent-chat-flows/react";
import { tandemFlowEditorSkin } from "@ykurilov/agent-chat-skin-tandem/flows";
import { oduvanchikFlowEditorSkin } from "../src/flows";
import fixture from "../../../packages/flows/tests/fixtures/sales-review.json";

const parsed = parseFlow(fixture);
if (!parsed.ok) throw new Error("invalid fixture");
const initial = parsed.flow;
const catalog = { tools: [...initial.tools], events: [], widgets: [] };
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
globalThis.DOMMatrixReadOnly ??= class { m22 = 1; } as unknown as typeof DOMMatrixReadOnly;
afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

for (const [name, skin] of [["tandem", tandemFlowEditorSkin], ["oduvanchik", oduvanchikFlowEditorSkin]] as const) {
  describe(`${name}: state editing`, () => {
    it("restores condition text across kind switches and inspector remounts", () => {
      function Harness() {
        const [value, onChange] = useState<AgentFlow>(structuredClone(initial));
        return <FlowEditor skin={skin} value={value} onChange={onChange} catalog={catalog} />;
      }
      const { container } = render(<Harness />);
      fireEvent.click(container.querySelector('.react-flow__node[data-id="intro"] [role="button"]')!);
      const card = () => within(container.querySelector('[data-exit-card="intro_clear"]') as HTMLElement);
      fireEvent.change(card().getByRole("textbox"), { target: { value: "Сохранённое условие" } });
      fireEvent.click(card().getByRole("radio", { name: /Данные/ }));
      fireEvent.click(container.querySelector('.react-flow__node[data-id="block"] [role="button"]')!);
      fireEvent.click(container.querySelector('.react-flow__node[data-id="intro"] [role="button"]')!);
      fireEvent.click(card().getByRole("radio", { name: /Словами/ }));
      expect((card().getByRole("textbox") as HTMLTextAreaElement).value).toBe("Сохранённое условие");
      fireEvent.change(card().getByRole("textbox"), { target: { value: "Обновлённое условие" } });
      fireEvent.click(card().getByRole("radio", { name: /Событие/ }));
      fireEvent.click(card().getByRole("radio", { name: /Словами/ }));
      expect((card().getByRole("textbox") as HTMLTextAreaElement).value).toBe("Обновлённое условие");
    });

    it("starts learn choices collapsed with the selected/total summary", () => {
      const state = initial.states[0]!;
      function Panel() {
        const [learn, setLearn] = useState(state.learn);
        const props: FlowStatePanelProps = { stateId: state.id, title: state.title, instructions: state.instructions, firstMessage: state.firstMessage, learn, tools: [], tags: [], start: true, noSideQuestions: false, fields: [...initial.clientCard, ...initial.chatNotes], catalogTools: [], exits: null, issues: [], onChange: (patch) => { if (patch.learn) setLearn(patch.learn); }, onMakeStart: vi.fn(), onAddExit: vi.fn(), onDelete: vi.fn() };
        return <skin.FlowStatePanel {...props} />;
      }
      render(<Panel />);
      const summary = screen.getByText("Узнать о человеке: 2 из 9").closest("summary")!;
      const detail = summary.closest("details")!;
      expect(detail.open).toBe(false);
      // The native details element controls visibility in the browser; jsdom does not hide its children.
      fireEvent.click(summary);
      expect(detail.open).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Имя", exact: true }));
      expect(screen.getByText("Узнать о человеке: 3 из 9")).toBeTruthy();
    });

    it("uses app tool labels and configurable tags/side-question hints", () => {
      const custom = { ...russianFlowLabels, editor: { ...russianFlowLabels.editor, statePanel: { ...russianFlowLabels.editor.statePanel, tagsHint: "Подсказка меток приложения", noSideQuestionsHint: "Подсказка вопросов приложения" } } };
      const changed = vi.fn<(flow: AgentFlow) => void>();
      function Harness() {
        const [value, setValue] = useState<AgentFlow>(() => ({ ...structuredClone(initial), tools: [...initial.tools, "sale_answer", "person_link_view", "finish_dialog"], states: initial.states.map(state => state.id === "intro" ? { ...state, tools: ["sale_answer"] } : state) }));
        return <FlowLabelsProvider labels={custom}><FlowEditor skin={skin} value={value} onChange={flow => { changed(flow); setValue(flow); }} catalog={{ ...catalog, tools: [...catalog.tools, "sale_answer", "person_link_view", "finish_dialog"], toolLabels: { sale_answer: "Инструмент ответа", person_link_view: "Инструмент ссылки", finish_dialog: "Инструмент завершения" } }} /></FlowLabelsProvider>;
      }
      const { container } = render(<Harness />);
      fireEvent.click(container.querySelector('.react-flow__node[data-id="intro"] [role="button"]')!);
      fireEvent.click(screen.getByText("Дополнительно"));
      expect(screen.getByRole("button", { name: "Инструмент ответа", exact: true }).getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(screen.getByRole("button", { name: "Инструмент ссылки", exact: true }));
      expect(changed.mock.calls.at(-1)?.[0].states[0]!.tools).toEqual(["sale_answer", "person_link_view"]);
      expect(screen.queryByText("sale_answer")).toBeNull();
      expect(screen.getByText("Подсказка меток приложения")).toBeTruthy();
      expect(screen.getByText("Подсказка вопросов приложения")).toBeTruthy();
    });
  });
}
