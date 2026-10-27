import type { ExternalConversationService, PermissionDecision } from "@ykurilov/agent-chat-core/external";
import { createRequestOriginCheck } from "@ykurilov/agent-chat-core";

export interface ExternalChatHandlerOptions {
  service:ExternalConversationService;
  attachments?:{
    settings():Response;
    handle(input:{request:Request;userId:string;chatId:string;segments:string[]}):Promise<Response>;
  };
  basePath?:string;
  resolveUser:(request:Request)=>{id:string}|null|Promise<{id:string}|null>;
  allowedOrigins?:string[];
  pollMs?:number; heartbeatMs?:number;
  logError?:(error:unknown)=>void;
}
/** Version 1 native protocol. Standard fetch handler: mount with Hono's app.all(..., c => handler.fetch(c.req.raw)). */
export function createExternalChatHandler(options:ExternalChatHandlerOptions) {
  const base=(options.basePath??"/api/conversations").replace(/\/$/,"");
  const originCheck=createRequestOriginCheck({allowedOrigins:options.allowedOrigins});
  const service=options.service;
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"cache-control":"no-store"}});
  return {
    async fetch(request:Request):Promise<Response> {
      try {
        const url=new URL(request.url);
        if(url.pathname!==base&&!url.pathname.startsWith(base+"/"))return json({error:{kind:"not_found"}},404);
        if(request.method!=="GET"&&request.method!=="HEAD"&&!originCheck(request))return json({error:{kind:"forbidden_origin"}},403);
        const user=await options.resolveUser(request);if(!user)return json({error:{kind:"unauthorized"}},401);
        const parts=url.pathname.slice(base.length).split("/").filter(Boolean).map(decodeURIComponent);
        if(parts.length===0&&request.method==="GET")return json({version:1,conversations:await service.list(user.id)});
        if(parts.length===2&&parts[0]==="attachments"&&parts[1]==="settings"&&request.method==="GET")return options.attachments?.settings()??json({error:{kind:"not_found"}},404);
        const id=parts[0];if(!id)return json({error:{kind:"not_found"}},404);
        // Always authorize before parsing request bodies or creating a stream.
        await service.snapshot(user.id,id);
        if(parts[1]==="attachments")return options.attachments?.handle({request,userId:user.id,chatId:id,segments:parts.slice(2)})??json({error:{kind:"not_found"}},404);
        if(parts[1]==="model"&&parts.length===2){
          if(request.method==="GET"){await service.start(user.id,id);return json({version:1,modelState:(await service.snapshot(user.id,id)).modelState??null});}
          if(request.method==="PUT"){const body=JSON.parse(await readBody(request));return json({version:1,modelState:await service.setModel(user.id,id,body)});}
        }
        if(parts.length===1&&request.method==="GET")return json(await service.snapshot(user.id,id));
        if(parts[1]==="events"&&parts.length===2&&request.method==="GET"){
          const raw=url.searchParams.get("after")??request.headers.get("last-event-id")??"0";
          if(!/^\d+$/.test(raw))throw Error("invalid_cursor");
          const after=Number(raw);
          const page=await service.events(user.id,id,after);
          if(page.reset)return json({version:1,reset:true},409);
          if(!request.headers.get("accept")?.includes("text/event-stream"))return json(page);
          let dispose=()=>{};
          let cursor=after,closed=false,timer:ReturnType<typeof setTimeout>|undefined;
          const encoder=new TextEncoder();let lastPing=Date.now();
          const stream=new ReadableStream<Uint8Array>({
            start(controller){
              const finish=()=>{if(closed)return;closed=true;clearTimeout(timer);request.signal.removeEventListener("abort",abort);controller.close();};
              const abort=()=>finish();
              request.signal.addEventListener("abort",abort,{once:true});
              dispose=()=>request.signal.removeEventListener("abort",abort);
              const poll=async()=>{
                if(closed)return;
                try {
                  if((controller.desiredSize??1)<=0){timer=setTimeout(()=>void poll(),options.pollMs??200);return;}
                  const next=await service.events(user.id,id,cursor);
                  if(closed)return;
                  if(next.reset){controller.enqueue(encoder.encode('event: reset\ndata: {"version":1,"reset":true}\n\n'));finish();return;}
                  for(const event of next.events){if((controller.desiredSize??1)<=0)break;controller.enqueue(encoder.encode(`id: ${event.seq}\nevent: change\ndata: ${JSON.stringify(event)}\n\n`));cursor=event.seq;}
                  if(Date.now()-lastPing>=(options.heartbeatMs??10_000)){controller.enqueue(encoder.encode(": heartbeat\n\n"));lastPing=Date.now();}
                  timer=setTimeout(()=>void poll(),options.pollMs??200);
                }catch(error){options.logError?.(error);finish();}
              };
              if(request.signal.aborted)finish();else {controller.enqueue(encoder.encode(": connected\n\n"));void poll();}
            },
            cancel(){closed=true;clearTimeout(timer);dispose();},
          });
          return new Response(stream,{headers:{"content-type":"text/event-stream","cache-control":"no-cache, no-transform","x-accel-buffering":"no","x-content-type-options":"nosniff"}});
        }
        if(request.method==="POST"){
          const bytes=await readBody(request);const body=JSON.parse(bytes) as Record<string,unknown>;
          if(!body||typeof body!=="object"||Array.isArray(body))throw Error("invalid_body");
          if(parts[1]==="messages"&&parts.length===2){
            if(typeof body.clientMessageId!=="string"||typeof body.text!=="string")throw Error("invalid_message");
            const receipt=await service.send(user.id,id,{clientMessageId:body.clientMessageId,text:body.text,...(body.attachmentIds!==undefined&&{attachmentIds:body.attachmentIds as string[]})});return json({version:1,...receipt},202);
          }
          if(parts[1]==="stop"&&parts.length===2){if(typeof body.commandId!=="string")throw Error("invalid_command");return json({version:1,...await service.stop(user.id,id,body.commandId)},202);}
          if(parts[1]==="permissions"&&parts[2]&&parts.length===3){
            if(typeof body.commandId!=="string"||!body.decision||typeof body.decision!=="object"||Array.isArray(body.decision))throw Error("invalid_permission_answer");
            const decision=body.decision as PermissionDecision;
            if(decision.behavior!==undefined&&decision.behavior!=="allow"&&decision.behavior!=="deny")throw Error("invalid_permission_answer");
            if(decision.actionId!==undefined&&typeof decision.actionId!=="string")throw Error("invalid_permission_answer");
            if(decision.answers!==undefined&&(!decision.answers||typeof decision.answers!=="object"||Array.isArray(decision.answers)))throw Error("invalid_permission_answer");
            return json({version:1,...await service.answerPermission(user.id,id,parts[2],body.commandId,decision)},202);
          }
        }
        return json({error:{kind:"not_found"}},404);
      }catch(error){
        const kind=error instanceof Error?error.message:"internal";
        if(kind==="not_found")return json({error:{kind}},404);
        if(kind==="body_too_large")return json({error:{kind}},413);
        if(["busy","message_id_conflict","command_id_conflict","permission_not_pending","executor_offline","executor_not_supported"].includes(kind))return json({error:{kind,...(kind==="busy"&&{code:"external_conversation_busy"})}},409);
        const code=error&&typeof error==="object"&&"code" in error&&typeof error.code==="string"?error.code:kind;
        if(code.startsWith("external_model_")||kind==="external_attachments_unsupported")return json({error:{kind:code,code}},409);
        if(kind.startsWith("attachment_"))return json({error:{kind}},kind==="attachment_not_found"?404:422);
        if(kind.startsWith("invalid_")||error instanceof SyntaxError||error instanceof URIError)return json({error:{kind:"invalid"}},400);
        options.logError?.(error);return json({error:{kind:"internal"}},500);
      }
    },
  };
}
async function readBody(request:Request):Promise<string> {
  if(!request.body)return "{}";
  const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>128_000){await reader.cancel();throw Error("body_too_large");}chunks.push(value);}}finally{reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return new TextDecoder().decode(result);
}
