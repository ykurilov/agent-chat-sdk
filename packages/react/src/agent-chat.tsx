import type { ComposerOptions } from "./composer-options";
import { getToolName, isToolUIPart } from "ai";
import type { DynamicToolUIPart, ToolUIPart } from "ai";
import { Fragment, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ComponentProps, ElementType, ReactNode } from "react";
import { ALWAYS_IN_CHAT, ALWAYS_OFFERED, messageText } from "./chat-types";
import { stripVoiceTags } from "./voice-tags";
import { useVoiceAnswerIds } from "./voice-turn";
import type { AgentChatMessage, AnswerStatus, ApprovalDecision, ApprovalFailureKind, ChatModelChoice, CompactionMarker } from "./chat-types";
import { partKey, useExpandedParts, usePartOpen } from "./expanded-parts";
import type { ExpandedParts } from "./expanded-parts";
import type { EditErrorKind } from "./labels";
import { useFeedAnnouncement } from "./feed-announcement";
import { isLiveTask, taskElapsedMs, useBackgroundTasks } from "./background-tasks/use-background-tasks";
import { customErrorText, useChatLabels } from "./labels";
import { agentNoticesOf, appNoticesOf, isAgentNoticePart, noticesAsText, noticeViewOf, staffRepliesOf } from "./notices/agent-notices";
import type { AppNotice, NoticeTaskControls, StaffReply } from "./notices/agent-notices";
import type { ChatLabels, ResolvedChatLabels } from "./labels";
import type { SpendingView } from "./spending-status";
import { MessageFeed } from "./message-feed";
import { useMessageEditing } from "./message-editing/use-message-editing";
import type { MessageFeedHandle } from "./message-feed";
import type { AgentChatExtensions, NoticeLines } from "./agent-chat-extensions";
import { answerEdited } from "./answer-editing/answer-editing";
import type { AnswerEditing, AnswerEditMark } from "./answer-editing/answer-editing";
import { createDiagramRenders } from "./diagrams/diagram-renders";
import type { DiagramRenders } from "./diagrams/diagram-renders";
import { countMermaidBlocks, useDiagramBlocks } from "./diagrams/use-diagram-blocks";
import { useDiagramColors } from "./diagrams/use-diagram-colors";
import { useDemoColors, useLiveDemoBlocks } from "./live-demos/use-live-demo-blocks";
import { collectViewerItems } from "./media-viewer/collect-viewer-items";
import { answerFileViews } from "./media-viewer/answer-file-images";
import { SubjectChatLoading } from "./subject-chat/subject-chat-loading";
import { useSubjectChatId } from "./subject-chat/use-subject-chat-id";
import { describeWithViewer } from "./media-viewer/open-attachments";
import { describeGeneratedImages, generatedViewerItems, imageClientsOf } from "./media-viewer/generated-images";
import type { DescribeGeneratedImages } from "./media-viewer/generated-images";
import { useMediaViewer } from "./media-viewer/use-media-viewer";
import type { MediaViewerController } from "./media-viewer/use-media-viewer";
import { suggestedRepliesOf } from "./widgets/suggested-replies";
import type { WidgetFailureKind } from "./widgets/use-widget-answer";
import { SUGGEST_REPLIES, widgetCallOf } from "./widgets/widget-view";
import { WidgetPart } from "./widgets/widget-part";
import { helperCallViewOf, isHelperPart } from "./helpers/helper-call";
import type { AttachmentsPlugin, MessageAttachmentsView } from "./attachments-contract";
import type { AgentVideoView, ChatSkin, DiagramColors, LiveDemoColors, MessageActionView, ModelChoiceView, ToolApprovalView, ToolCallState } from "./skin-contract";
import { useAgentChat } from "./use-agent-chat";
import { useModelChoice } from "./use-model-choice";
import { useVoiceDictation } from "./use-voice-dictation";
import type { VoiceInput } from "./voice-input";
import type { VoiceDialogEngine } from "./voice-dialog";
import { useVoiceDialog } from "./use-voice-dialog";
import type { AppRefusal } from "./app-refusal";
import type { ChatAccess } from "./chat-access";
import type { ServerRefusal } from "./server-refusal";
import type { ChatRefusal, ConnectionState, EditRefusalReason, LivenessOptions } from "./use-agent-chat";
import type { AgentAppBridge } from "./app-bridge/app-bridge";
import { useMessageActionRuns } from "./message-actions";
import type { MessageAction, MessageActionTarget } from "./message-actions";
import { renderComposerActions } from "./composer-actions";
import type { ComposerActions } from "./composer-actions";
import { useTurnFinishedReport } from "./turn-finished";
import { appEventOfPart, useAppEventReport } from "./app-events";
import type { AppEvent, AppEventHandler } from "./app-events";
import type { TurnFinishedEvent } from "./turn-finished";
import { ThinkingClockProvider, ThinkingClocksProvider } from "./thinking-status/thinking-status";
import { ChatStateContext } from "./chat-state/chat-state";
import type { ChatStateValues } from "./chat-state/chat-state";
import { steeredAnswerIdsOf } from "./steering/corrections";
import { workLayoutOf } from "./work-view/work-layout";
import type { AnswerEntry, WorkStep } from "./work-view/work-layout";
import { WorkStepsPart } from "./work-view/work-steps-part";

interface FeedExtensions extends AgentChatExtensions {
  reasoningVisible?: boolean;
  modelNames?: ModelChoiceView["providers"];
}

export interface AgentChatProps extends AgentChatExtensions {
  composerOptions?: ComposerOptions;
  /** Адрес обработчика чата, например `/api/chat`. */
  api: string;
  /** Какой чат открыть. Нужен ровно один из `chatId` и `subject`: оба сразу или ни одного — ошибка разработчика (исключение). */
  chatId?: string;
  /**
   * Ключ объекта приложения (урок, заказ), например `"lesson:42"`: при открытии чат спрашивает у сервера
   * `POST {api}/subject` чат человека по этому ключу (нет — сервер создаёт, с приветствием) и дальше работает с ним как
   * с обычным. Отказ сервера показывается текстом. Нужен `subjectChats` в обработчике чата.
   */
  subject?: string;
  skin: ChatSkin;
  /** Сроки живой связи; по умолчанию как в договоре 002. */
  liveness?: LivenessOptions;
  /** Голосовой ввод; без него кнопки микрофона в поле ввода нет. */
  voice?: VoiceInput;
  /** Голосовой режим («разговор»): `createVoiceDialogEngine` из `@ykurilov/agent-chat-voice-dialog`. Без него кнопки режима нет. */
  voiceDialog?: VoiceDialogEngine;
  /** Вложения к сообщениям: `attachmentsClient` из `@ykurilov/agent-chat-attachments/react`. Нет — чат только текстовый. */
  attachments?: AttachmentsPlugin;
  /** У сервера включены лимиты расходов (`limits` в обработчике чата): показывать предупреждение и исчерпание. */
  spendingLimits?: boolean;
  /** Чат занят (идёт ответ) или свободен; вызывается при открытии чата и при каждой смене. Для расширений вокруг чата, например списка чатов. */
  onBusyChange?: (busy: boolean) => void;
  /** Связь с приложением (место на экране, изменения данных, браузерные инструменты); её создаёт `AgentPanelProvider`. Нет — чат как раньше. */
  appBridge?: AgentAppBridge;
  /** Текст в поле ввода при открытии чата. */
  initialDraft?: string;
  /** Правка ответов агента (песочница): кнопка правки у законченных ответов, отметки «изменено», редактор страницы. Нет — ответы не правятся. */
  answerEditing?: AnswerEditing;
  /** Сообщения текущей ветки и занятость чата; вызывается при каждой смене. Для панелей рядом с чатом, например журнала песочницы. */
  onFeedChange?: (feed: { messages: AgentChatMessage[]; busy: boolean }) => void;
  /** Свои кнопки под ответами агента («Нравится», «В заметки»): рисует скин в ряду действий ответа. Массив держите постоянным. */
  messageActions?: MessageAction[];
  /** Ход закончен: у ответа `messageId` итог `status` (включая остановку и ошибку). Один раз на ход; открытие чата хода не даёт. */
  onTurnFinished?: (turn: TurnFinishedEvent) => void;
  /** Свои кнопки у поля ввода («Проверить работу»): узел или функция от помощника (`ComposerHelper`: поле, `send`, `addFiles`). Нет — кнопок нет. */
  composerActions?: ComposerActions;
  /**
   * События приложения (`afterTurn`, `emitAppEvent`, `publishAppEvent` на сервере): по разу на событие. `live: true` —
   * пришло живьём (во время хода или вне хода через канал наблюдения), `false` — лежало в истории при открытии чата.
   * У события вне хода нет `messageId`. Вид события в ответе задаёт `appEvents`.
   */
  onAppEvent?: AppEventHandler;
  /**
   * Приложение отказало ходу (`beforeTurn`) или человеку в доступе (`resolveUser`): `kind` — `turn_refused` или `access_refused`,
   * `code` — для программы, `message` — слова для человека (до 300 знаков; чат их уже показал). Зовётся на каждый такой отказ,
   * в том числе когда сервер не открыл чат объекта (`subject`).
   */
  onTurnRefused?: (refusal: AppRefusal) => void;
  /**
   * Права человека в чате и закрытие (`closed`, `null` — открыт): после загрузки истории и при каждой смене (отказ
   * `chat_closed`, закрытие инструментом, события `chat-closed` и `chat-reopened`). Кнопки чат прячет сам.
   */
  onChatAccessChange?: (access: ChatAccess) => void;
  /**
   * Состояние чата показанной ветки (`model.state` на сервере) после загрузки истории и при каждой смене: запись по
   * ходу ответа, смена ветки, правка. То же значение повторно не приходит. Внутри ленты — `useChatState()`.
   */
  onStateChange?: (state: ChatStateValues) => void;
  /**
   * Человек выбрал модель или уровень рассуждений в меню, и сервер сохранил выбор. Выбор по умолчанию и выбор из истории
   * его не зовут. На сервере то же сообщает хук `onModelChosen`.
   */
  onModelChosen?: (choice: ChatModelChoice) => void;
  /**
   * Служебный, для `ChatWorkspace`: приложению не нужен. Чат не открылся и прав не будет: его нет, приложение не пустило
   * человека или история не загрузилась. Пока права неизвестны, список чатов скрыт, а в этих случаях он нужен,
   * чтобы выбрать другой чат.
   */
  onChatUnavailable?: () => void;
  /**
   * Другое значение — история перечитывается с сервера: права, закрытие и лента. Для случая, когда чат изменили не
   * через этот экран (например, песочница открыла закрытый чат снова). Первое значение ничего не перечитывает.
   */
  reloadKey?: number;
  /**
   * Поправки на лету: пока идёт ответ, поле принимает текст, агент учтёт его на ближайшем шаге. Включено, если скин их
   * рисует (`ChatSkin.steering`, договор 21); `false` — выключить и у такого скина. Скин без `steering` — как до 0.34.
   */
  steering?: boolean;
}

