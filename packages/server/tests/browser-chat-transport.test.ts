import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { createBrowserChatTransport } from "../../react/src/browser-chat/index";
import type { BrowserChatSnapshot } from "../../react/src/browser-chat/types";
import { browserChatView } from "../../react/src/browser-chat/view";
import { createBrowserChatHandler } from "../src/browser-chat/index";
import { catalogWithModel, mockEnv, mockModelId, usage } from "./support/mock-catalog";

const text = (snapshot: BrowserChatSnapshot) => browserChatView(snapshot).then(history => history.messages.flatMap(row => row.parts.flatMap(part => part.type === "text" ? [part.text] : [])).join("|"));
function setup(slow = false) {
  let calls = 0, aborted = 0;
  const billed: Array<{ estimated?: boolean; aborted: boolean }> = [];
  const model = new MockLanguageModelV4({ doStream: async input => {
    calls++;
    const stream = new ReadableStream<LanguageModelV4StreamPart>({ start(out) {
      out.enqueue({ type: "stream-start", warnings: [] }); out.enqueue({ type: "text-start", id: "t" });
      out.enqueue({ type: "text-delta", id: "t", delta: "Visible prefix" });
      if (slow && calls === 1) input.abortSignal?.addEventListener("abort", () => { aborted++; try { out.error(new DOMException("Aborted", "AbortError")); } catch {} }, { once: true });
      else { out.enqueue({ type: "text-end", id: "t" }); out.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }); out.close(); }
    } });
    return { stream };
  } });
  const handler = createBrowserChatHandler({ namespace: "transport-test", snapshotKey: new Uint8Array(32).fill(8), checkpointIntervalMs: 10,
    resolveUser: async () => ({ id: "owner" }), configure: () => ({ catalog: catalogWithModel(model), agent: { instructions: "Server only" }, env: mockEnv, defaultChoice: { modelId: mockModelId, providerId: "mock" }, onUsage: async (usage, signal) => { billed.push({ estimated: usage.estimated, aborted: signal.aborted }); } }) });
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => { requests.push(String(input)); return handler.fetch(new Request(String(input), init)); };
  let saved: BrowserChatSnapshot | null = null;
  const make = (save = async (snapshot: BrowserChatSnapshot) => { saved = structuredClone(snapshot); }) => createBrowserChatTransport({ endpoint: "http://test/browser", ownerId: "owner", chatId: "local", fetch, loadSnapshot: () => saved, saveSnapshot: save });
  const transport = make();
  const request = (action = "", init?: RequestInit) => transport.chatProps.transport!.fetch(`${transport.chatProps.api}/local${action && "/" + action}`, init);
  const send = (id: string, value: string) => request("messages", { method: "POST", body: JSON.stringify({ message: { id, role: "user", parts: [{ type: "text", text: value }] } }) });
  return { handler, transport, request, send, make, requests, billed, saved: () => saved, calls: () => calls, aborted: () => aborted };
}

