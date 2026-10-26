/** Versioned native conversation protocol. Independent of model providers and UIMessageChunk. */
export type ConnectionStatus = "idle" | "thinking" | "waiting_approval" | "offline";
export type DeliveryStatus = "queued" | "sending" | "unknown" | "sent";
export interface ConversationDefinition {
  id: string; ownerId: string; title: string; pinned?: boolean;
  execution: { kind: "external" | "model"; id: string };
  modelChoice?: { modelId: string; providerId: string; reasoning?: string };
}
export interface ConversationMessage {
  id: string; role: "user" | "assistant" | "system"; text: string; createdAt: string; revision: number;
  delivery?: DeliveryStatus;
  status: "complete" | "streaming" | "stopped" | "error" | "unknown";
  aliases: Array<{id:string; epoch?:string}>;
}
export interface ExternalPermissionRequest {
  id: string; name: string; kind: string; title?: string; description?: string;
  input?: Record<string, unknown>;
  actions?: Array<{id:string;label:string;behavior:"allow"|"deny"}>;
}
export interface PermissionDecision { actionId?: string; behavior?: "allow" | "deny"; answers?: Record<string,string> }
export type ExternalPermissionResponse =
  | {behavior:"allow";selectedActionId?:string;updatedInput?:Record<string,unknown>}
  | {behavior:"deny";selectedActionId?:string};
export interface ConversationPermission extends ExternalPermissionRequest {
  revision: number; status: "open" | "responding" | "resolved"; decision?: PermissionDecision;
}
export interface ExternalMessage {id:string;role:"user"|"manager"|"assistant"|"system";text:string;createdAt:string}
export type ExternalConversationEvent =
 | {type:"message";message:ExternalMessage;rebuilt?:boolean}
 | {type:"delta";id:string;textSoFar:string}
 | {type:"turn_started"}
 | {type:"turn_ended";outcome:"completed"|"canceled"|"failed"|"unknown";error?:string}
 | {type:"status";manager:ConnectionStatus}
 | {type:"permission_requested";request:ExternalPermissionRequest}
 | {type:"permission_resolved";requestId:string}
 | {type:"permissions_snapshot";requests:ExternalPermissionRequest[]}
 /** Required before a rebuilt replay; epoch is stable across restart of the bridge. */
 | {type:"history_reset";epoch:string};
export interface ExternalExecutor {
  status(): ConnectionStatus;
  send(text:string,messageId:string):Promise<void>;
  stopTurn():Promise<void>;
  respondToPermission(requestId:string,response:ExternalPermissionResponse):Promise<void>;
  /** The source MUST await this promise before advancing its durable source cursor. */
  onConversation(listener:(event:ExternalConversationEvent)=>Promise<void>):()=>void;
  /** Replay/reconcile through the same ordered, acknowledged sink, then resolve. Include permissions_snapshot. */
  reconcile():Promise<void>;
}
/** Use only when the transport can prove no submission was accepted. Ordinary failures are ambiguous. */
export class ExternalDispatchRejected extends Error {
  readonly code="external_dispatch_rejected" as const;
}
/** Explicit adapter assertion of proven non-acceptance; works across duplicate package copies. */
export function isExternalDispatchRejected(error:unknown):boolean {
  return error instanceof ExternalDispatchRejected || !!(error&&typeof error==="object"&&"code" in error&&error.code==="external_dispatch_rejected");
}
export interface ConversationView {
  id:string;title:string;pinned:boolean;execution:{kind:"external"|"model"};modelChoice?:ConversationDefinition["modelChoice"];
  updatedAt:string;connection:ConnectionStatus;
}
export interface ConversationTurn {status:"idle"|"running"|"stopped"|"error"|"unknown";generation:number;stopRequested?:boolean;error?:string}
export type ConversationChange =
 | {type:"message";message:ConversationMessage}
 | {type:"permission";permission:ConversationPermission}
 | {type:"status";connection:ConnectionStatus;turn:ConversationTurn};
export type ConversationFeedEvent = ConversationChange & {version:1;seq:number;chatId:string};
export interface ConversationSnapshot {version:1;conversation:ConversationView;cursor:number;messages:ConversationMessage[];permissions:ConversationPermission[];turn:ConversationTurn}
export interface ConversationState {
  definition:ConversationDefinition;updatedAt:string;connection:ConnectionStatus;turn:ConversationTurn;
  messages:ConversationMessage[];permissions:ConversationPermission[];cursor:number;events:ConversationFeedEvent[];
  epoch?:string;lease?:{holder:string;expiresAt:number};
}
/** Atomic synchronous callback: exceptions roll back all projection and journal writes together. Never await inside. */
export interface ConversationStore {
  readonly guarded:true;
  create(definition:ConversationDefinition):Promise<void>;
  list(ownerId:string):Promise<ConversationView[]>;
  read(ownerId:string,chatId:string):Promise<ConversationState>;
  transaction<T>(ownerId:string,chatId:string,change:(state:ConversationState)=>T):Promise<T>;
}
