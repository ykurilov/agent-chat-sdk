import type { ReasoningLevelId, ReasoningRequest } from "../model-catalog";

/** Уровни для провайдеров, которые принимают общий параметр SDK `reasoning` (Fireworks, Together). */
export function sdkReasoningRequest(level: ReasoningLevelId): ReasoningRequest {
  switch (level) {
    case "off":
      return { reasoning: "none" };
    case "on":
      return { reasoning: "provider-default" };
    case "max":
      return { reasoning: "xhigh" };
    default:
      return { reasoning: level };
  }
}
