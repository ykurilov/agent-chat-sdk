import { randomUUID } from "node:crypto";
import { conversationView } from "./store";
import { isExternalDispatchRejected } from "./types";
import type { ConversationChange, ConversationDefinition, ConversationFeedEvent, ConversationMessage, ConversationPermission, ConversationSnapshot, ConversationState, ConversationStore, ExternalConversationEvent, ExternalExecutor, ExternalPermissionRequest, ExternalPermissionResponse, PermissionDecision } from "./types";

interface Active {
  ownerId:string; executor:ExternalExecutor; holder:string; tail:Promise<unknown>; off:()=>void;
  timer?:ReturnType<typeof setInterval>; drain?:Promise<void>; reconcile?:Promise<void>; replay?:Promise<void>; decisions:Map<string,Promise<void>>; ready:boolean; nextReconcileAt:number; reconcileFailures:number; lost:boolean;
}
export interface ExternalConversationOptions {
  store:ConversationStore;
  resolveExecutor(definition:ConversationDefinition):ExternalExecutor|Promise<ExternalExecutor>;
  now?:()=>number; leaseMs?:number; pollMs?:number; commandTimeoutMs?:number; retainedEvents?:number;
  logError?:(error:unknown)=>void;
}
/** Durable client projection. The executor remains authoritative about execution and permission outcomes. */
export function createExternalConversationService(options:ExternalConversationOptions) {
  if(options.store.guarded!==true)throw TypeError("ConversationStore must implement guarded atomic transactions");
  const {store}=options, now=options.now??Date.now, leaseMs=options.leaseMs??30_000;
  if(leaseMs<100)throw TypeError("leaseMs must be at least 100");
  const active=new Map<string,Active>();
  const starts=new Map<string,Promise<void>>();
  const log=options.logError??(()=>{});
  let closed=false;
  const assertActive=(a:Active)=>{if(closed||a.lost)throw Error("lease_lost");};
  const ownLease=(state:ConversationState,a:Active)=>{
    if(closed||a.lost||state.lease?.holder!==a.holder||state.lease.expiresAt<=now())throw Error("lease_lost");
  };
  const emit=(s:ConversationState,change:ConversationChange)=>{
    s.updatedAt=new Date(now()).toISOString();
    s.events.push({...structuredClone(change),version:1,chatId:s.definition.id,seq:++s.cursor});
    const keep=options.retainedEvents??1024;
    if(s.events.length>keep)s.events.splice(0,s.events.length-keep);
  };
  const messageChanged=(s:ConversationState,m:ConversationMessage)=>{m.revision++;emit(s,{type:"message",message:m});};
  const permissionChanged=(s:ConversationState,p:ConversationPermission)=>{p.revision++;emit(s,{type:"permission",permission:p});};
  const statusChanged=(s:ConversationState)=>emit(s,{type:"status",connection:s.connection,turn:s.turn});
  const guarded=<T>(id:string,a:Active,change:(s:ConversationState)=>T)=>store.transaction(a.ownerId,id,s=>{ownLease(s,a);return change(s);});
  async function bounded<T>(work:Promise<T>):Promise<T> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("executor_timeout")),options.commandTimeoutMs??30_000);})]);}
    finally{clearTimeout(timer);}
  }
  function upsertPermission(s:ConversationState,request:ExternalPermissionRequest) {
    const old=s.permissions.find(p=>p.id===request.id);
    if(old){if(old.status==="resolved")return;const next={...old,...structuredClone(request)};if(JSON.stringify(old)!==JSON.stringify(next)){Object.assign(old,next);permissionChanged(s,old);}return;}
    const p:ConversationPermission={...structuredClone(request),revision:0,status:"open"};s.permissions.push(p);permissionChanged(s,p);
  }
  async function ingest(id:string,a:Active,event:ExternalConversationEvent) {
    await guarded(id,a,s=>{
      switch(event.type){
        case "history_reset":s.epoch=event.epoch;break;
        case "message":case "delta":{
          const complete=event.type==="message";
          const incoming=complete?event.message:{id:event.id,role:"assistant" as const,text:event.textSoFar,createdAt:new Date(now()).toISOString()};
          if(!incoming.id||incoming.id.length>200||typeof incoming.text!=="string"||incoming.text.length>100_000||!Number.isFinite(Date.parse(incoming.createdAt)))throw Error("invalid_external_message");
          const role=incoming.role==="manager"?"assistant":incoming.role;
          let m=s.messages.find(m=>m.id===incoming.id||m.aliases.some(x=>x.id===incoming.id));
          if(!m&&complete&&event.rebuilt){
            if(!s.epoch)throw Error("rebuilt_requires_history_reset");
            // Ordered one-to-one matching within the new epoch, never text-only set deduplication.
            m=s.messages.find(m=>m.role===role&&m.text===incoming.text&&Math.abs(Date.parse(m.createdAt)-Date.parse(incoming.createdAt))<=2000&&!m.aliases.some(x=>x.epoch===s.epoch));
          }
          if(!m){m={id:incoming.id,role,text:"",createdAt:incoming.createdAt,revision:0,status:complete?"complete":"streaming",aliases:[]};s.messages.push(m);}
          if(m.role!==role)throw Error("external_message_identity_conflict");
          if(m.delivery&&m.text!==incoming.text)throw Error("external_message_identity_conflict");
          const before=JSON.stringify(m);
          const alias=m.aliases.find(x=>x.id===incoming.id);
          if(alias){if(s.epoch)alias.epoch=s.epoch;else delete alias.epoch;}
          else m.aliases.push({id:incoming.id,...(s.epoch&&{epoch:s.epoch})});
          // A replay of an older cumulative prefix cannot truncate a newer saved answer.
          if(!m.text.startsWith(incoming.text)||incoming.text.length>=m.text.length)m.text=incoming.text;
          if(complete){m.createdAt=incoming.createdAt;m.status="complete";if(role==="user")m.delivery="sent";}
          else if(m.status!=="complete")m.status="streaming";
          if(before!==JSON.stringify(m)||m.revision===0)messageChanged(s,m);
          break;
        }
        case "status":if(event.manager==="offline")a.ready=false;if(s.connection!==event.manager){s.connection=event.manager;statusChanged(s);}break;
        case "turn_started":s.turn={status:"running",generation:s.turn.generation+1};statusChanged(s);break;
        case "turn_ended":{
          s.turn={status:event.outcome==="completed"?"idle":event.outcome==="canceled"?"stopped":event.outcome==="failed"?"error":"unknown",generation:s.turn.generation,...(event.error&&{error:event.error})};
          for(const m of s.messages.filter(m=>m.status==="streaming")){m.status=event.outcome==="canceled"?"stopped":event.outcome==="failed"?"error":event.outcome==="unknown"?"unknown":"complete";messageChanged(s,m);}
          statusChanged(s);break;
        }
        case "permission_requested":upsertPermission(s,event.request);break;
        case "permission_resolved":{const p=s.permissions.find(p=>p.id===event.requestId);if(p&&p.status!=="resolved"){p.status="resolved";permissionChanged(s,p);}break;}
        case "permissions_snapshot":{
          const ids=new Set(event.requests.map(r=>r.id));
          for(const p of s.permissions)if(p.status!=="resolved"&&!ids.has(p.id)){p.status="resolved";permissionChanged(s,p);}
          for(const p of event.requests)upsertPermission(s,p);break;
        }
      }
    });
  }
  function scheduleDrain(id:string,a:Active) { void drain(id,a).catch(log); }
  async function drain(id:string,a:Active):Promise<void> {
    if(a.lost||closed||!a.ready)return;
    if(a.drain)return a.drain;
    const work=(async()=>{
      while(!a.lost&&!closed&&a.ready&&a.executor.status()!=="offline"){
        const next=await guarded(id,a,s=>{
          if(s.messages.some(m=>m.delivery==="unknown"||m.delivery==="sending"))return null;
          const m=s.messages.find(m=>m.delivery==="queued");if(!m)return null;
          m.delivery="sending";messageChanged(s,m);return {id:m.id,text:m.text};
        });
        if(!next)return;
        try {
          assertActive(a);await bounded(a.executor.send(next.text,next.id));
          await guarded(id,a,s=>{const m=s.messages.find(m=>m.id===next.id)!;if(m.delivery==="sending"){m.delivery="sent";messageChanged(s,m);}});
        } catch(error) {
          await guarded(id,a,s=>{const m=s.messages.find(m=>m.id===next.id)!;if(m.delivery==="sending"){m.delivery=isExternalDispatchRejected(error)?"queued":"unknown";messageChanged(s,m);}});
          log(error);return;
        }
      }
    })();
    a.drain=work;
    try{await work;}finally{if(a.drain===work)a.drain=undefined;}
  }
  async function start(ownerId:string,id:string):Promise<void> {
    if(closed)throw Error("service_closed");
    const existing=active.get(id);if(existing){if(existing.ownerId!==ownerId)throw Error("not_found");return;}
    if(starts.has(id)){await starts.get(id);await store.read(ownerId,id);return;}
    const work=(async()=>{
      const state=await store.read(ownerId,id);
      if(state.definition.execution.kind!=="external")throw Error("executor_not_supported");
      const executor=await bounded(Promise.resolve(options.resolveExecutor(state.definition)));
      if(closed)throw Error("service_closed");
      const a:Active={ownerId,executor,holder:randomUUID(),tail:Promise.resolve(),off:()=>{},lost:false,decisions:new Map(),ready:false,nextReconcileAt:0,reconcileFailures:0};
      await store.transaction(ownerId,id,s=>{
        if(s.lease&&s.lease.expiresAt>now())throw Error("busy");
        s.lease={holder:a.holder,expiresAt:now()+leaseMs};
        for(const m of s.messages)if(m.delivery==="sending"){m.delivery="unknown";messageChanged(s,m);}
      });
      if(closed){await store.transaction(ownerId,id,s=>{if(s.lease?.holder===a.holder)delete s.lease;});throw Error("service_closed");}
      active.set(id,a);
      try {
        a.off=executor.onConversation(event=>{
          const work=a.tail.then(()=>ingest(id,a,event));a.tail=work.catch(log);
          // The returned promise is the commit acknowledgement, not a queued receipt.
          void work.then(()=>{
            if(event.type==="status"&&event.manager!=="offline"&&!a.reconcile)void reconcile(ownerId,id).catch(log);
          },()=>{});
          return work;
        });
        let renewing=false;
        a.timer=setInterval(()=>{
          if(renewing||a.lost)return;renewing=true;
          void guarded(id,a,s=>{s.lease!.expiresAt=now()+leaseMs;}).then(()=>{
            if(!a.ready&&a.executor.status()!=="offline"&&now()>=a.nextReconcileAt)void reconcile(ownerId,id).catch(log);
            else if(a.ready)scheduleDrain(id,a);
          },error=>{a.lost=true;a.off();clearInterval(a.timer);if(active.get(id)===a)active.delete(id);log(error);}).finally(()=>{renewing=false;});
        },Math.min(options.pollMs??1000,Math.floor(leaseMs/3)));
        a.timer.unref?.();
        // Keep the lease and acknowledged subscription during a transient offline startup.
        await reconcile(ownerId,id).catch(log);
        if(closed)throw Error("service_closed");
      } catch(error) {
        clearInterval(a.timer);a.off();active.delete(id);
        await store.transaction(ownerId,id,s=>{if(s.lease?.holder===a.holder)delete s.lease;});throw error;
      }
    })();
    starts.set(id,work);try{await work;}finally{starts.delete(id);}
  }
  async function reconcile(ownerId:string,id:string):Promise<void> {
    const a=active.get(id);if(!a){await start(ownerId,id);return;}
    if(a.ownerId!==ownerId)throw Error("not_found");
    if(a.reconcile)return a.reconcile;
    const work=(async()=>{
      // A retained replay belongs to a timed-out call. It is only a barrier, never a fresh result.
      if(a.replay){await bounded(a.replay);await a.tail;}
      assertActive(a);
      const replay=Promise.resolve().then(()=>{assertActive(a);return a.executor.reconcile();});a.replay=replay;
      const settled=()=>{if(a.replay===replay)a.replay=undefined;};
      void replay.then(settled,settled);
      await bounded(replay);await a.tail;
      const current=a.executor.status();
      await guarded(id,a,s=>{
        const before=JSON.stringify(s.turn);
        if(current==="thinking"||current==="waiting_approval"){
          if(s.turn.status!=="running")s.turn={status:"running",generation:s.turn.generation+1};
          // A snapshot confirms that execution is still active, not that an earlier Stop succeeded.
          delete s.turn.stopRequested;delete (s as ConversationState&{stop?:unknown}).stop;
        }else if(current==="idle"&&s.turn.status==="running"){
          s.turn={status:"unknown",generation:s.turn.generation};
          for(const m of s.messages.filter(m=>m.status==="streaming")){m.status="unknown";messageChanged(s,m);}
          delete (s as ConversationState&{stop?:unknown}).stop;
        }
        if(before!==JSON.stringify(s.turn))statusChanged(s);
      });
      a.ready=current!=="offline";a.reconcileFailures=0;a.nextReconcileAt=0;
      // Source replay confirms accepted client ids; ambiguous missing sends stay unknown.
      await drain(id,a);
      const pending=(await store.read(ownerId,id)).permissions.filter(p=>p.status==="responding"&&p.decision);
      for(const p of pending)await dispatchDecision(id,a,p.id,p.decision!);
    })();
    a.reconcile=work;try{await work;}catch(error){
      a.ready=false;a.nextReconcileAt=now()+Math.min(30_000,1000*2**Math.min(a.reconcileFailures++,5));
      await guarded(id,a,s=>{if(s.connection!=="offline"){s.connection="offline";statusChanged(s);}});
      throw error;
    }finally{if(a.reconcile===work)a.reconcile=undefined;}
  }
  async function dispatchDecision(id:string,a:Active,requestId:string,decision:PermissionDecision) {
    const pending=a.decisions.get(requestId);if(pending)return pending;
    const work=performDecision(id,a,requestId,decision);a.decisions.set(requestId,work);
    try{await work;}finally{if(a.decisions.get(requestId)===work)a.decisions.delete(requestId);}
  }
  async function performDecision(id:string,a:Active,requestId:string,decision:PermissionDecision) {
    if(!a.ready||a.executor.status()==="offline")return;
    const response=await guarded(id,a,s=>{
      const p=s.permissions.find(p=>p.id===requestId);if(!p||p.status!=="responding")return null;
      return permissionResponse(p,decision);
    });
    if(response)try{assertActive(a);await bounded(a.executor.respondToPermission(requestId,response));}catch(error){log(error);}
  }
  function permissionResponse(p:ConversationPermission,d:PermissionDecision):ExternalPermissionResponse {
    if(!d||typeof d!=="object"||Array.isArray(d))throw Error("invalid_permission_answer");
    const fields=[d.answers!==undefined,d.actionId!==undefined,d.behavior!==undefined].filter(Boolean).length;
    if(fields!==1)throw Error("invalid_permission_answer");
    const isQuestion=p.kind==="question"||p.name==="AskUserQuestion";
    if(d.answers){
      const questions=p.input?.questions;
      if(!isQuestion||!Array.isArray(questions)||typeof d.answers!=="object"||Array.isArray(d.answers)||Object.values(d.answers).some(v=>typeof v!=="string"||!v.trim()))throw Error("invalid_permission_answer");
      const allowed=new Set(questions.map(q=>typeof q==="object"&&q!==null&&"question" in q?q.question:undefined));
      if(allowed.size===0||allowed.has(undefined)||Object.keys(d.answers).some(q=>!allowed.has(q))||[...allowed].some(q=>typeof q!=="string"||!d.answers?.[q]?.trim()))throw Error("invalid_permission_answer");
      return {behavior:"allow",updatedInput:{questions,answers:d.answers}};
    }
    if(d.actionId){const action=p.actions?.find(a=>a.id===d.actionId);if(!action)throw Error("invalid_permission_action");if(isQuestion&&action.behavior==="allow")throw Error("invalid_permission_answer");return {behavior:action.behavior,selectedActionId:action.id};}
    if(p.actions?.length||!d.behavior||(isQuestion&&d.behavior!=="deny"))throw Error("invalid_permission_action");
    return {behavior:d.behavior};
  }
  return {
    ensureConversation:(d:ConversationDefinition)=>store.create(d),
    list:(ownerId:string)=>store.list(ownerId),start,reconcile,
    async snapshot(ownerId:string,id:string):Promise<ConversationSnapshot>{const s=await store.read(ownerId,id);return {version:1,conversation:conversationView(s),cursor:s.cursor,messages:s.messages,permissions:s.permissions,turn:s.turn};},
    async events(ownerId:string,id:string,after:number):Promise<{version:1;reset:boolean;cursor:number;events:ConversationFeedEvent[]}>{
      if(!Number.isSafeInteger(after)||after<0)throw Error("invalid_cursor");const s=await store.read(ownerId,id);
      const reset=after>s.cursor||(s.events.length>0&&after<s.events[0]!.seq-1);
      return {version:1,reset,cursor:s.cursor,events:reset?[]:s.events.filter(e=>e.seq>after)};
    },
    async send(ownerId:string,id:string,input:{clientMessageId:string;text:string}){
      if(!input.clientMessageId||input.clientMessageId.length>200||!input.text.trim()||input.text.length>100_000)throw Error("invalid_message");
      const receipt=await store.transaction(ownerId,id,s=>{
        if(s.definition.execution.kind!=="external")throw Error("executor_not_supported");
        const old=s.messages.find(m=>m.id===input.clientMessageId);
        if(old){if(old.role!=="user"||old.text!==input.text)throw Error("message_id_conflict");return {messageId:old.id,delivery:old.delivery??"sent"};}
        const m:ConversationMessage={id:input.clientMessageId,role:"user",text:input.text,createdAt:new Date(now()).toISOString(),revision:0,delivery:"queued",status:"complete",aliases:[]};s.messages.push(m);messageChanged(s,m);return {messageId:m.id,delivery:m.delivery!};
      });
      const a=active.get(id);if(a)scheduleDrain(id,a);
      return receipt;
    },
    async answerPermission(ownerId:string,id:string,requestId:string,commandId:string,decision:PermissionDecision){
      if(!commandId||commandId.length>200)throw Error("invalid_command");
      await store.transaction(ownerId,id,s=>{
        const p=s.permissions.find(p=>p.id===requestId);if(!p)throw Error("not_found");
        const withId=p as ConversationPermission&{commandId?:string};
        if(withId.commandId===commandId){if(stableJSON(p.decision)!==stableJSON(decision))throw Error("command_id_conflict");return;}
        if(p.status!=="open")throw Error("permission_not_pending");permissionResponse(p,decision);
        withId.commandId=commandId;p.decision=structuredClone(decision);p.status="responding";permissionChanged(s,p);
      });
      const a=active.get(id);if(a)await dispatchDecision(id,a,requestId,decision);
      return {accepted:true};
    },
    async stop(ownerId:string,id:string,commandId:string){
      const a=active.get(id);if(!a||!a.ready||a.ownerId!==ownerId||a.executor.status()==="offline")throw Error("executor_offline");
      const needed=await guarded(id,a,s=>{
        const state=s as ConversationState&{stop?:{id:string;generation:number}};
        if(!commandId||commandId.length>200)throw Error("invalid_command");
        if(state.stop?.generation===s.turn.generation)return false;if(s.turn.status!=="running")return false;
        state.stop={id:commandId,generation:s.turn.generation};s.turn.stopRequested=true;statusChanged(s);return true;
      });
      if(needed)try{assertActive(a);await bounded(a.executor.stopTurn());}catch(error){
        await guarded(id,a,s=>{const state=s as ConversationState&{stop?:{id:string;generation:number}};if(state.stop?.id===commandId&&state.stop.generation===s.turn.generation){delete state.stop;delete s.turn.stopRequested;statusChanged(s);}});throw error;
      }return {requested:needed};
    },
    async close(){closed=true;
      for(const a of active.values()){a.lost=true;a.off();clearInterval(a.timer);}
      await Promise.allSettled([...starts.values()]);
      await Promise.all([...active].map(async([id,a])=>{a.lost=true;a.off();clearInterval(a.timer);await a.tail;await store.transaction(a.ownerId,id,s=>{if(s.lease?.holder===a.holder)delete s.lease;});}));active.clear();},
  };
}
export type ExternalConversationService=ReturnType<typeof createExternalConversationService>;

function stableJSON(value:unknown):string {
  if(Array.isArray(value))return "["+value.map(stableJSON).join(",")+"]";
  if(value&&typeof value==="object")return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+stableJSON((value as Record<string,unknown>)[key])).join(",")+"}";
  return JSON.stringify(value)??"undefined";
}
