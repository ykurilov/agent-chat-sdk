import {afterEach,expect,it,vi} from "vitest";
import {createExternalConversationService,createMemoryConversationStore} from "../../src/external";
import type {ExternalExecutor,ExternalConversationEvent,ExternalAttachmentAccess,ExternalModelState} from "../../src/external";
const definition={id:"main",ownerId:"owner",title:"Main",execution:{kind:"external" as const,id:"manager"}};
const file={id:"00000000-0000-4000-8000-000000000001",name:"archive.zip",kind:"file" as const,mediaType:"application/zip",size:4};
const closers:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const close of closers.splice(0))await close();});
async function fixture(){
 const store=createMemoryConversationStore();let sink:(e:ExternalConversationEvent)=>Promise<void>=async()=>{};
 let state:ExternalModelState={revision:"a",models:[{id:"a",label:"A",reasoning:{levels:["off","high"],default:"high"}},{id:"b",label:"B"}],selected:{id:"a",reasoning:"high"},canChange:true};
 const sent:unknown[]=[];const files:ExternalAttachmentAccess={async accept(){return [file];},async confirm(){},async open(){return {...file,readBytes:async()=>new Uint8Array([80,75,3,4])};}};
 const executor:ExternalExecutor={status:()=>"idle",send:async()=>{throw Error("text fallback must not receive attachments");},sendMessage:async input=>{sent.push({text:input.text,id:input.messageId,bytes:await input.attachments[0]?.readBytes()});await sink({type:"message",message:{id:input.messageId,role:"user",text:input.text,createdAt:new Date().toISOString()}});},stopTurn:async()=>{},respondToPermission:async()=>{},onConversation:f=>{sink=f;return()=>{};},reconcile:async()=>{await sink({type:"permissions_snapshot",requests:[]});},models:async()=>state,setModel:async input=>{state={...state,revision:"b",selected:input.choice};await sink({type:"model_state",state});}};
 const service=createExternalConversationService({store,resolveExecutor:()=>executor,attachments:files});closers.push(()=>service.close());await service.ensureConversation(definition);await service.start("owner","main");return {service,store,executor,sent,emit:(e:ExternalConversationEvent)=>sink(e),state:()=>state};
}
it("attachment-only is durable, text-only source replay preserves files, repeated id compares ordered files",async()=>{
 const f=await fixture();await f.service.send("owner","main",{clientMessageId:"client:1",text:"",attachmentIds:[file.id]});
 await vi.waitFor(()=>expect(f.sent).toHaveLength(1));
 let snapshot=await f.service.snapshot("owner","main");expect(snapshot.messages[0]).toMatchObject({text:"",delivery:"sent",attachments:[file]});
 await f.emit({type:"message",message:{id:"client:1",role:"user",text:"",createdAt:new Date().toISOString()}});
 expect((await f.service.snapshot("owner","main")).messages[0]?.attachments).toEqual([file]);
 await expect(f.service.send("owner","main",{clientMessageId:"client:1",text:"",attachmentIds:[]})).rejects.toThrow("message_id_conflict");
 expect(f.sent).toEqual([{text:"",id:"client:1",bytes:new Uint8Array([80,75,3,4])}]);
});
it("attachments never fall through to legacy text send when executor lacks file capability",async()=>{
 const f=await fixture();delete f.executor.sendMessage;const legacy=vi.fn();f.executor.send=legacy;
 await f.service.send("owner","main",{clientMessageId:"c",text:"note",attachmentIds:[file.id]});await f.service.reconcile("owner","main");
 expect(legacy).not.toHaveBeenCalled();expect((await f.service.snapshot("owner","main")).messages[0]?.delivery).toBe("queued");
});
it("model state is source confirmed, revision guarded and command idempotent",async()=>{
 const f=await fixture();expect((await f.service.snapshot("owner","main")).modelState?.selected.id).toBe("a");
 const change=vi.spyOn(f.executor,"setModel");const input={commandId:"change:1",expectedRevision:"a",choice:{id:"b"}};
 await f.service.setModel("owner","main",input);await f.service.setModel("owner","main",input);
 expect(change).toHaveBeenCalledTimes(1);expect((await f.service.snapshot("owner","main")).modelState?.selected.id).toBe("b");
 await expect(f.service.setModel("owner","main",{...input,commandId:"change:2"})).rejects.toThrow("external_model_conflict");
 await f.emit({type:"turn_started"});await expect(f.service.setModel("owner","main",{commandId:"change:3",expectedRevision:"b",choice:{id:"a"}})).rejects.toThrow("external_model_busy");
});
it("ambiguous model update is not replayed; actual partial source state is preserved",async()=>{
 const f=await fixture();let calls=0;f.executor.setModel=async()=>{calls++;await f.emit({type:"model_state",state:{...f.state(),revision:"partial",selected:{id:"b"}}});throw Error("thinking update failed");};
 const input={commandId:"change:1",expectedRevision:"a",choice:{id:"b"}};
 await expect(f.service.setModel("owner","main",input)).rejects.toThrow();await expect(f.service.setModel("owner","main",input)).rejects.toThrow("external_model_unknown");
 expect(calls).toBe(1);expect((await f.service.snapshot("owner","main")).modelState?.selected.id).toBe("b");
});

it("a failed model/catalog replay does not invent an executor offline status",async()=>{
 const f=await fixture();await f.emit({type:"status",manager:"idle"});f.executor.reconcile=async()=>{throw Error("projection temporarily unavailable");};
 await expect(f.service.reconcile("owner","main")).rejects.toThrow("projection temporarily unavailable");
 expect((await f.service.snapshot("owner","main")).conversation.connection).toBe("idle");
});
