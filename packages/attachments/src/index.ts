export { createAttachments } from "./create-attachments";
export type { Attachments, ChatImage, CreateAttachmentsOptions } from "./create-attachments";
export type { BlindImageMarkerInput, ImagesForBlindModels } from "./images-for-blind-models";
export type { AttachmentRoutes, IngestedFile, IngestFileResult } from "./attachment-routes";
export { createDiskAttachmentStorage } from "./disk-attachment-storage";
export { createMemoryAttachmentStorage } from "./memory-attachment-storage";
export { isAttachmentId } from "./attachment-storage";
export type { AttachmentKind, AttachmentStorage, StoredAttachment } from "./attachment-storage";
export { detectFileKind } from "./detect-file-kind";
export type { DetectedFile } from "./detect-file-kind";
export { attachmentsInstructions } from "./instructions";
export { defaultAttachmentLimits } from "./limits";
export type { AttachmentLimits } from "./limits";

export { createExternalAttachments } from "./external-attachments";
export type { ExternalAttachmentsOptions } from "./external-attachments";
