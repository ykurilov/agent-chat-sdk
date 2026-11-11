// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

/*
 * Ранний «Стоп»: человек жмёт «Стоп» сразу после отправки. Запрос хода несёт свой id (`turnRequestId`), «Стоп» —
 * тот же id: сервер останавливает именно этот ход, даже если «Стоп» пришёл раньше хода или на другую копию.
 */

const turnIdOf = (body: unknown) => (body as { turnRequestId?: unknown } | undefined)?.turnRequestId;

async function send(result: ReturnType<typeof renderChatHook>["result"], text: string) {
  act(() => result.current.setValue(text));
  act(() => {
    result.current.submit();
  });
}

describe("useAgentChat: «Стоп» называет id запроса хода", () => {
  it("«Стоп», пока запрос отправки ещё идёт, уходит с id этого запроса", async () => {
    const server = fakeChatServer();
    let release!: () => void;
    server.state.gate.messages = new Promise<void>((resolve) => (release = resolve));
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await send(result, "Расскажи подробно");
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    const turnRequestId = turnIdOf(server.requestsTo("messages")[0]!.body);
    expect(turnRequestId).toEqual(expect.any(String));

    await act(async () => {
      await result.current.stop();
    });
    release();
    expect(server.requestsTo("stop").map((request) => turnIdOf(request.body))).toEqual([turnRequestId]);
  });

  it("каждый запрос хода — со своим id; кончившийся ход «Стоп» больше не называет", async () => {
    const server = fakeChatServer();
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await send(result, "Первый");
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0]!.push({ type: "start", messageId: "a1" });
    server.streams[0]!.finish();
    await waitFor(() => expect(result.current.busy).toBe(false));
    await send(result, "Второй");
    await waitFor(() => expect(server.streams).toHaveLength(2));
    const [first, second] = server.requestsTo("messages").map((request) => turnIdOf(request.body));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    server.streams[1]!.push({ type: "start", messageId: "a2" });
    server.streams[1]!.finish();
    await waitFor(() => expect(result.current.busy).toBe(false));
    await act(async () => {
      await result.current.stop();
    });
    expect(server.requestsTo("stop")[0]!.body).toBeUndefined();
  });

  it("ход, к которому вкладка только подключилась, «Стоп» останавливает без id — как раньше", async () => {
    const server = fakeChatServer({ history: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Привет" }] }], running: true, resumable: true });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    server.resumed[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(result.current.busy).toBe(true));
    await act(async () => {
      await result.current.stop();
    });
    expect(server.requestsTo("stop")).toHaveLength(1);
    expect(server.requestsTo("stop")[0]!.body).toBeUndefined();
  });

  it("поправка начала новый ход, а «Стоп» нажат, пока она шла: новый ход останавливается своим id", async () => {
    const server = fakeChatServer({ resumable: true });
    const { result } = renderChatHook(server, { steering: true });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await send(result, "Нарисуй кнопку");
    await waitFor(() => expect(server.streams).toHaveLength(1));
    server.streams[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(result.current.canSteer).toBe(true));
    let releaseSteer!: () => void;
    server.state.gate.steer = new Promise<void>((resolve) => (releaseSteer = resolve));
    server.state.steer.result = "started";
    act(() => result.current.setValue("Сделай синей"));
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    const sendId = turnIdOf(server.requestsTo("messages")[0]!.body);
    const steerId = turnIdOf(server.requestsTo("steer")[0]!.body);
    expect(steerId).toEqual(expect.any(String));
    expect(steerId).not.toBe(sendId);

    await act(async () => {
      await result.current.stop();
    });
    releaseSteer();
    await waitFor(() => expect(server.requestsTo("stop").map((request) => turnIdOf(request.body))).toEqual([sendId, steerId]));
  });
});
