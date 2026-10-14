import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { convertToModelMessages, wrapLanguageModel } from "ai";
import type { LanguageModel, ModelMessage, SystemModelMessage, ToolSet } from "ai";
import { withoutFileParts } from "../attachments/message-attachments";
import type { MessageAttachments } from "../attachments/message-attachments";
import { isStateMessage } from "../app-state/state-messages";
import { closeHangingToolCalls } from "../conversation/hanging-tool-calls";
import { selectReasoningForModel } from "../conversation/select-reasoning";
import type { AgentChatMessage } from "../conversation/types";
import { findModel, mergeProviderOptions, profileProviderOptions, resolveLanguageModel } from "../models/model-catalog";
import type { ModelCatalog, ProviderDescription, ProviderOptionsByProvider, ReasoningRequest } from "../models/model-catalog";
import { effectiveReasoningLevel } from "../models/reasoning-level";
import { createTransientRetryMiddleware } from "../provider-errors/transient-retry-middleware";
import type { TransientRetryContext } from "../provider-errors/transient-retry-middleware";
import { resolveModelSilence } from "../provider-errors/model-silence";
import type { ModelSilenceLimits } from "../provider-errors/model-silence";
import { withoutLoneSurrogates } from "../text/safe-truncate";
import { hasAnswerContent } from "./auto-continue";
import { observeModelCalls } from "./observe-model-calls";
import { withCacheMark } from "./step-cache-mark";
import type { ModelCallObservation } from "./observe-model-calls";
import { lengthCutForModel } from "./length-cut";
import { endTurnNoteForModel } from "./end-turn";
import { withModeNotes } from "./mode-notes";
import { withChannelNotes } from "./channel-notes";
import { noticePartForModel } from "../notices/notices-for-model";
import type { ModeNotes } from "./mode-notes";
import { withAssistantFilesAsText, withGreetingLead } from "./greeting-lead";
import { withUnansweredMarked } from "./unanswered-messages";
import { withBurstsJoined } from "../bursts/message-bursts";
import { withCorrectionsJoined } from "../steering/turn-steering";
import { holdNoteAfterApprovals, withFrozenContext } from "../frozen-context/frozen-context-messages";
import type { FrozenContextData } from "../frozen-context/context-blocks";
import { withoutUndelivered } from "./undelivered";

export interface ModelRequest {
  model: LanguageModel;
  /** Строка; сообщением `system` — если провайдер просит метку кэша на инструкции. */
  instructions: string | SystemModelMessage;
  messages: ModelMessage[];
  tools?: ToolSet;
  providerOptions?: ProviderOptionsByProvider;
  headers?: Record<string, string>;
  /** Общий параметр SDK: сила рассуждений. */
  reasoning?: ReasoningRequest["reasoning"];
  /** Предел вывода запроса: приложения, иначе потолок модели (`ModelProfile.maxOutputTokens`). Нет обоих — нет и его. */
  maxOutputTokens?: number;
  /**
   * Заметка продолжения, придержанная до выполнения одобренных вызовов (`holdNoteAfterApprovals`): ход ставит её в конец
   * первого шага, за их результатами. В `streamText` не идёт.
   */
  noteAfterApprovals?: ModelMessage[];
}

/**
 * Запрос к модели для `streamText`, построенный под кэш: неизменная инструкция первой,
 * инструменты по имени, история в конце; чужие рассуждения из истории вырезаны, вызовы без результата закрыты,
 * непарные половинки эмодзи убраны. Хранилище не меняется: из той же истории — тот же запрос.
 */
