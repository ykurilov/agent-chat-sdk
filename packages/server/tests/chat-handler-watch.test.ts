import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { BackgroundPort, BackgroundTasks, ChatStorage, TaskView } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatServer } from "../src/chat-handler";
import type { ChatHandlerOptions } from "../src/chat-handler";
import { createGate, mockCatalog, mockEnv, mockModelId } from "./support/mock-catalog";
import { parseSse, readUntil } from "./support/sse";
import { message, seedUnfinishedAnswer } from "./support/test-chat";

const base = "http://test.local/api/chat";

/** Фон-заглушка: запоминает порт, задачи и вызовы отмены и подтверждения. */
function fakeBackground() {
  const state = {
    port: undefined as BackgroundPort | undefined,
    tasks: [] as TaskView[],
    listCalls: 0,
    canceled: [] as Array<[string, string, string]>,
    approvals: [] as Array<[string, string, string, string, string]>,
  };
  const background: BackgroundTasks = {
    instructions: "Фон.",
    toolNames: [],
    tools: () => ({}),
    attach: (port) => {
      state.port = port;
    },
    listForChat: async () => {
      state.listCalls++;
      return state.tasks;
    },
    cancel: async (ownerId, chatId, taskId) => {
      state.canceled.push([ownerId, chatId, taskId]);
      return taskId === "нет" ? "not_found" : "canceled";
    },
    answerApproval: async (ownerId, chatId, taskId, approvalId, decision) => {
      state.approvals.push([ownerId, chatId, taskId, approvalId, decision]);
      if (taskId === "нет") return "not_found";
      return approvalId === "approval-1" ? "resumed" : "stale";
    },
    chatDeleted: async () => {},
    recover: async () => {},
    flush: async () => {},
  };
  return { background, state };
}

const task = (id: string, status: TaskView["status"]): TaskView => ({ id, title: "Отчёт", kind: "tool", name: "report", status, startedAt: "2026-10-05T10:00:00.000Z" });

