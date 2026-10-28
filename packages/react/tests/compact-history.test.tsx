// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppEventReport } from "../src/app-events";
import { useAgentChat } from "../src/use-agent-chat";
import type { AgentChatMessage } from "../src/chat-types";
import type { HistoryView } from "../src/history-view";
afterEach(cleanup);
const view = (branch = "B", olderCursor: string | null = "a2"): HistoryView => ({ mode: "compact", branch, olderCursor, headMessageId: "a2", totals: { messages: 8, assistantAnswers: 4 }, stateBefore: { phase: "saved" } });
const answer = (id: string): AgentChatMessage => ({ id, role: "assistant", metadata: { status: "complete", historyRevision:"MR", historyDetails: { 0: { type: "reasoning", revision: "R" } } }, parts: [{ type: "reasoning", text: "", state: "done" },{type:"text",text:id}] });
const history = (messages = [answer("a2")], v = view()) => ({ chat: { id: "c1" }, messages, historyView: v, running: false, compactions: [], forks: [] });
function setup(options: { detail?: () => Promise<Response>; older?: () => Promise<Response> } = {}) {
  const requests: string[] = []; let branch = "B";
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://test.local"); requests.push(url.pathname+url.search);
    if (url.pathname.endsWith("/watch")) return new Response(null,{status:204});
    if (url.pathname.endsWith("/history-part")) return options.detail ? options.detail() : Response.json({ branch, messageId:"a2",partIndex:0,revision:"R",part:{type:"reasoning",text:"Full reasoning",state:"done"} });
    if (url.pathname.endsWith("/history-message")) return Response.json({branch,messageId:"a2",revision:"MR",message:{...answer("a2"),metadata:{status:"complete"},parts:[{type:"reasoning",text:"Full editor reasoning",state:"done"},{type:"text",text:"a2"}]}});
    if (url.pathname.endsWith("/branch")) { branch = "C"; return Response.json(history([answer("a3")],view("C",null))); }
    if (url.searchParams.has("before") && options.older) return options.older();
    if (url.searchParams.has("before")) return Response.json(history([answer("a0"),answer("a1")],view(branch,null)));
    if (url.pathname.endsWith("/compactions")) return Response.json({ compactions:[] });
    return Response.json(history([answer(branch === "B" ? "a2" : "a3")],view(branch)));
  }) as typeof fetch;
  const hook = renderHook(({ chatId, reloadKey }) => useAgentChat({ api:"/api/chat",chatId,history:"compact",fetch:fetcher,reloadKey }),{initialProps:{chatId:"c1",reloadKey:0}});
  return {...hook,requests};
}
it("initial page preserves branch facts/state; pagination is not live and retains existing messages", async () => {
  const {result,requests}=setup(); await waitFor(()=>expect(result.current.loaded).toBe(true));
  expect(requests[0]).toContain("history=compact"); expect(result.current.chatState).toMatchObject({phase:"saved"});
  expect(result.current.feedChange).toMatchObject({kind:"history",historyComplete:false,view:{totals:{assistantAnswers:4}}});
  await act(async()=>{expect(await result.current.loadOlder()).toBe(true);});
  expect(result.current.messages.map(m=>m.id)).toEqual(["a0","a1","a2"]);
  expect(result.current.feedChange).toMatchObject({kind:"older-page",historyComplete:true});
});
it("details replace only the requested payload and are marked hydration", async()=>{
  const {result}=setup(); await waitFor(()=>expect(result.current.loaded).toBe(true));
  await act(async()=>{expect(await result.current.loadHistoryDetails("a2:0")).toBe(true);});
  expect(result.current.messages[0]!.parts[0]).toMatchObject({text:"Full reasoning"});
  expect(result.current.messages[0]!.id).toBe("a2"); expect(result.current.feedChange.kind).toBe("details");
  expect(result.current.messages[0]!.metadata?.historyDetails?.[0]).toBeUndefined();
});
it("late details after selecting a branch cannot enter the new branch", async()=>{
  let finish!: (response:Response)=>void;
  const detail = new Promise<Response>(resolve=>{finish=resolve;});
  const {result}=setup({detail:()=>detail}); await waitFor(()=>expect(result.current.loaded).toBe(true));
  let pending!:Promise<boolean>; act(()=>{pending=result.current.loadHistoryDetails("a2:0");});
  await act(async()=>{expect(await result.current.selectBranch("a3")).toBe(true);});
  await act(async()=>{finish(Response.json({branch:"B",messageId:"a2",partIndex:0,revision:"R",part:{type:"reasoning",text:"Old secret",state:"done"}}));expect(await pending).toBe(false);});
  expect(result.current.messages.map(m=>m.id)).toEqual(["a3"]); expect(JSON.stringify(result.current.messages)).not.toContain("Old secret");
  expect(result.current.feedChange.kind).toBe("branch");
});
it("late details after changing chat are ignored", async()=>{
  let finish!: (response:Response)=>void; const detail = new Promise<Response>(resolve=>{finish=resolve;});
  const {result,rerender}=setup({detail:()=>detail}); await waitFor(()=>expect(result.current.loaded).toBe(true));
  let pending!:Promise<boolean>; act(()=>{pending=result.current.loadHistoryDetails("a2:0");});
  rerender({chatId:"c2",reloadKey:0}); await waitFor(()=>expect(result.current.loaded).toBe(true));
  await act(async()=>{finish(Response.json({branch:"B",messageId:"a2",partIndex:0,revision:"R",part:{type:"reasoning",text:"Old chat",state:"done"}}));expect(await pending).toBe(false);});
  expect(JSON.stringify(result.current.messages)).not.toContain("Old chat");
});

