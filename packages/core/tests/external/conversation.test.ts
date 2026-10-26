import { describe, expect, it, vi } from "vitest";
import { createMemoryConversationStore, createExternalConversationService } from "../../src/external";
import type { ExternalConversationEvent, ExternalExecutor } from "../../src/external";

function fixture() {
  const store = createMemoryConversationStore();
  let sink: (event: ExternalConversationEvent) => Promise<void> = async () => {};
  let status: "idle" | "offline" | "thinking" = "idle";
  const sent: string[] = [];
  let failSend = false;
  const remote: Array<{id:string; role:"user"; text:string; createdAt:string}> = [];
  const executor: ExternalExecutor = {
    status: () => status,
    onConversation: listener => { sink = listener; return () => {}; },
    async reconcile() { for (const message of remote) await sink({ type: "message", message }); await sink({type:"permissions_snapshot", requests:[]}); await sink({type:"status",manager:status}); },
    async send(text,id) { sent.push(id); remote.push({id,role:"user",text,createdAt:new Date().toISOString()}); if(failSend) throw Error("ack lost"); await sink({type:"message",message:remote.at(-1)!}); },
    async stopTurn() { await sink({type:"turn_ended",outcome:"canceled"}); },
    async respondToPermission() {},
  };
  const service = createExternalConversationService({store,resolveExecutor:()=>executor});
  return {store,service,executor,sent,emit:(event:ExternalConversationEvent)=>sink(event),offline:()=>{status="offline";},online:()=>{status="idle";},loseAck:()=>{failSend=true;}};
}
const definition = {id:"main",ownerId:"yuri",title:"Главный",pinned:true,execution:{kind:"external" as const,id:"manager"}};

describe("external conversation",()=>{
  it("offline send is durable, duplicate has one receipt, recovery dispatches once",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);f.offline();await f.service.start("yuri","main");
    await f.service.send("yuri","main",{clientMessageId:"client:1",text:"Привет"});
    await f.service.send("yuri","main",{clientMessageId:"client:1",text:"Привет"});
    expect((await f.service.snapshot("yuri","main")).messages).toHaveLength(1);expect(f.sent).toEqual([]);
    f.online();await f.service.reconcile("yuri","main");expect(f.sent).toEqual(["client:1"]);
    expect((await f.service.snapshot("yuri","main")).messages[0]?.delivery).toBe("sent");await f.service.close();
  });
  it("lost send acknowledgement is reconciled by client id, never blindly resent",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");f.loseAck();
    await f.service.send("yuri","main",{clientMessageId:"client:1",text:"Оплата"});await f.service.reconcile("yuri","main");
    expect(f.sent).toEqual(["client:1"]);expect((await f.service.snapshot("yuri","main")).messages).toHaveLength(1);await f.service.close();
  });
  it("external message import never sends; cumulative deltas are not concatenated",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    await f.emit({type:"message",message:{id:"outside",role:"user",text:"Извне",createdAt:"2026-10-26T00:00:00Z"}});
    await f.emit({type:"turn_started"});await f.emit({type:"delta",id:"answer",textSoFar:"Пр"});await f.emit({type:"delta",id:"answer",textSoFar:"Привет"});
    expect(f.sent).toEqual([]);expect((await f.service.snapshot("yuri","main")).messages.at(-1)?.text).toBe("Привет");
    await f.service.stop("yuri","main","stop:1");expect((await f.service.snapshot("yuri","main")).turn.status).toBe("stopped");await f.service.close();
  });
  it("cursor replays committed revisions, snapshot cursor is consistent, alien owner denied",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");const before=await f.service.snapshot("yuri","main");
    await f.emit({type:"message",message:{id:"x",role:"user",text:"Один",createdAt:"2026-10-26T00:00:00Z"}});
    const page=await f.service.events("yuri","main",before.cursor);expect(page.events.some(e=>e.type==="message")).toBe(true);
    const after=await f.service.snapshot("yuri","main");expect((await f.service.events("yuri","main",after.cursor)).events).toEqual([]);
    await expect(f.service.snapshot("other","main")).rejects.toThrow(/not_found/);await f.service.close();
  });
  it("rebuilt repeated identical human messages preserve multiplicity and add aliases",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    for(const id of ["a","b"])await f.emit({type:"message",message:{id,role:"user",text:"Да",createdAt:"2026-10-26T00:00:00Z"}});
    await f.emit({type:"history_reset",epoch:"second"});
    for(const id of ["new-a","new-b"])await f.emit({type:"message",rebuilt:true,message:{id,role:"user",text:"Да",createdAt:"2026-10-26T00:00:00Z"}});
    expect((await f.service.snapshot("yuri","main")).messages).toHaveLength(2);await f.service.close();
  });
});

