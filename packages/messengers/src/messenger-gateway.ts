import { createHash, randomUUID } from "node:crypto";
import type { ChatEvent } from "@ykurilov/agent-chat-core";
import type { AccountLinking } from "./account-linking";
import { answerDeliveryOutcome, deliverAnswer } from "./answer-delivery";
import { commandOf } from "./bot-commands";
import type { ButtonActions, CardButton, PressOutcome } from "./button-actions";
import type { AnswerChunk, MessengerChatService, MessengerUserMessage } from "./chat-port";
import type { ConversationContext, ConversationPolicy, OpenedChat, PolicyReply } from "./conversation-policy";
import type { GroupChats } from "./group-chats";
import type { InboundMedia } from "./inbound-media";
import type { ExternalChat, InboundUpdate } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTexts, type MessengerTextsOf } from "./messenger-texts";
import { chatKeyOf, type OutboundQueue } from "./outbound-queue";
import { DELIVERY_GIVE_UP_MS, DELIVERY_LEASE_MS, durableDelivery } from "./pending-deliveries";
import type { AnswerDeliveryReport, AnswerRef, ConversationKey, MessengerBot, MessengerStore } from "./types";
import type { VoiceAnswers } from "./voice-replies";

/** Сколько раз пробовать сообщение, если чат занят чужим ходом. */
const BUSY_ATTEMPTS = 3;
/** Обработка сорвалась — пауза перед повтором. */
const UPDATE_RETRY_MS = 30_000;
/** Сколько раз обновление забирается заново (после падения копии или сбоя обработки), потом оно брошено. */
const UPDATE_RETRIES = 3;
/**
 * Обновление не записывается в хранилище столько времени подряд — оно пропускается: одно битое обновление не держит
 * опрос и повторы вебхука вечно. Короткий сбой базы его не теряет.
 */
const CLAIM_GIVE_UP_MS = 10 * 60_000;
/** Сколько незаписанных обновлений помнить: больше — забывается самое старое. */
const CLAIM_FAILURES_KEPT = 1000;
/** Сколько брошенных обновлений брать из хранилища за раз. */
const RECOVER_BATCH = 50;

/** Обновление в очереди разговора: номер его сообщения агенту и повтор ли это после сбоя. */
interface Inbound {
  messageId: string;
  /** Повтор: сообщение могло уже дойти до чата — сначала сверка с историей. */
  retry: boolean;
  /**
   * Работа после очереди разговора: обновление закончено, когда кончится и она, но следующее сообщение её не ждёт
   * (ход на пачку ждёт тишины уже вне очереди).
   */
  later?(work: () => Promise<void>): void;
}

/**
 * Номер сообщения агенту из ключа обновления и времени приёма: повтор после сбоя приходит с тем же номером, и служба
 * узнаёт сообщение, а не пишет второе.
 */
function inboundMessageId(updateKey: string, receivedAt: string): string {
  return `msg-${createHash("sha256").update(`${updateKey}\u0000${receivedAt}`).digest("hex").slice(0, 40)}`;
}

/** Ход, который сейчас печатается в разговор: его обрывает `/stop`, его ждёт следующее сообщение. */
interface RunningTurn {
  userId: string;
  chatId: string;
  /** Кто в группе попросил ход (внешний id): ему можно `/stop`. У хода фона и в личке — нет. */
  authorId?: string;
  controller: AbortController;
  done: Promise<void>;
}

/** Кому и куда идёт сообщение агенту. */
interface Turn {
  bot: MessengerBot;
  update: InboundUpdate;
  inbound: Inbound;
  key: ConversationKey;
  ctx: ConversationContext;
  group?: { allowedTools: readonly string[]; author: string };
  /** Сообщение лички, которое склеивается с соседними в один ход (`messageBursts`). */
  burst?: boolean;
}

const errorNamed = (error: unknown, name: string) => error instanceof Error && error.name === name;

/** Отказ приложения своими словами: отказ хода, закрытый чат, запрет правами. Человеку — его текст, в журнал не пишем. */
const isAppRefusal = (error: unknown) =>
  ["TurnRefusedError", "ChatClosedError", "ActionForbiddenError", "ChatCreationRefusedError"].some((name) => errorNamed(error, name));

/** Какое право нужно входящему: голосовое — `voice`, файлы — `attachments`. */
function capabilityOf(update: InboundUpdate): "voice" | "attachments" | undefined {
  if (update.kind === "voice") return "voice";
  return update.files?.length ? "attachments" : undefined;
}

