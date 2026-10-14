import { z } from "zod";
import { agentFlowSchema } from "./flow-schema";

/** JSON Schema сценария (то, что пишет автор: значения по умолчанию необязательны). Лежит в пакете: `agent-flow.schema.json`. */
export function flowJsonSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(agentFlowSchema, { io: "input", unrepresentable: "any" }),
    $id: "https://github.com/ykurilov/agent-chat-sdk/packages/flows/agent-flow.schema.json",
    title: "Сценарий поведения агента (agent-flow)",
  };
}