describe("external permission and ownership boundaries",()=>{
  it("records a decision once, preserves original question input, serializes concurrent retries",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    await f.emit({type:"permission_requested",request:{id:"p",name:"AskUserQuestion",kind:"question",input:{questions:[{question:"Куда?",options:[{label:"Домой"}]}]}}});
    let calls=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    const replies:unknown[]=[];f.executor.respondToPermission=async(_id,response)=>{calls++;replies.push(response);await gate;};
    const first=f.service.answerPermission("yuri","main","p","cmd",{answers:{"Куда?":"Домой"}});
    await vi.waitFor(()=>expect(calls).toBe(1));
    const second=f.service.answerPermission("yuri","main","p","cmd",{answers:{"Куда?":"Домой"}});
    await Promise.resolve();release();await Promise.all([first,second]);
    expect(calls).toBe(1);expect(replies[0]).toEqual({behavior:"allow",updatedInput:{questions:[{question:"Куда?",options:[{label:"Домой"}]}],answers:{"Куда?":"Домой"}}});
    expect((await f.service.snapshot("yuri","main")).permissions[0]?.status).toBe("responding");
    await f.emit({type:"permission_resolved",requestId:"p"});expect((await f.service.snapshot("yuri","main")).permissions[0]?.status).toBe("resolved");await f.service.close();
  });
  it("refuses a second copy before it subscribes and permits takeover after close",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    const other=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor});
    await expect(other.start("yuri","main")).rejects.toThrow("busy");
    await f.service.close();await other.start("yuri","main");await other.close();
  });
  it("failed durable ingestion rejects source acknowledgement and writes no cursor",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    await f.service.send("yuri","main",{clientMessageId:"local",text:"Сохранённый текст"});await f.service.reconcile("yuri","main");
    const before=await f.service.snapshot("yuri","main");
    await expect(f.emit({type:"message",message:{id:"local",role:"user",text:"Подмена",createdAt:new Date().toISOString()}})).rejects.toThrow("identity_conflict");
    expect(await f.service.snapshot("yuri","main")).toEqual(before);await f.service.close();
  });
});

it("an expired sender cannot overwrite the new owner's reconciliation",async()=>{
  const store=createMemoryConversationStore();let time=0;let release!:()=>void;let entered=false;
  let sink:(e:ExternalConversationEvent)=>Promise<void>=async()=>{};
  const slow:ExternalExecutor={status:()=>"idle",onConversation:listener=>{sink=listener;return()=>{};},reconcile:async()=>{},send:async()=>{entered=true;await new Promise<void>(r=>{release=r;});},stopTurn:async()=>{},respondToPermission:async()=>{}};
  const first=createExternalConversationService({store,now:()=>time,leaseMs:1000,resolveExecutor:()=>slow});
  await first.ensureConversation(definition);await first.start("yuri","main");await first.send("yuri","main",{clientMessageId:"slow",text:"Один"});
  await vi.waitFor(()=>expect(entered).toBe(true));time=2000;
  const second=createExternalConversationService({store,now:()=>time,leaseMs:1000,resolveExecutor:()=>({...slow,send:async()=>{throw Error("must not resend ambiguous submission");}})});
  await second.start("yuri","main");
  await sink({type:"message",message:{id:"slow",role:"user",text:"Один",createdAt:"2026-10-26T00:00:00Z"}});
  release();await Promise.resolve();await Promise.resolve();
  expect((await second.snapshot("yuri","main")).messages[0]?.delivery).toBe("sent");
  await first.close();await second.close();
});

