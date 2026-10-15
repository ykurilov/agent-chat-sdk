// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFlow, type AgentFlow } from "../src/format";
import { useFlowEditor } from "../src/react/editor/use-flow-editor";
import { flowTestChatData } from "../src/runtime";
import { flowChat, newChat, OWNER, runOf, say } from "./runtime/flow-chat";
import { miniV1, miniV2 } from "./runtime/migrate-flows";

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-13T10:00:00Z") }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const parsed = (json: unknown): AgentFlow => {
  const result = parseFlow(json);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.flow;
};

/** Сквозной случай: окно перевода в редакторе → API службы сценария → чаты в хранилище. */
describe("T092 окно перевода чатов подключено к серверной части", () => {
  it("редактор показывает чаты старой версии; после перевода они идут по новой", async () => {
    const chat = flowChat({ flowJson: miniV1() });
    const ids = [(await newChat(chat.service)).id, (await newChat(chat.service)).id, (await newChat(chat.service)).id];
    for (const id of ids) await say(chat.service, id, "раз");
    await say(chat.service, ids[2]!, "два");
    await chat.flow.settled();

    const next = parsed(miniV2());
    const migration = {
      chatsByState: () => chat.flow.chatsByState("mini", { exceptVersionId: "v2" }),
      migrate: (map: Record<string, string>) => chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map, flow: next }),
    };
    const hook = renderHook(() => {
      const [value, setValue] = useState(next);
      return useFlowEditor({ value, onChange: setValue, catalog: { tools: [], events: [], widgets: [] }, migration });
    });

    act(() => hook.result.current.migrate!.open());
    await waitFor(() => expect(hook.result.current.migrate!.rows).toHaveLength(2));
    const rows = () => hook.result.current.migrate!.rows;
    expect(rows().map((row) => [row.stateId, row.chats, row.removed])).toEqual([
      ["parked", 1, true],
      ["work", 2, false],
    ]);
    expect(hook.result.current.migrate!.canMigrate).toBe(false);

    act(() => hook.result.current.migrate!.setTarget("parked", "waiting"));
    expect(hook.result.current.migrate!.canMigrate).toBe(true);
    await act(async () => hook.result.current.migrate!.run());

    expect(hook.result.current.migrate!.moved).toBe(3);
    expect(hook.result.current.migrate!.failed).toBe(false);
    expect(await chat.flow.chatsByState("mini")).toEqual([
      { versionId: "v2", stateId: "waiting", chats: 1 },
      { versionId: "v2", stateId: "work", chats: 2 },
    ]);

    act(() => hook.result.current.migrate!.open());
    await waitFor(() => expect(hook.result.current.migrate!.busy).toBe(false));
    expect(hook.result.current.migrate!.rows).toEqual([]);

    await say(chat.service, ids[2]!, "и что дальше?");
    expect((await runOf(chat.service, ids[2]!))?.path.map((entry) => entry.decidedBy)).toContain("migrate");
  });

  it("отказ сервера (нет цели) показывается как «не получилось», чаты не тронуты", async () => {
    const chat = flowChat({ flowJson: miniV1() });
    const { id } = await newChat(chat.service);
    await say(chat.service, id, "раз");
    await say(chat.service, id, "два");
    await chat.flow.settled();
    const next = parsed(miniV2());
    const migration = {
      chatsByState: () => chat.flow.chatsByState("mini", { exceptVersionId: "v2" }),
      migrate: (map: Record<string, string>) => chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map, flow: next }),
    };
    const hook = renderHook(() => {
      const [value, setValue] = useState(next);
      return useFlowEditor({ value, onChange: setValue, catalog: { tools: [], events: [], widgets: [] }, migration });
    });
    act(() => hook.result.current.migrate!.open());
    await waitFor(() => expect(hook.result.current.migrate!.rows).toHaveLength(1));
    // Цель выбрана несуществующая — сервер откажет, окно скажет «не получилось».
    act(() => hook.result.current.migrate!.setTarget("parked", "nowhere"));
    await act(async () => hook.result.current.migrate!.run());
    expect(hook.result.current.migrate!.failed).toBe(true);
    expect((await chat.store.getChat(id))?.versionId).toBe("v1");
  });

  it("счётчик окна — только идущие боевые чаты; после перевода окно перечитывает остаток", async () => {
    const chat = flowChat({ flowJson: miniV1() });
    const live = await newChat(chat.service);
    const ended = await newChat(chat.service);
    const test = await chat.service.createChat(OWNER, { data: flowTestChatData() });
    const locked = await newChat(chat.service);
    for (const { id } of [live, ended, test, locked]) await say(chat.service, id, "раз");
    await chat.flow.settled();
    await chat.flow.end({ ownerId: OWNER, chatId: ended.id, reason: "final" });

    const next = parsed(miniV2());
    // Чат `locked` в эту минуту держит другая копия: хранилище его пропускает, он остаётся на старой версии.
    const migrateBatch = chat.store.migrateBatch.bind(chat.store);
    vi.spyOn(chat.store, "migrateBatch").mockImplementation(async (input) => migrateBatch({ ...input, chatIds: input.chatIds?.filter((id) => id !== locked.id) }));
    const chatsByState = vi.fn(() => chat.flow.chatsByState("mini", { exceptVersionId: "v2" }));
    const migration = {
      chatsByState,
      migrate: (map: Record<string, string>) => chat.flow.migrateChats({ flowId: "mini", toVersionId: "v2", map, flow: next }),
    };
    const hook = renderHook(() => {
      const [value, setValue] = useState(next);
      return useFlowEditor({ value, onChange: setValue, catalog: { tools: [], events: [], widgets: [] }, migration });
    });

    act(() => hook.result.current.migrate!.open());
    await waitFor(() => expect(hook.result.current.migrate!.rows).toHaveLength(1));
    expect(hook.result.current.migrate!.rows[0]).toMatchObject({ stateId: "work", chats: 2 });
    await act(async () => hook.result.current.migrate!.run());

    expect(hook.result.current.migrate!.moved).toBe(1);
    await waitFor(() => expect(chatsByState).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current.migrate!.rows.map((row) => [row.stateId, row.chats])).toEqual([["work", 1]]));
    expect((await chat.store.getChat(ended.id))?.versionId).toBe("v1");
    expect((await chat.store.getChat(test.id))?.versionId).toBe("v1");
  });
});