function createServer(options: Partial<ChatHandlerOptions> & { gate?: () => Promise<void>; storage?: ChatStorage } = {}) {
  const { gate, ...overrides } = options;
  const storage = options.storage ?? createInMemoryChatStorage();
  const server = createChatServer({
    basePath: "/api/chat",
    resolveUser: async (request) => {
      const user = request.headers.get("x-user");
      return user ? { id: user } : null;
    },
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    catalog: mockCatalog(gate),
    agent: { instructions: "Ты помощник." },
    env: mockEnv,
    ...overrides,
    storage,
  });
  const call = (method: string, path: string, init: { body?: unknown; user?: string | null } = {}) =>
    server.handler.fetch(
      new Request(`${base}${path}`, {
        method,
        headers: {
          ...(init.user !== null && { "x-user": init.user ?? "anna" }),
          ...(init.body !== undefined && { "content-type": "application/json" }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      }),
    );
  const createChat = async (user = "anna") => ((await (await call("POST", "", { user })).json()) as { id: string }).id;
  return { ...server, storage, call, createChat };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("история сообщает, подключены ли фоновые задачи", () => {
  it.each([
    ["с фоном", true],
    ["без фона", false],
  ])("%s: backgroundTasks = %s", async (_, withBackground) => {
    const server = createServer(withBackground ? { background: fakeBackground().background } : {});
    const chatId = await server.createChat();
    const history = (await (await server.call("GET", `/${chatId}`)).json()) as { backgroundTasks?: boolean };
    expect(history.backgroundTasks).toBe(withBackground);
  });
});

describe("T047: GET /:chatId/watch", () => {
  it("поток событий своего чата: ход человека, задачи; чужие чаты не видны", async () => {
    const { background, state } = fakeBackground();
    const server = createServer({ background });
    const chatId = await server.createChat();
    const other = await server.createChat();
    const watch = await server.call("GET", `/${chatId}/watch`);
    expect(watch.status).toBe(200);
    expect(watch.headers.get("content-type")).toContain("text/event-stream");
    expect(watch.headers.get("x-agent-chat-heartbeat-ms")).toBe("10000");
    const reader = watch.body!.getReader();
    let seen = await readUntil(reader, ": ping");
    await (await server.call("POST", `/${other}/messages`, { body: message("x1", "в другом чате") })).text();
    state.port!.events.emit({ type: "tasks-changed", ownerId: "anna", chatId: other });
    await (await server.call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") })).text();
    state.port!.events.emit({ type: "tasks-changed", ownerId: "anna", chatId });
    seen = await readUntil(reader, '"tasks-changed"');
    await reader.cancel();
    const events = parseSse(seen);
    expect(events.map((event) => event.type)).toEqual(["turn-started", "turn-finished", "tasks-changed"]);
    expect(events[0]).toMatchObject({ type: "turn-started", chatId, trigger: "human", channel: "web" });
    expect(events[1]).toMatchObject({ type: "turn-finished", messageId: events[0]!.messageId, status: "complete" });
    // Владелец в поток не уходит: вкладке он не нужен.
    expect(events.every((event) => !("ownerId" in event))).toBe(true);
  });

  it("чужой чат — 404, без входа — 401", async () => {
    const server = createServer();
    const chatId = await server.createChat("boris");
    expect((await server.call("GET", `/${chatId}/watch`)).status).toBe(404);
    expect((await server.call("GET", `/${chatId}/watch`, { user: null })).status).toBe(401);
  });

  it("работает и без фона: ход, начатый служебным сообщением, тоже виден", async () => {
    const server = createServer();
    const chatId = await server.createChat();
    await (await server.call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") })).text();
    const reader = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    await server.service.deliverNotices({
      ownerId: "anna",
      chatId,
      notices: [{ kind: "task_done", taskId: "t1", title: "Отчёт", result: "готово" }],
      wakeAgent: true,
      deliveryKey: "k1",
    });
    const seen = await readUntil(reader, '"turn-finished"');
    await reader.cancel();
    expect(parseSse(seen)[0]).toMatchObject({ type: "turn-started", trigger: "notice" });
  });

  it("hasWatchers — есть ли открытый watch у чата этого владельца", async () => {
    const server = createServer();
    const chatId = await server.createChat();
    expect(server.service.hasWatchers("anna", chatId)).toBe(false);
    expect(server.handler.hasWatchers!("anna", chatId)).toBe(false);
    const first = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    const second = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(first, ": ping");
    expect(server.service.hasWatchers("anna", chatId)).toBe(true);
    expect(server.service.hasWatchers("boris", chatId)).toBe(false);
    await first.cancel();
    expect(server.handler.hasWatchers!("anna", chatId)).toBe(true);
    await second.cancel();
    expect(server.handler.hasWatchers!("anna", chatId)).toBe(false);
  });

  it("клиент ушёл, так и не начав читать поток: подписчик снимается", async () => {
    const server = createServer();
    const chatId = await server.createChat();
    const client = new AbortController();
    const response = await server.handler.fetch(new Request(`${base}/${chatId}/watch`, { headers: { "x-user": "anna" }, signal: client.signal }));
    expect(response.status).toBe(200);
    expect(server.service.hasWatchers("anna", chatId)).toBe(true);
    client.abort();
    expect(server.service.hasWatchers("anna", chatId)).toBe(false);
  });

  it("подписка на события не удалась: ответ 500, подписчик не считается", async () => {
    const logError = vi.fn();
    const server = createServer({ logError });
    const chatId = await server.createChat();
    vi.spyOn(server.service, "subscribeEvents").mockImplementation(() => {
      throw new Error("шина недоступна");
    });
    const response = await server.call("GET", `/${chatId}/watch`);
    expect(response.status).toBe(500);
    expect(server.service.hasWatchers("anna", chatId)).toBe(false);
  });

  it.each([
    { name: "вопрос из Telegram", seed: { userParts: [{ type: "data-agent-channel", data: { channel: "telegram" } }] }, trigger: "human", channel: "telegram" },
    { name: "итог фона в веб-чате", seed: { afterNotice: true }, trigger: "notice", channel: "web" },
  ])("сверка: ход другой копии ($name) приходит с источником и каналом из истории", async ({ seed, trigger, channel }) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const { background, state } = fakeBackground();
    const server = createServer({ background });
    const chatId = await server.createChat();
    state.tasks = [task("t1", "running")];
    const reader = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    await seedUnfinishedAnswer(server.storage, chatId, "a-other", "Начало ответа", seed);
    await server.storage.markAnswerAlive?.("a-other");
    const started = readUntil(reader, '"turn-started"');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(parseSse(await started).find((event) => event.type === "turn-started")).toMatchObject({ messageId: "a-other", trigger, channel });
    await reader.cancel();
  });

  it("пинг раз в 10 с", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
    const server = createServer();
    const chatId = await server.createChat();
    const reader = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    const next = readUntil(reader, ": ping");
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(next).resolves.toContain(": ping");
    await reader.cancel();
  });

  it("пока идут задачи — сверка с базой раз в 5 с: ход другой копии и перемены задач видны", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const { background, state } = fakeBackground();
    const server = createServer({ background });
    const chatId = await server.createChat();
    state.tasks = [task("t1", "running")];
    const reader = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    // Ответ ведёт другая копия сервера: в базе он идёт, в реестре этой копии его нет.
    await seedUnfinishedAnswer(server.storage, chatId, "a-other");
    await server.storage.markAnswerAlive?.("a-other");
    const started = readUntil(reader, '"turn-started"');
    await vi.advanceTimersByTimeAsync(5_000);
    const startedText = await started;
    expect(parseSse(startedText).find((event) => event.type === "turn-started")).toMatchObject({ messageId: "a-other", chatId });
    state.tasks = [task("t1", "done")];
    const changed = readUntil(reader, '"tasks-changed"');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(changed).resolves.toContain('"tasks-changed"');
    // Задач больше нет — сверка не идёт.
    const calls = state.listCalls;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(state.listCalls).toBe(calls);
    // Новое событие задач снова включает сверку.
    state.tasks = [task("t2", "queued")];
    state.port!.events.emit({ type: "tasks-changed", ownerId: "anna", chatId });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.listCalls).toBeGreaterThan(calls);
    await reader.cancel();
  });

  it("первая сверка задач упала — следующая всё равно запланирована", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
    const { background, state } = fakeBackground();
    const listForChat = background.listForChat;
    background.listForChat = async (...args) => {
      if (state.listCalls === 0) {
        state.listCalls++;
        throw new Error("база недоступна");
      }
      return listForChat(...args);
    };
    const errors: string[] = [];
    const server = createServer({ background, logError: (error) => void errors.push(String(error)) });
    const chatId = await server.createChat();
    state.tasks = [task("t1", "running")];
    const reader = (await server.call("GET", `/${chatId}/watch`)).body!.getReader();
    await readUntil(reader, ": ping");
    await vi.waitFor(() => expect(errors.some((error) => error.includes("база недоступна"))).toBe(true));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.listCalls).toBe(2);
    state.tasks = [task("t1", "done")];
    const changed = readUntil(reader, '"tasks-changed"');
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(changed).resolves.toContain('"tasks-changed"');
    await reader.cancel();
  });
});

