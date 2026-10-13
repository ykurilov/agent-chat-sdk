// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanelProvider } from "../../src/agent-panel/agent-panel-provider";
import { useAgentDataChanges, useAgentPlace } from "../../src/agent-panel/agent-panel-hooks";
import { useAppBridgeControl } from "../../src/agent-panel/panel-context";
import { APP_CHANGES_DELIVERED_KEY, createAppBridge } from "../../src/app-bridge/create-app-bridge";
import type { AppBridgeOptions } from "../../src/app-bridge/create-app-bridge";
import type { AgentAppBridge, AppDataChange, ScreenPlace } from "../../src/app-bridge/app-bridge";
import { readTabId, TAB_ID_KEY } from "../../src/app-bridge/tab-id";
import { fakeChatListServer } from "../support/fake-chat-list-server";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const unavailable = "Tool unavailable";
const bridgeWith = (options: Partial<AppBridgeOptions> = {}) => createAppBridge(() => ({ toolUnavailableMessage: unavailable, ...options }));
const change = (id: string, tag: string, details?: unknown): AppDataChange => ({ id, tag, ...(details !== undefined && { details }) });

describe("номер вкладки", () => {
  it("создаётся один раз и живёт в sessionStorage под agent-chat:tab-id", () => {
    expect(TAB_ID_KEY).toBe("agent-chat:tab-id");
    const first = readTabId();
    expect(first).toMatch(/\S{8,}/);
    expect(sessionStorage.getItem("agent-chat:tab-id")).toBe(first);
    expect(readTabId()).toBe(first);
    expect(bridgeWith().bridge.tabId).toBe(first);
  });

  it("уже записанный номер берётся как есть (перезагрузка вкладки)", () => {
    sessionStorage.setItem("agent-chat:tab-id", "tab-from-before");
    expect(bridgeWith().bridge.tabId).toBe("tab-from-before");
  });

  it("хранилище недоступно — номер всё равно есть и один на страницу", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const first = readTabId();
    expect(first).toMatch(/\S{8,}/);
    expect(readTabId()).toBe(first);
  });
});

describe("номер вкладки: «Дублировать вкладку»", () => {
  // Каждый тест — новая страница: модуль номера вкладки загружается заново.
  const freshPage = async () => {
    vi.resetModules();
    return import("../../src/app-bridge/tab-id");
  };

  it("копия sessionStorage с номером открытой вкладки — у дубликата новый номер, записан вместо скопированного", async () => {
    const original = await freshPage();
    const originalId = original.readTabId();
    // Дубликат: sessionStorage скопирован, исходная вкладка жива.
    const duplicate = await freshPage();
    const duplicateId = duplicate.readTabId();
    expect(duplicateId).not.toBe(originalId);
    expect(duplicateId).toMatch(/\S{8,}/);
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBe(duplicateId);
    expect(duplicate.readTabId()).toBe(duplicateId);
  });

  it("перезагрузка: страница ушла (pagehide) — новая страница той же вкладки берёт прежний номер", async () => {
    const before = await freshPage();
    const id = before.readTabId();
    window.dispatchEvent(new Event("pagehide"));
    const afterReload = await freshPage();
    expect(afterReload.readTabId()).toBe(id);
  });

  it("страницу вернули из кэша «Назад» (pageshow) — она снова считается открытой", async () => {
    const page = await freshPage();
    const id = page.readTabId();
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pageshow"));
    const duplicate = await freshPage();
    expect(duplicate.readTabId()).not.toBe(id);
  });
});