export async function buildModelRequest(input: {
  catalog: ModelCatalog;
  modelId: string;
  providerId: string;
  /** Выбранный уровень рассуждений; нет или недоступен — уровень по умолчанию модели. */
  reasoning?: string;
  chatId: string;
  /**
   * Сессия кэша провайдера, если она не чат: помощник берёт `helper:<имя>:<владелец>`, чтобы его запросы из разных чатов
   * попадали в один кэш. Нет — сессия по чату.
   */
  sessionId?: string;
  instructions: string;
  tools?: ToolSet;
  /**
   * Инструменты, которые чат может выключить (виджеты с `enabledFor`): прошлый вызов такого инструмента, которого нет в
   * `tools` этого запроса, идёт модели текстом, а не вызовом — строгий провайдер не примет вызов неизвестного
   * инструмента. Нет — вызовы как есть.
   */
  switchableTools?: ReadonlySet<string>;
  history: readonly AgentChatMessage[];
  /** Вложения: части `file` истории заменяются тем, что увидит выбранная модель. Нет расширения — части убираются. */
  attachments?: MessageAttachments;
  /**
   * Пометки смены режима (голосовой режим: «отвечай коротко и разговорно» и «разговор снова текстом»): отдельной текстовой
   * частью в конце сообщения человека, где режим сменился (см. `withModeNotes`). Выводятся из отметок в истории и в историю
   * чата не пишутся: уже отправленное не меняется, кэш модели цел. Нет — запрос без пометок.
   */
  modeNotes?: ModeNotes;
  /**
   * Застывшие блоки хода (память, дата, блоки приложения, место): текстом в вопрос перед каждым ответом, у которого они
   * есть, после пометок режима и канала (`withFrozenContext`). `current` — блоки ответа, которого в истории ещё нет.
   * Нет — блоков в запросе нет: запросы сжатия и помощников идут без них.
   */
  frozenContext?: { current?: { answerId: string; data: FrozenContextData }; group: boolean };
  /**
   * Сообщения после истории только в этом запросе (служебная пометка попытки): в историю не пишутся. Метка кэша конца —
   * на последнем сообщении истории, хвост без метки: его не будет в следующих запросах, записывать его в кэш незачем,
   * а помеченное начало до него найдут и следующие запросы этого хода, и следующий ход.
   */
  tailMessages?: readonly ModelMessage[];
  /**
   * Предел вывода запроса, заданный приложением или вызывающим (сжатие): главнее потолка модели. От него провайдер
   * считает бюджет рассуждений. Нет — потолок модели, нет и его — запрос без предела.
   */
  maxOutputTokens?: number;
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  /** Журнал сервера: строки `[повтор]` и `[молчание модели]`. Нет — повторы молчат. */
  logError?: (message: string) => void;
  /** Сроки молчания потока для обёртки повторов. Сам запрос они не меняют (кэш). Нет — по умолчанию. */
  modelSilence?: ModelSilenceLimits;
  /** Повторять ли молчание до первого куска у того же провайдера (`TransientRetryContext.repeatSilence`). Нет — да. */
  repeatSilence?: () => boolean;
  /** Каждый запрос к модели (повторы — тоже), на который провайдер начал отвечать. Сам запрос не меняет. */
  requestWatch?: ModelRequestWatch;
  /**
   * Наблюдатель хода: каждое обращение к модели (повторы — тоже) уходит ему событием. Сам запрос не меняет;
   * нет — модель без прослойки, запрос побайтно прежний.
   */
  observe?: ModelCallObservation;
}): Promise<ModelRequest> {
  const found = findModel(input.catalog, input.modelId, input.providerId);
  const { profile, provider } = found;
  const base = resolveLanguageModel(found, input.env, input.fetch);
  const observed = input.observe
    ? observeModelCalls(base, {
        ...input.observe,
        chatId: input.chatId,
        modelId: profile.id,
        providerId: provider.id,
        ...(profile.pricing?.[provider.id] && { price: profile.pricing[provider.id] }),
        logError: input.logError ?? (() => {}),
      })
    : base;
  const model = withTransientRetries(withRequestWatch(observed, provider, input.requestWatch), {
    chatId: input.chatId,
    modelId: profile.id,
    providerId: provider.id,
    logError: input.logError,
    ...silenceOfProvider(provider, input.modelSilence),
    ...(input.repeatSilence && { repeatSilence: input.repeatSilence }),
  });
  const tools = input.tools ? sortToolsByName(input.tools) : undefined;
  const sendable = input.switchableTools ? withSwitchedOffCallsAsText(sendableHistory(input.history), input.switchableTools, tools) : sendableHistory(input.history);
  const noted = withChannelNotes(withModeNotes(withBurstsJoined(withCorrectionsJoined(sendable)), input.modeNotes));
  const held: { messages: readonly AgentChatMessage[]; note?: AgentChatMessage } = input.frozenContext
    ? holdNoteAfterApprovals(withFrozenContext(noted, input.frozenContext))
    : { messages: noted };
  const history = selectReasoningForModel(held.messages, {
    modelId: profile.id,
    providerId: provider.id,
    replayPastTurns: profile.reasoning.replayPastTurns,
  });
  const providerRequest = provider.requestOptions({ chatId: input.sessionId ?? input.chatId, profile });
  const visibleHistory = input.attachments
    ? await input.attachments.prepareHistory({ chatId: input.chatId, history, model: { profile, providerId: provider.id } })
    : withoutFileParts(history);
  const historyMessages = withLastMessageMark(
    withGreetingLead(withUnansweredMarked(await convertToModelMessages(visibleHistory, { tools, convertDataPart: dataPartForModel }))),
    providerRequest.lastMessageProviderOptions,
  );
  const messages = input.tailMessages ? [...historyMessages, ...input.tailMessages] : historyMessages;
  const level = effectiveReasoningLevel(profile, input.reasoning);
  const maxOutputTokens = input.maxOutputTokens ?? profile.maxOutputTokens;
  const reasoningRequest =
    level && provider.reasoningRequest
      ? provider.reasoningRequest(level, { profile, providerModelId: found.providerModelId, ...(maxOutputTokens !== undefined && { maxOutputTokens }) })
      : undefined;
  const providerOptions = mergeProviderOptions(
    providerRequest.providerOptions,
    // Модель добавит их и сама (`resolveLanguageModel`); здесь — чтобы они были видны в запросе и журнале хода.
    profileProviderOptions(profile, provider),
    reasoningRequest?.providerOptions,
  );

  return {
    model,
    instructions: providerRequest.instructionsProviderOptions
      ? { role: "system", content: input.instructions, providerOptions: providerRequest.instructionsProviderOptions }
      : input.instructions,
    messages,
    ...(tools && { tools }),
    ...(providerOptions && { providerOptions }),
    ...(providerRequest.headers && { headers: providerRequest.headers }),
    ...(reasoningRequest?.reasoning && { reasoning: reasoningRequest.reasoning }),
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
    ...(held.note && { noteAfterApprovals: await convertToModelMessages([held.note]) }),
  };
}

