import { asSchema } from "ai";
import type { ContentPart, LanguageModelUsage, ModelMessage, ToolSet, UIMessageChunk } from "ai";
import { addTokenUsage, emptyTokenUsage } from "../conversation/token-usage";
import type { PendingStepUsage, TokenUsage } from "../conversation/types";

/** Прикидка ведётся в шестых долях токена: так у каждого знака целый вес. */
const SHARES_PER_TOKEN = 6;
/** Файл в запросе (картинка, документ) — как 1600 токенов. */
const FILE_SHARES = 1_600 * SHARES_PER_TOKEN;

const tokensOf = (shares: number): number => Math.ceil(shares / SHARES_PER_TOKEN);

/**
 * Доли токена в тексте по письму. Прикидка скорее завышает, чем занижает: по ней берегут бюджет. Латиница, цифры и
 * пробелы — токен на 3 знака (у английского около 4); знаки препинания и скобки (JSON плотнее), кириллица и другие
 * алфавиты — токен на 2 знака (у русского 2–2,5); иероглифы, кана, хангыль и половинки пар (эмодзи) — токен на знак.
 */
function textShares(text: string): number {
  let shares = 0;
  for (let index = 0; index < text.length; index++) shares += charShares(text.charCodeAt(index));
  return shares;
}

function charShares(code: number): number {
  if (code < 0x80) return isLatinLetterDigitOrSpace(code) ? 2 : 3;
  return isDenseScript(code) ? 6 : 3;
}

function isLatinLetterDigitOrSpace(code: number): boolean {
  const isLetterOrDigit = (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
  return isLetterOrDigit || code === 0x20 || code === 0x0a || code === 0x09 || code === 0x0d;
}

/** Иероглифы и кана, хангыль, половинки пар (эмодзи и редкие знаки), полноширинные знаки. */
function isDenseScript(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x9fff) || (code >= 0xac00 && code <= 0xdfff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef)
  );
}

/** Токены текста по письму (FR-050): так оцениваются шаги без чисел провайдера и хвост запроса в журнале промахов кэша. */
export function estimateTextTokens(text: string): number {
  return tokensOf(textShares(text));
}

export type TurnUsage = ReturnType<typeof createTurnUsage>;

/** Расход шага и когда ушёл его запрос (ISO). */
export type TimedTokenUsage = TokenUsage & { at?: string };

/** Шаг хода: расход, провайдер, у которого он сделан, и номера генераций его запросов (повторы — тоже). */
export interface TurnStep {
  usage: TokenUsage;
  providerId: string;
  /** Когда ушёл запрос шага (ISO): по нему цена часов пик. */
  at: string;
  /** Номера генераций запросов шага по порядку; `undefined` — провайдер номера не дал. */
  generationIds: ReadonlyArray<string | undefined>;
  /** Шаг стёрт переходом при молчании: оплачен, но в запросы следующих шагов не попал. */
  erased?: boolean;
}

/** Шаг, расход которого стоит узнать у провайдера: оценка (нет — шаг оплачен по числам провайдера) и генерации без чисел. */
export interface StepToSettle {
  providerId: string;
  /** Когда ушёл запрос шага (ISO). Нет — начало хода. */
  at?: string;
  estimate: TokenUsage | null;
  generationIds: readonly string[];
}

/**
 * Расход хода по шагам всех его попыток. Шаг без чисел провайдера (вход и выход 0 или нет) оценивается по длине
 * запроса и написанного (FR-050). Попытка оборвалась («Стоп», сбой) посреди шага, в котором модель уже что-то
 * написала или на запрос которого провайдер уже начал отвечать, — этот шаг тоже оценивается (FR-051). Оценка помечена
 * `estimated`.
 */
