import { fileURLToPath } from 'node:url';
import { appendFileSync, mkdirSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defaultClientConditions, defineConfig, searchForWorkspaceRoot } from 'vite';
const messages=Array.from({length:80},(_,i)=>({id:`message-${i}`,role:i%2?'assistant':'user',parts:[{type:'text',text:`Message ${i}. This is enough text to make the real conversation scroll. The composer stays at the visible bottom.`}],metadata:{status:'complete'}}));
const models={providers:[{id:'provider',displayName:'Provider',models:[{id:'model',displayName:'Model',acceptsImages:false,reasoning:{levels:['off'],defaultLevel:'off'}}]}],defaultChoice:{providerId:'provider',modelId:'model',reasoning:'off'}};
export default defineConfig({
 root:fileURLToPath(new URL('./tests/viewport',import.meta.url)),plugins:[react(),tailwindcss(),{name:'viewport-fixture-api',configureServer(server){server.middlewares.use('/probe',(req,res)=>{let body='';req.on('data',chunk=>{body+=chunk;});req.on('end',()=>{mkdirSync('test-results/viewport-native',{recursive:true});appendFileSync('test-results/viewport-native/events.jsonl',body+'\n');res.end('ok');});});server.middlewares.use('/api/chat',(req,res,next)=>{
   const path=new URL(req.url!,'http://fixture').pathname;
   if(req.method!=='GET'){res.statusCode=405;res.end();return;}
   if(path.endsWith('/watch')){res.statusCode=404;res.end();return;}
   const value=path==='/'?{chats:[{id:'c1',title:'Conversation',createdAt:'2026-01-01',updatedAt:'2026-01-01'}]}:path==='/models'?models:path.endsWith('/branches')?{forks:[]}:path.endsWith('/compactions')?{compactions:[]}:path==='/c1'?{chat:{id:'c1'},messages,running:false,compacting:false,compactions:[],forks:[]}:{ };
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
 });}}],
 resolve:{conditions:[...defaultClientConditions,'@ykurilov/agent-chat-source']},
 server:{host:'127.0.0.1',port:6155,strictPort:true,fs:{allow:[searchForWorkspaceRoot(process.cwd())]}},
});