describe("T047: адреса задач", () => {
  it("список, отмена, подтверждение — через владельца", async () => {
    const { background, state } = fakeBackground();
    const server = createServer({ background });
    const chatId = await server.createChat();
    state.tasks = [task("t1", "running")];
    const list = await server.call("GET", `/${chatId}/tasks`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual(state.tasks);

    const cancel = await server.call("POST", `/${chatId}/tasks/t1/cancel`);
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toEqual({ status: "canceled" });
    expect(state.canceled).toEqual([["anna", chatId, "t1"]]);
    expect((await server.call("POST", `/${chatId}/tasks/нет/cancel`)).status).toBe(404);

    const approval = await server.call("POST", `/${chatId}/tasks/t1/approval`, { body: { decision: "allow", approvalId: "approval-1" } });
    expect(approval.status).toBe(200);
    expect(await approval.json()).toEqual({ status: "resumed" });
    expect(state.approvals).toEqual([["anna", chatId, "t1", "approval-1", "allow"]]);
    expect((await server.call("POST", `/${chatId}/tasks/t1/approval`, { body: { decision: "always", approvalId: "approval-1" } })).status).toBe(400);
    // Без номера вопроса ответ не принимается: иначе он одобрил бы любой вопрос, который задача задаст следующим.
    expect((await server.call("POST", `/${chatId}/tasks/t1/approval`, { body: { decision: "allow" } })).status).toBe(400);
    expect((await server.call("POST", `/${chatId}/tasks/нет/approval`, { body: { decision: "deny", approvalId: "approval-1" } })).status).toBe(409);
    const stale = await server.call("POST", `/${chatId}/tasks/t1/approval`, { body: { decision: "allow", approvalId: "approval-0" } });
    expect([stale.status, await stale.json()]).toEqual([409, { error: { kind: "approval_stale" } }]);
  });

  it("приложение отказало ходу (beforeTurn): подтверждение задачи — 403 turn_refused, задача ждёт дальше, фон не тронут", async () => {
    const { background, state } = fakeBackground();
    const beforeTurn = vi.fn(() => ({ code: "lesson_closed", message: "Урок закрыт" }));
    const server = createServer({ background, beforeTurn });
    const chatId = await server.createChat();
    state.tasks = [task("t1", "running")];

    const response = await server.call("POST", `/${chatId}/tasks/t1/approval`, { body: { decision: "allow", approvalId: "approval-1" } });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "turn_refused", code: "lesson_closed", message: "Урок закрыт" } });
    expect(state.approvals).toEqual([]);
    expect(beforeTurn).toHaveBeenCalledWith(expect.objectContaining({ userId: "anna", action: "approval", chat: expect.objectContaining({ id: chatId }) }));
    // Отмена задачи хода модели не продолжает: проверка её не касается.
    expect((await server.call("POST", `/${chatId}/tasks/t1/cancel`)).status).toBe(200);
  });

  it("то же для мессенджеров: service.tasks.answerApproval отказывает, не дойдя до фона", async () => {
    const { background, state } = fakeBackground();
    const server = createServer({ background, beforeTurn: () => ({ code: "lesson_closed", message: "Урок закрыт" }) });
    const chatId = await server.createChat();
    await expect(server.service.tasks!.answerApproval("anna", chatId, "t1", "approval-1", "allow")).rejects.toMatchObject({ name: "TurnRefusedError", code: "lesson_closed" });
    expect(state.approvals).toEqual([]);
  });

  it("чужой чат — 404, фона ничего не просят", async () => {
    const { background, state } = fakeBackground();
    const server = createServer({ background });
    const chatId = await server.createChat("boris");
    expect((await server.call("GET", `/${chatId}/tasks`)).status).toBe(404);
    expect((await server.call("POST", `/${chatId}/tasks/t1/cancel`)).status).toBe(404);
    expect((await server.call("POST", `/${chatId}/tasks/t1/approval`, { body: { decision: "allow", approvalId: "approval-1" } })).status).toBe(404);
    expect(state.listCalls).toBe(0);
    expect(state.canceled).toEqual([]);
    expect(state.approvals).toEqual([]);
  });

  it("без фона адресов задач нет; у службы нет tasks", async () => {
    const server = createServer();
    const chatId = await server.createChat();
    expect((await server.call("GET", `/${chatId}/tasks`)).status).toBe(404);
    expect((await server.call("POST", `/${chatId}/tasks/t1/cancel`)).status).toBe(404);
    expect(server.service.tasks).toBeUndefined();
  });

  it("с фоном служба даёт tasks для мессенджеров", async () => {
    const { background, state } = fakeBackground();
    const server = createServer({ background });
    const chatId = await server.createChat();
    expect(await server.service.tasks!.cancel("anna", chatId, "t1")).toBe("canceled");
    expect(await server.service.tasks!.answerApproval("anna", chatId, "t1", "approval-1", "deny")).toBe("resumed");
    expect(state.canceled).toHaveLength(1);
  });
});

describe("T047: фон подключён к службе через обработчик", () => {
  it("attach получает порт; ход виден в событиях порта", async () => {
    const gate = createGate();
    const { background, state } = fakeBackground();
    const server = createServer({ background, gate: gate.wait });
    expect(state.port).toBeDefined();
    const seen: string[] = [];
    state.port!.events.subscribe((event) => seen.push(event.type));
    const chatId = await server.createChat();
    const sent = await server.call("POST", `/${chatId}/messages`, { body: message("m1", "Привет") });
    gate.open();
    await sent.text();
    expect(seen).toEqual(["turn-started", "turn-finished"]);
  });
});