export function createTurnUsage(now: () => Date = () => new Date()) {
  // Шаги хода: по ним выбирается ступень цены, их сумма — итог хода.
  const steps: TurnStep[] = [];
  // Попытка: провайдер, постоянная часть запроса, запрос каждого шага, начатые и завершённые шаги.
  let providerId = "";
  let fixedShares = 0;
  let requestShares: number[] = [];
  // Когда ушёл запрос каждого шага попытки.
  let requestTimes: string[] = [];
  let startedSteps = 0;
  let finishedSteps = 0;
  // Написанное в последнем начатом шаге.
  let written = { shares: 0, reasoningShares: 0, content: false };
  // Идущий шаг: номера генераций его запросов и открыт ли запрос, за который провайдер возьмёт деньги.
  let generationIds: Array<string | undefined> = [];
  let requestOpen = false;
  // Вызовы, аргументы которых пришли по кускам: их итоговый ввод второй раз не считается.
  let streamedCalls = new Set<string>();

  /** Оценка шага: вход не меньше входа и выхода прошлого шага (стёртые не в счёт); прошлый вход из кэша — снова из кэша. */
  function estimate(stepIndex: number, shares: number, reasoningShares: number): TokenUsage {
    const previous = steps.findLast((step) => !step.erased)?.usage;
    const inputTokens = Math.max(tokensOf(requestShares[stepIndex] ?? fixedShares), previous ? previous.inputTokens + previous.outputTokens : 0);
    const cachedInputTokens = previous && previous.cachedInputTokens > 0 ? Math.min(previous.inputTokens, inputTokens) : 0;
    return {
      inputTokens,
      cachedInputTokens,
      outputTokens: tokensOf(shares + reasoningShares),
      reasoningTokens: tokensOf(reasoningShares),
      estimated: true,
    };
  }

  /** Начатый шаг без конца, в котором модель уже что-то написала или на запрос которого провайдер начал отвечать. */
  function unfinishedStep(): TurnStep | null {
    const wroteSomething = startedSteps > finishedSteps && written.content;
    if (!wroteSomething && !requestOpen) return null;
    const index = wroteSomething ? startedSteps - 1 : finishedSteps;
    const usage = estimate(index, written.shares, written.reasoningShares);
    return { usage, providerId, generationIds, at: stepTime(index) };
  }

  function stepTime(index: number): string {
    return requestTimes[index] ?? now().toISOString();
  }

  function nextStep(): void {
    written = { shares: 0, reasoningShares: 0, content: false };
    generationIds = [];
    requestOpen = false;
  }

  return {
    /** Новая попытка у провайдера `attemptProviderId`: инструкция и описания инструментов её запроса. */
    beginAttempt(request: { instructions?: unknown; tools?: ToolSet }, attemptProviderId: string): void {
      providerId = attemptProviderId;
      fixedShares = instructionsShares(request.instructions) + toolsShares(request.tools);
      requestShares = [];
      requestTimes = [];
      startedSteps = 0;
      finishedSteps = 0;
      nextStep();
      streamedCalls = new Set();
    },
    /** Перед шагом попытки: сообщения его запроса. */
    beforeStep(stepNumber: number, messages: readonly ModelMessage[]): void {
      requestShares[stepNumber] = fixedShares + messagesShares(messages);
      requestTimes[stepNumber] = now().toISOString();
    },
    /** Провайдер принял запрос идущего шага и начал поток: с этого мига вход оплачен (FR-051, FR-058). */
    requestOpened(request: { generationId: string | undefined }): void {
      generationIds.push(request.generationId);
      requestOpen = true;
    },
    /** Провайдер сам отказал посреди потока: такой запрос не оплачивается. */
    requestRefused(): void {
      requestOpen = false;
    },
    /** Кусок UI-потока попытки: начала шагов и написанное. */
    observe(chunk: UIMessageChunk): void {
      if (chunk.type === "start-step") {
        startedSteps += 1;
        written = { shares: 0, reasoningShares: 0, content: false };
        return;
      }
      if (chunk.type === "text-delta") written.shares += textShares(chunk.delta);
      else if (chunk.type === "reasoning-delta") written.reasoningShares += textShares(chunk.delta);
      else if (chunk.type === "tool-input-delta") {
        streamedCalls.add(chunk.toolCallId);
        written.shares += textShares(chunk.inputTextDelta);
      } else if (chunk.type === "tool-input-available" && !streamedCalls.has(chunk.toolCallId)) {
        written.shares += textShares(JSON.stringify(chunk.input ?? null));
      } else if (!isWritten(chunk)) return;
      written.content = true;
    },
    /** Шаг завершён: числа провайдера или, если их нет, оценка. */
    finishStep(usage: LanguageModelUsage, content: readonly ContentPart<ToolSet>[]): void {
      const index = finishedSteps;
      finishedSteps += 1;
      let stepUsage: TokenUsage;
      if ((usage.inputTokens ?? 0) > 0 || (usage.outputTokens ?? 0) > 0) {
        stepUsage = emptyTokenUsage();
        addTokenUsage(stepUsage, usage);
      } else {
        const output = contentShares(content);
        stepUsage = estimate(index, output.shares, output.reasoningShares);
      }
      steps.push({ usage: stepUsage, providerId, generationIds, at: stepTime(index) });
      nextStep();
    },
    /** Шаг без запроса к провайдеру (готовый текст `endTurn`): в расход не идёт. */
    finishFreeStep(): void {
      finishedSteps += 1;
      nextStep();
    },
    /**
     * Попытка кончилась: недописанный шаг с написанным или с открытым запросом — в расход хода оценкой. `erased` — этот
     * шаг стёрт: оплачен, но следующий шаг его не видит.
     */
    closeAttempt(options: { erased?: boolean } = {}): void {
      const unfinished = unfinishedStep();
      if (unfinished) steps.push(options.erased ? { ...unfinished, erased: true } : unfinished);
      finishedSteps = startedSteps;
      nextStep();
    },
    /** Расход каждого шага хода, без идущего. */
    steps(): readonly TokenUsage[] {
      return steps.map((step) => step.usage);
    },
    /** Шаги хода по провайдерам, в порядке первого шага у каждого: каждому — запись по его цене. */
    stepsByProvider(): Array<{ providerId: string; steps: TimedTokenUsage[] }> {
      const groups = new Map<string, TimedTokenUsage[]>();
      for (const step of steps) groups.set(step.providerId, [...(groups.get(step.providerId) ?? []), { ...step.usage, at: step.at }]);
      return [...groups].map(([id, usages]) => ({ providerId: id, steps: usages }));
    },
    /**
     * Шаги, расход которых стоит узнать у провайдера (FR-058): оценённый — все его генерации; оплаченный по числам —
     * генерации до последней (повторы, оборванные до первого куска). Шаг с генерацией без номера не узнать — его нет.
     */
    stepsToSettle(): StepToSettle[] {
      return steps.flatMap((step): StepToSettle[] => {
        const ids = step.usage.estimated ? step.generationIds : step.generationIds.slice(0, -1);
        if (ids.length === 0 || !ids.every((id): id is string => id !== undefined)) return [];
        return [{ providerId: step.providerId, at: step.at, estimate: step.usage.estimated ? step.usage : null, generationIds: ids }];
      });
    },
    /** Шаги хода с провайдерами вместе с оценкой идущего — в идущий ответ для восстановления (FR-052). */
    pendingSteps(): PendingStepUsage[] {
      const unfinished = unfinishedStep();
      return (unfinished ? [...steps, unfinished] : steps).map((step) => ({ ...step.usage, providerId: step.providerId, at: step.at }));
    },
    /** Расход хода на этот момент вместе с оценкой идущего шага; ничего не потрачено — `null`. */
    total(): TokenUsage | null {
      const unfinished = unfinishedStep();
      return sumOfSteps((unfinished ? [...steps, unfinished] : steps).map((step) => step.usage));
    },
  };
}

