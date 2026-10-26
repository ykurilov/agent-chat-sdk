import Database from "better-sqlite3";
import { conversationView, initialConversation } from "@ykurilov/agent-chat-core/external";
import type { ConversationDefinition, ConversationState, ConversationStore, ConversationFeedEvent, ConversationMessage } from "@ykurilov/agent-chat-core/external";

/** Opt-in external/native projection, isolated tables; does not change ordinary ChatStorage. */
export function createSqliteConversationStore(path:string):ConversationStore&{close():void} {
  const db=new Database(path);
  db.pragma("journal_mode = WAL");db.pragma("busy_timeout = 5000");db.pragma("foreign_keys = ON");
  db.transaction(()=>db.exec(`
    CREATE TABLE IF NOT EXISTS sdk_external_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
    INSERT OR IGNORE INTO sdk_external_schema VALUES (1,1);
    CREATE TABLE IF NOT EXISTS sdk_external_conversations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sdk_external_messages (chat_id TEXT NOT NULL REFERENCES sdk_external_conversations(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(chat_id,id));
    CREATE TABLE IF NOT EXISTS sdk_external_events (chat_id TEXT NOT NULL REFERENCES sdk_external_conversations(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(chat_id,seq));
  `)).immediate();
  const version=db.prepare("SELECT version FROM sdk_external_schema WHERE id=1").get() as {version:number};
  if(version.version!==1){db.close();throw Error("unsupported_external_schema");}
  function read(ownerId:string,id:string):ConversationState {
    const row=db.prepare("SELECT metadata FROM sdk_external_conversations WHERE id=? AND owner_id=?").get(id,ownerId) as {metadata:string}|undefined;
    if(!row)throw Error("not_found");
    return {...JSON.parse(row.metadata),messages:(db.prepare("SELECT data FROM sdk_external_messages WHERE chat_id=? ORDER BY position").all(id) as Array<{data:string}>).map(r=>JSON.parse(r.data) as ConversationMessage),events:(db.prepare("SELECT data FROM sdk_external_events WHERE chat_id=? ORDER BY seq").all(id) as Array<{data:string}>).map(r=>JSON.parse(r.data) as ConversationFeedEvent)};
  }
  function write(s:ConversationState) {
    const {messages,events,...metadata}=s;
    db.prepare("UPDATE sdk_external_conversations SET metadata=? WHERE id=? AND owner_id=?").run(JSON.stringify(metadata),s.definition.id,s.definition.ownerId);
    const put=db.prepare("INSERT INTO sdk_external_messages(chat_id,id,position,data) VALUES(?,?,?,?) ON CONFLICT(chat_id,id) DO UPDATE SET position=excluded.position,data=excluded.data WHERE data<>excluded.data OR position<>excluded.position");
    messages.forEach((m,index)=>put.run(s.definition.id,m.id,index,JSON.stringify(m)));
    const event=db.prepare("INSERT OR IGNORE INTO sdk_external_events(chat_id,seq,data) VALUES(?,?,?)");
    for(const e of events)event.run(s.definition.id,e.seq,JSON.stringify(e));
    db.prepare("DELETE FROM sdk_external_events WHERE chat_id=? AND seq<?").run(s.definition.id,events[0]?.seq??s.cursor+1);
  }
  return {guarded:true,
    close(){db.close();},
    async create(d:ConversationDefinition){db.transaction(()=>{
      const row=db.prepare("SELECT owner_id,metadata FROM sdk_external_conversations WHERE id=?").get(d.id) as {owner_id:string;metadata:string}|undefined;
      if(row){if(row.owner_id!==d.ownerId)throw Error("not_found");if(JSON.stringify(JSON.parse(row.metadata).definition.execution)!==JSON.stringify(d.execution))throw Error("execution_conflict");return;}
      const {messages:_m,events:_e,...s}=initialConversation(d);
      db.prepare("INSERT INTO sdk_external_conversations VALUES(?,?,?)").run(d.id,d.ownerId,JSON.stringify(s));
    }).immediate();},
    async read(ownerId,id){return db.transaction(()=>read(ownerId,id))();},
    async list(ownerId){return (db.prepare("SELECT metadata FROM sdk_external_conversations WHERE owner_id=?").all(ownerId) as Array<{metadata:string}>).map(r=>conversationView(JSON.parse(r.metadata))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));},
    async transaction<T>(ownerId:string,id:string,change:(s:ConversationState)=>T):Promise<T>{return db.transaction(()=>{
      const s=read(ownerId,id);const result=change(s);
      if(result&&typeof result==="object"&&"then" in result)throw Error("async_transaction_forbidden");
      write(s);return structuredClone(result);
    }).immediate();},
  };
}
