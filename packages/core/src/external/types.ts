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
  attachments?:ConversationAttachment[];
  /** First committed position in this conversation; absent in pre-0.85 records. */
  sequence?: number;
  status: "complete" | "streaming" | "stopped" | "error" | "unknown";
  aliases: Array<{id:string; epoch?:string}>;
}
export interface ExternalPermissionRequest {
  id: string; name: string; kind: string; title?: string; description?: string; createdAt?: string;
  input?: Record<string, unknown>;
  actions?: Array<{id:string;label:string;behavior:"allow"|"deny"}>;
}
export interface PermissionDecision { actionId?: string; behavior?: "allow" | "deny"; answers?: Record<string,string> }
export type ExternalPermissionResponse =
  | {behavior:"allow";selectedActionId?:string;updatedInput?:Record<string,unknown>}
  | {behavior:"deny";selectedActionId?:string;message?:string};
export interface ConversationPermission extends ExternalPermissionRequest {
  revision: number; status: "open" | "responding" | "resolved"; decision?: PermissionDecision;
  /** Actual source resolution, distinct from a submitted SDK intent. Absence means unknown. */
  resolution?: ExternalPermissionResponse; sequence?: number;
}
export interface ExternalMessage {id:string;role:"user"|"manager"|"assistant"|"system";text:string;createdAt:string}
export type ExternalConversationEvent =
 | {type:"message";message:ExternalMessage;rebuilt?:boolean}
 | {type:"delta";id:string;textSoFar:string}
 | {type:"turn_started"}
 | {type:"turn_ended";outcome:"completed"|"canceled"|"failed"|"unknown";error?:string}
 | {type:"status";manager:ConnectionStatus}
 | {type:"permission_requested";request:ExternalPermissionRequest}
 | {type:"permission_resolved";requestId:string;decision?:ExternalPermissionResponse}
 | {type:"permissions_snapshot";requests:ExternalPermissionRequest[]}
 /** Required before a rebuilt replay; epoch is stable across restart of the bridge. */
 | {type:"history_reset";epoch:string}
 | {type:"model_state";state:ExternalModelState};
export interface ExternalExecutor {
  status(): ConnectionStatus;
  send(text:string,messageId:string):Promise<void>;
  /** Optional richer send; never silently fall back to text if files are present. */
  sendMessage?(input:{text:string;messageId:string;attachments:ExternalAttachment[]}):Promise<void>;
  models?():Promise<ExternalModelState>;
  /** Recheck expectedRevision against a fresh source snapshot, then emit model_state with actual result. */
  setModel?(input:ExternalModelCommand):Promise<void>;
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
 | {type:"model_state";modelState:ExternalModelState}
 | {type:"permission";permission:ConversationPermission}
 | {type:"status";connection:ConnectionStatus;turn:ConversationTurn};
export type ConversationFeedEvent = ConversationChange & {version:1;seq:number;chatId:string};
export interface ConversationSnapshot {version:1;conversation:ConversationView;cursor:number;messages:ConversationMessage[];permissions:ConversationPermission[];turn:ConversationTurn;modelState?:ExternalModelState}
export interface ConversationState {
  definition:ConversationDefinition;updatedAt:string;connection:ConnectionStatus;turn:ConversationTurn;
  messages:ConversationMessage[];permissions:ConversationPermission[];cursor:number;events:ConversationFeedEvent[];
  modelState?:ExternalModelState;
  modelCommands?:Array<ExternalModelCommand&{status:"applying"|"applied"|"unknown"}>;
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

/** Another service currently owns the conversation. Message stays compatible with 0.84. */
export class ExternalConversationBusyError extends Error {
  readonly code = "external_conversation_busy" as const;
  constructor() { super("busy"); this.name = "ExternalConversationBusyError"; }
}

/** Durable references only. Bytes are available solely to the trusted server-side adapter. */
export interface ConversationAttachment { id:string; name:string; mediaType:string; size:number; kind:"image"|"pdf"|"text"|"file" }
export interface ExternalAttachment extends ConversationAttachment { readBytes():Promise<Uint8Array> }
export interface ExternalAttachmentAccess {
  accept(input:{ownerId:string;chatId:string;ids:readonly string[]}):Promise<ConversationAttachment[]>;
  confirm(input:{ownerId:string;chatId:string;attachments:readonly ConversationAttachment[]}):Promise<void>;
  open(input:{ownerId:string;chatId:string;attachment:ConversationAttachment}):Promise<ExternalAttachment>;
}
export interface ExternalModelChoice { id:string; reasoning?:string }
export interface ExternalModel { id:string; label:string; description?:string; isDefault?:boolean; reasoning?:{levels:string[];default?:string} }
export interface ExternalModelState { revision:string; models:ExternalModel[]; selected:ExternalModelChoice; canChange:boolean }
export interface ExternalModelCommand { commandId:string; expectedRevision:string; choice:ExternalModelChoice }
/** Machine-readable errors, safe across multiple installed SDK copies. */
export class ExternalModelError extends Error { constructor(readonly code:string){super(code);this.name="ExternalModelError";} }