/** Лента чата с агентом. Всё видимое рисуют компоненты скина. */
export function AgentChat(props: AgentChatProps) {
  if (props.chatId !== undefined && props.subject !== undefined) throw new Error("AgentChat: pass either chatId or subject, not both.");
  if (props.subject !== undefined) return <SubjectAgentChat {...props} subject={props.subject} />;
  if (props.chatId === undefined) throw new Error("AgentChat: chatId or subject is required.");
  // Плагин вложений — хук: пока он есть или нет, порядок хуков внутри неизменен, а смена превращается в новый экземпляр.
  // Другой чат — новый экземпляр, как у чата объекта: состояние ленты (в том числе учёт событий приложения) не
  // переходит из чата в чат.
  return <AgentChatBody key={`${props.chatId}:${props.attachments ? "attachments" : "plain"}`} {...props} chatId={props.chatId} />;
}

/** Чат объекта: сначала id чата по ключу у сервера, потом обычный чат; отказ — текстом с «Повторить». */
function SubjectAgentChat(props: AgentChatProps & { subject: string }) {
  const found = useSubjectChatId(props.api, props.subject, props.onTurnRefused);
  if (found.state === "ready") return <AgentChatBody key={`${found.chatId}:${props.attachments ? "attachments" : "plain"}`} {...props} chatId={found.chatId} />;
  if (found.state === "refused") return <props.skin.ErrorNotice kind="other" text={found.text} onRetry={found.retry} />;
  if (found.state === "failed") return <props.skin.ErrorNotice kind="other" onRetry={found.retry} />;
  return <SubjectChatLoading skin={props.skin} />;
}

