/** Ссылка на проверку, зарегистрированную сервером приложения, а не моделью или JSON сценария. */
export interface FlowConfirmationRef {
  key: string;
  revision: string;
}

export interface FlowConfirmationScope {
  ownerId: string;
  chatId: string;
  flowId: string;
}

export interface FlowConfirmationReceipt extends FlowConfirmationRef {
  status: "confirmed";
  scope: FlowConfirmationScope;
  criterionHash: string;
  checkedAt: number;
  source: {
    kind: "judge";
    versionId: string;
    answerId: string;
    humanMessageId: string;
    probability: number;
  };
}

/** Tombstone: прежнее доказательство не используется для повторного подтверждения после исправления. */
export interface FlowConfirmationRevocation extends FlowConfirmationRef {
  status: "revoked";
  versionId: string;
  scope: FlowConfirmationScope;
  criterionHash: string;
  revokedAt: number;
  afterMessageId: string | null;
  reason: string;
  operationKey: string;
}

export type FlowConfirmationRecord = FlowConfirmationReceipt | FlowConfirmationRevocation;
