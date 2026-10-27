// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../../src/agent-panel/agent-panel";
import type { AgentPanelProps } from "../../src/agent-panel/agent-panel";
import { AgentPanelProvider } from "../../src/agent-panel/agent-panel-provider";
import type { AgentPanelProviderProps } from "../../src/agent-panel/agent-panel-provider";
import { useAgentDataChanges, useAgentPanel, useAgentPlace } from "../../src/agent-panel/agent-panel-hooks";
import type { AgentPanelControls } from "../../src/agent-panel/agent-panel-hooks";
import { panelChatKey, panelOpenKey } from "../../src/agent-panel/panel-state";
import type { AgentAppBridge } from "../../src/app-bridge/app-bridge";
import { fakeChatListServer } from "../support/fake-chat-list-server";
import { setupChatDom, settle, submitQuestion } from "../support/chat-dom";
import { stubPanelSkin } from "../support/stub-agent-panel-skin";

setupChatDom();
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => localStorage.clear());

type Server = ReturnType<typeof fakeChatListServer>;
interface RenderOptions {
  provider?: Partial<AgentPanelProviderProps>;
  panel?: Partial<AgentPanelProps>;
}

let controls: AgentPanelControls | undefined;
function ControlsProbe() {
  controls = useAgentPanel();
  return null;
}

function page({ provider = {}, panel = {} }: RenderOptions = {}) {
  return (
    <AgentPanelProvider api="/api/chat" userKey="ivan" {...provider}>
      <button type="button">Page button</button>
      <ControlsProbe />
      <AgentPanel skin={stubPanelSkin} {...panel} />
    </AgentPanelProvider>
  );
}

function renderPanel(server: Server, options: RenderOptions = {}) {
  vi.stubGlobal("fetch", server.fetch);
  const view = render(page(options));
  return { ...view, rerenderWith: (next: RenderOptions) => view.rerender(page(next)) };
}

const launcher = () => screen.getByTestId("launcher");
const panelFrame = () => screen.getByTestId("panel");
const isOpen = () => launcher().getAttribute("aria-expanded") === "true" && !panelFrame().hidden;
const field = () => screen.getByLabelText("поле") as HTMLTextAreaElement;
const row = (id: string) => document.querySelector(`[data-chat-id="${id}"]`) as HTMLElement;
const rows = () => [...document.querySelectorAll("[data-chat-id]")].map((item) => item.getAttribute("data-chat-id"));
const historyRequested = (server: Server, id: string) => server.requests.some((request) => request.method === "GET" && request.path === `/api/chat/${id}`);
const twoChats = () =>
  fakeChatListServer([
    { id: "c2", title: "Второй" },
    { id: "c1", title: "Первый" },
  ]);

async function openPanel() {
  await screen.findByLabelText("поле");
  fireEvent.click(launcher());
  await waitFor(() => expect(isOpen()).toBe(true));
}

