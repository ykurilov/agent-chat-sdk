import type { AgentFlow } from "../../format/flow-format";

/** Часть постоянных правил сценария; не нужна этому сценарию — `null`. Текст зависит только от версии сценария (кэш). */
export type FlowRulePart = (flow: AgentFlow) => string | null;
