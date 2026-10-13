import type { GenericToolApprovalFunction, ToolSet } from "ai";
import { ALWAYS_OFFERED_REASON } from "./approval-parts";

export interface PreparedToolApproval {
  /** Инструменты для SDK: без устаревшего `needsApproval`, решает только правило ниже. */
  tools: ToolSet | undefined;
  /** Правило для `streamText`; нет, если ни один инструмент подтверждения не просит. */
  toolApproval?: GenericToolApprovalFunction<ToolSet, any, unknown>;
}

interface NeedsApprovalOptions {
  toolCallId: string;
  messages: unknown[];
  experimental_context?: unknown;
}
type NeedsApproval = boolean | ((input: unknown, options: NeedsApprovalOptions) => boolean | PromiseLike<boolean>);

const needsApprovalOf = (tool: unknown): NeedsApproval | undefined => (tool as { needsApproval?: NeedsApproval }).needsApproval;

/**
 * Поле `needsApproval` инструмента приложения превращается в правило `toolApproval` современного SDK.
 * Инструмент с флагом `true` из набора `alwaysAllowed` (человек нажал «Всегда в этом чате») спрашивать не нужно;
 * у функции метка не учитывается, и запрос не предлагает «Всегда» (`requestReason`).
 * Правило в запрос к модели не попадает, поэтому кэш модели не страдает.
 */
export function prepareToolApproval(tools: ToolSet | undefined, alwaysAllowed: ReadonlySet<string>): PreparedToolApproval {
  if (!tools || !Object.values(tools).some((tool) => needsApprovalOf(tool) !== undefined && needsApprovalOf(tool) !== false)) {
    return { tools };
  }
  const withoutFlag: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    const { needsApproval: _flag, ...rest } = tool as typeof tool & { needsApproval?: unknown };
    withoutFlag[name] = rest as typeof tool;
  }
  return {
    tools: withoutFlag,
    toolApproval: async ({ toolCall, messages }) => {
      const needs = needsApprovalOf(tools[toolCall.toolName]);
      if (needs === undefined || needs === false) return undefined;
      // «Всегда» действует только на простой флаг: функция каждый раз смотрит на входные данные.
      if (needs === true) {
        return alwaysAllowed.has(toolCall.toolName) ? "not-applicable" : { type: "user-approval", reason: ALWAYS_OFFERED_REASON };
      }
      const asked = await needs(toolCall.input, { toolCallId: toolCall.toolCallId, messages });
      return asked ? "user-approval" : undefined;
    },
  };
}
