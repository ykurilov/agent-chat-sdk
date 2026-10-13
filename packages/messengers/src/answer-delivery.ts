import { randomInt } from "node:crypto";
import { type ButtonActions, type Card, type CardButton, approvalCard, joinLines, suggestionRows, widgetCard } from "./button-actions";
import type { AnswerChunk } from "./chat-port";
import { htmlToPlainText, toMessengerChunks } from "./markdown-to-messenger";
import { buttonsRejected, MessengerBlockedError, MessengerMarkupError } from "./messenger-api";
import type { ExternalChat, MessengerAdapter, OutboundMessage, SentMessage } from "./messenger-adapter";
import { type MessengerTexts, messengerTexts, statusLineFor } from "./messenger-texts";
import type { OutboundQueue } from "./outbound-queue";
import { durableDelivery } from "./pending-deliveries";
import type { ConversationKey, PendingDelivery } from "./types";

/** В режиме правок первое сообщение появляется, когда набралось столько знаков: иначе человек видит «П», «Пр», «При»… */
export const FIRST_MESSAGE_CHARS = 40;
/** «Печатает…» гаснет через ~5 с, обновляем чаще. */
export const TYPING_EVERY_MS = 4000;
/** Черновик Telegram живёт ~30 с: при долгом молчании модели обновляем его заранее. */
export const DRAFT_REFRESH_MS = 20_000;
const DRAFT_CHECK_MS = 5000;

export interface DeliverAnswerInput {
  adapter: MessengerAdapter;
  chat: ExternalChat;
  /** Ключ чата в очереди отправки. */
  chatKey: string;
  queue: OutboundQueue;
  buttons: ButtonActions;
  key: ConversationKey;
  /** Чат агента, к которому относится ответ. */
  chatId: string;
  stream: ReadableStream<AnswerChunk>;
  /** `/stop`: показанное закрепляется, дальше не читаем. */
  signal?: AbortSignal;
  webChatUrl?(chatId: string): string;
  /** Фразы бота; нет — по умолчанию. */
  texts?: MessengerTexts;
  /** У агента включены живые демонстрации: блок ```html-demo → `texts.liveDemoOnSite`. Нет — блок кодом, как любой. */
  liveDemos?: boolean;
  logError?(error: unknown): void;
}

export interface DeliveryOutcome {
  status: "finished" | "stopped" | "failed" | "blocked";
  /** Номер ответа агента в чате. */
  messageId?: string;
  /** Весь текст ответа, Markdown. */
  text: string;
  /** Сообщения с текстом ответа. */
  sent: SentMessage[];
}

interface ToolCall {
  toolName: string;
  input?: unknown;
  done: boolean;
}

/** Сообщение, которое печатается по ходу (режим правок): часть ответа с номером `index`. */
interface LiveMessage {
  index: number;
  creating: boolean;
  sent?: SentMessage;
  shown?: string;
}

/**
 * Поток ответа → сообщения мессенджера. Черновик (только личный чат), правки или «печатает…» и готовый ответ;
 * строка статуса, пока идут инструменты; длинный ответ режется по абзацам; в конце — карточки подтверждений и
 * виджетов, подсказки — кнопками под последним сообщением. Итог доставляется всегда (кроме «заблокирован»).
 */
