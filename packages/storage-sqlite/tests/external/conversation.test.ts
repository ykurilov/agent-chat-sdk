import {describe,it,expect} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
import {createSqliteConversationStore} from "../../src/external";
import {createExternalConversationService}from"@ykurilov/agent-chat-core/external";
const d={id:"main",ownerId:"owner",title:"Главный",pinned:true,execution:{kind:"external" as const,id:"external-agent"}};
describe("SQLite external conversations",()=>{
 it("survives restart with queued messages, atomic cursor and receipt identity",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"external-sdk-"));const path=join(dir,"conversation.sqlite");let store=createSqliteConversationStore(path);
 try {const service=createExternalConversationService({store,resolveExecutor:()=>{throw Error("not connected");}});await service.ensureConversation(d);await service.send("owner","main",{clientMessageId:"client:1",text:"Не потерять"});
 const saved=await service.snapshot("owner","main");expect(saved.messages[0]?.delivery).toBe("queued");await service.close();store.close();store=createSqliteConversationStore(path);
 const restored=createExternalConversationService({store,resolveExecutor:()=>{throw Error("not connected");}});
 expect(await restored.snapshot("owner","main")).toEqual(saved);
 await restored.send("owner","main",{clientMessageId:"client:1",text:"Не потерять"});expect((await restored.snapshot("owner","main")).messages).toHaveLength(1);
 await expect(restored.send("owner","main",{clientMessageId:"client:1",text:"Другой текст"})).rejects.toThrow("conflict");await restored.close();
 } finally {store.close();rmSync(dir,{recursive:true,force:true});}
 });
 it("rolls back projection and feed together; keeps per-chat settings and pinned sort",async()=>{
 const store=createSqliteConversationStore(":memory:");try{await store.create(d);await store.create({...d,id:"second",pinned:false,execution:{kind:"model",id:"builtin"},modelChoice:{modelId:"deepseek",providerId:"deepseek",reasoning:"max"}});
 const before=await store.read("owner","main");await expect(store.transaction("owner","main",s=>{s.cursor=99;s.connection="thinking";throw Error("disk simulation");})).rejects.toThrow();expect(await store.read("owner","main")).toEqual(before);
 const list=await store.list("owner");expect(list.map(c=>c.id)).toEqual(["main","second"]);expect(list[1]?.modelChoice?.reasoning).toBe("max");await expect(store.read("alien","main")).rejects.toThrow("not_found");
 }finally{store.close();}
 });
});

describe("permission projection persistence",()=>{
 it("restores first position and actual source answer after SQLite reopen",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"permission-projection-"));const path=join(dir,"state.sqlite");let store=createSqliteConversationStore(path);
  let sink:(event:import("@ykurilov/agent-chat-core/external").ExternalConversationEvent)=>Promise<void>=async()=>{};
  let service=createExternalConversationService({store,resolveExecutor:()=>({status:()=>"idle",send:async()=>{},stopTurn:async()=>{},respondToPermission:async()=>{},onConversation:f=>{sink=f;return()=>{};},reconcile:async()=>{await sink({type:"permissions_snapshot",requests:[]});}})});
  try{
   await service.ensureConversation(d);await service.start("owner","main");
   await sink({type:"permission_requested",request:{id:"p",name:"Read",kind:"tool",createdAt:"2026-10-26T10:00:00.000Z"}});
   await sink({type:"permission_resolved",requestId:"p",decision:{behavior:"allow",selectedActionId:"once",updatedInput:{path:"/dummy"}}});
   const before=await service.snapshot("owner","main");expect(before.permissions[0]).toMatchObject({sequence:1,resolution:{behavior:"allow"}});
   await service.close();store.close();store=createSqliteConversationStore(path);
   service=createExternalConversationService({store,resolveExecutor:()=>{throw Error("offline");}});
   expect(await service.snapshot("owner","main")).toEqual(before);
  }finally{await service.close();store.close();rmSync(dir,{recursive:true,force:true});}
 });
});