async function openList() {
  fireEvent.click(screen.getByTestId("panel-list-toggle"));
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

describe("AgentPanel: кнопка, закрытие, фокус (T008)", () => {
  it("по умолчанию закрыта, а открытый чат уже смонтирован и загружен", async () => {
    const server = twoChats();
    renderPanel(server);
    expect(launcher().getAttribute("aria-expanded")).toBe("false");
    expect(panelFrame().hidden).toBe(true);
    await screen.findByLabelText("поле");
    await waitFor(() => expect(historyRequested(server, "c2")).toBe(true));
  });

  it("кнопка открывает (фокус в поле) и закрывает (фокус на кнопке); чат при этом не перемонтируется", async () => {
    const server = twoChats();
    renderPanel(server);
    const before = await screen.findByLabelText("поле");
    fireEvent.click(launcher());
    expect(isOpen()).toBe(true);
    expect(document.activeElement).toBe(field());
    fireEvent.click(launcher());
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(launcher());
    expect(field()).toBe(before);
    expect(server.requests.filter((request) => request.method === "GET" && request.path === "/api/chat/c2")).toHaveLength(1);
  });

  it("«Закрыть» закрывает панель и возвращает фокус на кнопку агента", async () => {
    renderPanel(twoChats());
    await openPanel();
    fireEvent.click(screen.getByTestId("panel-close"));
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(launcher());
  });

  it("Esc внутри панели закрывает; при открытом подтверждении удаления — нет", async () => {
    renderPanel(twoChats());
    await openPanel();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(launcher());

    fireEvent.click(launcher());
    await openList();
    fireEvent.click(within(row("c1")).getByText("Удалить"));
    const dialog = screen.getByTestId("delete-dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(isOpen()).toBe(true);
  });

  it("Esc при открытом списке сначала закрывает список (назад к чату), второй Esc — панель", async () => {
    renderPanel(twoChats());
    await openPanel();
    await openList();
    fireEvent.keyDown(row("c1"), { key: "Escape" });
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(isOpen()).toBe(false);
  });

  it("закрытие из кода приложения не уводит фокус с элемента страницы", async () => {
    renderPanel(twoChats());
    await openPanel();
    const pageButton = screen.getByText("Page button");
    pageButton.focus();
    act(() => controls!.setOpen(false));
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(pageButton);
  });

  it("режим и ширина: по умолчанию overlay и 420, свои доходят до скина", async () => {
    const server = twoChats();
    const view = renderPanel(server);
    expect(panelFrame().getAttribute("data-mode")).toBe("overlay");
    expect(panelFrame().getAttribute("data-width")).toBe("420");
    view.rerenderWith({ provider: { mode: "push", width: 360 } });
    expect(panelFrame().getAttribute("data-mode")).toBe("push");
    expect(panelFrame().getAttribute("data-width")).toBe("360");
    await settle();
  });

  it("в шапке — название открытого чата, у чата без названия — «Новый чат»", async () => {
    renderPanel(fakeChatListServer([{ id: "c1", title: "Про Грецию" }]));
    await waitFor(() => expect(screen.getByTestId("panel-title").textContent).toBe("Про Грецию"));
    cleanupAndRender(fakeChatListServer([{ id: "empty", title: null }]));
    await waitFor(() => expect(screen.getByTestId("panel-title").textContent).toBe("Новый чат"));
  });

  it("надписи кнопки и панели — из словаря", async () => {
    renderPanel(twoChats());
    expect(launcher().textContent).toBe("Агент");
    expect(screen.getByRole("complementary", { hidden: true }).getAttribute("aria-label")).toBe("Панель агента");
    await settle();
  });
});

function cleanupAndRender(server: Server, options: RenderOptions = {}) {
  cleanup();
  return renderPanel(server, options);
}

describe("AgentPanel: запоминание на человека (T007)", () => {
  it("после перезагрузки панель открыта на том же чате", async () => {
    const server = twoChats();
    const first = renderPanel(server);
    await openPanel();
    await openList();
    fireEvent.click(within(row("c1")).getByText("Первый"));
    await waitFor(() => expect(historyRequested(server, "c1")).toBe(true));
    expect(localStorage.getItem(panelOpenKey("/api/chat", "ivan"))).toBe('{"open":true}');
    expect(localStorage.getItem(panelChatKey("/api/chat", "ivan"))).toBe("c1");
    first.unmount();

    const again = twoChats();
    renderPanel(again);
    expect(isOpen()).toBe(true);
    await waitFor(() => expect(historyRequested(again, "c1")).toBe(true));
    expect(historyRequested(again, "c2")).toBe(false);
  });

  it("основной ключ ChatWorkspace панель не трогает", async () => {
    localStorage.setItem("agent-chat:active-chat:/api/chat", "c1");
    const server = twoChats();
    renderPanel(server);
    await waitFor(() => expect(historyRequested(server, "c2")).toBe(true));
    expect(localStorage.getItem("agent-chat:active-chat:/api/chat")).toBe("c1");
  });

  it("сменился человек — его состояние; чат прошлого не открывается", async () => {
    const server = fakeChatListServer([
      { id: "c3", title: "Третий" },
      { id: "c2", title: "Второй" },
    ]);
    localStorage.setItem(panelChatKey("/api/chat", "ivan"), "c2");
    localStorage.setItem(panelOpenKey("/api/chat", "ivan"), '{"open":true}');
    const view = renderPanel(server);
    await waitFor(() => expect(historyRequested(server, "c2")).toBe(true));
    expect(isOpen()).toBe(true);
    await openList();

    server.requests.length = 0;
    view.rerenderWith({ provider: { userKey: "maria" } });
    expect(isOpen()).toBe(false);
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    await waitFor(() => expect(historyRequested(server, "c3")).toBe(true));
    expect(historyRequested(server, "c2")).toBe(false);
    expect(localStorage.getItem(panelChatKey("/api/chat", "maria"))).toBe("c3");
  });

  it("запомненный чат удалили в другой вкладке — после перезагрузки открыт существующий, а не «Чат не найден»", async () => {
    localStorage.setItem(panelChatKey("/api/chat", "ivan"), "gone");
    const server = twoChats();
    renderPanel(server);
    await waitFor(() => expect(historyRequested(server, "c2")).toBe(true));
    expect(screen.queryByText("Чат не найден")).toBeNull();
  });
});

describe("AgentPanel: смена человека не показывает и не раздаёт чужое", () => {
  /** Два человека на одном адресе: сервер отвечает тому, кто вошёл на момент запроса; GET списка можно придержать. */
  function twoPeople() {
    const people = {
      ivan: fakeChatListServer([{ id: "ivan-1", title: "Чат Ивана" }]),
      maria: fakeChatListServer([{ id: "maria-1", title: "Чат Марии" }]),
    };
    const state = { who: "ivan" as keyof typeof people, holdList: false };
    const held: Array<() => void> = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const server = people[state.who];
      const listGet = (init?.method ?? "GET").toUpperCase() === "GET" && String(input).replace(/\?.*$/, "") === "/api/chat";
      if (state.holdList && listGet) await new Promise<void>((release) => held.push(release));
      return server.fetch(input, init);
    }) as typeof globalThis.fetch;
    return { people, state, fetch, release: () => held.splice(0).forEach((release) => release()) };
  }

  /** Скин, который запоминает, какой чат и с каким мостом панель рисует в каждом кадре. */
  const frames: Array<{ chatId: string | undefined; bridge: AgentAppBridge | undefined }> = [];
  const recordingSkin: AgentPanelProps["skin"] = {
    ...stubPanelSkin,
    AgentPanel: (props) => {
      const chat = props.children as { props?: { chatId?: string; appBridge?: AgentAppBridge } } | false;
      frames.push({ chatId: chat ? chat.props?.chatId : undefined, bridge: chat ? chat.props?.appBridge : undefined });
      return <stubPanelSkin.AgentPanel {...props} />;
    },
  };

  it("в первом кадре после смены нет чата прежнего; его поток не раздаёт изменения данных новому", async () => {
    const { people, state, fetch } = twoPeople();
    vi.stubGlobal("fetch", fetch);
    const handler = vi.fn();
    const all = vi.fn();
    function TaskList() {
      useAgentDataChanges("tasks", handler);
      return null;
    }
    const tree = (userKey: string) => (
      <AgentPanelProvider api="/api/chat" userKey={userKey} onDataChanged={all}>
        <TaskList />
        <AgentPanel skin={recordingSkin} />
      </AgentPanelProvider>
    );
    const view = render(tree("ivan"));
    await waitFor(() => expect(historyRequested(people.ivan, "ivan-1")).toBe(true));
    const ivanBridge = frames.at(-1)!.bridge!;

    frames.length = 0;
    state.who = "maria";
    view.rerender(tree("maria"));
    expect(frames.map((frame) => frame.chatId).filter((id) => id === "ivan-1")).toEqual([]);
    act(() => ivanBridge.dataChanged({ id: "from-ivan", tag: "tasks" }));
    expect(handler).not.toHaveBeenCalled();
    expect(all).not.toHaveBeenCalled();

    await waitFor(() => expect(historyRequested(people.maria, "maria-1")).toBe(true));
    act(() => ivanBridge.dataChanged({ id: "from-ivan-2", tag: "tasks" }));
    expect(handler).not.toHaveBeenCalled();
    act(() => frames.at(-1)!.bridge!.dataChanged({ id: "from-maria", tag: "tasks" }));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledTimes(1);
  });

  it("openNewChat прежнего человека, закончившийся после смены, не открывает список, чат и текст у нового", async () => {
    const { people, state, fetch, release } = twoPeople();
    people.ivan.state.chats.push({ id: "ivan-empty", title: null, createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z" });
    vi.stubGlobal("fetch", fetch);
    const view = render(page());
    await waitFor(() => expect(historyRequested(people.ivan, "ivan-1")).toBe(true));
    state.holdList = true;
    let opened: Promise<boolean> | undefined;
    act(() => {
      opened = controls!.openNewChat({ draft: "Текст Ивана" });
    });
    state.holdList = false;
    state.who = "maria";
    view.rerender(page({ provider: { userKey: "maria" } }));
    await waitFor(() => expect(historyRequested(people.maria, "maria-1")).toBe(true));
    await act(async () => {
      release();
      await opened;
    });
    expect(await opened).toBe(false);
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    expect(screen.getByTestId("panel-title").textContent).toBe("Чат Марии");
    expect(field().value).toBe("");
    expect(historyRequested(people.maria, "ivan-empty")).toBe(false);
    expect(localStorage.getItem(panelChatKey("/api/chat", "maria"))).toBe("maria-1");
  });
});

describe("AgentPanel: список поверх чата (T009)", () => {
  it("«Чаты» открывает список поверх чата, чат остаётся смонтированным; выбор открывает чат и закрывает список", async () => {
    const server = twoChats();
    renderPanel(server);
    await openPanel();
    const chatField = field();
    await openList();
    expect(panelFrame().getAttribute("data-list-open")).toBe("true");
    expect(field()).toBe(chatField);
    expect(row("c2").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("panel-list-toggle").textContent).toBe("К чату");

    fireEvent.click(within(row("c1")).getByText("Первый"));
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    await waitFor(() => expect(historyRequested(server, "c1")).toBe(true));
    expect(screen.getByTestId("panel-title").textContent).toBe("Первый");
  });

  it("«Новый чат» создаёт чат, открывает его и закрывает список", async () => {
    const server = twoChats();
    renderPanel(server);
    await openPanel();
    await openList();
    fireEvent.click(within(screen.getByTestId("panel-list")).getByText("Новый чат", { selector: "button" }));
    await waitFor(() => expect(panelFrame().getAttribute("data-list-open")).toBe("false"));
    expect(server.state.chats.map((chat) => chat.id)).toEqual(["new-1", "c2", "c1"]);
    await waitFor(() => expect(historyRequested(server, "new-1")).toBe(true));
    expect(screen.getByTestId("panel-title").textContent).toBe("Новый чат");
  });

  it("переименование и удаление — как в ChatWorkspace; удалён открытый — открыт соседний", async () => {
    const server = twoChats();
    renderPanel(server);
    await openPanel();
    await openList();
    fireEvent.click(within(row("c2")).getByText("Переименовать"));
    const title = screen.getByLabelText("Название чата");
    fireEvent.change(title, { target: { value: "Про Грецию" } });
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(row("c2").textContent).toContain("Про Грецию"));
    expect(screen.getByTestId("panel-title").textContent).toBe("Про Грецию");
    expect(server.state.chats.find((chat) => chat.id === "c2")?.title).toBe("Про Грецию");

    fireEvent.click(within(row("c2")).getByText("Удалить"));
    expect(screen.getByTestId("delete-dialog").textContent).toContain("«Про Грецию»");
    expect(server.listRequests("DELETE")).toHaveLength(0);
    fireEvent.click(within(screen.getByTestId("delete-dialog")).getByText("Удалить"));
    await waitFor(() => expect(rows()).toEqual(["c1"]));
    expect(row("c1").getAttribute("aria-current")).toBe("true");
    await waitFor(() => expect(historyRequested(server, "c1")).toBe(true));
  });

  it("открытый чат удалили в другой вкладке — «Чат не найден», «Чаты» ведут к списку", async () => {
    const server = twoChats();
    renderPanel(server);
    await screen.findByLabelText("поле");
    server.state.chats.splice(0, 1);
    // Открытие того же чата заново: история спрашивается снова и сервер отвечает 404.
    act(() => controls!.openChat("c1"));
    act(() => controls!.openChat("c2"));
    await waitFor(() => expect(within(screen.getByTestId("panel-chat")).getByText("Чат не найден")).toBeTruthy());
    expect(isOpen()).toBe(true);
    await openList();
    expect(rows()).toEqual(["c1"]);
    fireEvent.click(within(row("c1")).getByText("Первый"));
    await screen.findByLabelText("поле");
    expect(screen.queryByText("Чат не найден")).toBeNull();
  });

  it("список не загрузился и чата нет — список с ошибкой и «Повторить» виден сразу", async () => {
    const server = twoChats();
    server.state.fail.add("list");
    renderPanel(server);
    fireEvent.click(launcher());
    expect((await screen.findByRole("alert")).textContent).toBe("Список чатов не загрузился");
    server.state.fail.clear();
    fireEvent.click(within(screen.getByTestId("panel-list")).getByText("Повторить"));
    await screen.findByLabelText("поле");
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
  });

  it("свойства AgentChat доходят до чата панели", async () => {
    const server = twoChats();
    renderPanel(server, { panel: { spendingLimits: true } });
    await screen.findByLabelText("поле");
    await waitFor(() => expect(server.chatServer.requestsTo("spending").length).toBeGreaterThan(0));
  });
});

describe("useAgentPanel: управление из кода (T010)", () => {
  it("setOpen и toggle", async () => {
    renderPanel(twoChats());
    await screen.findByLabelText("поле");
    act(() => controls!.setOpen(true));
    expect(isOpen()).toBe(true);
    expect(controls!.open).toBe(true);
    act(() => controls!.toggle());
    expect(isOpen()).toBe(false);
    act(() => controls!.toggle());
    expect(isOpen()).toBe(true);
  });

  it("openChat открывает панель на нужном чате и закрывает список", async () => {
    const server = twoChats();
    renderPanel(server);
    await openPanel();
    await openList();
    act(() => controls!.setOpen(false));
    act(() => controls!.openChat("c1"));
    expect(isOpen()).toBe(true);
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    await waitFor(() => expect(historyRequested(server, "c1")).toBe(true));
  });

  it("openNewChat({ draft }) — новый чат с готовым текстом в поле, панель открыта", async () => {
    const server = twoChats();
    renderPanel(server);
    await screen.findByLabelText("поле");
    let opened: boolean | undefined;
    await act(async () => {
      opened = await controls!.openNewChat({ draft: "Расскажи про заказ 1052" });
    });
    expect(opened).toBe(true);
    expect(isOpen()).toBe(true);
    await waitFor(() => expect(historyRequested(server, "new-1")).toBe(true));
    await waitFor(() => expect(field().value).toBe("Расскажи про заказ 1052"));
  });

  it("openNewChat при открытом пустом чате ставит текст в него; уход и возврат текст не возвращают", async () => {
    const server = fakeChatListServer([
      { id: "empty", title: null },
      { id: "c1", title: "Первый" },
    ]);
    renderPanel(server);
    await screen.findByLabelText("поле");
    await act(async () => {
      await controls!.openNewChat({ draft: "Вопрос про карточку" });
    });
    await waitFor(() => expect(field().value).toBe("Вопрос про карточку"));
    expect(server.listRequests("POST")).toHaveLength(0);

    act(() => controls!.openChat("c1"));
    await waitFor(() => expect(historyRequested(server, "c1")).toBe(true));
    act(() => controls!.openChat("empty"));
    await waitFor(() => expect(field().value).toBe(""));
  });

  it("openNewChat без текста — пустое поле; не создался — false и список с ошибкой", async () => {
    const server = fakeChatListServer([{ id: "c1", title: "Первый" }]);
    renderPanel(server);
    await screen.findByLabelText("поле");
    await act(async () => {
      expect(await controls!.openNewChat()).toBe(true);
    });
    await waitFor(() => expect(historyRequested(server, "new-1")).toBe(true));
    expect(field().value).toBe("");

    server.state.chats[0]!.title = "Уже не пустой";
    server.state.fail.add("create");
    let opened: boolean | undefined;
    await act(async () => {
      opened = await controls!.openNewChat({ draft: "текст" });
    });
    expect(opened).toBe(false);
    expect(panelFrame().getAttribute("data-list-open")).toBe("true");
    expect(within(screen.getByTestId("panel-list")).getByRole("alert").textContent).toBe("Не удалось создать чат");
  });

  it("busy: идёт ответ — значок на кнопке; ответ закончился — нет", async () => {
    const server = twoChats();
    renderPanel(server);
    await screen.findByLabelText("поле");
    expect(launcher().getAttribute("data-busy")).toBe("false");
    submitQuestion("Вопрос");
    await waitFor(() => expect(server.chatServer.streams).toHaveLength(1));
    await waitFor(() => expect(launcher().getAttribute("data-busy")).toBe("true"));
    expect(controls!.busy).toBe(true);
    server.chatServer.streams[0]!.answer("Ответ");
    await waitFor(() => expect(launcher().getAttribute("data-busy")).toBe("false"));
    expect(controls!.busy).toBe(false);
  });

  it("mode и width видны в useAgentPanel", async () => {
    const view = renderPanel(twoChats());
    expect(controls!.mode).toBe("overlay");
    expect(controls!.width).toBe(420);
    view.rerenderWith({ provider: { mode: "push", width: 500 } });
    expect(controls!.mode).toBe("push");
    expect(controls!.width).toBe(500);
    await settle();
  });
});

describe("useAgentPanel: pageInset (T010)", () => {
  function stubScreen(narrow: boolean) {
    const listeners = new Set<(event: { matches: boolean }) => void>();
    const query = {
      matches: narrow,
      media: "(max-width: 640px)",
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => listeners.delete(listener),
    };
    const matchMedia = vi.fn(() => query);
    vi.stubGlobal("matchMedia", matchMedia);
    return {
      matchMedia,
      resize(next: boolean) {
        query.matches = next;
        act(() => listeners.forEach((listener) => listener({ matches: next })));
      },
    };
  }

  it("overlay — всегда 0", async () => {
    stubScreen(false);
    renderPanel(twoChats());
    await screen.findByLabelText("поле");
    act(() => controls!.setOpen(true));
    expect(controls!.pageInset).toBe(0);
  });

  it("push: закрыта — 0, открыта — ширина, узкий экран — 0, экран стал шире — снова ширина", async () => {
    const screenSize = stubScreen(false);
    renderPanel(twoChats(), { provider: { mode: "push", width: 380 } });
    await screen.findByLabelText("поле");
    expect(controls!.pageInset).toBe(0);
    act(() => controls!.setOpen(true));
    expect(controls!.pageInset).toBe(380);
    screenSize.resize(true);
    expect(controls!.pageInset).toBe(0);
    screenSize.resize(false);
    expect(controls!.pageInset).toBe(380);
    expect(screenSize.matchMedia).toHaveBeenCalledWith("(max-width: 640px)");
  });
});

describe("хуки панели вне AgentPanelProvider", () => {
  it.each([
    ["useAgentPanel", () => useAgentPanel()],
    ["useAgentPlace", () => useAgentPlace(null)],
    ["useAgentDataChanges", () => useAgentDataChanges("tasks", () => {})],
  ])("%s бросает понятную ошибку", (_name, hook) => {
    function Outside() {
      hook();
      return null;
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Outside />)).toThrow(/AgentPanelProvider/);
  });

  it("AgentPanel вне провайдера тоже", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<AgentPanel skin={stubPanelSkin} />)).toThrow(/AgentPanelProvider/);
  });
});


describe("application composer commands", () => {
  it("returns from a closed list to the same chat/draft and focuses on every request", async () => {
    const server = twoChats();
    renderPanel(server);
    await openPanel();
    const original = field();
    fireEvent.change(original, { target: { value: "My pending edit" } });
    await openList();
    act(() => controls!.setOpen(false));
    act(() => controls!.focusComposer());
    expect(isOpen()).toBe(true);
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    expect(field()).toBe(original);
    expect(field().value).toBe("My pending edit");
    expect(document.activeElement).toBe(original);
    screen.getByText("Page button").focus();
    act(() => controls!.focusComposer());
    expect(document.activeElement).toBe(original);
    expect(server.requests.filter((r) => r.method === "POST" && r.path === "/api/chat")).toHaveLength(0);
  });

  it("showChat closes the list without stealing focus from the application", async () => {
    renderPanel(twoChats());
    await openPanel();
    await openList();
    const pageButton = screen.getByText("Page button");
    pageButton.focus();
    act(() => controls!.showChat());
    expect(panelFrame().getAttribute("data-list-open")).toBe("false");
    expect(document.activeElement).toBe(pageButton);
  });
});