describe("createAppBridge: место на экране", () => {
  const card = (id: number): ScreenPlace => ({ description: `card ${id}`, data: { id } });

  it("места нет, пока его никто не задал", () => {
    expect(bridgeWith().bridge.currentPlace()).toBeNull();
  });

  it("главнее владелец, созданный позже, даже если задал место раньше; обновление прежнего не перебивает позднего", () => {
    const control = bridgeWith();
    const list = control.createPlaceOwner();
    const modal = control.createPlaceOwner();
    control.setPlace(modal, card(2));
    control.setPlace(list, card(1));
    expect(control.bridge.currentPlace()).toEqual(card(2));
    control.removePlace(modal);
    control.setPlace(list, card(1));
    expect(control.bridge.currentPlace()).toEqual(card(1));
    control.setPlace(modal, card(2));
    expect(control.bridge.currentPlace()).toEqual(card(2));
    control.setPlace(list, card(3));
    expect(control.bridge.currentPlace()).toEqual(card(2));
  });

  it("снятие убирает только своё место: ушёл поздний — снова место раннего; чужое снятие ничего не трогает", () => {
    const control = bridgeWith();
    const list = control.createPlaceOwner();
    const modal = control.createPlaceOwner();
    control.setPlace(list, card(1));
    control.setPlace(modal, card(2));
    control.removePlace(modal);
    expect(control.bridge.currentPlace()).toEqual(card(1));
    control.removePlace(modal);
    control.removePlace(control.createPlaceOwner());
    expect(control.bridge.currentPlace()).toEqual(card(1));
    control.setPlace(list, null);
    expect(control.bridge.currentPlace()).toBeNull();
  });
});

