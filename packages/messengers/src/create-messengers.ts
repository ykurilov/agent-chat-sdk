import type { ChatEvent } from "@ykurilov/agent-chat-core";
import type { MessengerChatService } from "./chat-port";
import { createAccountLinking } from "./account-linking";
import { createButtonActions } from "./button-actions";
import { createConversationPolicy } from "./conversation-policy";
import { createGroupChats } from "./group-chats";
import { createInboundMedia } from "./inbound-media";
import { createMessengerGateway } from "./messenger-gateway";
import type { MessengerName } from "./messenger-adapter";
import { createTextsLookup, defaultMessengerTextsWithoutChat } from "./messenger-texts";
import { createOutboundQueue, type OutboundQueue } from "./outbound-queue";
import { createPendingDeliveries } from "./pending-deliveries";
import { startPolling } from "./polling-lease";
import { createTaskCards } from "./task-cards";
import { createTaskReadyPing } from "./task-ready-ping";
import type { MessengerBot, MessengersOptions } from "./types";
import { createVoiceAnswers } from "./voice-replies";

/** Адрес вебхука каждого мессенджера внутри `basePath`. */
const WEBHOOK_PATHS: Record<MessengerName, string> = { telegram: "/telegram/webhook", vk: "/vk/callback", max: "/max/webhook" };
/** Как часто продлевать аренду своих итогов и подбирать брошенные чужие: заметно чаще срока аренды. */
const DELIVERY_SWEEP_MS = 30_000;
/**
 * Сколько хранить разовые записи: коды привязки, принятые обновления, кнопки, обращения участников групп. Дольше суток:
 * мессенджер повторяет обновление и брошенная обработка подбирается в пределах суток, а кнопки под старыми ответами
 * работают месяц.
 */
export const MESSENGER_RECORDS_KEEP_MS = 30 * 24 * 60 * 60_000;
/** Как часто убирать записи старше срока хранения. */
const PURGE_EVERY_MS = 60 * 60_000;

/**
 * Мессенджеры для чата приложения: адреса вебхуков и привязки, опрос, ответы агента в мессенджер.
 * Каждая настройка читается в своём модуле; здесь только сборка.
 */