it("keeps offline startup subscribed and sends only after a successful reconciliation",async()=>{
  const f=fixture();await f.service.ensureConversation(definition);
  let unavailable=true;
  const original=f.executor.reconcile;
  f.executor.reconcile=async()=>{if(unavailable)throw Error("bridge unavailable");await original();};
  await f.service.start("yuri","main");
  await f.service.send("yuri","main",{clientMessageId:"offline-start",text:"Сохранить"});
  await Promise.resolve();expect(f.sent).toEqual([]);
  unavailable=false;await f.service.reconcile("yuri","main");expect(f.sent).toEqual(["offline-start"]);await f.service.close();
});

it("close joins an in-flight start and prevents a late resolver from claiming",async()=>{
  const store=createMemoryConversationStore();const f=fixture();let release!:(e:ExternalExecutor)=>void;
  const gate=new Promise<ExternalExecutor>(resolve=>{release=resolve;});
  const service=createExternalConversationService({store,resolveExecutor:()=>gate});await service.ensureConversation(definition);
  const starting=service.start("yuri","main");const outcome=starting.catch(e=>e.message);await Promise.resolve();await Promise.resolve();
  const closing=service.close();release(f.executor);await closing;
  expect(await outcome).toBe("service_closed");expect((await store.read("yuri","main")).lease).toBeUndefined();
});
it("authoritative status recovers an active turn and marks a missed ending unknown",async()=>{
  const f=fixture();await f.service.ensureConversation(definition);
  f.executor.status=()=>"thinking";await f.service.start("yuri","main");
  expect((await f.service.snapshot("yuri","main")).turn.status).toBe("running");
  // No synthetic completed: the end outcome was missed while disconnected.
  f.executor.status=()=>"idle";await f.service.reconcile("yuri","main");
  expect((await f.service.snapshot("yuri","main")).turn.status).toBe("unknown");await f.service.close();
});

it("a reconcile timeout never admits a second physical replay over the first",async()=>{
  const f=fixture();let calls=0;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const service=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor,commandTimeoutMs:20,pollMs:30_000});
  f.executor.reconcile=async()=>{
    calls++;
    if(calls===1){await gate;await f.emit({type:"permissions_snapshot",requests:[]});}
    else {await f.emit({type:"permissions_snapshot",requests:[{id:"fresh",name:"Read",kind:"tool"}]});}
  };
  try {
    await service.ensureConversation(definition);await service.start("yuri","main");
    await expect(service.reconcile("yuri","main")).rejects.toThrow("executor_timeout");expect(calls).toBe(1);
    release();await new Promise(resolve=>setTimeout(resolve,0));
    await service.reconcile("yuri","main");expect(calls).toBe(2);
    expect((await service.snapshot("yuri","main")).permissions.find(p=>p.id==="fresh")?.status).toBe("open");
  }finally{release();await service.close();}
});

it("close does not wait for a timed-out source replay and rejects its late callback",async()=>{
  const f=fixture();f.executor.reconcile=()=>new Promise<void>(()=>{});
  const service=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor,commandTimeoutMs:10});
  await service.ensureConversation(definition);await service.start("yuri","main");
  await service.close();const before=await service.snapshot("yuri","main");
  await expect(f.emit({type:"permission_requested",request:{id:"late",name:"Read",kind:"tool"}})).rejects.toThrow("lease_lost");
  expect(await service.snapshot("yuri","main")).toEqual(before);
});