describe("createAppBridge: сообщения об изменении данных", () => {
  it("подписчик метки зовётся один раз на сообщение; повтор id не раздаётся; чужая метка — мимо", () => {
    const control = bridgeWith();
    const tasks = vi.fn();
    const clients = vi.fn();
    control.subscribe(["tasks"], tasks);
    control.subscribe(["clients"], clients);
    control.bridge.dataChanged(change("m1", "tasks", { taskId: 7 }));
    control.bridge.dataChanged(change("m1", "tasks", { taskId: 7 }));
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(tasks).toHaveBeenCalledWith({ id: "m1", tag: "tasks", details: { taskId: 7 } });
    expect(clients).not.toHaveBeenCalled();
    control.bridge.dataChanged(change("m2", "tasks"));
    expect(tasks).toHaveBeenCalledTimes(2);
  });

  it("перезагрузка страницы во время ответа: поток отдаёт ход с начала, но доставленное не раздаётся второй раз", () => {
    const before = vi.fn();
    bridgeWith({ onDataChanged: before }).bridge.dataChanged(change("m1", "tasks"));
    expect(sessionStorage.getItem(APP_CHANGES_DELIVERED_KEY)).toContain("m1");
    const afterReload = vi.fn();
    const control = bridgeWith({ onDataChanged: afterReload });
    control.bridge.dataChanged(change("m1", "tasks"));
    control.bridge.dataChanged(change("m2", "tasks"));
    expect(before).toHaveBeenCalledTimes(1);
    expect(afterReload.mock.calls.map(([incoming]) => incoming.id)).toEqual(["m2"]);
  });

  it("вкладка помнит не больше 500 последних id", () => {
    const control = bridgeWith();
    for (let index = 0; index < 501; index += 1) control.bridge.dataChanged(change(`m${index}`, "tasks"));
    const stored = JSON.parse(sessionStorage.getItem(APP_CHANGES_DELIVERED_KEY)!) as string[];
    expect(stored).toHaveLength(500);
    expect(stored).not.toContain("m0");
  });

  it("хранилище недоступно — повтор id в той же странице всё равно не раздаётся", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const handler = vi.fn();
    const control = bridgeWith({ onDataChanged: handler });
    control.bridge.dataChanged(change("private-1", "tasks"));
    control.bridge.dataChanged(change("private-1", "tasks"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("подписка на список меток; отписка; onDataChanged получает все сообщения", () => {
    const all = vi.fn();
    const control = bridgeWith({ onDataChanged: all });
    const handler = vi.fn();
    const unsubscribe = control.subscribe(["tasks", "clients"], handler);
    control.bridge.dataChanged(change("m1", "clients"));
    control.bridge.dataChanged(change("m2", "orders"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(2);
    unsubscribe();
    control.bridge.dataChanged(change("m3", "tasks"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("сломанный подписчик не мешает остальным", () => {
    const reportError = vi.fn();
    vi.stubGlobal("reportError", reportError);
    const control = bridgeWith();
    const failing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    control.subscribe(["tasks"], failing);
    control.subscribe(["tasks"], healthy);
    expect(() => control.bridge.dataChanged(change("m1", "tasks"))).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });
});

describe("createAppBridge: браузерный вызов", () => {
  it("зовёт функцию приложения с входом и сигналом и отдаёт результат", async () => {
    const openTask = vi.fn(async (input: { taskId: number }, context: { signal: AbortSignal }) => ({ opened: input.taskId, aborted: context.signal.aborted }));
    const control = bridgeWith({ browserTools: { open_task: openTask } });
    const controller = new AbortController();
    const result = await control.bridge.browserCall({ toolCallId: "call-1", toolName: "open_task", input: { taskId: 2 } }, { signal: controller.signal });
    expect(result).toEqual({ output: { opened: 2, aborted: false } });
    expect(openTask.mock.calls[0]![1].signal).toBe(controller.signal);
  });

  it("функция бросила ошибку — её текст; функции нет — ошибка «недоступен»", async () => {
    const control = bridgeWith({
      browserTools: {
        fail: () => {
          throw new Error("Task not found");
        },
      },
    });
    expect(await control.bridge.browserCall({ toolCallId: "c1", toolName: "fail", input: {} })).toEqual({ error: "Task not found" });
    expect(await control.bridge.browserCall({ toolCallId: "c2", toolName: "missing", input: {} })).toEqual({ error: unavailable });
  });

  it("набор функций читается в момент вызова: новые свойства провайдера видны без нового моста", async () => {
    let tools: AppBridgeOptions["browserTools"] = {};
    const control = createAppBridge(() => ({ toolUnavailableMessage: unavailable, browserTools: tools }));
    tools = { ping: () => "pong" };
    expect(await control.bridge.browserCall({ toolCallId: "c1", toolName: "ping", input: null })).toEqual({ output: "pong" });
  });
});

describe("useAgentPlace и useAgentDataChanges в AgentPanelProvider", () => {
  beforeEach(() => vi.stubGlobal("fetch", fakeChatListServer([{ id: "c1", title: "Первый" }]).fetch));
  let bridge: AgentAppBridge | undefined;
  function BridgeProbe() {
    bridge = useAppBridgeControl().bridge;
    return null;
  }
  const wrap = (children: ReactNode, props: { onDataChanged?: (change: AppDataChange) => void } = {}) => (
    <AgentPanelProvider api="/api/chat" userKey="ivan" {...props}>
      <BridgeProbe />
      {children}
    </AgentPanelProvider>
  );

  function Place({ place }: { place: ScreenPlace | null }) {
    useAgentPlace(place);
    return null;
  }

  it("место, пока компонент на экране; появившийся позже главнее; размонтирование — снова прежнее", () => {
    const list: ScreenPlace = { description: "Task list" };
    const card: ScreenPlace = { description: "Task card 2", data: { taskId: 2 } };
    const view = render(wrap(<Place place={list} />));
    expect(bridge!.currentPlace()).toEqual(list);
    view.rerender(
      wrap(
        <>
          <Place place={list} />
          <Place place={card} />
        </>,
      ),
    );
    expect(bridge!.currentPlace()).toEqual(card);
    view.rerender(wrap(<Place place={list} />));
    expect(bridge!.currentPlace()).toEqual(list);
    view.rerender(wrap(null));
    expect(bridge!.currentPlace()).toBeNull();
  });

  it("новое место того же компонента видно сразу; null снимает его", () => {
    const view = render(wrap(<Place place={{ description: "Task card 1" }} />));
    view.rerender(wrap(<Place place={{ description: "Task card 2" }} />));
    expect(bridge!.currentPlace()).toEqual({ description: "Task card 2" });
    view.rerender(wrap(<Place place={null} />));
    expect(bridge!.currentPlace()).toBeNull();
  });

  it("data не превращается в JSON (цикл, BigInt) — страница рисуется, место задано", () => {
    const cyclic: Record<string, unknown> = { taskId: 1 };
    cyclic.self = cyclic;
    const view = render(wrap(<Place place={{ description: "Task card 1", data: cyclic }} />));
    expect(bridge!.currentPlace()).toEqual({ description: "Task card 1", data: cyclic });
    view.rerender(wrap(<Place place={{ description: "Task card 2", data: { big: 10n } }} />));
    expect(bridge!.currentPlace()?.description).toBe("Task card 2");
    view.rerender(wrap(<Place place={{ description: "Task card 3", data: { big: 10n } }} />));
    expect(bridge!.currentPlace()?.description).toBe("Task card 3");
  });

  describe("вложенные места: ближайший к странице главнее", () => {
    const section: ScreenPlace = { description: "Раздел задач" };
    const card = (id: string, title = `Задача ${id}`): ScreenPlace => ({ description: `Карточка «${title}»`, data: { taskId: id } });
    function TaskCard({ id, title }: { id: string; title?: string }) {
      useAgentPlace(card(id, title));
      return null;
    }
    function TasksLayout({ taskId, title, layoutPlace = section }: { taskId: string | null; title?: string; layoutPlace?: ScreenPlace | null }) {
      useAgentPlace(layoutPlace);
      return taskId === null ? null : <TaskCard key={taskId} id={taskId} {...(title !== undefined && { title })} />;
    }

    it("при первом показе и после переходов действует место страницы, а не макета", () => {
      const view = render(wrap(<TasksLayout taskId="1" />));
      expect(bridge!.currentPlace()).toEqual(card("1"));
      view.rerender(wrap(<TasksLayout taskId="2" />));
      expect(bridge!.currentPlace()).toEqual(card("2"));
      view.rerender(wrap(<TasksLayout taskId={null} />));
      expect(bridge!.currentPlace()).toEqual(section);
      view.rerender(wrap(<TasksLayout taskId="1" />));
      expect(bridge!.currentPlace()).toEqual(card("1"));
    });

    it("смена места у страницы или у макета не меняет, кто главнее", () => {
      const view = render(wrap(<TasksLayout taskId="1" />));
      view.rerender(wrap(<TasksLayout taskId="1" title="Переименована" />));
      expect(bridge!.currentPlace()).toEqual(card("1", "Переименована"));
      view.rerender(wrap(<TasksLayout taskId="1" title="Переименована" layoutPlace={{ description: "Раздел задач, фильтр «мои»" }} />));
      expect(bridge!.currentPlace()).toEqual(card("1", "Переименована"));
    });

    it("макет задал место позже страницы (сначала null) — страница всё равно главнее", () => {
      const view = render(wrap(<TasksLayout taskId="1" layoutPlace={null} />));
      view.rerender(wrap(<TasksLayout taskId="1" layoutPlace={section} />));
      expect(bridge!.currentPlace()).toEqual(card("1"));
    });
  });

  it("подписчик по метке зовётся один раз, видит свежий обработчик, после размонтирования не зовётся", () => {
    const seen: string[] = [];
    const all = vi.fn();
    function TaskList() {
      const [version, setVersion] = useState(0);
      useAgentDataChanges("tasks", (incoming) => {
        seen.push(`${incoming.id}@${version}`);
        setVersion((value) => value + 1);
      });
      return null;
    }
    const view = render(wrap(<TaskList />, { onDataChanged: all }));
    act(() => bridge!.dataChanged(change("m1", "tasks")));
    act(() => bridge!.dataChanged(change("m1", "tasks")));
    act(() => bridge!.dataChanged(change("m2", "tasks")));
    expect(seen).toEqual(["m1@0", "m2@1"]);
    expect(all).toHaveBeenCalledTimes(2);
    view.rerender(wrap(null, { onDataChanged: all }));
    act(() => bridge!.dataChanged(change("m3", "tasks")));
    expect(seen).toHaveLength(2);
    expect(all).toHaveBeenCalledTimes(3);
  });

  it("подписка на список меток", () => {
    const handler = vi.fn();
    function Watcher() {
      useAgentDataChanges(["tasks", "clients"], handler);
      return null;
    }
    render(wrap(<Watcher />));
    act(() => bridge!.dataChanged(change("m1", "clients")));
    act(() => bridge!.dataChanged(change("m2", "orders")));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