export async function deliverAnswer(input: DeliverAnswerInput): Promise<DeliveryOutcome> {
  const { adapter, chat, chatKey, queue, buttons, key } = input;
  const { abilities } = adapter;
  const texts = input.texts ?? messengerTexts;
  const logError = (error: unknown) => input.logError?.(error);
  const mode: "draft" | "edit" | "none" = abilities.liveText === "draft" && (chat.type !== "private" || !adapter.draft) ? "edit" : abilities.liveText;
  const target = { messenger: adapter.messenger, textLimit: abilities.textLimit, ...(input.liveDemos && { liveDemoNote: texts.liveDemoOnSite }) };
  const draftBase = randomInt(1, 2 ** 31 - 1_000_000);
  /** Метка правок этого ответа в очереди: в конце они снимаются, итог не ждёт их паузы. */
  const slotPrefix = `answer-${draftBase}:`;

  let text = "";
  /** Длина текста на начале текущего шага: шаг, начатый заново у другого провайдера, стирается до неё. */
  let stepTextStart = 0;
  /**
   * Ход помечен `data-steps-may-reset`: идущий шаг может стереться. Тогда постоянными сообщениями уходят только части,
   * готовые до начала шага (`committable`), остальное — живым сообщением до конца шага.
   */
  let stepsMayReset = false;
  let committable = Number.POSITIVE_INFINITY;
  let textPartId: string | undefined;
  let status: string | null = null;
  let messageId: string | undefined;
  const tools = new Map<string, ToolCall>();
  const approvals: Array<{ approvalId: string; toolCallId: string }> = [];

  let committed = 0;
  let live: LiveMessage = { index: 0, creating: false };
  let draftShown = "";
  let lastDraftAt = Number.NEGATIVE_INFINITY;
  let markupFailed = false;
  let streamEnded = false;
  let blocked = false;
  let stopped = false;
  let failed = false;
  const finals: Promise<unknown>[] = [];
  const sentTexts: SentMessage[] = [];

  const reader = input.stream.getReader();
  const stopReading = () => {
    reader.cancel().catch(() => undefined);
  };

  const view = () => [text, status].filter((part) => part).join("\n\n");
  const chunksOf = (markdown: string) => (markdown.trim() ? toMessengerChunks(markdown, target) : []);
  const tailOf = (index: number) => chunksOf(view())[index] ?? "";

  /** Кусок для отправки: после отказа разметки — простым текстом до конца ответа. */
  const render = (chunk: string): { text: string; markup: "html" | "plain" } =>
    abilities.markup === "html" && !markupFailed ? { text: chunk, markup: "html" } : { text: abilities.markup === "html" ? htmlToPlainText(chunk) : chunk, markup: "plain" };
  async function withMarkupFallback<T>(call: (message: { text: string; markup: "html" | "plain" }) => Promise<T>, chunk: string): Promise<T> {
    try {
      return await call(render(chunk));
    } catch (error) {
      if (!(error instanceof MessengerMarkupError) || abilities.markup !== "html" || markupFailed) throw error;
      markupFailed = true;
      return call(render(chunk));
    }
  }

  /** Итог; `durable` — его запись, чтобы он пережил перезапуск сервера. */
  function final<T>(op: () => Promise<T>, durable?: () => PendingDelivery): Promise<T | undefined> {
    const result = queue.run(chatKey, op, durable ? { durable } : {});
    result.catch((error: unknown) => {
      if (error instanceof MessengerBlockedError) {
        blocked = true;
        stopReading();
      } else logError(error);
    });
    finals.push(result);
    return result;
  }

  /** Отправить или закрепить правкой часть ответа; `rows` — подсказки под ней. */
  function finalizeChunk(index: number, chunk: string, rows?: CardButton[][]) {
    const reuse = mode === "edit" && live.index === index && (live.sent || live.creating) ? live : undefined;
    const prepared = rows && rows.length > 0 ? buttons.prepare(key, rows) : undefined;
    final(async () => {
      const attempt = async (withButtons: boolean): Promise<SentMessage> => {
        const extra = withButtons && prepared ? { buttons: prepared.buttons } : {};
        if (reuse?.sent) {
          const sent = reuse.sent;
          if (reuse.shown === chunk && !extra.buttons) return sent;
          await withMarkupFallback((message) => adapter.edit(sent, { ...message, ...extra }), chunk);
          reuse.shown = chunk;
          return sent;
        }
        return withMarkupFallback((message) => adapter.send(chat, { ...message, ...extra }), chunk);
      };
      let withButtons = prepared !== undefined;
      let sent: SentMessage;
      try {
        sent = await attempt(withButtons);
      } catch (error) {
        if (!withButtons || !buttonsRejected(error)) throw error;
        withButtons = false;
        sent = await attempt(false);
      }
      sentTexts.push(sent);
      if (withButtons && prepared) await prepared.save(sent, render(chunk));
      return sent;
    }, durableDelivery(key, () => ({
      chat,
      message: { ...render(chunk), ...(prepared && { buttons: prepared.buttons }) },
      ...(reuse?.sent && { edit: reuse.sent }),
      ...(prepared && { rows: prepared.rows }),
    })));
  }

  /** Карточка с кнопками; не приняли кнопки — текстом и ответом словами. `reuse` — сообщение со строкой статуса. */
  function sendCard(card: Card, fallback: { text: string; onFallback?(): void }, reuse?: LiveMessage) {
    const prepared = card.rows.length > 0 ? buttons.prepare(key, card.rows) : undefined;
    final(async () => {
      const deliver = async (message: OutboundMessage): Promise<SentMessage> => {
        if (reuse?.sent) {
          await adapter.edit(reuse.sent, message);
          return reuse.sent;
        }
        return adapter.send(chat, message);
      };
      if (!prepared) return deliver({ text: card.text, markup: "plain" });
      try {
        const sent = await deliver({ text: card.text, markup: "plain", buttons: prepared.buttons });
        await prepared.save(sent, { text: card.text, markup: "plain" });
        return sent;
      } catch (error) {
        if (!buttonsRejected(error)) throw error;
        fallback.onFallback?.();
        return deliver({ text: fallback.text, markup: "plain" });
      }
    }, durableDelivery(key, () => ({
      chat,
      message: { text: card.text, markup: "plain", ...(prepared && { buttons: prepared.buttons }) },
      ...(reuse?.sent && { edit: reuse.sent }),
      ...(prepared && { rows: prepared.rows }),
    })));
  }

  /** Закрывающая фраза пустая: строку статуса убираем, чтобы «Работаю…» не висело вечно. Адаптер не умеет удалять — остаётся. */
  function removeStatus(status: LiveMessage) {
    const remove = adapter.deleteMessage?.bind(adapter);
    if (!remove) return;
    final(async () => {
      if (status.sent) await remove(status.sent);
    });
  }

  function commitReady(chunks: string[]) {
    while (chunks.length - 1 > committed && committed < committable) {
      finalizeChunk(committed, chunks[committed] as string);
      committed++;
      live = { index: committed, creating: false };
    }
  }

  function scheduleDraft(force: boolean) {
    const index = committed;
    const draft = adapter.draft;
    if (!draft) return;
    void queue.run(
      chatKey,
      async () => {
        if (streamEnded || index !== committed) return;
        const tail = tailOf(index);
        if (!tail || (!force && tail === draftShown)) return;
        await draft.call(adapter, chat, draftBase + index, abilities.markup === "html" ? htmlToPlainText(tail) : tail);
        draftShown = tail;
        lastDraftAt = Date.now();
      },
      { slot: `${slotPrefix}draft:${index}` },
    );
  }

  /** Показать новое состояние ответа: черновик или правка. */
  function update() {
    if (mode === "none" || streamEnded) return;
    const chunks = chunksOf(view());
    commitReady(chunks);
    if (!chunks[committed]) return;
    if (mode === "draft") {
      scheduleDraft(false);
      return;
    }
    if (!live.sent && !live.creating) {
      if (committed === 0 && text.trim().length < FIRST_MESSAGE_CHARS && status === null) return;
      const ref = live;
      ref.creating = true;
      final(async () => {
        const tail = tailOf(ref.index) || ref.shown || "";
        if (!tail) return undefined;
        const sent = await withMarkupFallback((message) => adapter.send(chat, message), tail);
        ref.sent = sent;
        ref.shown = tail;
        return sent;
      });
      return;
    }
    const ref = live;
    void queue.run(
      chatKey,
      async () => {
        const sent = ref.sent;
        if (streamEnded || ref.index !== live.index || !sent) return;
        const tail = tailOf(ref.index);
        if (!tail || tail === ref.shown) return;
        await withMarkupFallback((message) => adapter.edit(sent, message), tail);
        ref.shown = tail;
      },
      { slot: `${slotPrefix}live:${ref.index}` },
    );
  }

  /** Разобрать кусок потока; `true` — ход закончен, дальше не читаем. */
  function handle(chunk: AnswerChunk): boolean {
    switch (chunk.type) {
      case "start":
        if (chunk.messageId) messageId = chunk.messageId;
        return false;
      case "text-delta": {
        if (!chunk.delta) return false;
        if (chunk.id !== textPartId) {
          if (text && !text.endsWith("\n\n")) text += "\n\n";
          textPartId = chunk.id;
        }
        text += chunk.delta;
        status = null;
        update();
        return false;
      }
      case "data-steps-may-reset":
        stepsMayReset = true;
        return false;
      case "start-step":
        stepTextStart = text.length;
        if (stepsMayReset) committable = Math.max(chunksOf(text).length - 1, 0);
        return false;
      case "finish-step":
        // Законченный шаг уже не стирается: готовые части можно закреплять.
        committable = Number.POSITIVE_INFINITY;
        if (stepsMayReset) update();
        return false;
      case "data-step-reset": {
        text = text.slice(0, stepTextStart).replace(/\n\n$/, "");
        textPartId = undefined;
        // Живое сообщение или черновик показывали стёртое, а показать на его месте нечего — фраза, что ответ пишется заново.
        const shownErased = mode === "draft" ? draftShown !== "" : Boolean(live.sent || live.creating);
        status = shownErased && !chunksOf(text)[committed] && texts.rewritingAnswer ? texts.rewritingAnswer : null;
        update();
        return false;
      }
      case "tool-input-start": {
        const id = chunk.toolCallId ?? "";
        tools.set(id, { toolName: chunk.toolName ?? "", done: false });
        const line = statusLineFor(chunk.toolName ?? "");
        if (line) {
          status = line;
          textPartId = undefined;
          update();
        }
        return false;
      }
      case "tool-input-available": {
        const id = chunk.toolCallId ?? "";
        const call = tools.get(id) ?? { toolName: chunk.toolName ?? "", done: false };
        if (!call.toolName && chunk.toolName) call.toolName = chunk.toolName;
        call.input = chunk.input;
        tools.set(id, call);
        return false;
      }
      case "tool-output-available":
      case "tool-output-error":
      case "tool-output-denied": {
        const call = tools.get(chunk.toolCallId ?? "");
        if (call) call.done = true;
        return false;
      }
      case "tool-approval-request":
        if (chunk.approvalId && chunk.toolCallId) approvals.push({ approvalId: chunk.approvalId, toolCallId: chunk.toolCallId });
        return false;
      case "finish":
        return true;
      case "error":
        failed = true;
        return true;
      case "abort":
        stopped = true;
        return true;
      default:
        return false;
    }
  }

  const onAbort = () => {
    stopped = true;
    stopReading();
  };
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) onAbort();

  void adapter.typing(chat).catch(logError);
  const typingTimer = mode === "none" ? setInterval(() => void adapter.typing(chat).catch(logError), TYPING_EVERY_MS) : undefined;
  const draftTimer =
    mode === "draft"
      ? setInterval(() => {
          if (Number.isFinite(lastDraftAt) && Date.now() - lastDraftAt >= DRAFT_REFRESH_MS) scheduleDraft(true);
        }, DRAFT_CHECK_MS)
      : undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || blocked || handle(value)) break;
    }
  } catch (error) {
    if (!stopped && !blocked) {
      failed = true;
      logError(error);
    }
  } finally {
    streamEnded = true;
    committable = Number.POSITIVE_INFINITY;
    queue.drop(chatKey, slotPrefix);
    clearInterval(typingTimer);
    clearInterval(draftTimer);
    input.signal?.removeEventListener("abort", onAbort);
    if (stopped || blocked) stopReading();
  }

  status = null;
  const outcomeStatus = (): DeliveryOutcome["status"] => (blocked ? "blocked" : stopped ? "stopped" : failed ? "failed" : "finished");
  if (!blocked) {
    const chunks = chunksOf(text);
    const finished = outcomeStatus() === "finished";
    const cards: Array<{ card: Card; fallback: { text: string; onFallback?(): void } }> = [];
    let suggestions: CardButton[][] | undefined;
    if (finished) {
      const waitingApproval = new Set(approvals.map((approval) => approval.toolCallId));
      for (const approval of approvals) {
        const card = approvalCard({ chatId: input.chatId, approvalId: approval.approvalId, toolName: tools.get(approval.toolCallId)?.toolName ?? "" }, texts);
        cards.push({
          card,
          fallback: {
            text: joinLines(card.text, texts.approvalByWords),
            onFallback: () => buttons.rememberWordsApproval(key, { chatId: input.chatId, approvalId: approval.approvalId }),
          },
        });
      }
      for (const [toolCallId, call] of tools) {
        if (call.toolName === "suggest_replies") {
          const replies = (call.input as { replies?: unknown } | undefined)?.replies;
          if (Array.isArray(replies) && replies.every((reply) => typeof reply === "string") && replies.length > 0) suggestions = suggestionRows(replies);
          continue;
        }
        if (call.done || waitingApproval.has(toolCallId) || call.input === undefined) continue;
        const card = widgetCard({ chatId: input.chatId, toolCallId, toolName: call.toolName, input: call.input }, input.webChatUrl, texts);
        const text = card.text.endsWith(texts.answerByMessage) ? card.text : joinLines(card.text, texts.answerByMessage);
        cards.push({ card, fallback: { text } });
      }
    }

    commitReady(chunks);
    const lastIndex = chunks.length - 1;
    if (lastIndex >= 0) finalizeChunk(lastIndex, chunks[lastIndex] as string, suggestions);
    // Сообщение со строкой статуса без текста ответа: превращаем его в первую карточку или в итоговую фразу.
    let statusMessage = lastIndex < 0 && mode === "edit" && (live.sent || live.creating) ? live : undefined;
    for (const { card, fallback } of cards) {
      sendCard(card, fallback, statusMessage);
      statusMessage = undefined;
    }
    const closing = failed && !stopped ? texts.answerFailed : statusMessage ? (stopped ? texts.stopped : texts.done) : undefined;
    if (closing) sendCard({ text: closing, rows: [] }, { text: closing }, statusMessage);
    else if (statusMessage) removeStatus(statusMessage);
  }
  await Promise.allSettled(finals);
  return { status: outcomeStatus(), ...(messageId !== undefined && { messageId }), text, sent: sentTexts };
}