it("a late old replay finishing inside retry is only a barrier, never the fresh snapshot",async()=>{
  const f=fixture();let calls=0;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const service=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor,commandTimeoutMs:30,pollMs:30_000});
  f.executor.reconcile=async()=>{
    calls++;if(calls===1){await gate;await f.emit({type:"permissions_snapshot",requests:[]});}
    else await f.emit({type:"permissions_snapshot",requests:[{id:"fresh",name:"Read",kind:"tool"}]});
  };
  try{
    await service.ensureConversation(definition);await service.start("yuri","main");
    const retry=service.reconcile("yuri","main");release();await retry;
    expect(calls).toBe(2);expect((await service.snapshot("yuri","main")).permissions.find(p=>p.id==="fresh")?.status).toBe("open");
  }finally{release();await service.close();}
});

it("incomplete question answers are refused without consuming the open permission",async()=>{
  const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
  await f.emit({type:"permission_requested",request:{id:"question",name:"AskUserQuestion",kind:"tool",input:{questions:[{question:"Куда?"}]}}});
  try{
    await expect(f.service.answerPermission("yuri","main","question","bad:1",{answers:{}})).rejects.toThrow("invalid_permission");
    await expect(f.service.answerPermission("yuri","main","question","bad:2",{behavior:"allow"})).rejects.toThrow("invalid_permission");
    expect((await f.service.snapshot("yuri","main")).permissions[0]?.status).toBe("open");
  }finally{await f.service.close();}
});

it("a retry waiting on old replay cannot start a fresh source call after close",async()=>{
  const f=fixture();let calls=0;let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const service=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor,commandTimeoutMs:30,pollMs:30_000});
  f.executor.reconcile=async()=>{calls++;await f.emit({type:"permissions_snapshot",requests:[]});if(calls===1)await gate;};
  await service.ensureConversation(definition);await service.start("yuri","main");
  const retry=service.reconcile("yuri","main");const outcome=retry.catch(e=>e.message);
  await service.close();release();await outcome;expect(calls).toBe(1);
});
it("an allow action cannot bypass answers on a question permission",async()=>{
  const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
  await f.emit({type:"permission_requested",request:{id:"q",name:"AskUserQuestion",kind:"tool",input:{questions:[{question:"Куда?"}]},actions:[{id:"allow",label:"Да",behavior:"allow"},{id:"deny",label:"Нет",behavior:"deny"}]}});
  const responses:unknown[]=[];f.executor.respondToPermission=async(_id,response)=>{responses.push(response);};
  try{await expect(f.service.answerPermission("yuri","main","q","bypass",{actionId:"allow"})).rejects.toThrow("invalid_permission");expect((await f.service.snapshot("yuri","main")).permissions[0]?.status).toBe("open");expect(responses).toEqual([]);await f.service.answerPermission("yuri","main","q","deny",{actionId:"deny"});expect(responses).toEqual([{behavior:"deny",selectedActionId:"deny"}]);}finally{await f.service.close();}
});

it("a stable id in a rebuilt epoch still consumes its one-to-one match",async()=>{
  const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
  try{
    for(const id of ["a","b"])await f.emit({type:"message",message:{id,role:"manager",text:"Повтор",createdAt:"2026-10-26T00:00:00Z"}});
    await f.emit({type:"history_reset",epoch:"next"});
    for(const id of ["a","new-b"])await f.emit({type:"message",rebuilt:true,message:{id,role:"manager",text:"Повтор",createdAt:"2026-10-26T00:00:00Z"}});
    const snapshot=await f.service.snapshot("yuri","main");
    expect(snapshot.messages.find(m=>m.id==="b")?.aliases.some(x=>x.id==="new-b")).toBe(true);
    await f.emit({type:"delta",id:"new-b",textSoFar:"Повтор с продолжением"});
    const after=await f.service.snapshot("yuri","main");expect(after.messages.find(m=>m.id==="a")?.text).toBe("Повтор");expect(after.messages.find(m=>m.id==="b")?.text).toBe("Повтор с продолжением");
  }finally{await f.service.close();}
});

