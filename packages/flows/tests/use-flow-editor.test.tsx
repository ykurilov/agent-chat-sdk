// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFlow, type AgentFlow } from "../src/format";
import { useFlowEditor, type FlowMigration, type UseFlowEditorOptions } from "../src/react/editor/use-flow-editor";
import salesReview from "./fixtures/sales-review.json";
import sheetsLesson from "./fixtures/sheets-lesson.json";
import shopSupport from "./fixtures/shop-support.json";

// В jsdom `import.meta.url` не путь к файлу — примеры берём импортом JSON, а не через `fixtureFlow`.
const fixtures = { "sales-review": salesReview, "shop-support": shopSupport, "sheets-lesson": sheetsLesson };

function fixtureFlow(name: keyof typeof fixtures): AgentFlow {
  const parsed = parseFlow(fixtures[name]);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.flow;
}

afterEach(cleanup);

const catalog = { tools: ["give_booking_link", "call_expert"], events: ["booking_link"], widgets: [] };

function useHarness(initial: AgentFlow, extra: Partial<UseFlowEditorOptions> = {}) {
  const [value, setValue] = useState(initial);
  const editor = useFlowEditor({ value, onChange: setValue, catalog, now: () => Date.UTC(2026, 9, 13, 9), timeZone: "UTC", ...extra });
  return { value, editor };
}

