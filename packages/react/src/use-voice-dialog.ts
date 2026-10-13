import { getToolName, isToolUIPart } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VideosClient } from "./agent-chat-extensions";
import type { AgentChatMessage } from "./chat-types";
import { useChatLabels } from "./labels";
import type { ResolvedChatLabels } from "./labels";
import type { AgentChatState } from "./use-agent-chat";
import { widgetCallOf } from "./widgets/widget-view";
import type { WidgetCall } from "./widgets/widget-view";
import type { AnswerEnd, AssistantActivity, AssistantTextDelta, DialogChatBridge, VoiceDialogEngine, VoiceDialogView } from "./voice-dialog";

type DialogChat = Pick<AgentChatState, "messages" | "busy" | "stop" | "sendVoiceMessage" | "replaceLastVoiceMessage" | "showVoiceCut">;

export interface UseVoiceDialogOptions {
  /** Голосовой режим приложения; нет — кнопки нет и `useVoiceDialog` возвращает `undefined`. */
  engine: VoiceDialogEngine | undefined;
  chatId: string;
  chat: DialogChat;
  /** Видео агента: на месте показанного видео звучит `labels.voice.videoOnScreen`. */
  videos?: VideosClient;
}

/** Режим кончился сам или человеком: звук и слова больше не идут. */
const finished = (view: VoiceDialogView) => view.state === "off" || view.state === "error";

/** Часть ответа, в которой модель сейчас работает: размышление или инструмент без результата. */
type ActiveWork = Pick<AssistantActivity, "kind" | "toolName">;
/** `quiet` — шло ещё до включения режима: о начале движку не говорили, о конце тоже не скажем. */
type AnnouncedWork = ActiveWork & { quiet: boolean };

/**
 * Связывает голосовой режим с чатом: даёт движку мост (отправка слов, остановка, текст ответа, конец ответа, отметка
 * обрыва) и возвращает вид для кнопки в поле ввода. Мост не знает, как режим слушает и говорит; движок не знает, как устроен чат.
 */
