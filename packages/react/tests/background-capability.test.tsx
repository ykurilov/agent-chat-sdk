// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { fakeChatServer } from "./support/fake-chat-server";
import { renderChatHook, setupChatDom } from "./support/chat-dom";
setupChatDom();

it("retains an explicit absence of background tasks across a branch response without the marker", async () => {
  const server = fakeChatServer();
  server.state.backgroundTasks = false;
  server.state.branchTo.a1 = { messages: [], forks: [] };
  const { result } = renderChatHook(server);
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.backgroundTasksAvailable).toBe(false);
  await act(async () => { expect(await result.current.selectBranch("a1")).toBe(true); });
  expect(result.current.backgroundTasksAvailable).toBe(false);
});

it("keeps the legacy probe for an unknown server and does not transfer a negative marker to another chat", async () => {
  const server = fakeChatServer();
  server.state.backgroundTasks = false;
  const { result, rerender } = renderChatHook(server);
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.backgroundTasksAvailable).toBe(false);
  server.state.backgroundTasks = undefined;
  rerender({ chatId: "c2" });
  await waitFor(() => expect(server.requestsTo("history").length).toBeGreaterThan(1));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.backgroundTasksAvailable).toBe(true);
});

it("accepts a new explicit true after false instead of treating absence as a new capability", async () => {
  const server = fakeChatServer();
  server.state.backgroundTasks = false;
  server.state.branchTo.a1 = { messages: [], forks: [] };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await server.fetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (url.endsWith("/branch")) return Response.json({ ...await response.json(), backgroundTasks: true });
    return response;
  };
  const { result } = renderChatHook(server, { fetch });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  expect(result.current.backgroundTasksAvailable).toBe(false);
  await act(async () => { expect(await result.current.selectBranch("a1")).toBe(true); });
  expect(result.current.backgroundTasksAvailable).toBe(true);
});
