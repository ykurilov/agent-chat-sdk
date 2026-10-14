import type { AgentToolsModel, AgentToolsSource, AppStateAccess } from "@ykurilov/agent-chat-core";
import { tool, type Tool, type ToolSet } from "ai";
import { z } from "zod";
import { FLOW_STATE_KEY, type Transition } from "../engine/flow-run";
import { stateById } from "../engine/flow-graph";
import { nextTransition } from "../engine/next-transition";
import { applyTransition, claimAllowed, noteRejectedClaim } from "../engine/run-updates";
import { judgeExits, stateGoal } from "../prompt/state-card";
import { advance, chainLimitMessage, currentRun, transitionReport, type ChatFlowRun, type FlowRuntime, type PinnedFlow } from "./flow-events";
import type { ClientCardTools, FlowJudge, JudgeMessage } from "./flow-types";
import { chatTime } from "./test-clock";
import type { FlowExtraTool } from "./extra-tool";
import { timeZoneTool } from "./time-zone-tool";
import { closeDayTool } from "./close-day-tool";
import { sideTaskTool } from "./side-task-tool";

export const FLOW_EXIT_TOOL = "flow_exit";

/** Служебные инструменты возможностей сценария, каждый из своего файла. */
export const FLOW_EXTRA_TOOLS: readonly FlowExtraTool[] = [timeZoneTool, closeDayTool, sideTaskTool];

export interface FlowToolsInput {
  runtime: FlowRuntime;
  judge: () => FlowJudge;
  /** Последние реплики чата для судьи. */
  history: (ownerId: string, chatId: string) => Promise<JudgeMessage[]>;
  /** `flow_note` и `client_card`; модуля ещё нет — пусто. */
  cardTools: () => ClientCardTools["tools"];
  /**
   * Сценарий чата, уже прочитанный в этом ходе (`prepareTurn`, инструкция); набор инструментов собирается без ожидания.
   * Нет — только инструменты 0.48.
   */
  knownFlow: (chatId: string) => PinnedFlow | undefined;
  extraTools?: readonly FlowExtraTool[];
}

const NO_FLOW = "В этом чате нет сценария: переходов нет, продолжай разговор.";

/** Чат по сценарию в ходе: сценарий, место и запись состояния. Нет сценария или вызов вне хода — `null`. */
async function flowOfTurn(runtime: FlowRuntime, model: AgentToolsModel): Promise<{ pinned: PinnedFlow; state: AppStateAccess; run: ChatFlowRun } | null> {
  if (!model.state) return null;
  const pinned = await runtime.chatFlow(model.ownerId, model.chatId);
  if (!pinned) return null;
  return { pinned, state: model.state, run: currentRun(pinned.flow, { [FLOW_STATE_KEY]: model.state.get(FLOW_STATE_KEY) }, runtime.now()) };
}

/** Записать новое место и сообщить о переходах; результат — карточка нового состояния. */
async function commit(runtime: FlowRuntime, model: AgentToolsModel, turn: { pinned: PinnedFlow; state: AppStateAccess }, run: ChatFlowRun, transitions: Transition[]) {
  turn.state.set(FLOW_STATE_KEY, run);
  await runtime.afterTransitions({ ownerId: model.ownerId, chatId: model.chatId, pinned: turn.pinned, run, transitions });
  return transitionReport(turn.pinned.flow, run, transitions);
}

/** После успешного инструмента: событие «вызван инструмент» и условия по данным. Перехода нет — `null`. */
async function afterToolCall(runtime: FlowRuntime, model: AgentToolsModel, name: string, event: boolean): Promise<string | null> {
  const turn = await flowOfTurn(runtime, model);
  if (!turn) return null;
  const now = chatTime(turn.run, runtime.now());
  const transitions: Transition[] = [];
  const input = {
    now,
    card: await runtime.cardValues(model.ownerId),
    out: transitions,
    onChainLimit: (stopped: ChatFlowRun) => runtime.logError(chainLimitMessage(model.chatId, stopped)),
  };
  let run = event ? advance(turn.pinned.flow, turn.run, { type: "event", event: "tool", name }, input) : turn.run;
  if (transitions.length === 0) run = advance(turn.pinned.flow, run, { type: "data", card: input.card }, input);
  return transitions.length > 0 ? commit(runtime, model, turn, run, transitions) : null;
}

type ToolCallOptions = Parameters<NonNullable<Tool["execute"]>>[1];

const isGeneratorFunction = (fn: unknown) => Object.prototype.toString.call(fn) === "[object AsyncGeneratorFunction]";

/**
 * Обёртка инструмента: инструмент сценария не из этого состояния не исполняется (набор инструментов тот же во всех
 * состояниях — кэш цел), после успеха — событие и условия по данным; переход — карточка в результате.
 */
