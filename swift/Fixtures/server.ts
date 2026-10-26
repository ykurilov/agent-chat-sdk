// Local-only transport fixture; no external executor connection and no model/provider calls.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { createExternalConversationService, createMemoryConversationStore } from "../../packages/core/src/external.ts";
import type { ExternalConversationEvent, ExternalExecutor, ExternalPermissionRequest } from "../../packages/core/src/external.ts";
import { createExternalChatHandler } from "../../packages/server/src/external.ts";
let sink:(event:ExternalConversationEvent)=>Promise<void>=async()=>{};
let status:"offline"|"idle"|"thinking"|"waiting_approval"="offline";
const remote:Array<{id:string;role:"user"|"manager";text:string;createdAt:string}>=[];
let permissions:ExternalPermissionRequest[]=[];
let sequence=0;
let eventsGate:Promise<void>|undefined;let releaseEvents:(()=>void)|undefined;
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
const service=createExternalConversationService({store:createMemoryConversationStore(),resolveExecutor:d=>d.execution.id==="offline-cache"?offlineExecutor:executor,pollMs:100});
await service.ensureConversation({id:"main",ownerId:"fixture",title:"Главный",pinned:true,execution:{kind:"external",id:"fixture"}});
await service.start("fixture","main");
await service.ensureConversation({id:"offline-cache",ownerId:"fixture",title:"Офлайн",execution:{kind:"external",id:"offline-cache"}});await service.start("fixture","offline-cache");
const handler=createExternalChatHandler({service,resolveUser:r=>r.headers.get("authorization")==="Bearer fixture-only"?{id:"fixture"}:null,pollMs:20});
const server=createServer(async(req,res)=>{
  const abort=new AbortController();res.once("close",()=>abort.abort());
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
  const request=new Request("http://127.0.0.1:9139"+req.url,{method:req.method,headers:req.headers as HeadersInit,signal:abort.signal,...(req.method!=="GET"&&req.method!=="HEAD"?{body:Readable.toWeb(req) as ReadableStream,duplex:"half"}:{})});
  const response=await handler.fetch(request);res.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body){const stream=Readable.fromWeb(response.body as never);stream.once("error",()=>res.destroy());res.once("close",()=>stream.destroy());stream.pipe(res);}else res.end();
});
server.listen(9139,"127.0.0.1",()=>console.log("NATIVE_FIXTURE_READY 9139"));
async function close(){server.closeAllConnections();server.close();await service.close();process.exit(0);}
process.on("SIGTERM",()=>void close());process.on("SIGINT",()=>void close());
