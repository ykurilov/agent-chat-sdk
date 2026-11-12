import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import type { LanguageModel, ToolSet } from "ai";
import type { AgentChatMessage } from "../conversation/types";
import { SUGGESTIONS_SHOWN } from "../widgets/basic-widgets";

type MessagePart = AgentChatMessage["parts"][number];

/** Подсказки под ответом: показанные вместе с текстом, они закрывают ответ человеку. */
const SUGGESTIONS_TOOL = "suggest_replies";

/**
 * Результат подсказок, когда ответ уже написан: модель знает, что новый текст человек не увидит, и не тратит шаг на
 * дописку. Служебные инструменты (заметки, задачи сценария) она вызывает как обычно. Текст постоянный — кэш цел.
 */
export const SUGGESTIONS_SHOWN_AFTER_ANSWER = `${SUGGESTIONS_SHOWN}. Ответ человеку на этом закончен: новый текст в этом ходе он не увидит. Нужные инструменты вызывай как обычно.`;

/** Шаг модели: был ли текст для человека, какие инструменты вызваны, показаны ли подсказки. */
interface Step {
  text: boolean;
  calls: string[];
  shown: boolean;
  /** Поток шага кончился: все вызовы шага известны. */
  ended: Promise<void>;
  end: () => void;
}

function newStep(): Step {
  let end!: () => void;
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  return { text: false, calls: [], shown: false, ended, end };
}

/**
 * Ответ закрыт подсказками: в шаге модели был текст для человека, подсказки показаны (вызов `suggest_replies` прошёл),
 * а других вызовов в шаге нет, кроме служебных (`serviceTools`). Дальше в этом ходе текст модели не идёт ни клиенту,
 * ни в запись, ни в запросы следующих шагов: дописка вроде «Жду ваш выбор» не вытесняет вопрос с кнопками. Вызовы
 * инструментов после этого идут как обычно.
 *
 * Не закрывают: черновик перед поиском («Собираю запрос» → поиск → ответ), подсказки в шаге без текста, вызов рядом
 * с подсказками, чей результат нужен ответу (поиск), подсказки с ошибкой или оборванные.
 */
export function createSealedAnswerGuard(serviceTools: ReadonlySet<string> = new Set()) {
  let sealed = false;
  let droppedChars = 0;
  let step: Step | undefined;
  const closes = (candidate: Step | undefined): boolean =>
    candidate !== undefined && candidate.text && candidate.shown && candidate.calls.every((name) => name === SUGGESTIONS_TOOL || serviceTools.has(name));
  return {
    /** Новая попытка хода: закрыт ли ответ, решают части, уже написанные этим ответом. */
    reset(parts: readonly MessagePart[]): void {
      sealed = sealedByParts(parts, closes);
      step = undefined;
    },
    /** Ответ закрыт подсказками (с учётом последнего шага). */
    sealed: (): boolean => sealed || closes(step),
    /** Сколько знаков текста не показано после закрытия ответа (за весь ход). */
    droppedChars: (): number => droppedChars,
    /**
     * Подсказки отмечают шаг показанными. Когда шаг закрывает ответ (или ответ уже закрыт), модель получает
     * `SUGGESTIONS_SHOWN_AFTER_ANSWER`: результат ждёт конца потока шага, чтобы знать все его вызовы.
     */
    tools(tools: ToolSet | undefined): ToolSet | undefined {
      const original = tools?.[SUGGESTIONS_TOOL];
      const execute = original?.execute;
      if (!tools || !original || !execute) return tools;
      return {
        ...tools,
        [SUGGESTIONS_TOOL]: {
          ...original,
          execute: async (input: unknown, options: Parameters<typeof execute>[1]) => {
            const own = step;
            const output = await execute(input, options);
            if (!own) return output;
            own.shown = true;
            if (output !== SUGGESTIONS_SHOWN) return output;
            await Promise.race([own.ended, aborted(options.abortSignal)]);
            return sealed || closes(own) ? SUGGESTIONS_SHOWN_AFTER_ANSWER : output;
          },
        },
      };
    },
    wrap(model: LanguageModel): LanguageModel {
      if (typeof model === "string") return model;
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v4",
          wrapStream: async ({ doStream }) => {
            // Новый шаг начинается, когда вызовы прошлого уже выполнены: теперь известно, закрыл ли он ответ.
            if (closes(step)) sealed = true;
            step?.end();
            const current = newStep();
            step = current;
            const result = await doStream();
            const transform = (part: LanguageModelV4StreamPart, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
              if (part.type === "text-start" || part.type === "text-delta" || part.type === "text-end") {
                if (sealed) {
                  if (part.type === "text-delta") droppedChars += part.delta.length;
                  return;
                }
                if (part.type === "text-delta" && hasText(part.delta)) current.text = true;
              } else if (part.type === "tool-call") {
                current.calls.push(part.toolName);
              } else if (part.type === "finish" || part.type === "error") {
                current.end();
              }
              controller.enqueue(part);
            };
            return { ...result, stream: result.stream.pipeThrough(new TransformStream({ transform, flush: () => current.end() })) };
          },
        },
      });
    },
  };
}

/** Записанный шаг ответа закрывает его: текст, показанные подсказки и только служебные вызовы рядом. */
function sealedByParts(parts: readonly MessagePart[], closes: (step: Step) => boolean): boolean {
  let current = newStep();
  for (const part of parts) {
    if (part.type === "step-start") {
      if (closes(current)) return true;
      current = newStep();
    } else if (part.type === "text" && hasText(part.text)) current.text = true;
    else if (isToolPart(part)) {
      const name = part.type === "dynamic-tool" ? (part as { toolName: string }).toolName : part.type.slice("tool-".length);
      current.calls.push(name);
      if (name === SUGGESTIONS_TOOL && (part as { state?: string }).state === "output-available") current.shown = true;
    }
  }
  return closes(current);
}

/**
 * Закрытый ответ кончился без слов после последнего вызова (дописка не показана или её не было): в записи нужна
 * отметка конца хода, иначе на следующем ходе вопрос человека встанет сразу за результатом инструмента.
 */
export function sealedAnswerEndsOnTool(parts: readonly MessagePart[]): boolean {
  const lastCall = parts.findLastIndex(isToolPart);
  return lastCall !== -1 && !parts.slice(lastCall + 1).some((part) => part.type === "text" && hasText(part.text));
}

function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

function hasText(text: string): boolean {
  return text.replace(/[\s\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "").length > 0;
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise(() => {});
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