describe("useFlowEditor", () => {
  it("управляемое значение: правки идут через onChange, проверка графа пересчитывается", () => {
    const hook = renderHook(() => useHarness(fixtureFlow("sales-review")));
    expect(hook.result.current.editor.issueCount).toEqual({ errors: 0, warnings: 0 });
    let stateId = "";
    act(() => {
      stateId = hook.result.current.editor.addState({ x: 100, y: 200 });
    });
    expect(hook.result.current.value.states.at(-1)!.id).toBe(stateId);
    expect(hook.result.current.value.layout[stateId]).toEqual({ x: 100, y: 200 });
    expect(hook.result.current.editor.selection).toEqual({ kind: "state", stateId });
    expect(hook.result.current.editor.issues.map((issue) => issue.code)).toContain("unreachable_state");
  });

  it("стрелка, отпущенная на пустом месте, создаёт состояние и ведёт в него", () => {
    const hook = renderHook(() => useHarness(fixtureFlow("sales-review")));
    act(() => {
      hook.result.current.editor.connectToNewState("booked", null, { x: 1, y: 1 });
    });
    // У «Записался» нет условий: стрелка из узла без условия создаёт новое условие словами.
    const booked = hook.result.current.value.states.find((state) => state.id === "booked")!;
    const created = hook.result.current.value.states.at(-1)!;
    expect(booked.exits).toEqual([{ id: expect.any(String), when: { type: "judge", text: "" }, to: created.id }]);

    act(() => {
      hook.result.current.editor.connectToNewState("intro", "intro_clear", { x: 2, y: 2 });
    });
    const intro = hook.result.current.value.states.find((state) => state.id === "intro")!;
    expect(intro.exits[0]!.to).toBe(hook.result.current.value.states.at(-1)!.id);
  });

  it("проверка графа: переход к месту ошибки открывает состояние", () => {
    const hook = renderHook(() => useHarness(fixtureFlow("sheets-lesson")));
    act(() => hook.result.current.editor.setMode("check"));
    const orphan = hook.result.current.editor.issues.find((issue) => issue.code === "unreachable_state")!;
    act(() => hook.result.current.editor.goToIssue(orphan));
    expect(hook.result.current.editor.mode).toBe("edit");
    expect(hook.result.current.editor.selection).toEqual({ kind: "state", stateId: "orphan" });
  });

  it("прогон: старт, выбор, «ничего», шаг назад, сначала; без старта — проверка", () => {
    const hook = renderHook(() => useHarness(fixtureFlow("sales-review")));
    act(() => hook.result.current.editor.setMode("run"));
    const run = () => hook.result.current.editor.simulation!;
    expect(run().run.state).toBe("intro");
    act(() => hook.result.current.editor.simulate.choose("intro_clear"));
    expect(run().run.state).toBe("block");
    act(() => hook.result.current.editor.simulate.nothing());
    expect(run().steps.at(-1)!.nothing).toBe(true);
    act(() => hook.result.current.editor.simulate.back());
    act(() => hook.result.current.editor.simulate.back());
    expect(run().run.state).toBe("intro");
    act(() => hook.result.current.editor.simulate.choose("intro_clear"));
    act(() => hook.result.current.editor.simulate.restart());
    expect(run().steps).toHaveLength(1);
    act(() => hook.result.current.editor.setMode("edit"));
    expect(hook.result.current.editor.simulation).toBeNull();

    const noStart = renderHook(() => useHarness({ ...fixtureFlow("sales-review"), start: null }));
    act(() => noStart.result.current.editor.setMode("run"));
    expect(noStart.result.current.editor.mode).toBe("check");
  });

  it("JSON: показ годится для parseFlow, загрузка битого — ошибки, годного — новое значение", () => {
    const hook = renderHook(() => useHarness(fixtureFlow("shop-support")));
    act(() => hook.result.current.editor.openJson());
    expect(hook.result.current.editor.dialog).toBe("json");
    expect(parseFlow(JSON.parse(hook.result.current.editor.json)).ok).toBe(true);
    act(() => {
      hook.result.current.editor.loadJson("{}");
    });
    expect(hook.result.current.editor.jsonErrors.length).toBeGreaterThan(0);
    const lesson = JSON.stringify(fixtureFlow("sheets-lesson"));
    act(() => {
      hook.result.current.editor.loadJson(lesson);
    });
    expect(hook.result.current.value.id).toBe(fixtureFlow("sheets-lesson").id);
    expect(hook.result.current.editor.jsonErrors).toEqual([]);
    expect(hook.result.current.editor.dialog).toBeNull();
  });

  it("сохранение: есть правки → сохранить → правок нет", async () => {
    const onSave = vi.fn(async () => {});
    const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { onSave }));
    expect(hook.result.current.editor.dirty).toBe(false);
    act(() => hook.result.current.editor.edit((flow) => ({ ...flow, name: "Другое" })));
    expect(hook.result.current.editor.dirty).toBe(true);
    await act(async () => hook.result.current.editor.save());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Другое" }));
    expect(hook.result.current.editor.dirty).toBe(false);
  });

  it("перевод чатов: удалённым состояниям нужна цель, перевод отдаёт карту приложению", async () => {
    const migration: FlowMigration = {
      chatsByState: vi.fn(async () => [
        { versionId: "v1", stateId: "intro", chats: 2 },
        { versionId: "v1", stateId: "old_state", chats: 1 },
      ]),
      migrate: vi.fn(async () => ({ moved: 3 })),
    };
    const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { migration }));
    act(() => hook.result.current.editor.migrate!.open());
    await waitFor(() => expect(hook.result.current.editor.migrate!.rows).toHaveLength(2));
    const rows = () => hook.result.current.editor.migrate!.rows;
    expect(rows().map((row) => row.removed)).toEqual([false, true]);
    expect(hook.result.current.editor.migrate!.canMigrate).toBe(false);
    act(() => hook.result.current.editor.migrate!.setTarget("old_state", "offer"));
    expect(hook.result.current.editor.migrate!.canMigrate).toBe(true);
    await act(async () => hook.result.current.editor.migrate!.run());
    expect(migration.migrate).toHaveBeenCalledWith({ old_state: "offer" });
    expect(hook.result.current.editor.migrate!.moved).toBe(3);
  });

  describe("только просмотр", () => {
    it("правки, связи, удаление, загрузка JSON и сохранение ничего не меняют; просмотр и прогон работают", async () => {
      const onSave = vi.fn(async () => {});
      const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { readOnly: true, onSave }));
      const before = hook.result.current.value;
      const { editor } = hook.result.current;
      expect(editor.readOnly).toBe(true);
      act(() => {
        editor.edit((flow) => ({ ...flow, name: "Другое" }));
        editor.addState({ x: 1, y: 1 });
        editor.connect("intro", "intro_clear", "booked");
        editor.connectToNewState("booked", null, { x: 1, y: 1 });
        editor.removeState("block");
      });
      expect(hook.result.current.value).toBe(before);
      let loaded = true;
      act(() => {
        loaded = hook.result.current.editor.loadJson(JSON.stringify({ ...before, name: "Чужое" }));
      });
      expect(loaded).toBe(false);
      expect(hook.result.current.value).toBe(before);
      await act(async () => hook.result.current.editor.save());
      expect(onSave).not.toHaveBeenCalled();

      act(() => hook.result.current.editor.select({ kind: "state", stateId: "block" }));
      expect(hook.result.current.editor.selection).toEqual({ kind: "state", stateId: "block" });
      act(() => hook.result.current.editor.setMode("check"));
      expect(hook.result.current.editor.mode).toBe("check");
      act(() => hook.result.current.editor.openJson());
      expect(hook.result.current.editor.dialog).toBe("json");
      act(() => hook.result.current.editor.setMode("run"));
      act(() => hook.result.current.editor.simulate.choose("intro_clear"));
      expect(hook.result.current.editor.simulation!.run.state).toBe("block");
    });

    it("без readOnly всё как раньше", () => {
      const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { readOnly: false }));
      act(() => hook.result.current.editor.edit((flow) => ({ ...flow, name: "Другое" })));
      expect(hook.result.current.value.name).toBe("Другое");
    });
  });

  describe("отказ в сохранении", () => {
    const renameThenSave = async (hook: ReturnType<typeof renderHook<ReturnType<typeof useHarness>, unknown>>) => {
      act(() => hook.result.current.editor.edit((flow) => ({ ...flow, name: "Другое" })));
      await act(async () => hook.result.current.editor.save());
    };

    it("undefined, void и { ok: true } — успех: «Сохранено»", async () => {
      for (const result of [undefined, { ok: true as const }]) {
        const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { onSave: async () => result }));
        await renameThenSave(hook);
        expect(hook.result.current.editor.dirty).toBe(false);
        expect(hook.result.current.editor.saveFailed).toBe(false);
      }
    });

    it("{ ok: false, issues }: остаётся «несохранено», отказ виден, находки стоят у нод как в проверке графа", async () => {
      const onSave = vi.fn(async () => ({ ok: false as const, issues: [{ path: "states[intro].exits[0]", message: "Приложение: нельзя." }] }));
      const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { onSave }));
      await renameThenSave(hook);
      const { editor } = hook.result.current;
      expect(editor.dirty).toBe(true);
      expect(editor.saveFailed).toBe(true);
      expect(editor.saving).toBe(false);
      const found = editor.issues.find((issue) => issue.message === "Приложение: нельзя.")!;
      expect(found).toMatchObject({ level: "error", place: { stateId: "intro", exitId: "intro_clear" } });
      expect(editor.issueCount.errors).toBe(1);
      act(() => editor.goToIssue(found));
      expect(hook.result.current.editor.selection).toEqual({ kind: "state", stateId: "intro", exitId: "intro_clear" });

      // Любая правка снимает отказ: находка устарела.
      act(() => hook.result.current.editor.edit((flow) => ({ ...flow, name: "Третье" })));
      expect(hook.result.current.editor.saveFailed).toBe(false);
      expect(hook.result.current.editor.issueCount.errors).toBe(0);
    });

    it("{ ok: false } без issues: только отказ в шапке", async () => {
      const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { onSave: async () => ({ ok: false as const }) }));
      await renameThenSave(hook);
      expect(hook.result.current.editor.saveFailed).toBe(true);
      expect(hook.result.current.editor.issues).toHaveLength(0);
    });

    it("исключение из onSave — тоже отказ, без необработанной ошибки", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const hook = renderHook(() =>
        useHarness(fixtureFlow("sales-review"), {
          onSave: async () => {
            throw new Error("Сервер недоступен");
          },
        }),
      );
      await renameThenSave(hook);
      expect(hook.result.current.editor.saveFailed).toBe(true);
      expect(hook.result.current.editor.dirty).toBe(true);
      expect(hook.result.current.editor.saving).toBe(false);
      expect(error).not.toHaveBeenCalled();
      warn.mockRestore();
      error.mockRestore();
    });

    it("повторное сохранение после отказа проходит", async () => {
      const results = [{ ok: false as const }, { ok: true as const }];
      const hook = renderHook(() => useHarness(fixtureFlow("sales-review"), { onSave: async () => results.shift() }));
      await renameThenSave(hook);
      await act(async () => hook.result.current.editor.save());
      expect(hook.result.current.editor.saveFailed).toBe(false);
      expect(hook.result.current.editor.dirty).toBe(false);
    });
  });
});
