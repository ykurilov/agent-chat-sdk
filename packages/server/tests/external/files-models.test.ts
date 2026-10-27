import {expect,it} from "vitest";
import {createExternalConversationService,createMemoryConversationStore} from "@ykurilov/agent-chat-core/external";
import type {ExternalExecutor,ExternalConversationEvent} from "@ykurilov/agent-chat-core/external";
import {createExternalChatHandler} from "../../src/external";
import {createExternalAttachments} from "../../../attachments/src/external-attachments";
import {createMemoryAttachmentStorage} from "../../../attachments/src/memory-attachment-storage";
it("authenticated external uploads, attachment-only POST and model PUT use one owned conversation",async()=>{
 const files=createExternalAttachments({storage:createMemoryAttachmentStorage(),allowGenericFiles:true});let sink:(e:ExternalConversationEvent)=>Promise<void>=async()=>{};
 let state={revision:"a",models:[{id:"a",label:"A"},{id:"b",label:"B"}],selected:{id:"a"},canChange:true};
 const executor:ExternalExecutor={status:()=>"idle",send:async()=>{},sendMessage:async i=>{await sink({type:"message",message:{id:i.messageId,role:"user",text:i.text,createdAt:new Date().toISOString()}});},stopTurn:async()=>{},respondToPermission:async()=>{},onConversation:f=>{sink=f;return()=>{};},reconcile:async()=>{},models:async()=>state,setModel:async i=>{state={...state,revision:"b",selected:i.choice};await sink({type:"model_state",state});}};
 const service=createExternalConversationService({store:createMemoryConversationStore(),resolveExecutor:()=>executor,attachments:files});
 await service.ensureConversation({id:"c",ownerId:"owner",title:"C",execution:{kind:"external",id:"e"}});await service.start("owner","c");
 const handler=createExternalChatHandler({service,attachments:files,resolveUser:r=>({id:r.headers.get("x-owner")??"owner"})});
 const url="https://chat.test/api/conversations";
 try{
  expect((await handler.fetch(new Request(url+"/attachments/settings"))).status).toBe(200);
  const body=new FormData();body.set("file",new Blob([new Uint8Array([80,75,3,4])]),"archive.zip");
  const uploaded=await handler.fetch(new Request(url+"/c/attachments",{method:"POST",body}));expect(uploaded.status).toBe(201);const file=await uploaded.json();
  expect((await handler.fetch(new Request(url+"/c/attachments/"+file.id,{headers:{"x-owner":"other"}}))).status).toBe(404);
  const response=await handler.fetch(new Request(url+"/c/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({clientMessageId:"client",text:"",attachmentIds:[file.id]})}));expect(response.status).toBe(202);
  expect((await service.snapshot("owner","c")).messages[0]?.attachments?.[0]?.id).toBe(file.id);
  await service.reconcile("owner","c");
  const changed=await handler.fetch(new Request(url+"/c/model",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({commandId:"m",expectedRevision:"a",choice:{id:"b"}})}));expect(changed.status).toBe(200);expect((await changed.json()).modelState.selected.id).toBe("b");
 }finally{await service.close();}
});