function AgentChatBody({ composerOptions, api, chatId, skin, liveness, voice, voiceDialog, attachments: attachmentsPlugin, spendingLimits, onBusyChange, appBridge, initialDraft, answerEditing, onFeedChange, messageActions, onTurnFinished, onTurnRefused, composerActions, onAppEvent, onChatAccessChange, onStateChange, onModelChosen, onChatUnavailable, reloadKey, steering, widgets, diagrams, liveDemos, images, videos, appEvents, workView, stepPhrases, noticeLines, answerDetails }: AgentChatProps & { chatId: string }) {
  const spendingNoticeId = useId();
  const closedNoticeId = useId();
  const chat = useAgentChat({
    api,
    chatId,
    ...(liveness && { liveness }),
    ...(spendingLimits && { spendingLimits }),
    ...(appBridge && { appBridge }),
    ...(initialDraft !== undefined && { initialDraft }),
    ...(onTurnRefused && { onTurnRefused }),
    ...(reloadKey !== undefined && { reloadKey }),
    // Поправки — только у скина, который их рисует: иначе текст ушёл бы поправкой без «Стопа» рядом и без пометки.
    steering: skin.steering === true && steering !== false,
    // Событие хука после «Стопа» сообщит учёт ленты, когда перечитанная история принесёт его часть.
    onAppEvent: (event: AppEvent, messageId?: string) => (messageId ? appEventReport.expectLive(messageId) : onAppEvent?.(event, { live: true })),
    onExpectLiveAppEvents: (messageId: string) => appEventReport.expectLive(messageId),
  });
  const backgroundTasks = useBackgroundTasks({
    chatUrl: `${api}/${encodeURIComponent(chatId)}`,
    enabled: chat.loaded && chat.backgroundTasksAvailable && Boolean(skin.TaskCard || skin.AgentNoticeView),
    version: chat.tasksVersion,
  });
  // Выбор чата приходит с историей; пока история грузится (и не сорвалась), выбор по умолчанию не показывается.
  const savedChoicePending = !chat.loaded && !chat.loadFailed && !chat.notFound;
  // Меню — после истории: права приходят с ней. Нужно оно для выбора модели; без выбора — только вложениям, если сервер
  // (старый) не прислал, видит ли модель картинки. Скрытая модель меню не запрашивает никогда.
  const menuWanted =
    !savedChoicePending &&
    chat.capabilities.modelDetails !== false &&
    (chat.capabilities.modelChoice || (attachmentsPlugin !== undefined && chat.modelAcceptsImages === undefined));
  const modelChoice = useModelChoice({ api, chatId, savedChoice: chat.savedModelChoice, savedChoicePending, menuWanted, onModelChosen });
  // Меню не нужно — и прежнее в памяти не в счёт: выбор мог смениться без него. Видит ли модель картинки — по истории.
  const chatModelSeesImages = menuWanted ? (modelSeesImages(modelChoice) ?? chat.modelAcceptsImages) : chat.modelAcceptsImages;
  const dictation = useVoiceDictation({ voice, value: chat.value, setValue: chat.setValue, chatId });
  const dialog = useVoiceDialog({ engine: voiceDialog, chatId, chat, ...(videos && { videos }) });
  const attachments = attachmentsPlugin?.useController({ api, chatId, modelSeesImages: chatModelSeesImages });
  const describeFiles = attachments?.describe;
  const imageClients = useSameList(imageClientsOf(images));
  const [localReasoningVisible, setLocalReasoningVisible] = useState(true);
  const showReasoning = composerOptions?.reasoningVisibility?.value ?? localReasoningVisible;
  const effectiveComposerOptions = useMemo(() => ({ ...composerOptions, reasoningVisibility: composerOptions?.reasoningVisibility ?? { value: showReasoning, onChange: setLocalReasoningVisible } }), [composerOptions, showReasoning]);
  const showAnswerDetails = answerDetails ?? composerOptions?.variant === "extended";
  // Only catalog names affect past answers; changing the current model/effort keeps this reference stable.
  const answerNamesKey = showAnswerDetails ? JSON.stringify(modelChoice.providers.map(({ id, name, models }) => ({ id, name, models: models.map(({ id, name }) => ({ id, name })) }))) : "";
  const answerModelNames = useMemo<ModelChoiceView["providers"] | undefined>(() => answerNamesKey ? JSON.parse(answerNamesKey) as ModelChoiceView["providers"] : undefined, [answerNamesKey]);
  // Свойства страницы несутся вниз одним стабильным объектом: ввод в поле ответы в ленте не перерисовывает.
  const extensions = useMemo<FeedExtensions>(
    () => ({
      reasoningVisible: showReasoning,
      answerDetails: showAnswerDetails,
      ...(answerModelNames && { modelNames: answerModelNames }),
      ...(widgets && { widgets }),
      ...(diagrams && { diagrams }),
      ...(liveDemos && { liveDemos }),
      ...(imageClients.length > 0 && { images: imageClients }),
      ...(videos && { videos }),
      ...(appEvents && { appEvents }),
      ...(workView && { workView }),
      ...(stepPhrases && { stepPhrases }),
      ...(noticeLines && { noticeLines }),
    }),
    [widgets, diagrams, liveDemos, imageClients, videos, appEvents, workView, stepPhrases, noticeLines, showReasoning, showAnswerDetails, answerModelNames],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<MessageFeedHandle>(null);
  const labels = useChatLabels();
  const expanded = useExpandedParts(chatId);
  const announcement = useFeedAnnouncement(chat.messages, chat.busy, chatId);
  const { busy, canRetry, retry, canEdit, canRegenerate, regenerate, edit, selectBranch, respondToApproval, approvalPendingId, approvalFailure } = chat;
  const { answerWidget, widgetPendingId, widgetFailure, sendReply, capabilities, closed } = chat;
  const chatClosed = closed !== null;
  const reportAccess = useRef(onChatAccessChange);
  reportAccess.current = onChatAccessChange;
  useEffect(() => {
    if (chat.loaded) reportAccess.current?.({ capabilities, closed });
  }, [capabilities, chat.loaded, closed]);
  const { chatState } = chat;
  const reportState = useRef(onStateChange);
  reportState.current = onStateChange;
  useEffect(() => {
    if (chat.loaded) reportState.current?.(chatState);
  }, [chat.loaded, chatState]);
  const reportUnavailable = useRef(onChatUnavailable);
  reportUnavailable.current = onChatUnavailable;
  const unavailable = chat.notFound || chat.loadFailed || chat.accessRefusal !== null;
  useEffect(() => {
    if (unavailable) reportUnavailable.current?.();
  }, [unavailable]);
  /**
   * «Ответ отправлен» для диктора: звучит, пока лента не скажет своё — итог продолжения хода. `feed` — что лента
   * говорила в миг отправки.
   */
  const [widgetAnnouncement, setWidgetAnnouncement] = useState<{ text: string; feed: string; chatId: string } | null>(null);
  const announced =
    widgetAnnouncement && widgetAnnouncement.chatId === chatId && (announcement === "" || announcement === widgetAnnouncement.feed)
      ? widgetAnnouncement.text
      : announcement;
  const announcementRef = useRef(announcement);
  announcementRef.current = announcement;
  const onWidgetAnswer = useCallback(
    (toolCallId: string, answer: unknown) =>
      void answerWidget(toolCallId, answer, () => setWidgetAnnouncement({ text: labels.widgets.answerSent, feed: announcementRef.current, chatId })),
    [answerWidget, chatId, labels],
  );
  const suggestedReplies = useMemo(() => suggestedRepliesOf(chat.messages, busy), [busy, chat.messages]);
  const exhaustedSpending = chat.spending?.state === "exhausted";
  const pickReply = useCallback(
    (text: string) => {
      if (sendReply(text)) feedRef.current?.scrollToBottom();
    },
    [sendReply],
  );
  const reportBusy = useRef(onBusyChange);
  reportBusy.current = onBusyChange;
  useEffect(() => {
    reportBusy.current?.(busy);
  }, [busy, chatId]);
  const lastIndex = chat.messages.length - 1;
  // Поправки, которые агент ещё не взял, идут в ленте после сообщений, с пометкой.
  const { corrections } = chat;
  const feedMessages = useMemo(() => (corrections.length > 0 ? [...chat.messages, ...corrections] : chat.messages), [chat.messages, corrections]);
  const correctionIds = useMemo(() => new Set(corrections.map((correction) => correction.id)), [corrections]);
  const steeredAnswerIdsKey = steeredAnswerIdsOf(feedMessages);
  const steeredAnswerIds = useMemo(() => new Set(steeredAnswerIdsKey.split(" ")), [steeredAnswerIdsKey]);
  const reportFeed = useRef(onFeedChange);
  reportFeed.current = onFeedChange;
  useEffect(() => {
    reportFeed.current?.({ messages: chat.messages, busy });
  }, [busy, chat.messages]);
  useTurnFinishedReport(chatId, busy, chat.messages, onTurnFinished);
  const appEventReport = useAppEventReport(chatId, chat.loaded, busy, chat.messages, onAppEvent);
  const actionRuns = useMessageActionRuns(chatId);
  const dividers = useMemo(() => dividersByMessage(chat.compactions), [chat.compactions]);
  const voiceAnswers = useVoiceAnswerIds(chat.messages);
  const forkByMessage = useMemo(() => new Map(chat.forks.map((fork) => [fork.messageId, fork])), [chat.forks]);
  /** Ответ агента, на месте которого стоит редактор страницы. */
  const [editingAnswerId, setEditingAnswerId] = useState<string | null>(null);
  const saving = useRef(false);
  const composerValue = useRef(chat.value);
  composerValue.current = chat.value;
  const { setValue: setComposerValue } = chat;
  // Сообщения с открытым полем правки больше нет: набранное уходит в поле ввода, а не пропадает.
  const draftLost = useCallback(
    (text: string) => setComposerValue(composerValue.current.trim().length > 0 ? `${composerValue.current}\n\n${text}` : text),
    [setComposerValue],
  );
  /** Открытое поле правки; после отказа открывается снова с тем, что печатал собеседник, и ошибкой. */
  const editing = useMessageEditing(chat.messages, { saving, onDraftLost: draftLost });
  const editingId = editing.id;
  /** Лента открывается заново при смене ветки: замеры прежних сообщений новым не подходят. */
  const [feedView, setFeedView] = useState<{ epoch: number; openAtMessageId?: string }>({ epoch: 0 });
  // Окно просмотра: карусель — картинки текущей ветки; другой чат или ветка закрывают окно.
  // Картинки агента — только у скина с `GeneratedImages`: без него вызов остаётся строкой инструмента и в карусель не идёт.
  const imagesShown = imageClients.length > 0 && skin.GeneratedImages ? imageClients : undefined;
  const viewerImages = useMemo(() => imagesShown && generatedViewerItems(describeGeneratedImages(imagesShown, { api, chatId })), [imagesShown, api, chatId]);
  const getViewerItems = useCallback(
    () => collectViewerItems({ messages: chat.messages, describeAttachments: describeFiles, extraItems: viewerImages }),
    [chat.messages, describeFiles, viewerImages],
  );
  const mediaViewer = useMediaViewer({ getItems: getViewerItems, resetKey: `${chatId}:${feedView.epoch}` });
  const describeImages = useMemo(
    () => imagesShown && describeGeneratedImages(imagesShown, { api, chatId, open: skin.MediaViewer && mediaViewer.open }),
    [imagesShown, api, chatId, skin.MediaViewer, mediaViewer.open],
  );
  const describeAttachments = useMemo(
    () => describeWithViewer(describeFiles, skin.MediaViewer && mediaViewer.open),
    [describeFiles, skin.MediaViewer, mediaViewer.open],
  );
  // Схемы: готовые рисунки помнит чат, цвета следуют теме страницы; без `diagrams` ничего этого нет.
  const diagramRenders = useMemo(() => diagrams && createDiagramRenders(diagrams), [diagrams]);
  const diagramColors = useDiagramColors(skin, diagrams !== undefined);
  const diagramSetup = useMemo<DiagramSetup | undefined>(
    () =>
      diagramRenders && diagramColors
        ? { renders: diagramRenders, colors: diagramColors, ...(skin.MediaViewer && { open: mediaViewer.open }) }
        : undefined,
    [diagramColors, diagramRenders, mediaViewer.open, skin.MediaViewer],
  );
  // Живые демонстрации: цвета следуют теме страницы; без `liveDemos` за темой никто не следит.
  const demoColors = useDemoColors(skin, liveDemos === true);
  // В чате чужой текст (сервер: история или кусок потока) — демонстрации показываются кодом, рамки не запускаются.
  const demos = useMemo<LiveDemoSetup | undefined>(() => demoColors && { colors: demoColors, blocked: chat.externalContent }, [demoColors, chat.externalContent]);
  const switchBranch = useCallback(
    async (messageId: string) => {
      if (await selectBranch(messageId)) setFeedView((view) => ({ epoch: view.epoch + 1, openAtMessageId: messageId }));
    },
    [selectBranch],
  );
  // Готовые переключатели по сообщениям: тот же элемент не даёт `memo` сообщений с развилками сбрасываться на каждый кусок ответа.
  const switchers = useMemo(() => new Map<string, ReactNode>(), [busy, capabilities.branches, forkByMessage, skin, switchBranch]);
  const switcherOf = useCallback(
    (messageId: string): ReactNode => {
      const cached = switchers.get(messageId);
      if (cached !== undefined) return cached;
      const fork = forkByMessage.get(messageId);
      // Ветки запрещены правом или чат закрыт: стрелок нет совсем.
      if (!fork || !capabilities.branches) return undefined;
      const position = fork.siblingIds.indexOf(messageId);
      if (position < 0) return undefined;
      const before = fork.siblingIds[position - 1];
      const after = fork.siblingIds[position + 1];
      const element = (
        <skin.BranchSwitcher
          position={position + 1}
          count={fork.siblingIds.length}
          {...(!busy && before !== undefined && { onPrevious: () => void switchBranch(before) })}
          {...(!busy && after !== undefined && { onNext: () => void switchBranch(after) })}
        />
      );
      switchers.set(messageId, element);
      return element;
    },
    [busy, capabilities.branches, forkByMessage, skin, switchBranch, switchers],
  );
  /** Поле правки закрывается, только когда сервер принял правку; иначе остаётся с текстом и ошибкой. */
  const saveEdit = useCallback(
    async (messageId: string, text: string) => {
      if (saving.current) return;
      saving.current = true;
      try {
        const outcome = await edit(messageId, text);
        if (outcome.status === "started") {
          editing.close();
          feedRef.current?.scrollToBottom();
          return;
        }
        const kind: EditErrorKind =
          outcome.status === "refused"
            ? EDIT_REFUSAL_ERRORS[outcome.reason]
            : outcome.reason === "busy" || outcome.reason === "offline"
              ? outcome.reason
              : "rejected";
        const messageLimit = outcome.status === "refused" && outcome.reason === "spending_limit" && outcome.unit === "messages";
        const error = (outcome.status === "refused" && outcome.text) || (messageLimit ? labels.editMessageLimit : labels.editErrors[kind]);
        editing.refuse(messageId, text, error);
      } finally {
        saving.current = false;
      }
    },
    [edit, editing, labels],
  );
  const { tasks: backgroundTaskList, decisions: taskDecisions, decide: decideTask } = backgroundTasks;
  const noticeControls = useMemo<NoticeTaskControls>(
    () => ({ tasks: backgroundTaskList, decisions: taskDecisions, decide: (taskId, approvalId, decision) => void decideTask(taskId, approvalId, decision), failureText: labels.approvalFailed }),
    [backgroundTaskList, decideTask, labels, taskDecisions],
  );
  // Ввод в поле не должен трогать ленту: renderMessage меняется только вместе с тем, что рисует.
  const renderMessage = useCallback(
    (message: AgentChatMessage, index: number) => {
      if (correctionIds.has(message.id)) return <UserMessage skin={skin} message={message} describe={describeAttachments} branchSwitcher={undefined} pending />;
      const branchSwitcher = switcherOf(message.id);
      const NoticeView = skin.AgentNoticeView;
      const notices = agentNoticesOf(message);
      const staffReplies = staffRepliesOf(message);
      const appNotices = appNoticesOf(message);
      // Пометки приложения — серыми строками перед всем остальным в сообщении; только они — больше ничего.
      const serviceLines = appNotices.length > 0 && <ServiceLines skin={skin} notices={appNotices} lines={extensions.noticeLines} />;
      const onlyAppNotices = appNotices.length > 0 && notices.length === 0 && staffReplies.length === 0 && message.parts.every(isAgentNoticePart);
      const content =
        onlyAppNotices ? (
          <></>
        ) : staffReplies.length > 0 ? (
          <StaffReplies skin={skin} replies={staffReplies} label={labels.notices.staffSaid} />
        ) : notices.length > 0 ? (
          NoticeView ? (
            <>
              {notices.map((notice, noticeIndex) => (
                <NoticeView key={noticeIndex} {...noticeViewOf(notice, noticeControls)} />
              ))}
            </>
          ) : (
            // Скин без плашек (v16): короткая строка из словаря, не пустой пузырь; править служебное сообщение нельзя.
            <skin.UserMessage text={noticesAsText(notices, labels.notices)} {...(branchSwitcher && { branchSwitcher })} />
          )
        ) : message.role === "user" ? (
          editingId === message.id ? (
            <MessageEditorRow
              key={editing.attempt}
              skin={skin}
              initialText={editing.draftOf(message)}
              describe={describeAttachments}
              message={message}
              {...(editing.error && { error: editing.error })}
              onDraftChange={editing.type}
              onSave={(text) => void saveEdit(message.id, text)}
              onCancel={editing.close}
            />
          ) : (
            <UserMessage
              skin={skin}
              message={message}
              describe={describeAttachments}
              branchSwitcher={branchSwitcher}
              {...(canEdit && { onEdit: () => editing.open(message.id) })}
            />
          )
        ) : editingAnswerId === message.id && answerEditing ? (
          <>
            {answerEditing.renderEditor({
              message,
              onSaved: (newMessageId) => {
                setEditingAnswerId(null);
                void switchBranch(newMessageId);
              },
              onCancel: () => setEditingAnswerId(null),
            })}
          </>
        ) : (
          <AgentAnswer
            skin={skin}
            extensions={extensions}
            {...(diagramSetup && { diagrams: diagramSetup })}
            {...(demos && { demos })}
            describeImages={describeImages}
            describeFiles={describeAttachments}
            message={message}
            voiceAnswer={voiceAnswers.has(message.id)}
            steered={steeredAnswerIds.has(message.id)}
            expanded={expanded}
            status={busy && index === lastIndex ? "streaming" : (message.metadata?.status ?? "complete")}
            branchSwitcher={branchSwitcher}
            {...(index === lastIndex && canRetry && { onRetry: retry })}
            onApproval={respondToApproval}
            approvalPendingId={approvalPendingId}
            approvalFailure={approvalFailure}
            awaitingHuman={index === lastIndex && !busy && !chatClosed && message.metadata?.status === "awaiting_approval"}
            chatClosed={chatClosed}
            chatId={chatId}
            onWidgetAnswer={onWidgetAnswer}
            widgetPendingId={widgetPendingId}
            widgetFailure={widgetFailure}
            {...(index === lastIndex && suggestedReplies && skin.SuggestedReplies && !chatClosed && {
              suggestedReplies: <skin.SuggestedReplies replies={suggestedReplies} onPick={pickReply} disabled={exhaustedSpending} />,
            })}
            {...(index === lastIndex && canRegenerate && { onRegenerate: regenerate })}
            {...(answerEditing && { editMark: answerEditing.edits.get(message.id) })}
            {...(answerEditing && capabilities.answerEditing && !busy && (message.metadata?.status ?? "complete") === "complete" && {
              onEdit: () => setEditingAnswerId(message.id),
            })}
            {...(messageActions && messageActions.length > 0 && {
              actions: messageActions,
              last: index === lastIndex,
              runningActionIds: actionRuns.running.get(message.id),
              onRunAction: actionRuns.run,
            })}
          />
        );
      const shown = serviceLines ? (
        <>
          {serviceLines}
          {content}
        </>
      ) : (
        content
      );
      const markers = dividers.get(message.id);
      // Разделитель живёт в элементе ленты сообщения, после которого стоит: индексы и замеры ленты не меняются.
      return markers ? (
        <>
          {shown}
          {markers.map((marker) => (
            <CompactionDividerRow key={marker.id} skin={skin} marker={marker} expanded={expanded} />
          ))}
        </>
      ) : (
        shown
      );
    },
    [
      actionRuns,
      answerEditing,
      approvalFailure,
      approvalPendingId,
      busy,
      canEdit,
      canRegenerate,
      canRetry,
      capabilities.answerEditing,
      chatClosed,
      correctionIds,
      describeAttachments,
      diagramSetup,
      demos,
      describeImages,
      dividers,
      editing,
      editingAnswerId,
      labels,
      noticeControls,
      exhaustedSpending,
      expanded,
      extensions,
      lastIndex,
      messageActions,
      onWidgetAnswer,
      pickReply,
      regenerate,
      respondToApproval,
      steeredAnswerIds,
      retry,
      saveEdit,
      skin,
      suggestedReplies,
      switchBranch,
      switcherOf,
      voiceAnswers,
      widgetFailure,
      widgetPendingId,
    ],
  );
  if (chat.notFound) return <skin.ChatNotFound />;
  // Приложение не пустило человека в чат: его слова вместо ленты и поля ввода.
  // «Повторить» перечитывает историю: доступ вернули — удачная загрузка снимает отказ.
  if (chat.accessRefusal) return <skin.Layout feed={<skin.ErrorNotice kind="other" text={chat.accessRefusal.text} onRetry={chat.retry} />} composer={null} scrollRef={scrollRef} announcement="" />;

  const feed = (
    <MessageFeed
      key={feedView.epoch}
      ref={feedRef}
      scrollRef={scrollRef}
      messages={feedMessages}
      keepLastMounted={busy}
      {...(editingId !== null && { keepMountedMessageId: editingId })}
      {...(feedView.openAtMessageId && { openAtMessageId: feedView.openAtMessageId })}
      renderMessage={renderMessage}
    />
  );

  // С файлами текст не обязателен, но отправка ждёт, пока все файлы загружены. Без файлов — как в чате без вложений.
  // Права прячут скрепку, микрофон, режим разговора и выбор модели; плагины при этом подключены как были.
  const composerAttachments = capabilities.attachments ? attachments : undefined;
  const sendingFiles = composerAttachments?.hasFiles ?? false;
  const exhausted = chat.spending?.state === "exhausted";
  const sendingBlocked = exhausted || chatClosed;
  const canSubmit = sendingFiles ? chat.loaded && !chat.busy && !sendingBlocked && attachments!.ready : chat.canSubmit;
  // Поправка во время ответа: с файлами — когда они загружены, без них — когда есть текст.
  const canSteer = chat.canSteer && (sendingFiles ? attachments!.ready : chat.value.trim().length > 0);
  const canSend = chat.loaded && !chat.busy && !sendingBlocked;
  const submitComposer = () => {
    if (sendingFiles && !canSubmit && !canSteer) return;
    if (canSubmit || canSteer) {
      // Отправка заканчивает диктовку: слова, пришедшие позже, не должны начинать новое сообщение.
      dictation.cancel();
      feedRef.current?.scrollToBottom();
    }
    // Поле с файлами очищается, только когда отправка принята; отказ сервера возвращает файлы обратно.
    const accepted = chat.submit(sendingFiles ? attachments!.readFiles() : undefined, attachments && ((kind) => attachments.restoreFiles(kind)));
    if (accepted && sendingFiles) attachments!.markSent();
  };
  const composerActionsNode = renderComposerActions(composerActions, {
    value: chat.value,
    setValue: chat.setValue,
    send: (text) => {
      // Обе формы отказывают, пока отправка невозможна: человек нажал кнопку, а не набрал текст, ждать загрузки истории незачем.
      if (!canSend) return;
      if (text === undefined) return submitComposer();
      if (!chat.sendReply(text)) return;
      dictation.cancel();
      feedRef.current?.scrollToBottom();
    },
    addFiles: (files) => composerAttachments?.composer.onAddFiles(files),
    busy: chat.busy,
    blocked: sendingBlocked,
    canSend,
  });
  const connection = connectionNotice(skin, chat.connection, chat.retry, chat.sendFailed || chat.loadFailed, chat.refusal, chat.serverRefusal);
  // Область для диктора стоит в странице всегда: живой регион, который появился уже с текстом, читают не везде.
  const spendingNotice = spendingLimits && skin.SpendingNotice && (
    <skin.SpendingNotice
      id={spendingNoticeId}
      state={chat.spending?.state ?? "none"}
      text={chat.spending ? spendingNoticeText(chat.spending, labels) : ""}
    />
  );
  // Закрытие — слова приложения над полем: своя надпись скина или, у скина до версии 20, блок ошибки с текстом.
  const closedNotice =
    closed &&
    (skin.ChatClosedNotice ? (
      <skin.ChatClosedNotice id={closedNoticeId} code={closed.code} message={closed.message} />
    ) : (
      <skin.ErrorNotice kind="other" text={closed.message} />
    ));
  const sendingBlockedReasonId = chatClosed ? (skin.ChatClosedNotice ? closedNoticeId : undefined) : spendingNotice ? spendingNoticeId : undefined;
  const TaskCard = skin.TaskCard;
  const liveTasks = TaskCard ? backgroundTasks.tasks.filter(isLiveTask) : [];
  const taskCards =
    TaskCard && liveTasks.length > 0 ? (
      <>
        {liveTasks.map((task) => (
          <TaskCard
            key={task.id}
            id={task.id}
            title={task.title}
            status={task.status}
            elapsedMs={taskElapsedMs(task, backgroundTasks.now)}
            onCancel={() => void backgroundTasks.cancel(task.id)}
            canceling={backgroundTasks.cancelingIds.has(task.id)}
          />
        ))}
      </>
    ) : undefined;
  const notices = [taskCards, connection, closedNotice, spendingNotice].filter(Boolean);
  const notice =
    notices.length > 1 ? (
      <>
        {notices.map((part, index) => (
          <Fragment key={index}>{part}</Fragment>
        ))}
      </>
    ) : notices[0];

  const layout = (
    <skin.Layout
      feed={feed}
      scrollRef={scrollRef}
      announcement={announced}
      composer={
        <skin.Composer
          options={effectiveComposerOptions}
          value={chat.value}
          onValueChange={chat.setValue}
          onSubmit={submitComposer}
          canSubmit={canSubmit}
          {...(chat.canSteer && { canSteer })}
          busy={chat.busy}
          onStop={() => void chat.stop()}
          {...(capabilities.modelChoice && { modelChoice })}
          {...(composerAttachments && { attachments: composerAttachments.composer })}
          {...(sendingBlocked && { sendingBlocked: true, ...(sendingBlockedReasonId && { sendingBlockedReasonId }) })}
          {...(capabilities.voice && dictation.view && { voice: dictation.view })}
          {...(capabilities.voice && dialog && { dialog })}
          {...(composerActionsNode != null && { actions: composerActionsNode })}
        />
      }
      {...(notice && { notice })}
    />
  );
  const viewer = skin.MediaViewer && mediaViewer.viewer && <skin.MediaViewer {...mediaViewer.viewer} />;
  return (
    <ChatStateContext.Provider value={chatState}>
      <ThinkingClocksProvider>
        {layout}
        {viewer}
      </ThinkingClocksProvider>
    </ChatStateContext.Provider>
  );
}

/** Надпись лимита: у окна сообщений — сколько осталось или «лимит сообщений исчерпан», у денег — доля и срок. */
function spendingNoticeText(spending: SpendingView, labels: ResolvedChatLabels): string {
  const { state, info } = spending;
  if (info.unit === "messages" && state === "exhausted" && info.reason !== "blocked") return labels.spendingMessagesExhausted(info);
  if (info.unit === "messages" && state === "warning" && info.remaining !== undefined) return labels.spendingMessagesLeft(info.remaining, info);
  return (state === "exhausted" ? labels.spendingExhausted : labels.spendingWarning)(info);
}

/** Записи по сообщению, после которого стоит разделитель. Записи, чьего сообщения нет в ленте, ни на что не попадут. */
function dividersByMessage(compactions: readonly CompactionMarker[]): Map<string, CompactionMarker[]> {
  const byMessage = new Map<string, CompactionMarker[]>();
  for (const marker of compactions) byMessage.set(marker.throughMessageId, [...(byMessage.get(marker.throughMessageId) ?? []), marker]);
  return byMessage;
}

const CompactionDividerRow = memo(function CompactionDividerRow({
  skin,
  marker,
  expanded,
}: {
  skin: ChatSkin;
  marker: CompactionMarker;
  expanded: ExpandedParts;
}) {
  const [open, setOpen] = usePartOpen(expanded, `compaction:${marker.id}`);
  return <skin.CompactionDivider summary={marker.summary} open={open} onOpenChange={setOpen} />;
});

/**
 * Состояние связи главнее отказа сервера: пока связи нет, «что-то пошло не так» только путает. Понятный отказ
 * («войдите снова», «идут ответы в других чатах») главнее общего «что-то пошло не так».
 */
function connectionNotice(
  skin: ChatSkin,
  connection: ConnectionState,
  onRetry: () => void,
  serverRefused: boolean,
  refusal: ChatRefusal | null,
  serverRefusal: ServerRefusal | null,
): ReactNode {
  if (connection === "reconnecting") return <skin.ConnectionNotice state="reconnecting" />;
  if (connection === "offline") return <skin.ConnectionNotice state="offline" onRetry={onRetry} />;
  if (refusal === "signed_out") return <skin.ErrorNotice kind="signed_out" onRetry={onRetry} />;
  // Текст уже в поле: отправить снова человек может сам, когда один из ответов закончится.
  if (refusal === "too_many_turns") return <skin.ErrorNotice kind="too_many_turns" />;
  // Повтор не поможет, пока сервер не настроят: кнопки нет.
  if (refusal === "forbidden_origin") return <skin.ErrorNotice kind="forbidden_origin" />;
  // Сервер назвал причину сам: её и показываем. Окончательный отказ без «Повторить» — повтор получит тот же ответ.
  if (serverRefusal) {
    const retryable = !serverRefusal.final && serverRefused;
    return <skin.ErrorNotice kind="other" text={serverRefusal.text} {...(retryable && { onRetry })} />;
  }
  if (serverRefused) return <skin.ErrorNotice kind="other" onRetry={onRetry} />;
  return null;
}

/** Надпись в поле правки по причине отказа сервера. */
const EDIT_REFUSAL_ERRORS: Record<EditRefusalReason, EditErrorKind> = {
  busy: "busy",
  spending_limit: "spendingLimit",
  invalid: "rejected",
  not_found: "rejected",
  signed_out: "signedOut",
  too_many_turns: "tooManyTurns",
  forbidden_origin: "forbiddenOrigin",
  // Текст сервера идёт в редактор как есть; надпись — на случай, если текста почему-то нет.
  server_refused: "rejected",
};

/** Пометки приложения серыми строками (`ServiceLine`, версия 27); нет строки у пометки или компонента у скина — ничего. */
function ServiceLines({ skin, notices, lines }: { skin: ChatSkin; notices: AppNotice[]; lines: NoticeLines | undefined }) {
  const View = skin.ServiceLine;
  if (!View || !lines) return null;
  const texts = notices.flatMap((notice) => {
    const text = Object.hasOwn(lines, notice.name) ? lines[notice.name]!(notice) : undefined;
    return text ? [{ name: notice.name, text }] : [];
  });
  return (
    <>
      {texts.map(({ name, text }, index) => (
        <View key={`${name}-${index}`} text={text} />
      ))}
    </>
  );
}

/** Реплики живого сотрудника: `StaffMessage` скина; скин без него (до версии 25) — ответом агента с подписью. */
function StaffReplies({ skin, replies, label }: { skin: ChatSkin; replies: StaffReply[]; label: (staffName: string | undefined) => string }) {
  const View = skin.StaffMessage;
  return (
    <>
      {replies.map((reply, index) =>
        View ? (
          <View key={index} text={reply.text} {...(reply.staffName && { staffName: reply.staffName })} />
        ) : (
          <skin.AgentMessage key={index} status="complete" empty={false} onCopy={() => void navigator.clipboard?.writeText(reply.text)}>
            <skin.AgentText markdown={`**${label(reply.staffName)}:** ${reply.text}`} streaming={false} />
          </skin.AgentMessage>
        ),
      )}
    </>
  );
}

/*
 * Пока дописывается ответ, меняется только он: у остальных сообщений тот же объект.
 * `memo` не даёт длинной ленте перерисовываться на каждый кусок ответа.
 */
const UserMessage = memo(function UserMessage({
  skin,
  message,
  describe,
  branchSwitcher,
  onEdit,
  pending,
}: {
  skin: ChatSkin;
  message: AgentChatMessage;
  describe: ((message: AgentChatMessage) => MessageAttachmentsView | undefined) | undefined;
  branchSwitcher: ReactNode;
  onEdit?: () => void;
  pending?: boolean;
}) {
  const files = useMemo(() => describe?.(message), [describe, message]);
  return (
    <skin.UserMessage
      text={messageText(message)}
      {...(files && { attachments: files })}
      {...(branchSwitcher && { branchSwitcher })}
      {...(onEdit && { onEdit })}
      {...(pending && { pending: true })}
    />
  );
});

/** Правка сообщения: черновик живёт здесь, набор текста не перерисовывает ленту. Файлы сообщения остаются как были. */
function MessageEditorRow({
  skin,
  message,
  initialText,
  describe,
  error,
  onDraftChange,
  onSave,
  onCancel,
}: {
  skin: ChatSkin;
  message: AgentChatMessage;
  initialText: string;
  describe: ((message: AgentChatMessage) => MessageAttachmentsView | undefined) | undefined;
  error?: string;
  /** Набранный текст хранит чат: поле, пересозданное лентой, открывается с ним. */
  onDraftChange: (text: string) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initialText);
  const [shownError, setShownError] = useState(error);
  const files = useMemo(() => describe?.(message), [describe, message]);
  // С файлами текст может быть пустым: сообщение без слов, только с файлами, уже бывает.
  const canSave = draft.trim().length > 0 || files !== undefined;
  return (
    <skin.MessageEditor
      value={draft}
      onValueChange={(value) => {
        setDraft(value);
        onDraftChange(value);
        setShownError(undefined);
      }}
      onSave={() => canSave && onSave(draft)}
      onCancel={onCancel}
      canSave={canSave}
      {...(shownError && { error: shownError })}
      {...(files && { attachments: files })}
    />
  );
}

/** Скобки и обратная косая в названии ломали бы ссылку markdown. */
/** Название — одной строкой и без разметки: переводы строк → пробел, знаки markdown экранированы. */
const escapeLinkText = (text: string) =>
  text.replace(/[\r\n]+/g, " ").replace(/[\\\x60*_{}[\]()#+!<>|~&]/g, (char) => `\\${char}`);

/** Видео для скина без карточек: «▶ [Название](страница) · с 3:20». */
function videoLinkMarkdown(video: AgentVideoView, labels: ResolvedChatLabels): string {
  const link = `▶ [${escapeLinkText(video.title)}](${video.pageUrl})`;
  return video.start ? `${link} · ${labels.videos.from(video.start)}` : link;
}

/** Видит ли выбранная модель картинки; `undefined` — меню ещё не пришло или модели нет в нём. */
function modelSeesImages(choice: ModelChoiceView): boolean | undefined {
  return choice.providers
    .find((provider) => provider.id === choice.current.providerId)
    ?.models.find((model) => model.id === choice.current.modelId)?.acceptsImages;
}

const AgentAnswer = memo(function AgentAnswer({
  skin,
  describeImages,
  describeFiles,
  message,
  voiceAnswer,
  steered,
  expanded,
  status,
  onRetry,
  onApproval,
  approvalPendingId,
  approvalFailure,
  awaitingHuman,
  chatClosed,
  chatId,
  onWidgetAnswer,
  widgetPendingId,
  widgetFailure,
  suggestedReplies,
  extensions,
  diagrams,
  demos,
  branchSwitcher,
  onRegenerate,
  editMark,
  onEdit,
  actions,
  last,
  runningActionIds,
  onRunAction,
}: {
  skin: ChatSkin;
  /** Свои виджеты, схемы и картинки страницы. */
  extensions: FeedExtensions;
  /** Схемы подключены: блоки ```mermaid рисуются (без этого — обычный код). */
  diagrams?: DiagramSetup;
  /** Живые демонстрации подключены: блоки ```html-demo запускаются в этих цветах (без этого — обычный код). */
  demos?: LiveDemoSetup;
  /** Картинки агента (`images`): вызов `generate_images` → вид `GeneratedImages`; нет — строка инструмента. */
  describeImages: DescribeGeneratedImages | undefined;
  /** Вид вложений (плагин `attachments`): картинки-файлы в ответе агента (импорт) — видом `GeneratedImages`. */
  describeFiles: ((message: AgentChatMessage) => MessageAttachmentsView | undefined) | undefined;
  message: AgentChatMessage;
  /** Ответ голосового хода: теги голоса слышны, но на экране и в копии их нет. */
  voiceAnswer: boolean;
  /** Агент закончил ответ, чтобы взять поправку: пустой — не «модель не дала ответа». */
  steered: boolean;
  expanded: ExpandedParts;
  status: AnswerStatus;
  onRetry?: () => void;
  onApproval: (approvalId: string, decision: ApprovalDecision) => void;
  approvalPendingId: string | null;
  approvalFailure: { id: string; kind: ApprovalFailureKind; text?: string } | null;
  /** Последний ответ ветки ждёт человека: только в нём виджет активен. */
  awaitingHuman: boolean;
  /** Чат закрыт: ждущие подтверждения без кнопок. */
  chatClosed: boolean;
  /** Чат ленты: его получает свой компонент виджета. */
  chatId: string;
  onWidgetAnswer: (toolCallId: string, answer: unknown) => void;
  widgetPendingId: string | null;
  widgetFailure: { id: string; kind: WidgetFailureKind; text?: string } | null;
  /** Кнопки-подсказки под последним законченным ответом. */
  suggestedReplies?: ReactNode;
  branchSwitcher: ReactNode;
  onRegenerate?: () => void;
  /** Что в ответе изменено человеком (песочница). */
  editMark?: AnswerEditMark | undefined;
  /** Открыть правку ответа (песочница). */
  onEdit?: () => void;
  /** Свои кнопки приложения: какие показать, решает `visible` каждой. */
  actions?: MessageAction[];
  /** Последний ответ ветки — для `visible`. */
  last?: boolean;
  /** Id кнопок, чьи обработчики у этого ответа ещё идут. */
  runningActionIds?: readonly string[] | undefined;
  onRunAction?: (action: MessageAction, message: AgentChatMessage, text: string) => void;
}) {
  const labels = useChatLabels();
  const durations = message.metadata?.reasoningDurationsMs ?? {};
  const thoughtTitles = message.metadata?.thoughtTitles ?? {};
  let reasoningIndex = 0;
  // Простой вид: размышления и вызовы — шаги работы, их раскладывает `workLayoutOf`; подробный — всё как есть.
  const simple = extensions.workView === "simple";
  const entries: AnswerEntry<ReactNode>[] = [];
  const show = (node: ReactNode, blank = false) => void entries.push({ kind: "shown", node, ...(blank && { blank }) });
  const step = (index: number, work: WorkStep, node: ReactNode) =>
    void (simple ? entries.push({ kind: "step", key: partKey(message.id, index), step: work }) : show(node));
  const customNames = new Set(Object.keys(extensions.widgets ?? {}));
  /** Номер следующей схемы в ответе: схемы всех текстовых частей ответа нумеруются подряд. */
  let nextDiagram = 0;
  const fileViews = answerFileViews(message, describeFiles, Boolean(skin.GeneratedImages));

  message.parts.forEach((part, index) => {
    const key = `${message.id}-${index}`;
    if (part.type === "file") {
      const file = fileViews.get(index);
      if (file?.kind === "images" && skin.GeneratedImages) show(<skin.GeneratedImages key={key} {...file.view} />);
      else if (file?.kind === "file") show(<skin.AgentText key={key} markdown={file.markdown} streaming={false} />);
      return;
    }
    const imagesView = isToolUIPart(part) ? describeImages?.(part) : undefined;
    const videoView = isToolUIPart(part) && extensions.videos && getToolName(part) === extensions.videos.toolName ? extensions.videos.describe(part) : undefined;
    if (part.type === "reasoning") {
      if (extensions.reasoningVisible === false) return;
      const ordinal = String(reasoningIndex++);
      const streaming = part.state === "streaming";
      const durationMs = streaming ? null : (durations[ordinal] ?? null);
      // Заголовок раздумья от сервера (`thoughtTitles`); пока его нет — прежняя подпись.
      const title = streaming ? undefined : thoughtTitles[ordinal];
      // Пустое раздумье — пропуск; без права `reasoning` сервер шлёт пустое место с заголовком — шаг простого вида.
      if (!streaming && part.text.trim().length === 0 && (title === undefined || !simple)) return;
      step(
        index,
        { kind: "thinking", durationMs, ...(title !== undefined && { title }) },
        <ExpandablePart
          key={key}
          Component={skin.Reasoning}
          expanded={expanded}
          partId={partKey(message.id, index)}
          text={part.text}
          streaming={streaming}
          durationMs={durationMs}
          {...(title !== undefined && { title })}
        />,
      );
    } else if (part.type === "text") {
      const streaming = part.state === "streaming";
      // Теги голоса («[laughs]») слышны, но не видны; в потоке недописанный тег тоже прячется, чтобы не мелькал.
      const markdown = voiceAnswer ? stripVoiceTags(part.text, { partialTail: streaming }) : part.text;
      const blank = markdown.trim().length === 0;
      if (diagrams || demos) {
        show(
          <RichAgentText
            key={key}
            AgentText={skin.AgentText}
            markdown={markdown}
            streaming={streaming}
            messageId={message.id}
            firstBlock={nextDiagram}
            {...(diagrams && { diagrams })}
            {...(demos && { demos })}
          />,
          blank,
        );
        if (diagrams) nextDiagram += countMermaidBlocks(markdown);
      } else {
        show(<skin.AgentText key={key} markdown={markdown} streaming={streaming} />, blank);
      }
    } else if (part.type === "data-app-event") {
      // Событие приложения — компонентом приложения по типу, прямо в теле ответа; без компонента не видно.
      const event = appEventOfPart(part);
      const View = event && extensions.appEvents?.[event.type];
      if (event && View) show(<View key={key} event={event} messageId={message.id} />);
    } else if (imagesView && skin.GeneratedImages) {
      show(<skin.GeneratedImages key={key} {...imagesView} />);
    } else if (videoView) {
      // Пока вызов идёт — ничего: карточка появится готовой. Скин без `AgentVideo` (до версии 14) — ссылка в тексте.
      if (videoView.state === "loading") return;
      show(
        skin.AgentVideo ? (
          <skin.AgentVideo key={key} {...videoView.video} />
        ) : (
          <skin.AgentText key={key} markdown={videoLinkMarkdown(videoView.video, labels)} streaming={false} />
        ),
      );
    } else if (isToolUIPart(part)) {
      // Подсказки рисуются кнопками под ответом, а не строкой вызова.
      if (getToolName(part) === SUGGEST_REPLIES) return;
      // Помощник — своя строка с заданием, шагами и итогом; скин без неё (до версии 18) рисует обычный вызов.
      if (skin.HelperCallRow && isHelperPart(part)) {
        const helper = withoutPendingApproval(helperCallViewOf(part, { onApproval, approvalPendingId, approvalFailure, failureText: (kind) => failureTextOf(kind, labels) }), chatClosed);
        const row = <ExpandablePart key={key} Component={skin.HelperCallRow} expanded={expanded} partId={partKey(message.id, index)} {...helper} />;
        // Помощник, ждущий решения человека, виден и в простом виде: иначе ход встанет без кнопок.
        if (helper.approval?.state === "requested") show(row);
        else step(index, helperStepOf(part, helper, labels), row);
        return;
      }
      const call = widgetCallOf(part, { awaitingHere: awaitingHuman, customNames });
      if (call === "hidden") return;
      if (call) {
        const failure = widgetFailure?.id === call.toolCallId ? widgetFailureTextOf(widgetFailure, labels) : undefined;
        const Custom = extensions.widgets?.[call.name];
        show(
          skin.Widget ? (
            <WidgetPart
              key={key}
              Widget={skin.Widget}
              {...(Custom && { Custom })}
              call={call}
              chatId={chatId}
              pending={widgetPendingId === call.toolCallId}
              {...(failure !== undefined && { failure })}
              onAnswer={onWidgetAnswer}
            />
          ) : (
            // Скин без виджетов (до версии 13): строка вызова с вопросом и пометкой «ответьте сообщением» (FR-033).
            <ExpandablePart
              key={key}
              Component={skin.ToolCallRow}
              expanded={expanded}
              partId={partKey(message.id, index)}
              toolName={call.name}
              state={toolCallState(part)}
              title={fallbackTitleOf(call.input, labels)}
              {...(part.input !== undefined && { input: part.input })}
            />
          ),
        );
        return;
      }
      const row = (
        <ExpandablePart
          key={key}
          Component={skin.ToolCallRow}
          expanded={expanded}
          partId={partKey(message.id, index)}
          toolName={getToolName(part)}
          state={toolCallState(part)}
          {...(hasTitle(part) && { title: part.title })}
          {...withoutPendingApproval(approvalProps(part, { onApproval, approvalPendingId, approvalFailure, labels }), chatClosed)}
          {...(part.input !== undefined && { input: part.input })}
          {...(part.state === "output-available" && { output: part.output })}
          {...(part.state === "output-error" && { errorText: part.errorText })}
          {...(editMark?.editedToolCallIds.includes(part.toolCallId) && { outputEdited: true })}
        />
      );
      // Подтверждение опасного действия видно и в простом виде; решённое — уже шаг работы.
      if (part.state === "approval-requested") show(row);
      else step(index, toolStepOf(part), row);
    }
  });
  const parts = simple
    ? workLayoutOf(entries, { streaming: status === "streaming", phrases: extensions.stepPhrases, labels: labels.workView, thoughts: Object.keys(thoughtTitles).length > 0 }).map((item) =>
        item.kind === "shown" ? item.node : <WorkStepsPart key={`${item.key}:work`} skin={skin} expanded={expanded} item={item} />,
      )
    : entries.map((entry) => (entry.kind === "shown" ? entry.node : null));


  const text = messageText(message, { voiceAnswer });
  const actionViews = status === "streaming" ? undefined : messageActionViews(actions, { message, status, last: last ?? false }, (action) => ({
    busy: runningActionIds?.includes(action.id) ?? false,
    onRun: () => onRunAction?.(action, message, text),
  }));
  // У ответа с ошибкой «повторить» живёт в блоке ошибки, второй кнопки нет.
  const errorText = status === "error" ? customErrorText(labels, message.metadata?.error) : undefined;
  const notice =
    status === "error" ? (
      <skin.ErrorNotice kind={message.metadata?.error?.kind ?? "other"} {...(errorText !== undefined && { text: errorText })} {...(onRetry && { onRetry })} />
    ) : undefined;
  const answerProvider = extensions.modelNames?.find((provider) => provider.id === message.metadata?.providerId);
  const answerModel = answerProvider?.models.find((model) => model.id === message.metadata?.modelId);
  return (
    <ThinkingClockProvider id={message.id} waiting={status === "streaming"}>
      <skin.AgentMessage
        {...(extensions.answerDetails && message.metadata?.modelId && message.metadata?.providerId && { modelDetails: { modelId: message.metadata.modelId, providerId: message.metadata.providerId, ...(answerProvider && { providerName: answerProvider.name }), ...(answerModel && { modelName: answerModel.name }), ...(message.metadata.reasoningLevel !== undefined && { reasoning: message.metadata.reasoningLevel }) } })}
        status={status}
        empty={!steered && status !== "streaming" && status !== "awaiting_approval" && text.trim().length === 0}
        onCopy={() => void navigator.clipboard?.writeText(text)}
        {...(notice && { notice })}
        {...(onRetry && !notice && { onRetry })}
        {...(branchSwitcher && { branchSwitcher })}
        {...(onRegenerate && { onRegenerate })}
        {...(onEdit && { onEdit })}
        {...(answerEdited(editMark) && { edited: true })}
        {...(message.metadata?.undelivered && { undelivered: true })}
        {...(message.metadata?.voiceCut && { voiceInterrupted: { spokenTail: message.metadata.voiceCut.spokenTail } })}
        {...(message.parts.some((part) => part.type === "data-length-cut") && { cutByLength: true })}
        {...(actionViews && { actions: actionViews })}
      >
        {parts}
        {suggestedReplies}
      </skin.AgentMessage>
    </ThinkingClockProvider>
  );
});

/** Свои кнопки ответа для скина; ни одной видимой — `undefined`. */
function messageActionViews(
  actions: MessageAction[] | undefined,
  target: MessageActionTarget,
  stateOf: (action: MessageAction) => Pick<MessageActionView, "busy" | "onRun">,
): MessageActionView[] | undefined {
  const views = (actions ?? [])
    .filter((action) => action.visible?.(target) ?? true)
    .map((action) => ({ id: action.id, label: action.label, ...(action.icon !== undefined && { icon: action.icon }), ...stateOf(action) }));
  return views.length > 0 ? views : undefined;
}

/** Схемы для ленты: готовые рисунки чата, цвета темы и окно просмотра (если скин его рисует). */
interface DiagramSetup {
  renders: DiagramRenders;
  colors: DiagramColors;
  open?: MediaViewerController["open"];
}

type AgentTextProps = ComponentProps<ChatSkin["AgentText"]>;

/** Живые демонстрации ленты: цвета темы и запрет запуска (в чате чужой текст). */
interface LiveDemoSetup {
  colors: LiveDemoColors;
  blocked: boolean;
}

/** Текст ответа со схемами и живыми демонстрациями: скин получает `renderDiagram`/`onOpenDiagram` и `renderDemo`. */
function RichAgentText({
  AgentText,
  markdown,
  streaming,
  messageId,
  firstBlock,
  diagrams,
  demos,
}: {
  AgentText: ChatSkin["AgentText"];
  markdown: string;
  streaming: boolean;
  messageId: string;
  firstBlock: number;
  diagrams?: DiagramSetup;
  demos?: LiveDemoSetup;
}) {
  const renderDemo = useLiveDemoBlocks({ markdown, streaming, colors: demos?.colors, blocked: demos?.blocked === true });
  const demoProps: Partial<AgentTextProps> = renderDemo ? { renderDemo } : {};
  return diagrams ? (
    <DiagramAgentText AgentText={AgentText} markdown={markdown} streaming={streaming} messageId={messageId} firstBlock={firstBlock} setup={diagrams} extra={demoProps} />
  ) : (
    <AgentText markdown={markdown} streaming={streaming} {...demoProps} />
  );
}

/** Текст ответа со схемами: скин получает `renderDiagram` и, если есть окно просмотра, `onOpenDiagram`. */
function DiagramAgentText({
  AgentText,
  markdown,
  streaming,
  messageId,
  firstBlock,
  setup,
  extra,
}: {
  AgentText: ChatSkin["AgentText"];
  markdown: string;
  streaming: boolean;
  messageId: string;
  firstBlock: number;
  setup: DiagramSetup;
  /** Другие свойства текста (демонстрации). */
  extra: Partial<AgentTextProps>;
}) {
  const diagramProps = useDiagramBlocks({ markdown, streaming, messageId, firstBlock, ...setup });
  return <AgentText markdown={markdown} streaming={streaming} {...extra} {...diagramProps} />;
}

/** Причина, по которой ответ на виджет не принят, словами. */
function widgetFailureTextOf({ kind, text }: { kind: WidgetFailureKind; text?: string }, labels: ResolvedChatLabels): string {
  if (text !== undefined) return text;
  if (kind === "already_answered") return labels.widgets.alreadyAnswered;
  if (kind === "rejected" || kind === "answer_refused") return labels.widgets.answerRejected;
  if (kind === "check_timeout") return labels.widgets.answerCheckTimeout;
  return kind === "connection" ? labels.widgets.answerFailed : failureTextOf(kind === "refused" ? "connection" : kind, labels);
}

/** Заголовок строки вызова у скина без виджетов: вопрос модели и «ответьте сообщением». */
function fallbackTitleOf(input: unknown, labels: ResolvedChatLabels): string {
  const record = typeof input === "object" && input !== null ? (input as { question?: unknown; title?: unknown }) : {};
  const question = typeof record.question === "string" ? record.question : typeof record.title === "string" ? record.title : "";
  return question.trim().length > 0 ? `${question} \u2014 ${labels.widgets.fallback}` : labels.widgets.fallback;
}

/** Раскрытие берётся из хранилища чата: переживает уход сообщения за край экрана. */
function ExpandablePart<C extends ChatSkin["Reasoning"] | ChatSkin["ToolCallRow"] | NonNullable<ChatSkin["HelperCallRow"]>>({
  Component,
  expanded,
  partId,
  ...props
}: { Component: C; expanded: ExpandedParts; partId: string } & Omit<ComponentProps<C>, "open" | "onOpenChange">) {
  const [open, setOpen] = usePartOpen(expanded, partId);
  const Part = Component as ElementType;
  return <Part {...props} open={open} onOpenChange={setOpen} />;
}

/** Вызов инструмента как шаг простого вида: имя, состояние, вход и выход, если они пришли. */
function toolStepOf(part: ToolUIPart | DynamicToolUIPart): WorkStep {
  return {
    kind: "tool",
    call: {
      toolName: getToolName(part),
      state: toolCallState(part),
      ...(part.input !== undefined && { input: part.input }),
      ...(part.state === "output-available" && { output: part.output }),
    },
    ...(hasTitle(part) && { title: part.title }),
  };
}

/** Помощник как шаг простого вида: без фразы приложения — «Помощник «…» работает» и «… закончил». */
function helperStepOf(part: ToolUIPart | DynamicToolUIPart, helper: { name: string; title?: string; status: string }, labels: ResolvedChatLabels): WorkStep {
  const name = helper.title ?? helper.name;
  const state: ToolCallState = helper.status === "failed" ? "error" : helper.status === "running" || helper.status === "awaiting_approval" ? "running" : "done";
  return {
    kind: "tool",
    call: { toolName: getToolName(part), state, ...(part.input !== undefined && { input: part.input }), ...(part.state === "output-available" && { output: part.output }) },
    fallback: { running: labels.workView.helperRunning(name), done: labels.workView.helperDone(name) },
  };
}

/** Ожидание подтверждения — тоже «выполняется», отказ — ошибка; что именно решил человек, показывает `approval`. */
function toolCallState(part: ToolUIPart | DynamicToolUIPart): ToolCallState {
  switch (part.state) {
    case "output-available":
      return part.preliminary ? "running" : "done";
    case "output-error":
    case "output-denied":
      return "error";
    default:
      return "running";
  }
}

const hasTitle = (part: ToolUIPart | DynamicToolUIPart): part is typeof part & { title: string } =>
  typeof (part as { title?: unknown }).title === "string" && (part as { title: string }).title.length > 0;

function failureTextOf(kind: ApprovalFailureKind, labels: ChatLabels): string {
  if (kind === "spending_limit") return labels.approvalSpendingLimit;
  if (kind === "too_many_turns") return labels.approvalTooManyTurns;
  return kind === "busy" ? labels.approvalBusy : labels.approvalFailed;
}

/** В закрытом чате ждущее подтверждение не показывается: ответить на него сервер не даст. Итог прежних — на месте. */
function withoutPendingApproval<View extends { approval?: { state: string }; approvalAction?: unknown }>(view: View, chatClosed: boolean): View {
  if (!chatClosed || view.approval?.state !== "requested") return view;
  const { approval: _approval, approvalAction: _action, ...rest } = view;
  return rest as View;
}

/** Запрос подтверждения и его итог для строки вызова; у вызова без подтверждения свойства нет. */
function approvalProps(
  part: ToolUIPart | DynamicToolUIPart,
  controls: {
    onApproval: (approvalId: string, decision: ApprovalDecision) => void;
    approvalPendingId: string | null;
    approvalFailure: { id: string; kind: ApprovalFailureKind; text?: string } | null;
    labels: ChatLabels;
  },
): { approval?: ToolApprovalView } {
  const approval = (part as { approval?: { id: string; approved?: boolean; reason?: string; requestReason?: string } }).approval;
  if (!approval) return {};
  if (part.state === "approval-requested") {
    return {
      approval: {
        state: "requested",
        onDecide: (decision) => controls.onApproval(approval.id, decision),
        pending: controls.approvalPendingId === approval.id,
        failed: controls.approvalFailure?.id === approval.id,
        ...(controls.approvalFailure?.id === approval.id && { failureText: controls.approvalFailure.text ?? failureTextOf(controls.approvalFailure.kind, controls.labels) }),
        canAlways: approval.requestReason === ALWAYS_OFFERED,
      },
    };
  }
  if (part.state === "output-denied" || approval.approved === false) return { approval: { state: "denied" } };
  return { approval: { state: approval.reason === ALWAYS_IN_CHAT ? "always" : "allowed" } };
}

/** Тот же список, пока его элементы те же: `images={[a, b]}` прямо в разметке не перерисовывает ленту на каждый ввод. */
function useSameList<T>(list: readonly T[]): readonly T[] {
  const kept = useRef(list);
  if (kept.current.length !== list.length || kept.current.some((item, index) => item !== list[index])) kept.current = list;
  return kept.current;
}
