// Local-only transport fixture; no external executor connection and no model/provider calls.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createExternalConversationService, createMemoryConversationStore } from "../../packages/core/src/external.ts";
import type { ExternalConversationEvent, ExternalExecutor, ExternalPermissionRequest } from "../../packages/core/src/external.ts";
import { createExternalChatHandler } from "../../packages/server/src/external.ts";
import { createExternalAttachments, createMemoryAttachmentStorage } from "../../packages/attachments/src/index.ts";
const attachmentStorage=createMemoryAttachmentStorage();
const attachments=createExternalAttachments({storage:attachmentStorage,allowGenericFiles:true});
let fileSink:(event:ExternalConversationEvent)=>Promise<void>=async()=>{};
let modelState={revision:"model-a",models:[{id:"model-a",label:"Model A",reasoning:{levels:["off","high"],default:"high"}},{id:"model-b",label:"Model B",reasoning:{levels:["off","high"],default:"high"}}],selected:{id:"model-a",reasoning:"high"},canChange:true};
const fileExecutor:ExternalExecutor={status:()=>"idle",send:async()=>{},sendMessage:async input=>{for(const file of input.attachments)await file.readBytes();await fileSink({type:"message",message:{id:input.messageId,role:"user",text:input.text,createdAt:new Date().toISOString()}});},models:async()=>modelState,setModel:async input=>{if(input.expectedRevision!==modelState.revision)throw Error("external_model_conflict");modelState={...modelState,revision:input.choice.id,selected:{id:input.choice.id,reasoning:input.choice.reasoning??"high"}};await fileSink({type:"model_state",state:modelState});},stopTurn:async()=>{},respondToPermission:async()=>{},reconcile:async()=>{await fileSink({type:"permissions_snapshot",requests:[]});await fileSink({type:"status",manager:"idle"});},onConversation:f=>{fileSink=f;return()=>{};}};
let sink:(event:ExternalConversationEvent)=>Promise<void>=async()=>{};
let status:"offline"|"idle"|"thinking"|"waiting_approval"="offline";
const remote:Array<{id:string;role:"user"|"manager";text:string;createdAt:string}>=[];
let permissions:ExternalPermissionRequest[]=[];
let sequence=0;
let eventsGate:Promise<void>|undefined;let releaseEvents:(()=>void)|undefined;
let rejectFiles = 0;
let fileDeleteGate:Promise<void>|undefined;let releaseFileDelete:(()=>void)|undefined;let fileDeletes=0;
let listGate:Promise<void>|undefined;let releaseList:(()=>void)|undefined;let heldLists=0;
const executor:ExternalExecutor={
  status:()=>status,
  onConversation:listener=>{sink=listener;return()=>{sink=async()=>{};};},
  async reconcile(){for(const message of remote)await sink({type:"message",message});await sink({type:"permissions_snapshot",requests:permissions});await sink({type:"status",manager:status});},
  async send(text,id){
    const message={id,role:"user" as const,text,createdAt:new Date().toISOString()};remote.push(message);await sink({type:"message",message});
    status="thinking";await sink({type:"turn_started"});await sink({type:"status",manager:status});
    sequence++;await sink({type:"delta",id:"answer:"+sequence,textSoFar:"Пишу"});await sink({type:"delta",id:"answer:"+sequence,textSoFar:"Пишу ответ"});
    if(text!=="stop me"){
      permissions=[{id:"p:"+sequence,name:"Read",kind:"tool",title:"Прочитать файл?",actions:[{id:"allow",label:"Разрешить",behavior:"allow"},{id:"deny",label:"Отказать",behavior:"deny"}]}];
      await sink({type:"permission_requested",request:permissions[0]!});status="waiting_approval";await sink({type:"status",manager:status});
    }
  },
  async respondToPermission(id){
    if(!permissions.some(p=>p.id===id))return;
    permissions=[];await sink({type:"permission_resolved",requestId:id});
    const message={id:"answer:"+sequence,role:"manager" as const,text:"Готово",createdAt:new Date().toISOString()};remote.push(message);await sink({type:"message",message});
    await sink({type:"turn_ended",outcome:"completed"});status="idle";await sink({type:"status",manager:status});
  },
  async stopTurn(){await sink({type:"turn_ended",outcome:"canceled"});status="idle";await sink({type:"status",manager:status});},
};
let offlineSink:(event:ExternalConversationEvent)=>Promise<void>=async()=>{};
const offlineExecutor:ExternalExecutor={status:()=>"offline",onConversation:listener=>{offlineSink=listener;return()=>{};},reconcile:async()=>{await offlineSink({type:"permissions_snapshot",requests:[]});await offlineSink({type:"status",manager:"offline"});},send:async()=>{throw Error("offline must not send");},stopTurn:async()=>{},respondToPermission:async()=>{}};
const service=createExternalConversationService({store:createMemoryConversationStore(),attachments,resolveExecutor:d=>d.execution.id==="files-models"?fileExecutor:d.execution.id==="offline-cache"?offlineExecutor:executor,pollMs:100});
await service.ensureConversation({id:"main",ownerId:"fixture",title:"Главный",pinned:true,execution:{kind:"external",id:"fixture"}});
await service.start("fixture","main");
await service.ensureConversation({id:"offline-cache",ownerId:"fixture",title:"Офлайн",execution:{kind:"external",id:"offline-cache"}});await service.start("fixture","offline-cache");
await service.ensureConversation({id:"files-models",ownerId:"fixture",title:"Files",execution:{kind:"external",id:"files-models"}});await service.start("fixture","files-models");
const handler=createExternalChatHandler({service,attachments,resolveUser:r=>r.headers.get("authorization")==="Bearer fixture-only"?{id:"fixture"}:null,pollMs:20});
const port=Number(process.env.AGENT_CHAT_FIXTURE_PORT??9139);
const server=createServer(async(req,res)=>{
  const abort=new AbortController();res.once("close",()=>abort.abort());
  if(req.url==="/fixture/reject-files-twice"){rejectFiles=2;res.end("ok");return;}
  if(req.method==="POST"&&req.url==="/api/conversations/files-models/messages"&&rejectFiles>0){rejectFiles--;let body="";for await(const chunk of req)body+=chunk;for(const id of JSON.parse(body).attachmentIds??[])await attachmentStorage.removeUnattached(id);res.writeHead(404,{"content-type":"application/json"});res.end(JSON.stringify({error:{code:"attachment_expired"}}));return;}
  if(req.url==="/fixture/hold-file-delete"){fileDeleteGate=new Promise<void>(resolve=>{releaseFileDelete=resolve;});fileDeletes=0;res.end("ok");return;}
  if(req.url==="/fixture/file-delete-count"){res.end(String(fileDeletes));return;}
  if(req.url==="/fixture/release-file-delete"){releaseFileDelete?.();fileDeleteGate=undefined;res.end("ok");return;}
  if(req.url==="/fixture/hold-events"){eventsGate=new Promise<void>(resolve=>{releaseEvents=resolve;});res.end("ok");return;}
  if(req.url==="/fixture/release-events"){releaseEvents?.();eventsGate=undefined;res.end("ok");return;}
  if(req.url?.includes("/events")&&eventsGate){await eventsGate;if(res.destroyed)return;}
  if(req.url==="/fixture/hold-list"){listGate=new Promise<void>(resolve=>{releaseList=resolve;});heldLists=0;res.end("ok");return;}
  if(req.url==="/fixture/list-count"){res.end(String(heldLists));return;}
  if(req.url==="/fixture/release-list"){releaseList?.();listGate=undefined;res.end("ok");return;}
  if(req.url==="/api/conversations"&&listGate){heldLists++;await listGate;}
  if(req.url==="/fixture/online"){
    status="idle";await service.reconcile("fixture","main");res.end("ok");return;
  }
  const request=new Request("http://127.0.0.1:"+port+req.url,{method:req.method,headers:req.headers as HeadersInit,signal:abort.signal,...(req.method!=="GET"&&req.method!=="HEAD"?{body:Readable.toWeb(req) as ReadableStream,duplex:"half"}:{})});
  const response=await handler.fetch(request);if(req.method==="DELETE"&&req.url?.includes("/attachments/")&&fileDeleteGate){fileDeletes++;await fileDeleteGate;}res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body){const stream=Readable.fromWeb(response.body as never);stream.once("error",()=>res.destroy());res.once("close",()=>stream.destroy());stream.pipe(res);}else res.end();
});
server.listen(port,"127.0.0.1",()=>console.log("NATIVE_FIXTURE_READY "+port));
async function close(){server.closeAllConnections();server.close();await service.close();process.exit(0);}
process.on("SIGTERM",()=>void close());process.on("SIGINT",()=>void close());