/** Текст отказа человеку: запрет голоса и файлов — понятнее общего «недоступно». */
function refusalText(error: unknown, texts: MessengerTexts): string {
  const action = (error as { action?: unknown }).action;
  if (errorNamed(error, "ActionForbiddenError") && action === "voice") return texts.voiceForbidden;
  if (errorNamed(error, "ActionForbiddenError") && action === "attachments") return texts.filesForbidden;
  return (error as Error).message;
}

/**
 * Приём обновлений (T028): вебхук или опрос → запись обновления (повтор не обрабатывается) → очередь разговора.
 * Сообщения одного внешнего чата идут по одному: новое ждёт конца ответа. Сообщение лички со склейкой пачки
 * (`messageBursts`) освобождает очередь, как только записано: ход на пачку ждёт тишины вне очереди. Шлюз о настройках не знает —
 * решения за привязкой, правилами разговора, группами, файлами и голосом.
 */
export function createMessengerGateway(deps: {
  store: MessengerStore;
  service: MessengerChatService;
  /** `false` — службы чата нет: привязанному человеку на всё фраза `notifyOnly`, ход не начинается. */
  chatEnabled?: boolean;
  /** Ставить ли боту меню команд; `false` — снять поставленное раньше. По умолчанию — ставить. */
  menuFor?(bot: MessengerBot): boolean;
  bots: readonly MessengerBot[];
  linking: Pick<AccountLinking, "handleUpdate">;
  policy: ConversationPolicy;
  groups: GroupChats;
  media: InboundMedia;
  voice: VoiceAnswers;
  buttons: ButtonActions;
  /** Очередь отправки бота: у каждого мессенджера своя частота правок. */
  queueFor(bot: MessengerBot): OutboundQueue;
  webChatUrl?(chatId: string): string;
  textsOf?: MessengerTextsOf;
  /** Кто держит обновления в работе; по умолчанию случайный id копии сервера. */
  holder?: string;
  /** Исход доставки каждого ответа агента (`MessengersOptions.onAnswerDelivery`). */
  onAnswerDelivery?(report: AnswerDeliveryReport): Promise<void> | void;
  /** Склейка пачки в личке (`MessengersOptions.messageBursts`); по умолчанию включена. */
  messageBursts?: false | { quietMs?: number };
  logError?(error: unknown): void;
}) {
  const { store, service, policy, groups, buttons } = deps;
  const textsOf = deps.textsOf ?? defaultTextsOf;
  const logError = (error: unknown) => deps.logError?.(error);
  const chatEnabled = deps.chatEnabled ?? true;
  const bursts = deps.messageBursts === false ? undefined : (deps.messageBursts ?? {});
  /** Хвост очереди каждого разговора. */
  const lanes = new Map<string, Promise<void>>();
  const running = new Map<string, RunningTurn>();
  const pending = new Set<Promise<void>>();
  const holder = deps.holder ?? randomUUID();
  const leaseUntil = () => new Date(Date.now() + DELIVERY_LEASE_MS).toISOString();
  /** Обновления в работе у этой копии: их аренда продлевается, пока они не закончены. */
  const held = new Set<string>();
  /** Обновления, которые не удаётся записать: с какого времени. */
  const claimFailures = new Map<string, number>();

  const keyOf = (update: InboundUpdate): ConversationKey => ({ messenger: update.account.messenger, botId: update.account.botId, externalChatId: update.chat.id });
  const idOf = (key: ConversationKey) => chatKeyOf(key);
  const botOf = (key: { messenger: string; botId: string }) => deps.bots.find((bot) => bot.messenger === key.messenger && bot.botId === key.botId);

  function track(work: Promise<void>) {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  }

  /** Исход ответа — приложению; его сбой — в журнал, доставку он не ломает. */
  function reportAnswer(report: AnswerDeliveryReport) {
    const onAnswerDelivery = deps.onAnswerDelivery;
    if (!onAnswerDelivery) return;
    track((async () => onAnswerDelivery(report))().catch(logError));
  }

  /**
   * Обновление пришло: записать с содержимым за этой копией (повтор — мимо) и поставить в очередь разговора. Ответ
   * мессенджеру не ждёт обработки. Запись не удалась — ошибка наружу: мессенджер должен прислать обновление снова.
   * Не удаётся записать десять минут подряд — обновление пропускается с ошибкой в журнал.
   */
  async function accept(bot: MessengerBot, update: InboundUpdate): Promise<void> {
    const now = new Date().toISOString();
    const work = { messenger: bot.messenger, botId: bot.botId, update, holder, leaseUntil: leaseUntil() };
    let claimed: boolean;
    try {
      claimed = await store.claimUpdate(update.key, now, work);
    } catch (error) {
      if (!gaveUpClaiming(update.key)) throw error;
      logError(error);
      logError(new Error(`messengers: обновление ${update.key} не записано за ${CLAIM_GIVE_UP_MS / 60_000} минут попыток — пропущено`));
      return;
    }
    claimFailures.delete(update.key);
    if (claimed) enqueue(bot, update, { messageId: inboundMessageId(update.key, now), retry: false });
  }

  /** Запись обновления снова не удалась: пора ли его пропустить. */
  function gaveUpClaiming(updateKey: string): boolean {
    const since = claimFailures.get(updateKey);
    if (since === undefined) {
      if (claimFailures.size >= CLAIM_FAILURES_KEPT) claimFailures.delete(claimFailures.keys().next().value as string);
      claimFailures.set(updateKey, Date.now());
      return false;
    }
    if (Date.now() - since < CLAIM_GIVE_UP_MS) return false;
    claimFailures.delete(updateKey);
    return true;
  }

  function enqueue(bot: MessengerBot, update: InboundUpdate, inbound: Inbound) {
    held.add(update.key);
    const key = keyOf(update);
    // «Стоп» не ждёт конца ответа, который он обрывает.
    if (commandOf(update)?.name === "stop" && (update.chat.type === "private" || groups.enabled)) {
      track(finish(update, () => stop(bot, update, key)));
      return;
    }
    const id = idOf(key);
    // Работа после очереди (ход на пачку) держит обновление в работе: упадёт копия — повтор узнает сделанное по истории.
    const after: Promise<void>[] = [];
    const later = (work: () => Promise<void>) => {
      const running = work();
      running.catch(() => {});
      after.push(running);
    };
    const handled = (lanes.get(id) ?? Promise.resolve()).then(() => handle(bot, update, key, { ...inbound, later }));
    const lane = handled.then(
      () => {},
      () => {},
    );
    lanes.set(id, lane);
    track(
      finish(update, async () => {
        await handled;
        await Promise.all(after);
      }),
    );
    void lane.finally(() => {
      if (lanes.get(id) === lane) lanes.delete(id);
    });
  }

  /** Обработано — обновление закончено. Сорвалось — отпущено на повтор: его заберёт `recover` этой или другой копии. */
  async function finish(update: InboundUpdate, work: () => Promise<void>) {
    try {
      await work();
      // Закончить только своё: аренду могли забрать (копия зависла дольше срока), тогда итог пишет новый держатель.
      await store.finishUpdate(update.key, "done", new Date().toISOString(), holder).catch(logError);
    } catch (error) {
      logError(error);
      await store.releaseUpdate(update.key, holder, new Date(Date.now() + UPDATE_RETRY_MS).toISOString()).catch(logError);
    } finally {
      // Не удалось записать итог — аренда истечёт, и повтор узнает сделанное по истории чата.
      held.delete(update.key);
    }
  }

  /** Копия жива: обновления в работе остаются за ней. */
  async function renewUpdates(): Promise<void> {
    if (held.size > 0) await store.renewUpdates([...held], holder, leaseUntil());
  }

  /**
   * Брошенные обновления бота (копия упала, обработка сорвалась) — снова в очередь разговора, с тем же номером
   * сообщения. Забранные больше `UPDATE_RETRIES` раз или старше суток — брошены.
   */
  async function recoverUpdates(bot: MessengerBot): Promise<void> {
    for (;;) {
      const taken = await store.takeAbandonedUpdates(bot, holder, new Date().toISOString(), leaseUntil(), RECOVER_BATCH);
      for (const item of taken) {
        if (held.has(item.key)) continue;
        if (item.attempts > UPDATE_RETRIES || Date.now() - Date.parse(item.receivedAt) > DELIVERY_GIVE_UP_MS) {
          logError(new Error(`messengers: обновление ${item.key} не обработано за ${item.attempts} попыток — брошено`));
          await store.finishUpdate(item.key, "failed", new Date().toISOString(), holder).catch(logError);
          continue;
        }
        enqueue(bot, item.update as InboundUpdate, { messageId: inboundMessageId(item.key, item.receivedAt), retry: true });
      }
      if (taken.length < RECOVER_BATCH) return;
    }
  }

  async function receiveWebhook(bot: MessengerBot, request: Request): Promise<Response> {
    let read: Awaited<ReturnType<MessengerBot["adapter"]["readWebhook"]>>;
    try {
      read = await bot.adapter.readWebhook(request);
    } catch (error) {
      logError(error);
      return new Response("bad request", { status: 400 });
    }
    for (const update of read.updates) {
      try {
        await accept(bot, update);
      } catch (error) {
        // Обновление не записано: не «ok», иначе мессенджер его не повторит. Уже принятые повтор не задвоит.
        logError(error);
        return new Response("storage unavailable", { status: 503 });
      }
    }
    return read.response;
  }

  async function reply(bot: MessengerBot, key: ConversationKey, chat: ExternalChat, answer: PolicyReply | string) {
    const { text, rows } = typeof answer === "string" ? { text: answer, rows: undefined } : answer;
    if (!text) return;
    const prepared = rows && rows.length > 0 ? buttons.prepare(key, rows) : undefined;
    const message = { text, markup: "plain" as const, ...(prepared && { buttons: prepared.buttons }) };
    try {
      // Кнопки записываются в том же действии очереди: итог считается ушедшим, когда записаны и они.
      await deps.queueFor(bot).run(
        chatKeyOf(key),
        async () => {
          const sent = await bot.adapter.send(chat, message);
          if (prepared) await prepared.save(sent, message);
          return sent;
        },
        { durable: durableDelivery(key, () => ({ chat, message, ...(prepared && { rows: prepared.rows }) })) },
      );
    } catch (error) {
      await onSendError(key, error);
    }
  }

  async function onSendError(key: ConversationKey, error: unknown) {
    if (errorNamed(error, "MessengerBlockedError")) await markBlocked(key, true);
    else logError(error);
  }

  async function markBlocked(key: ConversationKey, blocked: boolean) {
    if (await store.getConversation(key)) await store.setBlocked(key, blocked, new Date().toISOString());
  }

  async function handle(bot: MessengerBot, update: InboundUpdate, key: ConversationKey, inbound: Inbound): Promise<void> {
    if (update.kind === "blocked" || update.kind === "allowed") return markBlocked(key, update.kind === "blocked");
    if (update.chat.type === "group") return handleGroup(bot, update, key, inbound);
    if (update.kind === "bot_added" || update.kind === "bot_removed") return;

    const linked = await deps.linking.handleUpdate(update);
    if (linked) return reply(bot, key, update.chat, linked.reply);
    const writer = await policy.resolveWriter(update.account);
    if ("reply" in writer) return reply(bot, key, update.chat, writer.reply);
    if (!chatEnabled) return withoutChat(bot, update, key);
    const ctx: ConversationContext = { key, account: update.account, userId: writer.userId };

    if (update.kind === "button") return press(bot, update, ctx, inbound);
    const command = commandOf(update);
    if (command) {
      const answer = await policy.handleCommand(command, ctx);
      if (answer) return reply(bot, key, update.chat, answer);
      if (command.name === "start") return;
    }
    if (update.kind === "text" && update.text) {
      const byWords = await buttons.answerByWords(key, ctx.userId, update.text);
      if (byWords) return afterPress(bot, update, ctx, byWords, inbound);
    }
    return talk({ bot, update, inbound, key, ctx, burst: true });
  }

  /** Службы чата нет: нажатие подтверждается без текста (иначе вечный значок загрузки), в ответ — `notifyOnly`. */
  async function withoutChat(bot: MessengerBot, update: InboundUpdate, key: ConversationKey): Promise<void> {
    if (update.kind === "button") await bot.adapter.answerButton(pressOf(update)).catch(logError);
    return reply(bot, key, update.chat, textsOf(key).notifyOnly);
  }

  async function handleGroup(bot: MessengerBot, update: InboundUpdate, key: ConversationKey, inbound: Inbound): Promise<void> {
    if (update.kind === "button") {
      if (!groups.enabled) return;
      const allowed = await groups.checkPress(key, update.account);
      if (!allowed.ok) {
        // Пустая фраза — на нажатие не отвечаем вовсе.
        if (allowed.text) await bot.adapter.answerButton(pressOf(update), allowed.text).catch(logError);
        return;
      }
      const payer = (await store.getConversation(key))?.userId ?? "";
      return press(bot, update, { key, account: update.account, userId: payer }, inbound);
    }
    const decision = await groups.handleUpdate(update);
    if (decision.type === "reply") return reply(bot, key, update.chat, decision.text);
    if (decision.type === "ignore") return;
    return talk({ bot, update, inbound, key, ctx: { key, account: update.account, userId: decision.userId }, group: decision.group });
  }

  const pressOf = (update: InboundUpdate) => ({ chat: update.chat, account: update.account, buttonId: update.buttonId ?? "", callbackId: update.callbackId ?? "" });

  async function press(bot: MessengerBot, update: InboundUpdate, ctx: ConversationContext, inbound: Inbound) {
    const outcome = await buttons.press({ key: ctx.key, adapter: bot.adapter, ownerId: ctx.userId, press: pressOf(update) });
    return afterPress(bot, update, ctx, outcome, inbound);
  }

  async function afterPress(bot: MessengerBot, update: InboundUpdate, ctx: ConversationContext, outcome: PressOutcome & { reply?: string }, inbound: Inbound) {
    if (outcome.reply) await reply(bot, ctx.key, update.chat, outcome.reply);
    if (outcome.selectChat) await reply(bot, ctx.key, update.chat, await policy.selectChat(ctx, outcome.selectChat));
    if (outcome.resume) await follow(bot, ctx.key, update.chat, ctx.userId, outcome.resume.chatId, { trigger: "human" }, outcome.resume.stream);
    if (outcome.userText === undefined) return;
    const asText: InboundUpdate = { ...update, kind: "text", text: outcome.userText };
    if (update.chat.type !== "group") return talk({ bot, update: asText, inbound, key: ctx.key, ctx });
    const decision = await groups.handlePressedText(update);
    if (decision.type === "reply") return reply(bot, ctx.key, update.chat, decision.text);
    if (decision.type === "ignore") return;
    return talk({ bot, update: asText, inbound, key: ctx.key, ctx: { ...ctx, userId: decision.userId }, group: decision.group });
  }

  /** Сообщение агенту и ответ в разговор. */
  async function talk(turn: Turn): Promise<void> {
    const { bot, update, inbound, key, ctx } = turn;
    const texts = textsOf(key);
    let opened: OpenedChat;
    try {
      opened = await policy.currentChat({ ...ctx, ...(turn.group && { group: turn.group }) });
    } catch (error) {
      // Приложение не дало завести первый чат (`beforeCreateChat`).
      if (isAppRefusal(error)) return reply(bot, key, update.chat, refusalText(error, texts));
      throw error;
    }
    // Правило приложения велело агенту писать первым: сначала его ход, потом сообщение человека.
    if (opened.agentStarted) await follow(bot, key, update.chat, ctx.userId, opened.chatId, { trigger: "notice", holdText: service.checksReplies === true });

    // Отказ приложения и права — до разбора вложений (распознавание голоса стоит денег). Полная проверка остаётся в `sendMessage`.
    try {
      await service.assertTurnAllowed?.(ctx.userId, opened.chatId, "send");
      const needed = capabilityOf(update);
      if (needed) await service.assertCapability?.(ctx.userId, opened.chatId, needed);
    } catch (error) {
      if (isAppRefusal(error)) return reply(bot, key, update.chat, refusalText(error, texts));
      // Чата уже нет: `sendMessage` ниже откроет новый.
      if (!errorNamed(error, "ChatNotFoundError")) {
        logError(error);
        return reply(bot, key, update.chat, texts.answerFailed);
      }
    }

    const earlier = inbound.retry ? await earlierCopy(ctx.userId, opened.chatId, inbound.messageId) : null;
    if (earlier === "handled") return;
    const prepared = earlier ? { parts: earlier.parts, voice: update.kind === "voice" } : await deps.media.toUserParts({ adapter: bot.adapter, update, ownerId: ctx.userId, chatId: opened.chatId });
    if ("reply" in prepared) return reply(bot, key, update.chat, prepared.reply);
    if (prepared.parts.length === 0) return;
    const message: MessengerUserMessage = { id: inbound.messageId, role: "user", parts: prepared.parts };
    const options = { channel: key.messenger, ...(turn.group && { group: turn.group }) };

    const sendBurstMessage = turn.burst && bursts ? service.sendBurstMessage : undefined;
    let sent: ReadableStream<AnswerChunk> | { turn: Promise<ReadableStream<AnswerChunk> | null> } | undefined;
    for (let attempt = 1; !sent; attempt++) {
      await running.get(idOf(key))?.done;
      try {
        sent = sendBurstMessage
          ? await sendBurstMessage.call(service, ctx.userId, opened.chatId, message, { ...options, ...(bursts?.quietMs !== undefined && { quietMs: bursts.quietMs }) })
          : await service.sendMessage(ctx.userId, opened.chatId, message, options);
      } catch (error) {
        if (errorNamed(error, "ChatNotFoundError") && attempt === 1) {
          try {
            opened = await policy.openChat({ ...ctx, reason: "chat_gone", ...(turn.group && { group: turn.group }) });
          } catch (openError) {
            if (isAppRefusal(openError)) return reply(bot, key, update.chat, refusalText(openError, texts));
            throw openError;
          }
          continue;
        }
        if (errorNamed(error, "ChatBusyError") && attempt < BUSY_ATTEMPTS) {
          await waitForTurnEnd(ctx.userId, opened.chatId);
          continue;
        }
        return replyToTurnError(bot, key, update.chat, error);
      }
    }
    const authorId = turn.group ? update.account.externalUserId : undefined;
    const print = (stream: ReadableStream<AnswerChunk>) =>
      printTurn({ bot, key, chat: update.chat, userId: ctx.userId, chatId: opened.chatId, stream, inputWasVoice: prepared.voice, trigger: "human", ...(authorId && { authorId }) });
    if (sent instanceof ReadableStream) return print(sent);
    // Сообщение пачки записано — очередь разговора свободна: следующее сообщение человека ляжет в ту же пачку. Ход
    // начнёт вызов последнего сообщения, когда человек замолчит; у остальных — `null`.
    const { turn: burstTurn } = sent;
    const answerBurst = async () => {
      let stream: ReadableStream<AnswerChunk> | null;
      try {
        stream = await burstTurn;
      } catch (error) {
        // Служба останавливается или чат занят другой копией: обновление уйдёт на повтор и доведёт ход.
        if (errorNamed(error, "ChatBusyError")) throw error;
        return replyToTurnError(bot, key, update.chat, error);
      }
      if (!stream) return;
      // Предыдущий ответ ещё допечатывается: этот — после него.
      await running.get(idOf(key))?.done;
      await print(stream);
    };
    if (inbound.later) inbound.later(answerBurst);
    else await answerBurst();
  }

  /** Ход не начался: человеку — понятный текст (лимит, занятость, отказ приложения), остальное — в журнал и «не вышло». */
  function replyToTurnError(bot: MessengerBot, key: ConversationKey, chat: ExternalChat, error: unknown): Promise<void> {
    const texts = textsOf(key);
    if (errorNamed(error, "SpendingLimitReachedError")) return reply(bot, key, chat, texts.limitReached(error as { resetsAt: string | null; timeZone?: string; unit?: "usd" | "messages" }));
    if (errorNamed(error, "TooManyTurnsError")) return reply(bot, key, chat, texts.tooManyTurns);
    // Приложение отказало в ходе своими словами: человеку — текст отказа, в журнал не пишем.
    if (isAppRefusal(error)) return reply(bot, key, chat, refusalText(error, texts));
    logError(error);
    return reply(bot, key, chat, texts.answerFailed);
  }

  /**
   * Повтор после сбоя: дошло ли сообщение до чата в прошлый раз. Не дошло — `null`, всё заново. После него уже что-то
   * есть или ответ идёт — `"handled"`: второго хода нет. Последнее без ответа — его части (файлы не скачиваются снова):
   * служба узнаёт номер и доводит ответ на то же сообщение.
   */
  async function earlierCopy(userId: string, chatId: string, messageId: string): Promise<MessengerUserMessage | "handled" | null> {
    const history = await service.getHistory(userId, chatId);
    const index = history.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return null;
    if (index < history.messages.length - 1 || history.running === true) return "handled";
    const parts: MessengerUserMessage["parts"] = [];
    for (const part of history.messages[index]?.parts ?? []) {
      if (part.type === "text" && typeof part.text === "string") parts.push({ type: "text", text: part.text });
      if (part.type === "file" && typeof part.url === "string") parts.push({ type: "file", url: part.url, mediaType: part.mediaType ?? "application/octet-stream", filename: part.filename ?? "file" });
    }
    return parts.length > 0 ? { id: messageId, role: "user", parts } : null;
  }

  /** Чат занят чужим ходом (веб, результат фона): дочитать его поток до конца. */
  async function waitForTurnEnd(userId: string, chatId: string) {
    const stream = await service.subscribe(userId, chatId).catch(() => null);
    if (!stream) return;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || value.type === "finish" || value.type === "error" || value.type === "abort") return;
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
  }

  /**
   * Подключиться к ходу, который начал не человек (продолжение после кнопки, результат фона, агент пишет первым).
   * `holdText` — ход проверяется и может быть переписан: без печати по ходу.
   */
  async function follow(
    bot: MessengerBot,
    key: ConversationKey,
    chat: ExternalChat,
    userId: string,
    chatId: string,
    turn: { trigger: AnswerRef["trigger"]; holdText?: boolean },
    taken?: ReadableStream<AnswerChunk> | null,
  ): Promise<void> {
    const current = running.get(idOf(key));
    if (current?.chatId === chatId) {
      await taken?.cancel();
      return current.done;
    }
    const stream = taken === undefined ? await service.subscribe(userId, chatId) : taken;
    if (!stream) return;
    await printTurn({ bot, key, chat, userId, chatId, stream, inputWasVoice: false, ...turn });
  }

  /**
   * Ход сервера: поток идущего хода. Ход кончился раньше подписки (готовый ответ без модели) — текст ответа из истории,
   * иначе ответ не дошёл бы до мессенджера.
   */
  async function followServerTurn(bot: MessengerBot, key: ConversationKey, chat: ExternalChat, userId: string, chatId: string, answerId: string, holdText: boolean): Promise<void> {
    const stream = await service.subscribe(userId, chatId);
    await follow(bot, key, chat, userId, chatId, { trigger: "notice", holdText }, stream ?? (await finishedAnswerStream(userId, chatId, answerId)));
  }

  /** Записанный ответ кусками потока: только его текст. Нет ответа или текста — `null`. */
  async function finishedAnswerStream(userId: string, chatId: string, answerId: string): Promise<ReadableStream<AnswerChunk> | null> {
    const { messages } = await service.getHistory(userId, chatId);
    const answer = messages.find((message) => message.id === answerId && message.role === "assistant");
    const texts = (answer?.parts ?? []).flatMap((part) => (part.type === "text" && typeof part.text === "string" && part.text.length > 0 ? [part.text] : []));
    if (texts.length === 0) return null;
    const chunks: AnswerChunk[] = [
      { type: "start", messageId: answerId },
      ...texts.flatMap((delta, index): AnswerChunk[] => [
        { type: "text-start", id: `text-${index}` },
        { type: "text-delta", id: `text-${index}`, delta },
        { type: "text-end", id: `text-${index}` },
      ]),
      { type: "finish" },
    ];
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  function printTurn(input: {
    bot: MessengerBot;
    key: ConversationKey;
    chat: ExternalChat;
    userId: string;
    chatId: string;
    stream: ReadableStream<AnswerChunk>;
    inputWasVoice: boolean;
    trigger: AnswerRef["trigger"];
    holdText?: boolean;
    authorId?: string;
  }) {
    const { bot, key, chat, userId, chatId, trigger } = input;
    const id = idOf(key);
    const queue = deps.queueFor(bot);
    const controller = new AbortController();
    const done = (async () => {
      const outcome = await deliverAnswer({
        adapter: bot.adapter,
        chat,
        chatKey: chatKeyOf(key),
        queue,
        buttons,
        key,
        chatId,
        stream: input.stream,
        signal: controller.signal,
        ...(deps.webChatUrl && { webChatUrl: deps.webChatUrl }),
        texts: textsOf(key),
        ...(service.liveDemos && { liveDemos: true }),
        ...(input.holdText && { holdText: true }),
        ...(deps.onAnswerDelivery && { report: { ownerId: userId, trigger } }),
        logError,
      });
      if (outcome.status === "blocked") await markBlocked(key, true);
      if (outcome.messageId !== undefined) reportAnswer({ ownerId: userId, chatId, messageId: outcome.messageId, trigger, outcome: answerDeliveryOutcome(outcome) });
      await deps.voice.afterText({ adapter: bot.adapter, chat, chatKey: chatKeyOf(key), queue, ownerId: userId, chatId, answer: outcome, inputWasVoice: input.inputWasVoice, signal: controller.signal });
    })().finally(() => {
      if (running.get(id)?.controller === controller) running.delete(id);
    });
    running.set(id, { userId, chatId, controller, done, ...(input.authorId && { authorId: input.authorId }) });
    return done;
  }

  /**
   * `/stop`: оборвать печать и ход агента. Приходит мимо очереди разговора. В личке — те же правила «кто пишет», что
   * у сообщения: отказ `resolveAccount` (или «как подключиться») — его текст, пустой — тишина.
   */
  async function stop(bot: MessengerBot, update: InboundUpdate, key: ConversationKey): Promise<void> {
    const texts = textsOf(key);
    const current = running.get(idOf(key));
    let target: { userId: string; chatId: string } | undefined = current;
    if (update.chat.type === "private") {
      const writer = await policy.resolveWriter(update.account);
      if ("reply" in writer) return reply(bot, key, update.chat, writer.reply);
      if (!chatEnabled) return reply(bot, key, update.chat, texts.notifyOnly);
      const conversation = target ? null : await store.getConversation(key);
      if (conversation?.currentChatId) target = { userId: writer.userId, chatId: conversation.currentChatId };
    } else if (!target) {
      const conversation = await store.getConversation(key);
      if (conversation?.active && conversation.currentChatId) target = { userId: conversation.userId, chatId: conversation.currentChatId };
    }
    if (!target) return reply(bot, key, update.chat, texts.nothingToStop);
    if (update.chat.type === "group" && !(await groups.mayStop(key, update.account, current?.authorId))) {
      return reply(bot, key, update.chat, texts.stopNotYours);
    }
    current?.controller.abort();
    const stopped = await service.stop(target.userId, target.chatId).catch((error: unknown) => {
      logError(error);
      return false;
    });
    await current?.done;
    await reply(bot, key, update.chat, stopped || current ? texts.stopped : texts.nothingToStop);
  }

  /**
   * Ход, начатый сервером (результат фона, агент пишет первым), в чате, который сейчас текущий у разговора мессенджера.
   * Ответ доставит само приложение (`deliveredByApp`) — не провожаем. Разговор заблокирован — сразу исход `blocked`.
   * Служба проверяет ответы, а ход пишется для веба — ядро его не придерживает, печать по ходу выключаем сами.
   */
  async function onChatEvent(event: ChatEvent): Promise<void> {
    if (event.type !== "turn-started" || event.trigger !== "notice" || event.deliveredByApp) return;
    const conversations = await store.listConversationsOfChat(event.chatId);
    const holdText = service.checksReplies === true && event.channel === "web";
    for (const conversation of conversations) {
      if (!conversation.active || conversation.userId !== event.ownerId) continue;
      if (conversation.blocked) {
        reportAnswer({ ownerId: event.ownerId, chatId: event.chatId, messageId: event.messageId, trigger: "notice", outcome: { status: "blocked" } });
        continue;
      }
      const bot = botOf(conversation);
      if (!bot) continue;
      const key: ConversationKey = { messenger: conversation.messenger, botId: conversation.botId, externalChatId: conversation.externalChatId };
      const chat: ExternalChat = { id: conversation.externalChatId, type: conversation.type };
      track(followServerTurn(bot, key, chat, event.ownerId, event.chatId, event.messageId, holdText).catch(logError));
    }
  }

  /** Меню команд каждого бота: поставить или, если боту меню не нужно, снять поставленное раньше. */
  async function installCommands() {
    for (const bot of deps.bots) {
      if (deps.menuFor?.(bot) ?? true) {
        await policy.installCommands(bot.adapter).catch(logError);
        await groups.installCommands(bot.adapter).catch(logError);
      } else if (bot.adapter.abilities.commandsMenu) {
        for (const scope of ["private", "group"] as const) await bot.adapter.setCommands([], scope).catch(logError);
      }
    }
  }

  /** Ждёт, пока все принятые обновления и начатые ответы закончатся. */
  async function idle() {
    while (pending.size > 0) await Promise.allSettled([...pending]);
  }

  return { accept, receiveWebhook, renewUpdates, recoverUpdates, onChatEvent, installCommands, idle };
}

export type MessengerGateway = ReturnType<typeof createMessengerGateway>;