/**
 * История, которую примет модель: вызовы инструментов без результата закрыты постоянным текстом (иначе `streamText`
 * отказывает до запроса), непарные половинки эмодзи вырезаны, ответы из одних рассуждений пропущены (FR-055: «Стоп»
 * на рассуждении — строгий провайдер не примет ответ без текста; вопросы вокруг него разделяет `withUnansweredMarked`),
 * служебные сообщения состояния (закрытие и открытие чата из кода) пропущены: запрос тот же, что без них, кэш цел.
 * Недоставленные ответы (`markUndelivered`) пропущены вместе со служебным сообщением, на которое они отвечали.
 * Делается при каждой сборке одинаково; нечего
 * менять — те же сообщения. Хранилище не меняется: человек свой остановленный ответ видит.
 */
function sendableHistory(history: readonly AgentChatMessage[]): readonly AgentChatMessage[] {
  return withoutUndelivered(history).filter((message) => (message.role !== "assistant" || hasAnswerContent(message.parts)) && !isStateMessage(message)).map(withAssistantFilesAsText).map((message) => {
    const closed = message.role === "assistant" ? closeHangingToolCalls(message.parts) : message.parts;
    const parts = withoutLoneSurrogatesInParts(closed);
    return parts === message.parts ? message : { ...message, parts };
  });
}


/**
 * Вызовы выключенных инструментов (`switchable`, но не в `tools` запроса) — текстом: имя, вход и итог. Текст постоянный —
 * та же история и тот же набор дают тот же запрос (кэш). Нечего менять — те же сообщения.
 */
function withSwitchedOffCallsAsText(
  history: readonly AgentChatMessage[],
  switchable: ReadonlySet<string>,
  tools: ToolSet | undefined,
): readonly AgentChatMessage[] {
  const switchedOff = (name: string) => switchable.has(name) && !(tools && Object.hasOwn(tools, name));
  return history.map((message) => {
    if (message.role !== "assistant") return message;
    let changed = false;
    const parts = message.parts.map((part) => {
      if (!part.type.startsWith("tool-") || !switchedOff(part.type.slice("tool-".length))) return part;
      changed = true;
      return { type: "text" as const, text: switchedOffCallText(part.type.slice("tool-".length), part as SwitchedOffCall), state: "done" as const };
    });
    return changed ? { ...message, parts } : message;
  });
}