export function useVoiceDialog({ engine, chatId, chat, videos }: UseVoiceDialogOptions): VoiceDialogView | undefined {
  const labels = useChatLabels();
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const [engineView, setEngineView] = useState<VoiceDialogView | null>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const active = useRef(false);
  /** Номер включения: вид от закрытого режима не должен попасть на экран. */
  const generation = useRef(0);
  const textListeners = useRef(new Set<(delta: AssistantTextDelta) => void>());
  const endListeners = useRef(new Set<(end: AnswerEnd) => void>());
  /** Сколько знаков каждой текстовой части уже отдано движку: сообщение → длины по номерам частей. */
  const delivered = useRef(new Map<string, number[]>());
  /** Ждущие виджеты, о которых движку уже сказано (или что ждали до включения режима). */
  const spokenWidgets = useRef(new Set<string>());
  /** Показанные видео, о которых движку уже сказано (или что были на экране до включения режима). */
  const spokenVideos = useRef(new Set<string>());
  const videosRef = useRef(videos);
  videosRef.current = videos;
  const activityListeners = useRef(new Set<(activity: AssistantActivity) => void>());
  /** Части, о начале которых движку уже сказано: сообщение → номер части → что в ней идёт. */
  const announced = useRef(new Map<string, Map<number, AnnouncedWork>>());

  const emitActivity = useCallback((activity: AssistantActivity) => {
    for (const listener of [...activityListeners.current]) listener(activity);
  }, []);

  const emitEnd = useCallback((end: AnswerEnd) => {
    for (const listener of [...endListeners.current]) listener(end);
  }, []);

  const bridge = useMemo<DialogChatBridge>(
    () => ({
      send: (text, options) => {
        if (!chatRef.current.sendVoiceMessage(text, options)) queueMicrotask(() => emitEnd({ messageId: "", status: "error" }));
      },
      stop: () => chatRef.current.stop(),
      replaceLastMessage: (text, options) => chatRef.current.replaceLastVoiceMessage(text, options),
      subscribeAssistantText: (listener) => {
        textListeners.current.add(listener);
        return () => void textListeners.current.delete(listener);
      },
      subscribeAnswerEnd: (listener) => {
        endListeners.current.add(listener);
        return () => void endListeners.current.delete(listener);
      },
      subscribeAssistantActivity: (listener) => {
        activityListeners.current.add(listener);
        return () => void activityListeners.current.delete(listener);
      },
      showCut: (messageId, cut) => chatRef.current.showVoiceCut(messageId, cut),
    }),
    [emitEnd],
  );

  // Дописанный текст последнего ответа уходит движку приращениями; всё, что было в ленте до включения, не звучит.
  useEffect(() => {
    if (!active.current) return;
    const last = chat.messages.at(-1);
    if (last?.role !== "assistant") return;
    const lengths = delivered.current.get(last.id) ?? [];
    last.parts.forEach((part, partIndex) => {
      if (part.type !== "text") return;
      const before = lengths[partIndex] ?? 0;
      lengths[partIndex] = part.text.length;
      if (part.text.length > before) {
        for (const listener of [...textListeners.current]) listener({ messageId: last.id, partIndex, text: part.text.slice(before) });
      }
    });
    delivered.current.set(last.id, lengths);
  }, [chat.messages]);

  // Ждущий виджет: к озвучке добавляется его вопрос; подсказки не звучат (FR-019), один виджет — один раз.
  useEffect(() => {
    if (!active.current) return;
    const last = chat.messages.at(-1);
    if (last?.role !== "assistant") return;
    for (const [partIndex, call] of waitingWidgets(last)) {
      if (spokenWidgets.current.has(call.toolCallId)) continue;
      spokenWidgets.current.add(call.toolCallId);
      const text = `${widgetPhrase(call, labelsRef.current)} `;
      for (const listener of [...textListeners.current]) listener({ messageId: last.id, partIndex, text });
    }
  }, [chat.messages]);

  // Показанное видео: к озвучке добавляется короткое «видео на экране» — что за видео, говорит сама модель.
  useEffect(() => {
    if (!active.current) return;
    const last = chat.messages.at(-1);
    if (last?.role !== "assistant") return;
    for (const [partIndex, toolCallId] of shownVideos(last, videosRef.current)) {
      if (spokenVideos.current.has(toolCallId)) continue;
      spokenVideos.current.add(toolCallId);
      const text = `${labelsRef.current.voice.videoOnScreen}. `;
      for (const listener of [...textListeners.current]) listener({ messageId: last.id, partIndex, text });
    }
  }, [chat.messages]);

  // Размышление и вызовы инструментов последнего ответа: начало и конец каждой части уходят движку один раз.
  useEffect(() => {
    if (!active.current) return;
    const last = chat.messages.at(-1);
    const now = last?.role === "assistant" ? activeWork(last) : new Map<number, ActiveWork>();
    const known = announced.current;
    for (const [messageId, parts] of [...known]) {
      for (const [partIndex, work] of [...parts]) {
        if (messageId === last?.id && now.has(partIndex)) continue;
        parts.delete(partIndex);
        if (!work.quiet) emitActivity({ messageId, partIndex, ...endOf(work) });
      }
      if (parts.size === 0) known.delete(messageId);
    }
    if (!last) return;
    const parts = known.get(last.id) ?? new Map<number, AnnouncedWork>();
    for (const [partIndex, work] of now) {
      if (parts.has(partIndex)) continue;
      parts.set(partIndex, { ...work, quiet: false });
      emitActivity({ messageId: last.id, partIndex, kind: work.kind, ...(work.toolName && { toolName: work.toolName }), phase: "start" });
    }
    if (parts.size > 0) known.set(last.id, parts);
  }, [chat.messages, emitActivity]);

  // Конец ответа — момент, когда чат перестал быть занятым; идёт после последнего приращения текста.
  const wasBusy = useRef(chat.busy);
  useEffect(() => {
    const ended = wasBusy.current && !chat.busy;
    wasBusy.current = chat.busy;
    if (!ended || !active.current) return;
    // Часть, застрявшая «идёт», когда ответ кончился, закрывается: режим не должен ждать её вечно.
    for (const [messageId, parts] of announced.current) {
      for (const [partIndex, work] of parts) if (!work.quiet) emitActivity({ messageId, partIndex, ...endOf(work) });
    }
    announced.current.clear();
    const last = chat.messages.at(-1);
    if (last?.role !== "assistant") emitEnd({ messageId: "", status: "error" });
    else emitEnd({ messageId: last.id, status: endStatus(last) });
  }, [chat.busy, chat.messages, emitActivity, emitEnd]);

  // Смена чата или уход со страницы закрывают режим: микрофон и звук не должны остаться без хозяина.
  useEffect(
    () => () => {
      generation.current += 1;
      if (!active.current) return;
      active.current = false;
      announced.current.clear();
      engine?.close();
      setEngineView(null);
    },
    [engine, chatId],
  );

  const toggle = useCallback(() => {
    if (!engine) return;
    if (engineView?.state === "error") {
      // Нажатие на панели с ошибкой («Выйти»): закрыть режим, чтобы вернулось поле ввода; причина остаётся в виде.
      generation.current += 1;
      engine.close();
      setEngineView({ state: "off", speechAvailable: true, error: engineView.error, onToggle: () => {} });
      return;
    }
    if (!active.current) {
      const id = ++generation.current;
      active.current = true;
      delivered.current = snapshotOf(chatRef.current.messages);
      announced.current = quietWork(chatRef.current.messages);
      spokenWidgets.current = new Set([...waitingWidgets(chatRef.current.messages.at(-1))].map(([, call]) => call.toolCallId));
      spokenVideos.current = new Set(shownVideos(chatRef.current.messages.at(-1), videosRef.current).values());
      setEngineView({ state: "connecting", speechAvailable: true, onToggle: () => {} });
      engine.open({
        chatId,
        chat: bridge,
        onView: (view) => {
          if (id !== generation.current) return;
          active.current = !finished(view);
          setEngineView(view);
        },
      });
      return;
    }
    generation.current += 1;
    active.current = false;
    engine.close();
    setEngineView(null);
  }, [bridge, chatId, engine, engineView]);

  return useMemo(() => {
    if (!engine) return undefined;
    const view: VoiceDialogView = engineView ?? { state: "off", speechAvailable: true, onToggle: toggle };
    return { ...view, onToggle: toggle };
  }, [engine, engineView, toggle]);
}

