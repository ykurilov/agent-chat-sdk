import{describe,it,expect}from"vitest";
import{createExternalConversationService,createMemoryConversationStore,ExternalConversationBusyError}from"@ykurilov/agent-chat-core/external";
import{createExternalChatHandler}from"../../src/external";
async function fixture(){const service=createExternalConversationService({store:createMemoryConversationStore(),resolveExecutor:()=>{throw Error("offline");}});await service.ensureConversation({id:"main",ownerId:"owner",title:"Главный",pinned:true,execution:{kind:"external",id:"manager"}});const handler=createExternalChatHandler({service,pollMs:1,resolveUser:r=>r.headers.get("authorization")==="Bearer owner"?{id:"owner"}:null});return{service,handler};}
const request=(path:string,body?:unknown,headers:Record<string,string>={})=>new Request("https://chat.example.com/api/conversations"+path,{headers:{authorization:"Bearer owner",...(body!==undefined&&{"content-type":"application/json"}),...headers},...(body!==undefined&&{method:"POST",body:JSON.stringify(body)})});
describe("native external HTTP",()=>{
 it("202 offline, replay same client id, no duplicate; owner isolation and origin guard",async()=>{const{handler,service}=await fixture();
 for(let i=0;i<2;i++){const r=await handler.fetch(request("/main/messages",{clientMessageId:"c1",text:"Привет"}));expect(r.status).toBe(202);expect(await r.json()).toMatchObject({messageId:"c1",delivery:"queued"});}
 expect((await service.snapshot("owner","main")).messages).toHaveLength(1);
 expect((await handler.fetch(request("/main/messages",{clientMessageId:"evil",text:"x"},{origin:"https://evil.example"}))).status).toBe(403);
 expect((await handler.fetch(request("/main",undefined,{authorization:""}))).status).toBe(401);
 expect((await handler.fetch(request("/unknown"))).status).toBe(404);
 });
 it("snapshot cursor and replay agree, duplicate cursor returns empty; malformed bodies are 400",async()=>{const{handler}=await fixture();const before=await(await handler.fetch(request("/main"))).json();await handler.fetch(request("/main/messages",{clientMessageId:"c1",text:"x"}));const page=await(await handler.fetch(request(`/main/events?after=${before.cursor}`))).json();expect(page.events).toHaveLength(1);expect(page.events[0].message.text).toBe("x");expect((await handler.fetch(request("/main/events?after=NaN"))).status).toBe(400);expect((await handler.fetch(request("/main/messages",null))).status).toBe(400);});
 it("SSE replays a committed event and closes on cancel",async()=>{const{handler}=await fixture();await handler.fetch(request("/main/messages",{clientMessageId:"c1",text:"x"}));const r=await handler.fetch(request("/main/events?after=0",undefined,{accept:"text/event-stream"}));expect(r.headers.get("content-type")).toBe("text/event-stream");const reader=r.body!.getReader();const opening=await reader.read();expect(new TextDecoder().decode(opening.value)).toBe(": connected\n\n");const first=await reader.read();expect(new TextDecoder().decode(first.value)).toMatch(/id: 1\nevent: change/);await reader.cancel();});
});

it("native HTTP busy exposes stable code without changing legacy kind",async()=>{
 const {handler,service}=await fixture();service.stop=async()=>{throw new ExternalConversationBusyError();};
 const response=await handler.fetch(request("/main/stop",{commandId:"stop"}));
 expect(response.status).toBe(409);expect(await response.json()).toEqual({error:{kind:"busy",code:"external_conversation_busy"}});
});