function wrapTool(runtime: FlowRuntime, model: AgentToolsModel, name: string, original: Tool, event: boolean): Tool {
  const execute = original.execute;
  if (!execute) return original;
  const refusal = async (): Promise<string | null> => {
    if (!event) return null;
    const turn = await flowOfTurn(runtime, model);
    if (!turn || !turn.pinned.flow.tools.includes(name)) return null;
    const state = stateById(turn.pinned.flow, turn.run.state);
    return state?.tools.includes(name) ? null : `Сейчас нельзя: «${name}» в этом состоянии недоступно. Не вызывай его, пока состояние не сменится.`;
  };
  if (isGeneratorFunction(execute)) {
    return {
      ...original,
      execute: async function* (input: unknown, options: ToolCallOptions) {
        const refused = await refusal();
        if (refused) {
          yield refused;
          return;
        }
        let last: unknown;
        for await (const value of execute(input, options) as AsyncIterable<unknown>) {
          last = value;
          yield value;
        }
        const report = await afterToolCall(runtime, model, name, event);
        if (report) yield { result: last, flow: report };
      },
    } as Tool;
  }
  return {
    ...original,
    execute: async (input: unknown, options: ToolCallOptions) => {
      const refused = await refusal();
      if (refused) return refused;
      const result = await execute(input, options);
      const report = await afterToolCall(runtime, model, name, event);
      return report ? { result, flow: report } : result;
    },
  } as Tool;
}

/** `flow_exit`: агент заявил, что условие словами выполнено; переход — только если судья подтвердил. */
function flowExitTool(input: FlowToolsInput, model: AgentToolsModel): Tool {
  const { runtime } = input;
  return tool({
    description:
      "Условие выхода из текущего состояния сценария выполнено. Номер условия — из карточки состояния (блок flow:state), why — одна фраза, почему. Переход проверит судья; подтвердит — в ответе карточка нового состояния.",
    inputSchema: z.object({
      exit: z.number().int().describe("Номер условия из карточки состояния"),
      why: z.string().describe("Почему условие выполнено, одной фразой"),
    }),
    execute: async ({ exit, why }, { abortSignal }) => {
      const turn = await flowOfTurn(runtime, model);
      if (!turn) return NO_FLOW;
      if (turn.run.endedAt !== undefined || turn.pinned.ended) return "Программа закончилась: переходов больше нет, отвечай по общей части.";
      const { flow } = turn.pinned;
      const chosen = judgeExits(flow, turn.run.state)[exit - 1];
      if (!chosen) return `Нет такого условия: номер ${exit}. Номера условий — в карточке состояния.`;
      if (!claimAllowed(turn.run, chosen.exitId)) return "Это условие уже проверяли: подожди ответа человека и продолжай разговор.";

      const state = stateById(flow, turn.run.state)!;
      let verdict;
      try {
        verdict = await input.judge().checkClaim({
          ownerId: model.ownerId,
          chatId: model.chatId,
          exitId: chosen.exitId,
          condition: chosen.text,
          goal: stateGoal(state.instructions),
          why,
          messages: await input.history(model.ownerId, model.chatId),
          ...(abortSignal && { signal: abortSignal }),
        });
      } catch (error) {
        runtime.logError(`[сценарий] чат=${model.chatId} судья упал: ${error instanceof Error ? error.message : String(error)}`);
        verdict = null;
      }
      if (!verdict) return "Проверка не удалась: перехода нет, продолжай разговор в текущем состоянии.";
      if (!verdict.confirmed) {
        turn.state.set(FLOW_STATE_KEY, noteRejectedClaim(turn.run, chosen.exitId));
        return "Судья не подтвердил: перехода нет, продолжай разговор в текущем состоянии.";
      }

      const now = chatTime(turn.run, runtime.now());
      const transition = nextTransition(flow, turn.run, { type: "verdict", exitId: chosen.exitId, probability: verdict.probability, decidedBy: "claim", why }, now);
      if (!transition) {
        runtime.logError(chainLimitMessage(model.chatId, turn.run));
        return "Переход сейчас невозможен: продолжай разговор в текущем состоянии.";
      }
      const transitions = [transition];
      const card = await runtime.cardValues(model.ownerId);
      const run = advance(flow, applyTransition(flow, turn.run, transition), { type: "data", card }, {
        now,
        card,
        out: transitions,
        onChainLimit: (stopped) => runtime.logError(chainLimitMessage(model.chatId, stopped)),
      });
      return commit(runtime, model, turn, run, transitions);
    },
  });
}

/** Служебный `flow_exit` и обёртки инструментов приложения: охрана по состоянию, события «вызван инструмент». */
export function withFlowTools(tools: AgentToolsSource | undefined, input: FlowToolsInput): AgentToolsSource {
  return (model) => {
    const app = typeof tools === "function" ? tools(model) : (tools ?? {});
    // В группах сценарий выключен: только инструменты приложения, без переходов и карточки.
    if (model.audience === "group") return app;
    const wrapped: ToolSet = {};
    for (const [name, original] of Object.entries(app)) wrapped[name] = wrapTool(input.runtime, model, name, original, true);
    const card = input.cardTools();
    const turn = { model, flow: async () => input.runtime.chatFlow(model.ownerId, model.chatId) };
    for (const [name, original] of Object.entries(typeof card === "function" ? card(turn) : card)) wrapped[name] = wrapTool(input.runtime, model, name, original, false);
    const extra: ToolSet = {};
    const known = input.knownFlow(model.chatId);
    for (const item of known ? (input.extraTools ?? FLOW_EXTRA_TOOLS) : []) {
      if (item.wanted(known!.flow)) extra[item.name] = item.make({ runtime: input.runtime, model });
    }
    return { ...wrapped, [FLOW_EXIT_TOOL]: flowExitTool(input, model), ...extra };
  };
}
