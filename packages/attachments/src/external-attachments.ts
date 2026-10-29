import { resolveUnsentRetentionMs } from "./unsent-retention";
import type { ConversationAttachment, ExternalAttachmentAccess } from "@ykurilov/agent-chat-core/external";
import type { AttachmentStorage } from "./attachment-storage";
import { isAttachmentId } from "./attachment-storage";
import { createAttachmentRoutes } from "./attachment-routes";
import type { AttachmentRoutes } from "./attachment-routes";
import { resolveAttachmentLimits } from "./limits";
import type { AttachmentLimits } from "./limits";

export interface ExternalAttachmentsOptions {storage:AttachmentStorage;limits?:Partial<AttachmentLimits>;
 /** Unsent file retention in milliseconds; default 24h, null disables age-based expiry. */
 unsentRetentionMs?:number|null;allowGenericFiles?:boolean;acceptedMediaTypes?:readonly string[];now?:()=>Date}
/** Existing file pipeline and storage, with conversation ownership supplied by the external HTTP handler. */
export function createExternalAttachments(options:ExternalAttachmentsOptions):ExternalAttachmentAccess&AttachmentRoutes {
 const unsentRetentionMs=resolveUnsentRetentionMs(options.unsentRetentionMs);
 const {storage}=options,limits=resolveAttachmentLimits(options.limits),now=options.now??(()=>new Date());
 if(typeof storage.removeUnattached!=="function")throw TypeError("AttachmentStorage requires removeUnattached");
 let cleaned=0;
 const {routes}=createAttachmentRoutes({storage,limits,now,extractFileText:false,acceptedMediaTypes:options.acceptedMediaTypes,allowGenericFiles:options.allowGenericFiles,onUpload:()=>{
  if(unsentRetentionMs===null)return;
  if(now().getTime()-cleaned<15*60_000)return;cleaned=now().getTime();void storage.removeUnattachedOlderThan(new Date(cleaned-unsentRetentionMs)).catch(()=>{});
 }});
 const own=async(ownerId:string,chatId:string,id:string)=>{
  const record=isAttachmentId(id)?await storage.get(id):undefined;
  if(!record||record.ownerId!==ownerId||record.chatId!==chatId)throw Error("attachment_not_found");
  return record;
 };
 const ref=(record:ConversationAttachment):ConversationAttachment=>({id:record.id,name:record.name,mediaType:record.mediaType,size:record.size,kind:record.kind});
 return {...routes,
  async accept({ownerId,chatId,ids}){
   if(ids.length>limits.maxFiles)throw Error("attachment_too_many");
   const result:ConversationAttachment[]=[];
   for(const id of ids){const record=await own(ownerId,chatId,id);if(unsentRetentionMs!==null&&!record.attached&&Date.parse(record.createdAt)<now().getTime()-unsentRetentionMs)throw Error("attachment_expired");if(record.kind==="file"&&!options.allowGenericFiles)throw Error("attachment_unsupported_type");if(options.acceptedMediaTypes&&!options.acceptedMediaTypes.includes(record.sourceMediaType??record.mediaType))throw Error("attachment_unsupported_type");if(record.size>limits.maxFileBytes)throw Error("attachment_too_large");result.push(ref(record));}
   return result;
  },
  async confirm({ownerId,chatId,attachments}){
   for(const attachment of attachments){await own(ownerId,chatId,attachment.id);await storage.markAttached(attachment.id);const saved=await own(ownerId,chatId,attachment.id);if(!saved.attached)throw Error("attachment_not_found");}
  },
  async open({ownerId,chatId,attachment}){
   const record=await own(ownerId,chatId,attachment.id);if(!record.attached)throw Error("attachment_not_found");
   return {...ref(record),async readBytes(){const current=await own(ownerId,chatId,record.id);if(!current.attached)throw Error("attachment_not_found");const bytes=await storage.readBytes(record.id);if(!bytes)throw Error("attachment_not_found");return bytes;}};
  },
 };
}