describe("browser-owned transport and isolated handler", () => {
  it("saves every displayed checkpoint first, survives reload without server history, and continues", async () => {
    const s = setup(); await s.request();
    const response = await s.send("u1", "Question");
    const reader = response.body!.getReader(); let body = "";
    for (;;) { const next = await reader.read(); if (next.done) break; const value = new TextDecoder().decode(next.value); if (value.includes("text-delta")) expect(await text(s.saved()!)).toContain("Visible prefix"); body += value; }
    expect(body).toContain("Visible prefix"); expect(s.saved()?.pending).toBeUndefined();
    s.transport.dispose();
    const restored = s.make(); const fetch = restored.chatProps.transport!.fetch, api = restored.chatProps.api;
    const history = await (await fetch(`${api}/local`)).json(); expect(history.messages).toHaveLength(2); expect(history.running).toBe(false);
    const next = await fetch(`${api}/local/messages`, { method: "POST", body: JSON.stringify({ message: { id: "u2", role: "user", parts: [{ type: "text", text: "Next" }] } }) });
    await next.text(); expect(s.calls()).toBe(2); expect(await text(s.saved()!)).toContain("Next");
    expect(s.requests.every(url => url === "http://test/browser")).toBe(true); expect(s.handler.activeRequests).toBe(0);
    restored.dispose(); await s.handler.close();
  });
  it("Stop aborts transient execution and restores the already visible prefix after reload", async () => {
    const s = setup(true); const response = await s.send("u1", "Question"); const reader = response.body!.getReader();
    let seen = "";
    while (!seen.includes("text-delta")) seen += new TextDecoder().decode((await reader.read()).value);
    expect(await text(s.saved()!)).toContain("Visible prefix");
    expect((await s.request("stop", { method: "POST" })).status).toBe(204);
    await vi.waitFor(() => expect(s.handler.activeRequests).toBe(0)); expect(s.aborted()).toBe(1);
    expect(s.billed.length).toBeGreaterThan(0); expect(s.billed.every(row => !row.aborted)).toBe(true); expect(s.billed.some(row => row.estimated)).toBe(true);
    s.transport.dispose(); const restored = s.make();
    const history = await (await restored.chatProps.transport!.fetch(`${restored.chatProps.api}/local`)).json();
    expect(history.running).toBe(false); expect(history.messages.at(-1).metadata.status).toBe("interrupted");
    expect(history.messages.at(-1).parts.some((p: { text?: string }) => p.text?.includes("Visible prefix"))).toBe(true);
    const retried = await restored.chatProps.transport!.fetch(`${restored.chatProps.api}/local/retry`, { method: "POST" });
    expect(retried.status).toBe(200); await retried.text(); expect(s.calls()).toBe(2);
    expect(s.billed).toHaveLength(2); // Stop + new provider call, never bill historical recovery again.
    expect(await text(s.saved()!)).toContain("Visible prefix");
    restored.dispose(); await s.handler.close();
  });
  it("does not expose provider text when the local transaction fails, and cancels the server", async () => {
    const s = setup(true); await s.request(); s.transport.dispose();
    const transport = s.make(async snapshot => { if ((await text(snapshot)).includes("Visible prefix")) throw Error("disk full"); });
    const response = await transport.chatProps.transport!.fetch(`${transport.chatProps.api}/local/messages`, { method: "POST", body: JSON.stringify({ message: { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] } }) });
    let seen = ""; try { const reader = response.body!.getReader(); for (;;) { const value = await reader.read(); if (value.done) break; seen += new TextDecoder().decode(value.value); } } catch {}
    expect(seen).not.toContain("text-delta"); await vi.waitFor(() => expect(s.handler.activeRequests).toBe(0));
    expect(s.aborted()).toBe(1); transport.dispose(); await s.handler.close();
  });
  it("preserves the pending outgoing text if the network fails before its first checkpoint", async () => {
    const view = { chat: { id: "local" }, capabilities: {}, messages: [], forks: [], compactions: [], running: false };
    let saved: BrowserChatSnapshot = { version: 1, ownerId: "owner", chatId: "local", sealed: "opaque", view: gzipSync(JSON.stringify(view)).toString("base64") };
    const transport = createBrowserChatTransport({ endpoint: "http://test/browser", ownerId: "owner", chatId: "local", loadSnapshot: () => saved, saveSnapshot: async next => { saved = next; }, fetch: async () => { throw Error("offline"); } });
    const result = await transport.chatProps.transport!.fetch(`${transport.chatProps.api}/local/messages`, { method: "POST", body: JSON.stringify({ message: { id: "u1", role: "user", parts: [{ type: "text", text: "Unacknowledged" }] } }) });
    expect(result.status).toBe(500); expect(saved.pending?.[0]?.text).toBe("Unacknowledged");
    const history = await (await transport.chatProps.transport!.fetch(`${transport.chatProps.api}/local`)).json(); expect(history.messages[0].parts[0].text).toBe("Unacknowledged");
    expect(history.messages.at(-1).metadata.status).toBe("interrupted"); transport.dispose();
  });
  it("retries a failed initial bootstrap instead of permanently caching its rejected promise", async () => {
    const s = setup(); let offline = true;
    const transport = createBrowserChatTransport({ endpoint: "http://test/browser", ownerId: "owner", chatId: "local", loadSnapshot: () => null, saveSnapshot: async () => {}, fetch: async (input, init) => { if (offline) throw Error("offline"); return s.handler.fetch(new Request(String(input), init)); } });
    const url = `${transport.chatProps.api}/local`;
    expect((await transport.chatProps.transport!.fetch(url)).status).toBe(500); offline = false;
    expect((await transport.chatProps.transport!.fetch(url)).status).toBe(200);
    transport.dispose(); s.transport.dispose(); await s.handler.close();
  });

});