export function createMessengers(options: MessengersOptions) {
  const { store, bots } = options;
  // Без службы чата шлюз до неё не доходит: заглушка только держит форму для модулей разговора.
  const chatEnabled = options.service !== undefined;
  const service = options.service ?? serviceWithoutChat;
  const menuFor = (bot: MessengerBot) => chatEnabled && (bot.commandsMenu ?? options.commandsMenu ?? true);
  const logError = (error: unknown) => options.logError?.(error);
  const basePath = options.basePath.replace(/\/+$/, "");
  const textsOf = createTextsLookup(bots, options.texts, chatEnabled ? undefined : defaultMessengerTextsWithoutChat);

  const buttons = createButtonActions({ store, service, textsOf, logError });
  const deliveries = createPendingDeliveries({ store, buttons, logError, ...(options.onAnswerDelivery !== undefined && { onAnswerDelivery: options.onAnswerDelivery }) });
  const queues = new Map<MessengerBot, OutboundQueue>();
  const queueFor = (bot: MessengerBot) => {
    let queue = queues.get(bot);
    if (!queue) {
      queue = createOutboundQueue({ gapMs: bot.adapter.abilities.editEveryMs, outbox: deliveries.outbox, logError });
      queues.set(bot, queue);
    }
    return queue;
  };
  const pingQueue = createOutboundQueue({ outbox: deliveries.outbox, logError });

  const linking = createAccountLinking({
    store,
    bots,
    textsOf,
    resolveUser: options.resolveUser,
    logError,
    ...(options.onLinked !== undefined && { onLinked: options.onLinked }),
    ...(options.onUnlinked !== undefined && { onUnlinked: options.onUnlinked }),
    ...(options.allowedOrigins !== undefined && { allowedOrigins: options.allowedOrigins }),
  });
  const policy = createConversationPolicy({
    store,
    service,
    textsOf,
    logError,
    ...(options.conversations !== undefined && { conversations: options.conversations }),
    ...(options.resolveAccount !== undefined && { resolveAccount: options.resolveAccount }),
    ...(options.chatForConversation !== undefined && { chatForConversation: options.chatForConversation }),
  });
  const groups = createGroupChats({ store, textsOf, ...(options.groups !== undefined && { groups: options.groups }) });
  const media = createInboundMedia({
    textsOf,
    logError,
    ...(options.attachments !== undefined && { attachments: options.attachments }),
    ...(options.transcribe !== undefined && { transcribe: options.transcribe }),
  });
  const voice = createVoiceAnswers({ logError, ...(options.voiceReplies !== undefined && { voiceReplies: options.voiceReplies }) });
  const gateway = createMessengerGateway({
    store,
    service,
    chatEnabled,
    menuFor,
    bots,
    linking,
    policy,
    groups,
    media,
    voice,
    buttons,
    queueFor,
    textsOf,
    logError,
    ...(options.webChatUrl !== undefined && { webChatUrl: options.webChatUrl }),
    ...(options.onAnswerDelivery !== undefined && { onAnswerDelivery: options.onAnswerDelivery }),
    ...(options.messageBursts !== undefined && { messageBursts: options.messageBursts }),
  });
  const taskReadyPing = createTaskReadyPing({
    store,
    service,
    bots,
    queue: pingQueue,
    buttons,
    textsOf,
    logError,
    ...(options.taskReadyPing !== undefined && { taskReadyPing: options.taskReadyPing }),
    ...(options.webChatUrl !== undefined && { webChatUrl: options.webChatUrl }),
  });

  const taskCards = createTaskCards({ store, service, bots, queueFor, buttons, textsOf, logError });

  /** События чатов: продолжение хода в мессенджер, карточка паузы задачи, «Задача готова». `flush` ждёт их работу. */
  const eventWork = new Set<Promise<void>>();
  function onChatEvent(event: ChatEvent): void {
    for (const work of [gateway.onChatEvent(event), taskCards.handle(event), taskReadyPing.handle(event)]) {
      const tracked = work.catch(logError).finally(() => eventWork.delete(tracked));
      eventWork.add(tracked);
    }
  }

  async function fetch(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return notFound();
    const path = pathname.slice(basePath.length) || "/";
    if (request.method === "POST") {
      // Один адрес на мессенджер: вебхук принимает первый бот этого мессенджера.
      const bot = bots.find((item) => item.receive === "webhook" && WEBHOOK_PATHS[item.messenger] === path);
      if (bot) return gateway.receiveWebhook(bot, request);
    }
    return (await linking.handleRequest(request, path)) ?? notFound();
  }

  let started: Promise<void> | undefined;
  const stops: Array<() => Promise<void> | void> = [];

  /** Брошенные итоги (копия сервера упала или перезапущена) — в очереди их ботов. */
  async function recoverDeliveries() {
    for (const bot of bots) await deliveries.recover(bot, queueFor(bot)).catch(logError);
  }

  /** Брошенные входящие обновления (копия упала, обработка сорвалась) — в очереди их разговоров. */
  async function recoverUpdates() {
    for (const bot of bots) await gateway.recoverUpdates(bot).catch(logError);
  }

  let lastPurge = 0;
  /** Убрать записи старше срока хранения — не чаще раза в час. */
  function purgeOld() {
    const now = Date.now();
    if (now - lastPurge < PURGE_EVERY_MS) return;
    lastPurge = now;
    void store.purgeBefore(new Date(now - MESSENGER_RECORDS_KEEP_MS).toISOString()).catch(logError);
  }

  /**
   * Меню команд, итоги, не ушедшие до перезапуска, опрос для ботов на опросе, подписка на события чата. Повторный вызов
   * ничего не делает.
   */
  function start(): Promise<void> {
    started ??= (async () => {
      await gateway.installCommands();
      await recoverDeliveries();
      await recoverUpdates();
      lastPurge = 0;
      purgeOld();
      const sweep = setInterval(() => {
        purgeOld();
        void deliveries
          .renew()
          .catch(logError)
          .then(() => gateway.renewUpdates())
          .catch(logError)
          .then(() => recoverDeliveries())
          .then(() => recoverUpdates());
      }, DELIVERY_SWEEP_MS);
      sweep.unref?.();
      stops.push(() => clearInterval(sweep));
      for (const bot of bots.filter((item) => item.receive === "polling")) {
        const polling = startPolling({ store, bot, onUpdate: (update) => gateway.accept(bot, update), logError });
        stops.push(() => polling.stop());
      }
      if (chatEnabled) stops.push(service.subscribeEvents(onChatEvent));
    })();
    return started;
  }

  /** Ждёт, пока принятые обновления обработаются и очереди отправки опустеют. */
  async function flush(): Promise<void> {
    while (eventWork.size > 0) await Promise.allSettled([...eventWork]);
    await gateway.idle();
    await Promise.all([...queues.values(), pingQueue].map((queue) => queue.flush()));
  }

  /** Остановить опрос и подписки (тесты, плавная остановка сервера). */
  async function stop(): Promise<void> {
    await started;
    started = undefined;
    for (const stopOne of stops.splice(0)) await stopOne();
  }

  return { handler: { basePath, fetch }, start, flush, stop };
}

function notFound() {
  return new Response("not found", { status: 404 });
}

/** Служба на месте отсутствующей: бот без чата её не зовёт, поэтому любой вызов — ошибка сборки, а не поведение. */
const missingService = () => Promise.reject(new Error("мессенджеры: служба чата не передана (service)"));
const serviceWithoutChat: MessengerChatService = {
  createChat: missingService,
  listChats: missingService,
  getHistory: missingService,
  sendMessage: missingService,
  subscribe: missingService,
  stop: missingService,
  answerApproval: missingService,
  answerWidget: missingService,
  deliverNotices: missingService,
  subscribeEvents: () => () => {},
  hasWatchers: () => false,
};
