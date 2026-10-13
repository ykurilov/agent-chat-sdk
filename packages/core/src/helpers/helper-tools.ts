import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { findModel } from "../models/model-catalog";
import type { ModelCatalog } from "../models/model-catalog";
import { cutToolResult } from "../agent-run/tool-result-limit";
import type { ResolvedToolResultLimit } from "../agent-run/tool-result-limit";
import type { AgentHelper, HelperProgress } from "./helper-types";

export const HELPER_TOOL_PREFIX = "helper_";
/** Имя помощника: латиница в нижнем регистре, цифры и `_`, с буквы, до 31 знака — `helper_<имя>` влезает в предел имени инструмента. */
const HELPER_NAME = /^[a-z][a-z0-9_]{0,30}$/;

export const helperToolName = (name: string): string => `${HELPER_TOOL_PREFIX}${name}`;
export const isHelperToolName = (toolName: string): boolean => toolName.startsWith(HELPER_TOOL_PREFIX);
export const helperNameOf = (toolName: string): string => toolName.slice(HELPER_TOOL_PREFIX.length);

/** Вход `helper_<имя>`: одно задание. */
const helperInput = z.object({ task: z.string().describe("Задание помощнику: что сделать и что вернуть") });

/**
 * Проверка помощников при создании службы: имя, модель из каталога, совпадение `helper_<имя>` с занятыми именами
 * (инструменты приложения набором, память, виджеты, браузер). Фоновому помощнику нужен подключённый фон.
 */
export function checkHelpers(
  helpers: Record<string, AgentHelper> | undefined,
  context: { catalog: ModelCatalog; takenToolNames: Iterable<string>; backgroundConnected?: boolean },
): void {
  if (!helpers) return;
  const taken = new Set(context.takenToolNames);
  for (const [name, helper] of Object.entries(helpers)) {
    if (!HELPER_NAME.test(name)) {
      throw new Error(`Помощник «${name}»: имя — латиница в нижнем регистре, цифры и «_», с буквы, не длиннее 31 знака`);
    }
    const toolName = helperToolName(name);
    if (taken.has(toolName)) {
      throw new Error(`Помощник «${name}»: инструмент ${toolName} уже задан приложением, памятью, виджетом или браузером — переименуйте один из них`);
    }
    try {
      findModel(context.catalog, helper.model.modelId, helper.model.providerId);
    } catch (error) {
      throw new Error(`Помощник «${name}»: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (helper.background && !context.backgroundConnected) {
      throw new Error(`Помощник «${name}» работает в фоне (background: true), а пакет фона не подключён`);
    }
  }
}

/** Что модель основного агента видит из результата помощника: только итог, в пределах `toolResultMaxLength`. */
export function helperModelOutput(output: unknown, maxLength: number): { type: "text"; value: string } {
  const progress = output as Partial<HelperProgress> | null | undefined;
  if (!progress || typeof progress !== "object" || typeof progress.status !== "string") {
    return { type: "text", value: typeof output === "string" ? output : JSON.stringify(output ?? null) };
  }
  const value = (() => {
    switch (progress.status) {
      case "done": {
        const text = progress.text ?? "";
        const cut = cutToolResult(text, maxLength);
        return cut.cut ? cut.text : text;
      }
      case "failed":
        return `Помощник не справился: ${progress.error ?? "неизвестная ошибка"}`;
      case "awaiting_approval":
        return "Помощник ждёт, когда пользователь разрешит или отклонит его действие.";
      case "background":
        return `Помощник работает в фоне${progress.taskId ? ` (задача ${progress.taskId})` : ""}: итог придёт позже.`;
      default:
        return "Помощник не закончил работу: ход прервался.";
    }
  })();
  return { type: "text", value };
}

/**
 * Описания `helper_<имя>` без `execute`: для сжатия и чтения истории (модель видит итог через `toModelOutput`).
 * Фоновые помощники здесь не участвуют.
 */
export function helperToolDescriptions(helpers: Record<string, AgentHelper> | undefined, limit: ResolvedToolResultLimit): ToolSet {
  const described: ToolSet = {};
  for (const [name, helper] of Object.entries(helpers ?? {})) {
    if (helper.background) continue;
    const toolName = helperToolName(name);
    described[toolName] = tool({
      description: helper.description,
      inputSchema: helperInput,
      toModelOutput: ({ output }) => helperModelOutput(output, limit.forTool(toolName)),
    });
  }
  return described;
}

/**
 * Инструменты `helper_<имя>` основного агента: `execute` — поток промежуточных `HelperProgress` (человек видит ход),
 * последнее значение — итог. `run` ведёт цикл помощника и не бросает, кроме «Стопа».
 */
export function helperTools(
  helpers: Record<string, AgentHelper> | undefined,
  limit: ResolvedToolResultLimit,
  run: (call: { name: string; helper: AgentHelper; task: string; abortSignal: AbortSignal }) => AsyncIterable<HelperProgress>,
): ToolSet {
  const described = helperToolDescriptions(helpers, limit);
  const tools: ToolSet = {};
  for (const [toolName, description] of Object.entries(described)) {
    const name = helperNameOf(toolName);
    const helper = helpers![name]!;
    tools[toolName] = {
      ...description,
      execute: async function* ({ task }: { task: string }, options: { abortSignal?: AbortSignal }) {
        yield* run({ name, helper, task, abortSignal: options.abortSignal ?? new AbortController().signal });
      },
    } as ToolSet[string];
  }
  return tools;
}
