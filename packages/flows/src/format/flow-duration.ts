import type { FlowDuration, FlowTimerUnit } from "./flow-format";

/** Мс в единице срока формата; d = 24 ч. */
export const FLOW_UNIT_MS: Readonly<Record<FlowTimerUnit, number>> = { min: 60_000, h: 3_600_000, d: 86_400_000 };

/** Срок формата в мс: «3 d» → 259 200 000. */
export const flowDurationMs = (duration: FlowDuration): number => duration.amount * FLOW_UNIT_MS[duration.unit];
