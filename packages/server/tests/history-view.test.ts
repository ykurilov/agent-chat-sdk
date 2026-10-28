import { describe, expect, it } from "vitest";
import { CURRENT_FORMAT_VERSION } from "@ykurilov/agent-chat-core";
import type { ChatHistory } from "@ykurilov/agent-chat-core";
import { compactHistory, historyPart, historyMessage, HistoryViewConflict, InvalidHistoryView } from "../src/history-view";
import { createTestChat } from "./support/test-chat";

const full = (): ChatHistory => ({ chat: { id: "c1" }, messages: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, role: "assistant", metadata: { status: "complete", thoughtTitles: { "0": "Planning" } }, parts: [
  { type: "reasoning", text: "r".repeat(8000), state: "done" },
  { type: "tool-read_file", toolCallId: `t${i}`, title: "Read", state: "output-available", input: { path: "file.ts" }, output: "o".repeat(18000) },
  { type: "text", text: "Visible answer", state: "done" },
  ...(i === 0 ? [{ type: "data-app-state", data: { set: { phase: "saved" } } }] : []),
] })), forks: [], compactions: [], running: false, detachedAnswer: false, compacting: false } as unknown as ChatHistory);

describe("compact browser history", () => {
  it("2.6MB stays raw; initial page is small and details are exact", () => {
    const raw = full(), before = structuredClone(raw);
    const page = compactHistory(raw, new URLSearchParams());
    expect(Buffer.byteLength(JSON.stringify(raw))).toBeGreaterThan(2_600_000);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(100_000);
    expect(page.messages).toHaveLength(30);
    expect(page.historyView).toMatchObject({ olderCursor: "a70", totals: { messages: 100, assistantAnswers: 100 }, stateBefore: { phase: "saved" } });
    const refs = (page.messages[0]!.metadata as { historyDetails: Record<number, { revision: string }> }).historyDetails;
    const detail = historyPart(raw, new URLSearchParams({ branch: page.historyView.branch, messageId: "a70", partIndex: "1", revision: refs[1]!.revision }));
    expect(detail.part).toEqual(raw.messages[70]!.parts[1]);
    expect(page.messages[0]!.parts[1]).toMatchObject({ type: "tool-read_file", toolCallId: "t70", state: "output-available", title: "Read" });
    expect(raw).toEqual(before);
  });
  it("older pages have no overlap, and refresh through keeps the loaded window", () => {
    const raw = full(), latest = compactHistory(raw, new URLSearchParams());
    const page = compactHistory(raw, new URLSearchParams({ branch: latest.historyView.branch, before: latest.historyView.olderCursor! }));
    expect(page.messages.map(m => m.id)).toEqual(Array.from({ length: 30 }, (_, i) => `a${40+i}`));
    expect(compactHistory(raw, new URLSearchParams({ through: "a40" })).messages).toHaveLength(60);
    expect(() => compactHistory(raw, new URLSearchParams({ limit: "1000" }))).toThrow(InvalidHistoryView);
    expect(() => compactHistory(raw, new URLSearchParams({ before: "foreign" }))).toThrow(HistoryViewConflict);
  });
  it("wrong branch, foreign message and changed payload are rejected", () => {
    const raw = full(), page = compactHistory(raw, new URLSearchParams());
    const refs = (page.messages[0]!.metadata as { historyDetails: Record<number, { revision: string }> }).historyDetails;
    const q = new URLSearchParams({ branch: page.historyView.branch, messageId: "a70", partIndex: "0", revision: refs[0]!.revision });
    const changed = structuredClone(raw); (changed.messages[70]!.parts[0] as { text: string }).text = "new";
    expect(() => historyPart(changed,q)).toThrow(HistoryViewConflict);
    q.set("messageId", "foreign"); expect(() => historyPart(raw,q)).toThrow(HistoryViewConflict);
    q.set("branch", "old"); expect(() => historyPart(raw,q)).toThrow(HistoryViewConflict);
  });
  it("active answers, widgets and helper approval payload remain eager", () => {
    const raw = full(); raw.messages = raw.messages.slice(0,3);
    raw.messages[0]!.metadata!.status = "awaiting_approval";
    raw.messages[1]!.metadata!.status = "streaming";
    raw.messages[2]!.parts = [
      { type: "tool-ask_choice", toolCallId: "widget", state: "output-available", input: { question: "Choose", choices: ["a"] }, output: { answer: "a" } },
      { type: "tool-my_widget", toolCallId: "custom", state: "output-available", input: { question: "Q" }, output: "answer" },
      { type: "tool-helper_plan", toolCallId: "helper", state: "output-available", input: {}, output: { pendingApproval: { approvalId: "p" } } },
    ] as never;
    const page = compactHistory(raw,new URLSearchParams(),["my_widget"]);
    expect(page.messages[0]).toBe(raw.messages[0]); expect(page.messages[1]).toBe(raw.messages[1]);
    expect(page.messages[2]!.parts).toEqual(raw.messages[2]!.parts);
  });
});