/** Части ответа, где модель работает сейчас: размышление идёт или инструмент ещё без результата. */
function activeWork(message: AgentChatMessage): Map<number, ActiveWork> {
  const work = new Map<number, ActiveWork>();
  message.parts.forEach((part, partIndex) => {
    if (part.type === "reasoning") {
      if (part.state === "streaming") work.set(partIndex, { kind: "reasoning" });
    } else if (isToolUIPart(part)) {
      // Ждущее подтверждения или отклонённое — не работа модели; «подтвердили» — инструмент вот-вот пойдёт.
      const running = part.state === "input-streaming" || part.state === "input-available" || part.state === "approval-responded" || (part.state === "output-available" && part.preliminary === true);
      if (running) work.set(partIndex, { kind: "tool", toolName: getToolName(part) });
    }
  });
  return work;
}

const endOf = (work: ActiveWork): Pick<AssistantActivity, "kind" | "phase"> & Pick<Partial<AssistantActivity>, "toolName"> => ({
  kind: work.kind,
  ...(work.toolName && { toolName: work.toolName }),
  phase: "end",
});

/** Что шло в последнем ответе в момент включения режима: уже «объявлено», чтобы не считаться началом. */
function quietWork(messages: readonly AgentChatMessage[]): Map<string, Map<number, AnnouncedWork>> {
  const last = messages.at(-1);
  const known = new Map<string, Map<number, AnnouncedWork>>();
  if (last?.role !== "assistant") return known;
  const work = activeWork(last);
  if (work.size > 0) known.set(last.id, new Map([...work].map(([index, item]) => [index, { ...item, quiet: true }])));
  return known;
}

/** Чем кончился ответ; ответ, застрявший в «идёт», когда чат уже не занят, — прерванный. */
function endStatus(message: AgentChatMessage): AnswerEnd["status"] {
  const status = message.metadata?.status ?? "complete";
  return status === "streaming" ? "interrupted" : status;
}

function snapshotOf(messages: readonly AgentChatMessage[]): Map<string, number[]> {
  const snapshot = new Map<string, number[]>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    snapshot.set(
      message.id,
      message.parts.map((part) => (part.type === "text" ? part.text.length : 0)),
    );
  }
  return snapshot;
}

/** Виджеты последнего ответа, что ждут человека, по номерам частей. */
function waitingWidgets(message: AgentChatMessage | undefined): Map<number, WidgetCall> {
  const waiting = new Map<number, WidgetCall>();
  if (message?.role !== "assistant") return waiting;
  const awaitingHere = message.metadata?.status === "awaiting_approval";
  message.parts.forEach((part, partIndex) => {
    if (!isToolUIPart(part)) return;
    const call = widgetCallOf(part, { awaitingHere, customNames: new Set() });
    if (call && call !== "hidden" && call.state === "pending") waiting.set(partIndex, call);
  });
  return waiting;
}

/** Готовые видео ответа: номер части → id вызова. Отказ и идущий вызов не в счёт. */
function shownVideos(message: AgentChatMessage | undefined, videos: VideosClient | undefined): Map<number, string> {
  const shown = new Map<number, string>();
  if (!videos || message?.role !== "assistant") return shown;
  message.parts.forEach((part, partIndex) => {
    if (isToolUIPart(part) && getToolName(part) === videos.toolName && videos.describe(part)?.state === "ready") shown.set(partIndex, part.toolCallId);
  });
  return shown;
}

/** Что сказать вслух: у выбора — вопрос и варианты, у остальных — «ответьте на экране или голосом». */
function widgetPhrase(call: WidgetCall, labels: ResolvedChatLabels): string {
  const input = typeof call.input === "object" && call.input !== null ? (call.input as Record<string, unknown>) : {};
  const title = [input["question"], input["title"]].find((value): value is string => typeof value === "string" && value.length > 0);
  const options = Array.isArray(input["options"]) ? input["options"].filter((option): option is string => typeof option === "string") : [];
  if ((call.name === "ask_choice" || call.name === "ask_multi_choice") && title && options.length > 0) return labels.voice.widgetChoices(title, options);
  return labels.voice.widgetOnScreen(title);
}
