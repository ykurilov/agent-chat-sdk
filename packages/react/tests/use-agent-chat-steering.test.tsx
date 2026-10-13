// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Нарисуй кнопку" }] };
const steerPart = { type: "data-agent-steer", data: true };
const answer = (status = "complete") => ({ id: "a1", role: "assistant" as const, parts: [{ type: "text", text: "Начало" }], metadata: { status } });
const correctionOf = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text", text }, steerPart] });
const textOf = (message: { parts: Array<{ type: string; text?: string }> }) =>
  message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

/** Ответ идёт: хук подключён к нему и уже получил начало. */
async function answering(options: Parameters<typeof renderChatHook>[1] = {}) {
  const server = fakeChatServer({ history: [question], running: true, resumable: true });
  const hook = renderChatHook(server, { steering: true, ...options });
  await waitFor(() => expect(server.resumed).toHaveLength(1));
  const stream = server.resumed[0]!;
  stream.push({ type: "start", messageId: "a1" });
  stream.push({ type: "text-start", id: "t" });
  stream.push({ type: "text-delta", id: "t", delta: "Начало" });
  await waitFor(() => expect(hook.result.current.messages).toHaveLength(2));
  return { server, stream, ...hook };
}

describe("useAgentChat: поправка на лету", () => {
  it("право steer запрещено: поправки нет, поле ждёт конца ответа, POST steer не уходит", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    server.state.capabilities = { steer: false };
    const { result } = renderChatHook(server, { steering: true });
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    server.resumed[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(result.current.capabilities.steer).toBe(false));
    act(() => result.current.setValue("Сделай синей"));
    expect(result.current.canSteer).toBe(false);
    let sent = true;
    act(() => {
      sent = result.current.submit();
    });
    expect(sent).toBe(false);
    expect(server.requestsTo("steer")).toHaveLength(0);
  });

  it("во время ответа поле свободно: submit шлёт POST steer, поправка видна с пометкой, текст из поля ушёл", async () => {
    const { server, result } = await answering();
    act(() => result.current.setValue("Сделай синей"));
    expect(result.current.canSteer).toBe(true);
    expect(result.current.canSubmit).toBe(false);

    let sent = false;
    act(() => {
      sent = result.current.submit();
    });
    expect(sent).toBe(true);
    expect(result.current.value).toBe("");
    expect(result.current.corrections.map(textOf)).toEqual(["Сделай синей"]);
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    const body = server.requestsTo("steer")[0]!.body as { message: { id: string; role: string; parts: unknown[] } };
    expect(body.message).toMatchObject({ role: "user", parts: [{ type: "text", text: "Сделай синей" }] });
    expect(body.message.id).toBe(result.current.corrections[0]!.id);
    // Ответ идёт дальше: лента прежняя, поправка — отдельно.
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1"]);
    expect(result.current.busy).toBe(true);
  });

  it("агент взял поправку: ответ кончился — хук перечитывает историю и подключается к новому ответу, пометка уходит", async () => {
    const { server, stream, result } = await answering();
    act(() => result.current.setValue("Сделай синей"));
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    const id = result.current.corrections[0]!.id;

    server.state.history = [question, answer(), correctionOf(id, "Сделай синей")];
    stream.finish("t");
    await waitFor(() => expect(server.resumed).toHaveLength(2));
    await waitFor(() => expect(result.current.corrections).toEqual([]));
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", id]);
    // Между ответами вкладка занята: обычная отправка не влезает.
    expect(result.current.busy).toBe(true);
    server.resumed[1]!.answer("Готово, синяя", "a2");
    await waitFor(() => expect(result.current.messages.map((message) => message.id)).toEqual(["u1", "a1", id, "a2"]));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("несколько поправок — все по порядку", async () => {
    const { server, result } = await answering();
    for (const text of ["синей", "и крупнее"]) {
      act(() => result.current.setValue(text));
      act(() => {
        result.current.submit();
      });
    }
    expect(result.current.corrections.map(textOf)).toEqual(["синей", "и крупнее"]);
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(2));
    expect(server.requestsTo("steer").map((request) => textOf((request.body as { message: { parts: Array<{ type: string; text?: string }> } }).message))).toEqual([
      "синей",
      "и крупнее",
    ]);
  });

  it("сервер отказал поправке — она уходит из ленты, текст возвращается в поле, onRejected узнаёт причину", async () => {
    const { server, result } = await answering();
    server.state.refuse.steer = { status: 409, kind: "busy" };
    const onRejected = vi.fn();
    act(() => result.current.setValue("Сделай синей"));
    act(() => {
      result.current.submit(undefined, onRejected);
    });
    await waitFor(() => expect(onRejected).toHaveBeenCalledWith("busy"));
    expect(result.current.corrections).toEqual([]);
    expect(result.current.value).toBe("Сделай синей");
  });

  it("связь оборвалась на поправке — повтор того же текста уходит с тем же id (сервер узнает повтор); новый текст — с новым", async () => {
    const { server, result } = await answering();
    server.state.drop.add("steer");
    const onRejected = vi.fn();
    act(() => result.current.setValue("Сделай синей"));
    act(() => {
      result.current.submit(undefined, onRejected);
    });
    await waitFor(() => expect(onRejected).toHaveBeenCalledWith("connection"));
    expect(result.current.value).toBe("Сделай синей");

    server.state.drop.delete("steer");
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(2));
    const ids = server.requestsTo("steer").map((request) => (request.body as { message: { id: string } }).message.id);
    expect(ids[1]).toBe(ids[0]);

    act(() => result.current.setValue("И крупнее"));
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(3));
    expect((server.requestsTo("steer")[2]!.body as { message: { id: string } }).message.id).not.toBe(ids[0]);
  });

  it("перезагрузка: поправки из истории (pendingMessages) показываются с пометкой", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    server.state.pendingMessages = [correctionOf("s1", "Сделай синей")];
    const { result } = renderChatHook(server, { steering: true });
    await waitFor(() => expect(result.current.corrections.map((message) => message.id)).toEqual(["s1"]));
    expect(result.current.messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it("«Стоп» при ждущей поправке: ответ остановлен, хук подключается к ходу по поправке", async () => {
    const { server, result } = await answering();
    act(() => result.current.setValue("Сделай синей"));
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    const id = result.current.corrections[0]!.id;
    server.state.history = [question, answer("stopped"), correctionOf(id, "Сделай синей")];

    await act(async () => {
      await result.current.stop();
    });
    expect(server.requestsTo("stop")).toHaveLength(1);
    await waitFor(() => expect(server.resumed).toHaveLength(2));
    await waitFor(() => expect(result.current.corrections).toEqual([]));
    expect(result.current.messages.find((message) => message.id === "a1")?.metadata?.status).toBe("stopped");
    expect(result.current.messages.at(-1)?.id).toBe(id);
  });

  it("steering: false — поправок нет: во время ответа отправить нельзя", async () => {
    const { server, result } = await answering({ steering: false });
    act(() => result.current.setValue("Сделай синей"));
    expect(result.current.canSteer).toBe(false);
    let sent = true;
    act(() => {
      sent = result.current.submit();
    });
    expect(sent).toBe(false);
    expect(server.requestsTo("steer")).toHaveLength(0);
    expect(result.current.value).toBe("Сделай синей");
  });

  it("без ответа submit — обычная отправка, не поправка", async () => {
    const server = fakeChatServer({ history: [question, answer()], running: false });
    const { result } = renderChatHook(server, { steering: true });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Ещё"));
    expect(result.current.canSteer).toBe(false);
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.streams).toHaveLength(1));
    expect(server.requestsTo("steer")).toHaveLength(0);
  });

  it("по умолчанию хук поправок не шлёт: своя лента должна сама рисовать `corrections` и включает их явно", async () => {
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    server.resumed[0]!.push({ type: "start", messageId: "a1" });
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => result.current.setValue("Сделай синей"));
    expect(result.current.canSteer).toBe(false);
    let sent = true;
    act(() => {
      sent = result.current.submit();
    });
    expect(sent).toBe(false);
    expect(server.requestsTo("steer")).toHaveLength(0);
  });

  it("сообщению отказано, а поправка уже ушла и начала ход — вкладка подключается к нему", async () => {
    const server = fakeChatServer({ resumable: true });
    const { result } = renderChatHook(server, { steering: true });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let release!: () => void;
    server.state.gate.messages = new Promise<void>((resolve) => (release = resolve));
    server.state.refuse.messages = { status: 400, kind: "invalid" };
    server.state.steer.result = "started";
    act(() => result.current.setValue("Нарисуй кнопку"));
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(result.current.canSteer).toBe(true));
    act(() => result.current.setValue("Сделай синей"));
    act(() => {
      result.current.submit();
    });
    await waitFor(() => expect(server.requestsTo("steer")).toHaveLength(1));
    const id = result.current.corrections[0]!.id;

    server.state.history = [correctionOf(id, "Сделай синей")];
    server.state.running = true;
    release();
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    await waitFor(() => expect(result.current.corrections).toEqual([]));
    expect(result.current.messages.map((message) => message.id)).toEqual([id]);
  });
});