describe("native timeline metadata and replay",()=>{
  it("keeps first position and time, actual external resolution and intent distinct",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    try {
      await f.emit({type:"delta",id:"a",textSoFar:"Перед вопросом"});
      await f.emit({type:"permission_requested",request:{id:"p",name:"Read",kind:"tool"}});
      await f.emit({type:"delta",id:"b",textSoFar:"После вопроса"});
      const before=await f.service.snapshot("yuri","main");
      const p=before.permissions[0] as any;
      expect(Date.parse(p.createdAt)).not.toBeNaN();
      expect((before.messages[0] as any).sequence).toBeLessThan(p.sequence);
      expect(p.sequence).toBeLessThan((before.messages[1] as any).sequence);
      await f.emit({type:"permission_requested",request:{id:"p",name:"Read",kind:"tool"}});
      await f.emit({type:"permission_resolved",requestId:"p",decision:{behavior:"deny",selectedActionId:"no",message:"Не сейчас"}} as any);
      const after=(await f.service.snapshot("yuri","main")).permissions[0] as any;
      expect(after).toMatchObject({sequence:p.sequence,createdAt:p.createdAt,status:"resolved",resolution:{behavior:"deny",selectedActionId:"no",message:"Не сейчас"}});
      expect(after.decision).toBeUndefined();
      const cursor=(await f.service.snapshot("yuri","main")).cursor;
      await f.emit({type:"permission_resolved",requestId:"p",decision:{behavior:"deny",selectedActionId:"no",message:"Не сейчас"}} as any);
      expect((await f.service.snapshot("yuri","main")).cursor).toBe(cursor);
      await f.emit({type:"permission_requested",request:{id:"unknown",name:"Read",kind:"tool"}});
      await f.emit({type:"permissions_snapshot",requests:[]});
      expect((await f.service.snapshot("yuri","main")).permissions.at(-1)).toMatchObject({status:"resolved"});
      expect(((await f.service.snapshot("yuri","main")).permissions.at(-1) as any).resolution).toBeUndefined();
    }finally{await f.service.close();}
  });
  it("replay and late deltas do not turn a stopped answer into complete or streaming",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    try{
      await f.emit({type:"turn_started"});await f.emit({type:"delta",id:"a",textSoFar:"Часть ответа"});
      await f.emit({type:"turn_ended",outcome:"canceled"});
      await f.emit({type:"delta",id:"a",textSoFar:"Часть ответа"});
      expect((await f.service.snapshot("yuri","main")).messages[0]?.status).toBe("stopped");
      await f.emit({type:"message",message:{id:"a",role:"assistant",text:"Часть ответа",createdAt:"2026-10-26T00:00:00Z"}});
      expect((await f.service.snapshot("yuri","main")).messages[0]?.status).toBe("stopped");
    }finally{await f.service.close();}
  });
  it("same status does not create repeated identical journal entries",async()=>{
    const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
    const other=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor});
    try{
      await f.emit({type:"turn_ended",outcome:"completed"});const first=await f.service.snapshot("yuri","main");
      await f.emit({type:"turn_ended",outcome:"completed"});
      expect((await f.service.snapshot("yuri","main")).cursor).toBe(first.cursor);

    }finally{await other.close();await f.service.close();}
  });
});

it("another service exposes machine-readable ownership busy code",async()=>{
 const f=fixture();await f.service.ensureConversation(definition);await f.service.start("yuri","main");
 const other=createExternalConversationService({store:f.store,resolveExecutor:()=>f.executor});
 try{await expect(other.start("yuri","main")).rejects.toMatchObject({code:"external_conversation_busy"});}
 finally{await other.close();await f.service.close();}
});