interface SwitchedOffCall {
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function switchedOffCallText(name: string, call: SwitchedOffCall): string {
  const result =
    call.state === "output-available"
      ? `ответ: ${JSON.stringify(call.output) ?? "нет"}`
      : call.state === "output-error"
        ? `ошибка: ${call.errorText ?? "нет текста"}`
        : call.state === "output-denied"
          ? "отклонён"
          : "без ответа";
  return `[Прошлый вызов «${name}», сейчас выключен. Вход: ${JSON.stringify(call.input) ?? "нет"}; ${result}]`;
}

type MessagePart = AgentChatMessage["parts"][number];

/** Половинки эмодзи вырезаны из текста, рассуждений и вызовов инструментов; нет половинок — тот же массив. */
function withoutLoneSurrogatesInParts(parts: MessagePart[]): MessagePart[] {
  const cleaned = parts.map(withoutLoneSurrogatesInPart);
  return cleaned.every((part, index) => part === parts[index]) ? parts : cleaned;
}

function withoutLoneSurrogatesInPart(part: MessagePart): MessagePart {
  if (part.type === "text" || part.type === "reasoning") {
    const text = withoutLoneSurrogates(part.text);
    return text === part.text ? part : { ...part, text };
  }
  if (part.type.startsWith("tool-") || part.type === "dynamic-tool") return withoutLoneSurrogatesDeep(part);
  return part;
}

/** Строки внутри значения без половинок эмодзи; ничего не изменилось — то же значение. */
function withoutLoneSurrogatesDeep<Value>(value: Value): Value {
  if (typeof value === "string") return withoutLoneSurrogates(value) as Value;
  if (Array.isArray(value)) {
    const items = value.map(withoutLoneSurrogatesDeep);
    return (items.every((item, index) => item === value[index]) ? value : items) as Value;
  }
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  const cleaned = entries.map(([key, field]) => [key, withoutLoneSurrogatesDeep(field)] as const);
  return (cleaned.every(([, field], index) => field === entries[index]![1]) ? value : Object.fromEntries(cleaned)) as Value;
}

/** Что ход узнаёт о каждом запросе к модели: с какого мига он оплачен и под каким номером его расход у провайдера. */
export interface ModelRequestWatch {
  /** Провайдер принял запрос и открыл поток; номер генерации — по `ProviderDescription.generationUsage`, иначе нет. */
  opened(request: { generationId: string | undefined }): void;
  /** Провайдер сам отказал посреди потока (кусок `error`): такой отказ не оплачивается. */
  refused(): void;
}

/** Под обёрткой повторов: каждый повтор — свой запрос со своим номером генерации. */
function withRequestWatch(model: LanguageModel, provider: ProviderDescription, watch: ModelRequestWatch | undefined): LanguageModel {
  if (!watch || typeof model === "string") return model;
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v4",
      wrapStream: async ({ doStream, params }) => {
        const result = await doStream();
        // Отменён раньше, чем провайдер ответил: настоящий `fetch` тогда отказывает, запрос не открыт.
        if (params.abortSignal?.aborted) return result;
        watch.opened({ generationId: provider.generationUsage?.generationId(result.response?.headers) });
        const refusals = new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "error") watch.refused();
            controller.enqueue(part);
          },
        });
        return { ...result, stream: result.stream.pipeThrough(refusals) };
      },
    },
  });
}

/** Временные сбои провайдера до первого куска ответа повторяются тихо (FR-016a). */
function withTransientRetries(model: LanguageModel, context: TransientRetryContext): LanguageModel {
  // Строка — id модели шлюза SDK; каталог отдаёт готовые модели, строка сюда не приходит.
  return typeof model === "string" ? model : wrapLanguageModel({ model, middleware: createTransientRetryMiddleware(context) });
}

/** Метка на последнем сообщении: на следующем ходе она переедет на новое, прежние остаются без метки. */
function withLastMessageMark(messages: ModelMessage[], options: ProviderOptionsByProvider | undefined): ModelMessage[] {
  if (!options || messages.length === 0) return messages;
  return [...messages.slice(0, -1), withCacheMark(messages[messages.length - 1]!, options)];
}

function sortToolsByName(tools: ToolSet): ToolSet {
  return Object.fromEntries(Object.entries(tools).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}

/** Для `convertToModelMessages`: отметка обрыва и служебные сообщения — текстом, остальные части-данные в запрос не идут. */
function dataPartForModel(part: { type: string; data?: unknown }) {
  return lengthCutForModel(part) ?? endTurnNoteForModel(part) ?? noticePartForModel(part);
}

/** Сроки молчания попытки: свои сроки провайдера перекрывают общие. Ничего не задано — обёртка берёт сроки по умолчанию. */
function silenceOfProvider(provider: Pick<ProviderDescription, "modelSilenceTimeout">, general: ModelSilenceLimits | undefined): { silence?: ModelSilenceLimits } {
  if (provider.modelSilenceTimeout === undefined) return general ? { silence: general } : {};
  return { silence: resolveModelSilence(provider.modelSilenceTimeout, general) };
}