it("failed details stay local and retry succeeds without replacing history",async()=>{
 let attempts=0;const {result}=setup({detail:async()=>++attempts===1?new Response(null,{status:503}):Response.json({branch:"B",messageId:"a2",partIndex:0,revision:"R",part:{type:"reasoning",text:"Retry success",state:"done"}})});
 await waitFor(()=>expect(result.current.loaded).toBe(true));
 await act(async()=>{expect(await result.current.loadHistoryDetails("a2:0")).toBe(false);});
 expect(result.current.historyDetailStates["a2:0"]).toBe("error");expect(result.current.messages).toHaveLength(1);
 await act(async()=>{expect(await result.current.loadHistoryDetails("a2:0")).toBe(true);});
 expect(result.current.historyDetailStates["a2:0"]).toBeUndefined();expect(result.current.messages[0]!.parts[0]).toMatchObject({text:"Retry success"});
});
it("late older page cannot prepend onto a newly selected branch",async()=>{
 let finish!:(value:Response)=>void;const older=new Promise<Response>(resolve=>{finish=resolve;});
 const {result}=setup({older:()=>older});await waitFor(()=>expect(result.current.loaded).toBe(true));
 let pending!:Promise<boolean>;act(()=>{pending=result.current.loadOlder();});
 await act(async()=>{expect(await result.current.selectBranch("a3")).toBe(true);});
 await act(async()=>{finish(Response.json(history([answer("old")],view("B",null))));expect(await pending).toBe(false);});
 expect(result.current.messages.map(m=>m.id)).toEqual(["a3"]);expect(result.current.loadingOlder).toBe(false);
});

it("editors receive the entire message before opening, marked as hydration",async()=>{
 const {result}=setup();await waitFor(()=>expect(result.current.loaded).toBe(true));
 await act(async()=>{expect(await result.current.loadHistoryMessage("a2")).toBe(true);});
 expect(result.current.messages[0]!.metadata?.historyDetails).toBeUndefined();
 expect(result.current.messages[0]!.parts[0]).toMatchObject({text:"Full editor reasoning"});expect(result.current.feedChange.kind).toBe("details");
});

it("hydrating an old page while busy never reports its events as live",()=>{
 const report=vi.fn();const event={type:"build",data:{old:true}};
 const {rerender}=renderHook(({messages,historical})=>useAppEventReport("c",true,true,messages,report,historical),{initialProps:{messages:[] as AgentChatMessage[],historical:false}});
 rerender({messages:[{id:"older",role:"assistant",parts:[{type:"data-app-event",data:event}]}],historical:true});
 expect(report).toHaveBeenCalledExactlyOnceWith(event,{live:false,messageId:"older"});
});
