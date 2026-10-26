import type { ConversationDefinition, ConversationState, ConversationStore, ConversationView } from "./types";
export function conversationView(s:ConversationState):ConversationView {
  return {id:s.definition.id,title:s.definition.title,pinned:s.definition.pinned===true,execution:{kind:s.definition.execution.kind},
    ...(s.definition.modelChoice&&{modelChoice:structuredClone(s.definition.modelChoice)}),updatedAt:s.updatedAt,connection:s.connection};
}
export function initialConversation(definition:ConversationDefinition):ConversationState {
  if(!definition.id||!definition.ownerId||!definition.title||!definition.execution.id||!["external","model"].includes(definition.execution.kind))throw Error("invalid_conversation");
  return {definition:structuredClone(definition),updatedAt:new Date().toISOString(),connection:"offline",turn:{status:"idle",generation:0},messages:[],permissions:[],events:[],cursor:0};
}
export function createMemoryConversationStore():ConversationStore {
  const records=new Map<string,ConversationState>();
  const own=(ownerId:string,id:string)=>{const state=records.get(id);if(!state||state.definition.ownerId!==ownerId)throw Error("not_found");return state;};
  return {guarded:true,
    async create(d){const old=records.get(d.id);if(old){if(old.definition.ownerId!==d.ownerId)throw Error("not_found");if(JSON.stringify(old.definition.execution)!==JSON.stringify(d.execution))throw Error("execution_conflict");return;}records.set(d.id,initialConversation(d));},
    async list(ownerId){return [...records.values()].filter(s=>s.definition.ownerId===ownerId).map(conversationView).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));},
    async read(ownerId,id){return structuredClone(own(ownerId,id));},
    async transaction(ownerId,id,change){const next=structuredClone(own(ownerId,id));const result=change(next);if(result&&typeof result==="object"&&"then" in result)throw Error("async_transaction_forbidden");records.set(id,next);return structuredClone(result);},
  };
}
