import type { AgentToolsModel } from "@ykurilov/agent-chat-core";
import type { Tool } from "ai";
import type { AgentFlow } from "../format/flow-format";
import type { FlowRuntime } from "./flow-events";

/**
 * Служебный инструмент сценария из своего файла. Набор зависит только от версии сценария, а не от состояния: кэш цел.
 * Сценарий без нужных полей — инструмента нет, набор как в 0.48.
 */
export interface FlowExtraTool {
  name: string;
  wanted(flow: AgentFlow): boolean;
  make(input: { runtime: FlowRuntime; model: AgentToolsModel }): Tool;
}
