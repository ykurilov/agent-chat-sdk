// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

const file = { type: "file" as const, url: "attachment:f1", mediaType: "image/png", filename: "кот.png" };

async function loaded(server = fakeChatServer()) {
  const hook = renderChatHook(server);
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return { server, ...hook };
}

describe("useAgentChat: сообщение с файлами", () => {
  it("файлы и текст уходят одним сообщением: сначала файлы, потом текст", async () => {
    const { server, result } = await loaded();
    act(() => result.current.setValue("Что на картинке?"));
    act(() => result.current.submit([file]));
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    expect(server.requestsTo("messages")[0]!.body).toEqual({
      message: { id: expect.any(String), role: "user", parts: [file, { type: "text", text: "Что на картинке?" }] },
      timeZone: expect.any(String),
    });
    expect(result.current.value).toBe("");
    server.streams[0]?.end();
  });

  it("только файлы, без текста — сообщение уходит без пустой текстовой части", async () => {
    const { server, result } = await loaded();
    act(() => result.current.submit([file]));
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    expect((server.requestsTo("messages")[0]!.body as { message: { parts: unknown[] } }).message.parts).toEqual([file]);
    server.streams[0]?.end();
  });

  it("без текста и без файлов отправки нет", async () => {
    const { server, result } = await loaded();
    act(() => result.current.submit([]));
    act(() => result.current.submit());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.requestsTo("messages")).toHaveLength(0);
  });

  it("submit говорит, принята ли отправка: с файлами — да, без текста и файлов — нет", async () => {
    const { server, result } = await loaded();
    let accepted: boolean | undefined;
    act(() => {
      accepted = result.current.submit();
    });
    expect(accepted).toBe(false);
    act(() => {
      accepted = result.current.submit([file]);
    });
    expect(accepted).toBe(true);
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(1));
    server.streams[0]?.end();
  });

  it("сервер не принял сообщение с файлами (400): сообщение уходит из ленты, текст возвращается в поле, причина доходит до вызывающего", async () => {
    const { server, result } = await loaded();
    server.state.refuse.messages = { status: 400, kind: "attachment_expired" };
    const rejected = vi.fn();
    act(() => result.current.setValue("Что на картинке?"));
    act(() => {
      result.current.submit([file], rejected);
    });
    await waitFor(() => expect(rejected).toHaveBeenCalledWith("attachment_expired"));
    await waitFor(() => expect(result.current.messages).toEqual([]));
    expect(result.current.value).toBe("Что на картинке?");
    expect(result.current.sendFailed).toBe(false);
    expect(result.current.connection).toBe("online");
    expect(result.current.busy).toBe(false);
    // Никаких попыток «переподключиться»: история не запрашивалась заново.
    expect(server.requestsTo("history")).toHaveLength(1);
  });

  it("после отказа можно отправить ещё раз, уже с другими файлами", async () => {
    const { server, result } = await loaded();
    server.state.refuse.messages = { status: 400, kind: "attachment_expired" };
    const rejected = vi.fn();
    act(() => {
      result.current.submit([file], rejected);
    });
    await waitFor(() => expect(rejected).toHaveBeenCalled());
    await waitFor(() => expect(result.current.busy).toBe(false));
    server.state.refuse = {};
    act(() => {
      result.current.submit([{ ...file, url: "attachment:f2" }]);
    });
    await waitFor(() => expect(server.requestsTo("messages")).toHaveLength(2));
    server.streams[0]?.end();
  });

  it("отказ 500 от сервера по-прежнему ведёт к «повторить», а не к возврату в поле", async () => {
    const { server, result } = await loaded();
    server.state.fail.add("messages");
    const rejected = vi.fn();
    act(() => {
      result.current.submit([file], rejected);
    });
    await waitFor(() => expect(result.current.sendFailed).toBe(true));
    expect(rejected).not.toHaveBeenCalled();
  });
});

