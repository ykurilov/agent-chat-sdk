import type { KnownTexts, ReplyCheck, ReplyChecksSetting, ReplyChecksWebMode } from "@ykurilov/agent-chat-core";
import type { AgentFlow } from "../format/flow-format";

// Тексты сценария, слова и ссылки из которых законны в ответе агента: сценарий их вписал сам. Нужны проверкам ответа
// (`replyChecks.knownTexts`): первое сообщение, прощание и тексты нод не стоят в инструкции целиком, а попадают к модели
// служебным сообщением или готовой фразой, которую проверки «виденным» не считают.

/** Тексты сценария: общая часть, ноды, первые сообщения, прощание, рамки дня, попутные задачи. */
export function flowKnownTexts(flow: AgentFlow): string[] {
  const texts = [
    flow.common,
    ...flow.states.flatMap((state) => [state.title, state.instructions, state.firstMessage]),
    flow.schedule?.farewellText,
    flow.schedule?.dayFrame?.hardText,
    ...(flow.sideTasks ?? []).flatMap((task) => [task.text, task.when]),
  ];
  return texts.filter((text): text is string => typeof text === "string" && text.trim() !== "");
}

/**
 * `replyChecks` службы с текстами сценария чата в `knownTexts` (после своих текстов приложения). Чат без сценария и сбой
 * чтения сценария — только свои тексты; сбой — строка в журнал.
 */
export function withFlowKnownTexts(
  setting: ReplyChecksSetting,
  flowOf: (ownerId: string, chatId: string) => Promise<{ flow: AgentFlow } | null>,
  logError: (message: string) => void,
): ReplyChecksSetting {
  const given = setting as { checks?: readonly ReplyCheck[]; web?: ReplyChecksWebMode; knownTexts?: KnownTexts };
  const own = Array.isArray(setting) ? undefined : given.knownTexts;
  const base = Array.isArray(setting) ? { checks: setting as readonly ReplyCheck[] } : (setting as { checks: readonly ReplyCheck[]; web?: ReplyChecksWebMode });
  return {
    ...base,
    knownTexts: async (context) => {
      const mine = own ? await own(context) : [];
      try {
        const pinned = await flowOf(context.ownerId, context.chatId);
        return pinned ? [...mine, ...flowKnownTexts(pinned.flow)] : mine;
      } catch (failure) {
        logError(`[сценарий] чат=${context.chatId}: тексты сценария для проверки ответа не прочитаны: ${failure instanceof Error ? failure.message : String(failure)}`);
        return mine;
      }
    },
  };
}
