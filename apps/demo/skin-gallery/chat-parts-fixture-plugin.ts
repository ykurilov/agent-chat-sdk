import type { Plugin } from "vite";

/** Read-only synthetic history for the actual AgentChat gallery. No provider, storage or secrets. */
export function chatPartsFixturePlugin(): Plugin {
 const messages=Array.from({length:250},(_,index)=>({id:`history-${index}`,role:index%2?"assistant":"user",parts:[{type:"text",text:`History ${index}. ${"Neutral demonstration text. ".repeat(index%2?12:2)}`}],...(index%2?{metadata:{status:"complete"}}:{})}));
 return {name:"chat-parts-history-fixture",configureServer(server){
  server.middlewares.use((request,response,next)=>{
   if(!request.url?.startsWith('/chat-parts-fixture/'))return next();
   if(request.url.endsWith('/watch')){
    response.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});response.write(': gallery\n\n');
    const heartbeat=setInterval(()=>response.write(': gallery\n\n'),5000);heartbeat.unref();response.on('close',()=>clearInterval(heartbeat));return;
   }
   response.setHeader('Content-Type','application/json');
   if(request.method!=='GET'){response.statusCode=405;response.end(JSON.stringify({error:{kind:'other',message:'Read-only gallery fixture'}}));return;}
   if(request.url.endsWith('/models')){response.end(JSON.stringify({providers:[]}));return;}
   if(request.url.endsWith('/branches')){response.end(JSON.stringify({forks:[]}));return;}
   if(request.url.endsWith('/compactions')){response.end(JSON.stringify({compactions:[],compacting:false}));return;}
   response.end(JSON.stringify({chat:{id:'history'},messages,running:false,detachedAnswer:false,compactions:[],compacting:false,forks:[],backgroundTasks:false,capabilities:{modelChoice:false,regenerate:false,edit:false,branches:false,retry:false,voice:false,attachments:false}}));
  });
 }};
}