it("HTTP details enforce ownership and capability filtering; server and storage stay full", async () => {
  const test = createTestChat(); const id = await test.createChat();
  const parts = full().messages[0]!.parts;
  await test.storage.insertMessage({ id: "answer", chatId: id, parentId: null, role: "assistant", parts, status: "complete", modelId: null, providerId: null, usage: null, error: null, reasoningDurationsMs: {}, formatVersion: CURRENT_FORMAT_VERSION, createdAt: new Date().toISOString() });
  const original = await test.service.getHistory("anna",id);
  const page = await (await test.call("GET",`/${id}?history=compact`)).json() as ReturnType<typeof compactHistory>;
  const refs = (page.messages[0]!.metadata as { historyDetails: Record<number, { revision: string }> }).historyDetails;
  const query = new URLSearchParams({ branch: page.historyView.branch, messageId: "answer", partIndex: "0", revision: refs[0]!.revision });
  expect((await test.call("GET",`/${id}/history-part?${query}`,{user:"boris"})).status).toBe(404);
  expect((await test.call("GET",`/${id}?history=compact`,{user:"boris"})).status).toBe(404);
  expect((await test.call("GET",`/${id}/history-part?${query}`,{user:null})).status).toBe(401);
  const detailResponse = await test.call("GET",`/${id}/history-part?${query}`);
  expect(detailResponse.headers.get("cache-control")).toContain("no-store");
  expect((await detailResponse.json() as {part:unknown}).part).toEqual(original.messages[0]!.parts[0]);
  const messageQuery=new URLSearchParams({branch:page.historyView.branch,messageId:"answer",revision:(page.messages[0]!.metadata as {historyRevision:string}).historyRevision});
  expect((await test.call("GET",`/${id}/history-message?${messageQuery}`,{user:"boris"})).status).toBe(404);
  expect((await(await test.call("GET",`/${id}/history-message?${messageQuery}`)).json() as {message:unknown}).message).toEqual(original.messages[0]);
  expect(await test.service.peekHistory("anna",id)).toEqual(original);
  expect((await test.storage.getMessage("answer"))!.parts).toEqual(parts);
});


it("revoking reasoning/toolDetails blocks previously issued references", async () => {
  let allowed = true;
  const test=createTestChat({chatCapabilities:()=>({reasoning:allowed,toolDetails:allowed})});const id=await test.createChat();
  await test.storage.insertMessage({id:"secret-answer",chatId:id,parentId:null,role:"assistant",parts:full().messages[0]!.parts,status:"complete",modelId:null,providerId:null,usage:null,error:null,reasoningDurationsMs:{},formatVersion:CURRENT_FORMAT_VERSION,createdAt:new Date().toISOString()});
  const page=await(await test.call("GET",`/${id}?history=compact`)).json() as ReturnType<typeof compactHistory>;
  const refs=(page.messages[0]!.metadata as {historyDetails:Record<number,{revision:string}>}).historyDetails;
  allowed=false;
  for(const index of [0,1]){
    const query=new URLSearchParams({branch:page.historyView.branch,messageId:"secret-answer",partIndex:String(index),revision:refs[index]!.revision});
    const response=await test.call("GET",`/${id}/history-part?${query}`);
    expect(response.status).toBe(409);expect(await response.text()).not.toContain("r".repeat(100));
  }
});

it("full-message hydration for editors is revision guarded and remains public", () => {
  const raw=full(), page=compactHistory(raw,new URLSearchParams());
  const revision=(page.messages[0]!.metadata as {historyRevision:string}).historyRevision;
  const query=new URLSearchParams({branch:page.historyView.branch,messageId:"a70",revision});
  expect(historyMessage(raw,query).message).toEqual(raw.messages[70]);
  const changed=structuredClone(raw);changed.messages[70]!.parts.push({type:"text",text:"changed"});
  expect(()=>historyMessage(changed,query)).toThrow(HistoryViewConflict);
  query.set("messageId","foreign");expect(()=>historyMessage(raw,query)).toThrow(HistoryViewConflict);
});
