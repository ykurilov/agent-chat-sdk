// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Сделай всё сразу" }] };

/** Те же тексты, что у сервера при «Стопе» (core: approval-parts.ts), чтобы экран сразу показывал то, что покажет перезагрузка. */
const hangingText = "Вызов инструмента оборвался до результата: действие могло выполниться частично или целиком. Не повторяй его, не проверив, что уже сделано";
const interruptedText = "Ход прерван раньше, чем пользователь ответил на запрос. Действие не выполнялось.";

/** Идущий ответ с вызовами в разных состояниях, затем «Стоп». `serverSaidStopped` — итог «stopped» пришёл раньше, чем «Стоп» дошёл до экрана. */
async function stopWithCalls(options: { serverSaidStopped?: boolean } = {}) {
  const server = fakeChatServer({ history: [question], running: true, resumable: true });
  const { result } = renderChatHook(server);
  await waitFor(() => expect(server.resumed).toHaveLength(1));
  const stream = server.resumed[0]!;
  stream.push({ type: "start", messageId: "a1" });
  // Готовый вызов.
  stream.push({ type: "tool-input-available", toolCallId: "done", toolName: "lookup", input: {} });
  stream.push({ type: "tool-output-available", toolCallId: "done", output: { ok: true } });
  // Запущенный, результата нет (как «создаются картинки»).
  stream.push({ type: "tool-input-available", toolCallId: "running", toolName: "generate_images", input: { prompt: "кот", count: 3 } });
  // Ждёт подтверждения человека.
  stream.push({ type: "tool-input-available", toolCallId: "asking", toolName: "clear_notes", input: {} });
  stream.push({ type: "tool-approval-request", approvalId: "ap1", toolCallId: "asking" });
  // Вход ещё дописывается.
  stream.push({ type: "tool-input-start", toolCallId: "typing", toolName: "generate_images" });
  await waitFor(() => expect(result.current.messages.at(-1)?.parts.filter((part) => part.type.startsWith("tool-"))).toHaveLength(4));
  if (options.serverSaidStopped) {
    stream.push({ type: "message-metadata", messageMetadata: { status: "stopped" } });
    await waitFor(() => expect(result.current.messages.at(-1)?.metadata?.status).toBe("stopped"));
  }
  await act(async () => {
    await result.current.stop();
  });
  const byId = (id: string) => result.current.messages.at(-1)!.parts.find((part) => (part as { toolCallId?: string }).toolCallId === id) as Record<string, unknown>;
  return { byId, status: result.current.messages.at(-1)?.metadata?.status };
}

describe("useAgentChat: «Стоп» закрывает вызовы без результата, как сервер", () => {
  it("запущенный вызов без результата становится ошибкой с текстом сервера, готовый остаётся как был", async () => {
    const { byId, status } = await stopWithCalls();
    expect(status).toBe("stopped");
    expect(byId("running")).toMatchObject({ state: "output-error", errorText: hangingText });
    expect(byId("done")).toMatchObject({ state: "output-available", output: { ok: true } });
  });

  it("запрос подтверждения без ответа становится отказом с текстом сервера", async () => {
    const { byId } = await stopWithCalls();
    expect(byId("asking")).toMatchObject({ state: "output-denied", approval: { id: "ap1", approved: false, reason: interruptedText } });
  });

  it("вход, который ещё дописывался, сервер не трогает — и экран тоже", async () => {
    const { byId } = await stopWithCalls();
    expect(byId("typing")).toMatchObject({ state: "input-streaming" });
  });

  it("то же, если сервер успел прислать итог «stopped» раньше: вызовы всё равно закрываются", async () => {
    const { byId, status } = await stopWithCalls({ serverSaidStopped: true });
    expect(status).toBe("stopped");
    expect(byId("running")).toMatchObject({ state: "output-error", errorText: hangingText });
    expect(byId("asking")).toMatchObject({ state: "output-denied" });
  });
});