/** Сумма шагов; размер контекста — по последнему шагу: у прежних тот же префикс. */
export function sumOfSteps(steps: readonly TokenUsage[]): TokenUsage | null {
  const last = steps.at(-1);
  if (!last) return null;
  const total = emptyTokenUsage();
  for (const step of steps) {
    total.inputTokens += step.inputTokens;
    total.cachedInputTokens += step.cachedInputTokens;
    total.outputTokens += step.outputTokens;
    total.reasoningTokens += step.reasoningTokens;
    if (step.cacheWriteTokens) total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + step.cacheWriteTokens;
  }
  const contextTokens = last.inputTokens + last.outputTokens;
  return { ...total, ...(contextTokens > 0 && { contextTokens }), ...(steps.some((step) => step.estimated) && { estimated: true }) };
}

/** Написанное моделью без длины: источник, файл, запрос подтверждения, часть-данные. */
function isWritten(chunk: UIMessageChunk): boolean {
  return chunk.type.startsWith("source-") || chunk.type === "file" || chunk.type === "tool-approval-request" || chunk.type.startsWith("data-");
}

function instructionsShares(instructions: unknown): number {
  if (typeof instructions === "string") return textShares(instructions);
  if (Array.isArray(instructions)) return instructions.reduce((sum: number, item) => sum + instructionsShares(item), 0);
  const content = (instructions as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? textShares(content) : 0;
}

function toolsShares(tools: ToolSet | undefined): number {
  let shares = 0;
  for (const [name, tool] of Object.entries(tools ?? {})) {
    // Описание, которое строится по ходу (функция), в оценку не идёт.
    shares += textShares(name) + (typeof tool.description === "string" ? textShares(tool.description) : 0);
    const schema = tool.inputSchema && asSchema(tool.inputSchema).jsonSchema;
    // Схема, которая строится не сразу, в оценку не идёт.
    if (schema && typeof (schema as PromiseLike<unknown>).then !== "function") shares += textShares(JSON.stringify(schema));
  }
  return shares;
}

function messagesShares(messages: readonly ModelMessage[]): number {
  let shares = 0;
  for (const message of messages) {
    if (typeof message.content === "string") shares += textShares(message.content);
    else for (const part of message.content) shares += partShares(part);
  }
  return shares;
}

function partShares(part: Exclude<ModelMessage["content"], string>[number]): number {
  switch (part.type) {
    case "text":
    case "reasoning":
      return textShares(part.text);
    case "image":
    case "file":
      return FILE_SHARES;
    case "tool-call":
      return textShares(part.toolName) + textShares(JSON.stringify(part.input ?? null));
    case "tool-result":
      return part.output.type === "content"
        ? part.output.value.reduce((sum, item) => sum + (item.type === "text" ? textShares(item.text) : FILE_SHARES), 0)
        : textShares(JSON.stringify(part.output));
    default:
      return textShares(JSON.stringify(part));
  }
}

function contentShares(content: readonly ContentPart<ToolSet>[]): { shares: number; reasoningShares: number } {
  let shares = 0;
  let reasoningShares = 0;
  for (const part of content) {
    if (part.type === "text") shares += textShares(part.text);
    else if (part.type === "reasoning") reasoningShares += textShares(part.text);
    else if (part.type === "tool-call") shares += textShares(JSON.stringify(part.input ?? null));
  }
  return { shares, reasoningShares };
}
