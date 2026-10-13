import { randomInt } from "node:crypto";
import { ActionForbiddenError, ApprovalNotPendingError, ChatClosedError, TurnRefusedError, WidgetNotPendingError } from "@ykurilov/agent-chat-core";
import type { AnswerChunk, MessengerChatService } from "./chat-port";
import type { Button, ButtonPress, MessengerAdapter, SentMessage } from "./messenger-adapter";
import { defaultTextsOf, type MessengerTexts, type MessengerTextsOf, messengerTexts } from "./messenger-texts";
import type { ButtonAction, ConversationKey, MessengerStore } from "./types";

/** Что делает кнопка. В мессенджер уходит только короткий номер, действие лежит в `messenger_buttons`. */
export type MessengerButtonAction =
  | { type: "approval"; chatId: string; approvalId: string; answer: "allow" | "deny" | "always" }
  | { type: "widget"; chatId: string; toolCallId: string; answer: unknown }
  | ({ type: "multi_toggle"; option: number } & MultiChoiceState)
  | ({ type: "multi_done" } & MultiChoiceState)
  | { type: "reply"; text: string }
  | { type: "select_chat"; chatId: string }
  | { type: "task_cancel"; chatId: string; taskId: string }
  | { type: "task_approval"; chatId: string; taskId: string; approvalId: string; decision: "allow" | "deny" }
  | { type: "open_link"; url: string };

export interface CardButton {
  text: string;
  action: MessengerButtonAction;
  /** Номер уже выдан (итог повторяется после перезапуска); нет — выдаётся новый. */
  id?: string;
}

/** Сообщение с кнопками до отправки: текст простой, без разметки. */
export interface Card {
  text: string;
  rows: CardButton[][];
}

interface MultiChoiceState {
  chatId: string;
  toolCallId: string;
  options: string[];
  selected: number[];
  min: number;
  max: number;
}

/** Действие в базе: плюс сообщение с кнопкой, соседи по карточке и сама карточка, чтобы её перерисовать. */
type StoredAction = MessengerButtonAction & {
  messageId: string;
  siblings: string[];
  card?: { text: string; markup: "html" | "plain"; rows: CardButton[][] };
};

/** Что шлюзу делать после нажатия: продолжить ход, отправить текст агенту или сменить чат. */
export interface PressOutcome {
  /** Ход продолжился; `stream` — его поток, взятый сразу после ответа, пока ход не успел закончиться. */
  resume?: { chatId: string; stream?: ReadableStream<AnswerChunk> | null };
  userText?: string;
  selectChat?: string;
}

const BUTTON_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const RANGE_ROW = 6;
/** Эти кнопки не перерисовывают карточку, ей незачем лежать в базе. */
const CARDLESS: ReadonlySet<string> = new Set(["reply", "select_chat", "open_link"]);

/** Короткий номер кнопки: 8 знаков, влезает в данные кнопки любого мессенджера. */
export function newButtonId(): string {
  let id = "";
  for (let index = 0; index < 8; index++) id += BUTTON_ID_ALPHABET[randomInt(BUTTON_ID_ALPHABET.length)];
  return id;
}

export function approvalCard(request: { chatId: string; approvalId: string; toolName: string; title?: string }, texts: MessengerTexts = messengerTexts): Card {
  const button = (text: string, answer: "allow" | "deny" | "always"): CardButton => ({
    text,
    action: { type: "approval", chatId: request.chatId, approvalId: request.approvalId, answer },
  });
  return {
    text: texts.approvalQuestion(request.title ?? request.toolName),
    rows: [[button(texts.allow, "allow"), button(texts.deny, "deny")], [button(texts.allowAlways, "always")]],
  };
}

/** Подсказки ответа: нажатие уходит агенту обычным сообщением. */
export function suggestionRows(replies: readonly string[]): CardButton[][] {
  return replies.map((text) => [{ text, action: { type: "reply", text } }]);
}

export function chatListRows(chats: ReadonlyArray<{ id: string; title: string | null; closed?: unknown }>, texts: MessengerTexts = messengerTexts): CardButton[][] {
  return chats.map((chat) => {
    const title = chat.title || texts.untitledChat;
    return [{ text: chat.closed ? texts.closedChat(title) : title, action: { type: "select_chat", chatId: chat.id } }];
  });
}

/** Виджет, ждущий ответа человека → карточка. Выбор, несколько вариантов и оценка — кнопками; форма и свои виджеты — текстом. */
export function widgetCard(
  call: { chatId: string; toolCallId: string; toolName: string; input: unknown },
  webChatUrl?: (chatId: string) => string,
  texts: MessengerTexts = messengerTexts,
): Card {
  const input = (typeof call.input === "object" && call.input !== null ? call.input : {}) as Record<string, unknown>;
  const question = typeof input.question === "string" ? input.question : undefined;
  const options = stringList(input.options);
  const widget = (text: string, answer: unknown): CardButton => ({ text, action: { type: "widget", chatId: call.chatId, toolCallId: call.toolCallId, answer } });

  if (call.toolName === "ask_choice" && question && options) {
    return { text: question, rows: options.map((option) => [widget(option, { выбрано: option })]) };
  }
  if (call.toolName === "ask_multi_choice" && question && options) {
    const state: MultiChoiceState = {
      chatId: call.chatId,
      toolCallId: call.toolCallId,
      options,
      selected: [],
      min: typeof input.min === "number" ? input.min : 1,
      max: typeof input.max === "number" ? input.max : options.length,
    };
    return { text: joinLines(question, texts.chooseMany), rows: multiChoiceRows(state, texts) };
  }
  if (call.toolName === "ask_rating" && question) {
    if (input.scale === "stars") return { text: question, rows: [[1, 2, 3, 4, 5].map((value) => widget(`${value} ★`, { оценка: value }))] };
    if (input.scale === "range" && typeof input.from === "number" && typeof input.to === "number") {
      const { from, to } = input;
      const labels = [
        typeof input.fromLabel === "string" ? `${from} — ${input.fromLabel}` : null,
        typeof input.toLabel === "string" ? `${to} — ${input.toLabel}` : null,
      ].filter((label) => label !== null);
      const values = Array.from({ length: to - from + 1 }, (_, index) => from + index);
      const rows: CardButton[][] = [];
      for (let start = 0; start < values.length; start += RANGE_ROW) rows.push(values.slice(start, start + RANGE_ROW).map((value) => widget(String(value), { оценка: value })));
      return { text: labels.length > 0 ? `${question}\n${labels.join(", ")}` : question, rows };
    }
  }

  // Форма и свои виджеты: ответ сообщением сам закрывает виджет.
  const title = typeof input.title === "string" ? input.title : question;
  const rows: CardButton[][] = webChatUrl ? [[{ text: texts.openInApp, action: { type: "open_link", url: webChatUrl(call.chatId) } }]] : [];
  return { text: joinLines(title, ...(call.toolName === "ask_form" ? formFieldLines(input.fields, texts) : []), texts.answerByMessage), rows };
}

/** Строки карточки через перевод строки; пустые и незаданные (фраза выключена) пропускаются. */
export function joinLines(...lines: Array<string | undefined>): string {
  return lines.filter((line) => line !== undefined && line !== "").join("\n");
}

function multiChoiceRows(state: MultiChoiceState, texts: MessengerTexts): CardButton[][] {
  const rows: CardButton[][] = state.options.map((option, index) => [
    { text: `${state.selected.includes(index) ? "✅" : "◻️"} ${option}`, action: { type: "multi_toggle", ...state, option: index } },
  ]);
  const count = state.selected.length;
  if (count >= state.min && count <= state.max) rows.push([{ text: texts.done, action: { type: "multi_done", ...state } }]);
  return rows;
}

function formFieldLines(fields: unknown, texts: MessengerTexts): string[] {
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field: Record<string, unknown>) => {
    if (typeof field?.label !== "string") return [];
    const required = field.required === true && texts.requiredField ? ` (${texts.requiredField})` : "";
    const choices = field.kind === "select" && stringList(field.options) ? `: ${(field.options as string[]).join(", ")}` : "";
    return [`• ${field.label}${required}${choices}`];
  });
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string") ? value : undefined;
}

const conversationId = (key: ConversationKey) => `${key.messenger}/${key.botId}/${key.externalChatId}`;

/** Короткие номера кнопок → действия: сохранение после отправки, нажатие один раз, ответ ядру, ответ словами без кнопок. */
export function createButtonActions(deps: { store: MessengerStore; service: MessengerChatService; textsOf?: MessengerTextsOf; logError?(error: unknown): void }) {
  const { store, service } = deps;
  const textsOf = deps.textsOf ?? defaultTextsOf;
  const logError = (error: unknown) => deps.logError?.(error);
  /** Подтверждения, ждущие «да» или «нет»: там, где кнопки не отправились. */
  const wordsApprovals = new Map<string, { chatId: string; approvalId: string }>();

  /** Номера для кнопок карточки; `save` — после отправки, когда известно сообщение. */
  function prepare(key: ConversationKey, rows: CardButton[][]) {
    const withIds = rows.map((row) => row.map(({ text, action, id }) => ({ text, action, id: id ?? newButtonId() })));
    // Карточка в базе — без номеров: перерисовка выдаёт новые.
    const cardRows: CardButton[][] = rows.map((row) => row.map(({ text, action }) => ({ text, action })));
    const siblings = withIds.flat().map((button) => button.id);
    const buttons: Button[][] = withIds.map((row) => row.map(({ id, text, action }) => ({ id, text, ...(action.type === "open_link" && { url: action.url }) })));
    const keepCard = rows.flat().some((button) => !CARDLESS.has(button.action.type));
    async function save(sent: SentMessage, message: { text: string; markup: "html" | "plain" }) {
      const createdAt = new Date().toISOString();
      const card = keepCard ? { text: message.text, markup: message.markup, rows: cardRows } : undefined;
      for (const button of withIds.flat()) {
        const action: StoredAction = { ...button.action, messageId: sent.messageId, siblings, ...(card && { card }) };
        await store.saveButton({ ...key, id: button.id, action: action as ButtonAction, createdAt });
      }
    }
    /** Кнопки с номерами — для записи итога, который переживёт перезапуск. */
    const storedRows = withIds as Array<Array<{ id: string; text: string; action: ButtonAction }>>;
    return { buttons, rows: storedRows, save };
  }

  async function take(key: ConversationKey, id: string): Promise<StoredAction | null> {
    return (await store.takeButton(key, id, new Date().toISOString())) as StoredAction | null;
  }

  async function press(input: { key: ConversationKey; adapter: MessengerAdapter; ownerId: string; press: ButtonPress }): Promise<PressOutcome> {
    const { key, adapter, ownerId } = input;
    const pressed = input.press;
    const texts = textsOf(key);
    // Нажатие своей кнопки подтверждаем всегда, иначе у человека крутится значок загрузки; пустая фраза — без текста.
    const answer = async (text?: string) => {
      await adapter.answerButton(pressed, text || undefined).catch(logError);
    };
    const stored = await take(key, pressed.buttonId);
    if (!stored) {
      // Кнопка не наша или уже нажата: при пустой фразе молчим совсем.
      if (texts.alreadyAnswered) await answer(texts.alreadyAnswered);
      return {};
    }
    // Ответ на карточку один: соседние кнопки гаснут вместе с нажатой.
    const disableSiblings = async () => {
      const now = new Date().toISOString();
      for (const id of stored.siblings) if (id !== pressed.buttonId) await store.takeButton(key, id, now);
    };
    /** Та же карточка со свежими номерами: после выбора варианта или сбоя, чтобы нажать ещё раз. */
    const redraw = async (rows: CardButton[][]) => {
      if (!stored.card) return;
      try {
        const sent: SentMessage = { chat: pressed.chat, messageId: stored.messageId };
        const prepared = prepare(key, rows);
        await adapter.edit(sent, { text: stored.card.text, markup: stored.card.markup, buttons: prepared.buttons });
        await prepared.save(sent, stored.card);
      } catch (error) {
        logError(error);
      }
    };

    switch (stored.type) {
      case "open_link":
        await answer();
        const linkText = texts.openLink(stored.url);
        if (linkText) await adapter.send(pressed.chat, { text: linkText, markup: "plain" });
        return {};
      case "reply":
        await disableSiblings();
        await answer();
        return { userText: stored.text };
      case "select_chat":
        await disableSiblings();
        await answer();
        return { selectChat: stored.chatId };
      case "multi_toggle": {
        const isSelected = stored.selected.includes(stored.option);
        if (!isSelected && stored.selected.length >= stored.max) {
          await answer(texts.chooseAtMost(stored.max));
          return {};
        }
        await disableSiblings();
        await answer();
        const selected = isSelected ? stored.selected.filter((index) => index !== stored.option) : [...stored.selected, stored.option].sort((left, right) => left - right);
        const { type: _type, option: _option, messageId: _messageId, siblings: _siblings, card: _card, ...state } = stored;
        await redraw(multiChoiceRows({ ...state, selected }, texts));
        return {};
      }
      default:
        break;
    }

    await disableSiblings();
    try {
      switch (stored.type) {
        case "approval": {
          const result = await service.answerApproval(ownerId, stored.chatId, stored.approvalId, stored.answer);
          const outcome = await resumeOutcome(result, ownerId, stored.chatId);
          await answer(texts.accepted);
          return outcome;
        }
        case "widget":
        case "multi_done": {
          const widgetAnswer = stored.type === "widget" ? stored.answer : { выбрано: stored.options.filter((_, index) => stored.selected.includes(index)) };
          const result = await service.answerWidget({ chatId: stored.chatId, ownerId, toolCallId: stored.toolCallId, answer: widgetAnswer });
          const outcome = await resumeOutcome(result, ownerId, stored.chatId);
          await answer(texts.accepted);
          return outcome;
        }
        case "task_cancel": {
          if (!service.tasks) throw new Error("Фоновые задачи не подключены");
          const result = await service.tasks.cancel(ownerId, stored.chatId, stored.taskId);
          await answer(result === "canceled" ? texts.taskCanceled : texts.alreadyAnswered);
          return {};
        }
        case "task_approval": {
          if (!service.tasks) throw new Error("Фоновые задачи не подключены");
          // Номер вопроса из карточки: кнопка старой карточки новый вопрос задачи не одобряет (`stale`).
          const result = await service.tasks.answerApproval(ownerId, stored.chatId, stored.taskId, stored.approvalId, stored.decision);
          await answer(result === "resumed" ? texts.accepted : texts.alreadyAnswered);
          return {};
        }
      }
    } catch (error) {
      if (isNotPending(error)) {
        await answer(texts.alreadyAnswered);
        return {};
      }
      // Приложение отказало в ходе своими словами: человеку — они, в журнал не пишем.
      const refusal = refusalText(error);
      if (refusal === undefined) logError(error);
      await answer(refusal ?? texts.failed);
      await redraw(stored.card?.rows ?? []);
    }
    return {};
  }

  /**
   * Подписка на продолжение — сразу после ответа службе: пока бот отвечает на нажатие, быстрый ход успел бы
   * закончиться, и поздняя подписка не нашла бы его.
   */
  async function resumeOutcome(result: { resumed: boolean }, ownerId: string, chatId: string): Promise<PressOutcome> {
    if (!result.resumed) return {};
    return { resume: { chatId, stream: await service.subscribe(ownerId, chatId) } };
  }

  /** Кнопки не отправились: подтверждение ждёт ответа словами. */
  function rememberWordsApproval(key: ConversationKey, approval: { chatId: string; approvalId: string }) {
    wordsApprovals.set(conversationId(key), approval);
  }

  /** «да» / «нет» на ждущее подтверждение. Не ответ на подтверждение — `null`, сообщение идёт дальше как обычно. */
  async function answerByWords(key: ConversationKey, ownerId: string, text: string): Promise<(PressOutcome & { reply?: string }) | null> {
    const id = conversationId(key);
    const pending = wordsApprovals.get(id);
    if (!pending) return null;
    const texts = textsOf(key);
    const word = text
      .trim()
      .toLowerCase()
      .replace(/[\s.!?,…]+$/u, "");
    const decision = word === "да" ? "allow" : word === "нет" ? "deny" : null;
    if (!decision) return null;
    wordsApprovals.delete(id);
    try {
      const result = await service.answerApproval(ownerId, pending.chatId, pending.approvalId, decision);
      return await resumeOutcome(result, ownerId, pending.chatId);
    } catch (error) {
      if (isNotPending(error)) return { reply: texts.alreadyAnswered };
      const refusal = refusalText(error);
      if (refusal === undefined) logError(error);
      wordsApprovals.set(id, pending);
      return { reply: refusal ?? texts.failed };
    }
  }

  return { prepare, take, press, rememberWordsApproval, answerByWords };
}

export type ButtonActions = ReturnType<typeof createButtonActions>;

/** Текст отказа приложения (отказ хода, закрытый чат, запрет правами); другая ошибка — `undefined`. */
function refusalText(error: unknown): string | undefined {
  return error instanceof TurnRefusedError || error instanceof ChatClosedError || error instanceof ActionForbiddenError ? error.message : undefined;
}

function isNotPending(error: unknown): boolean {
  return error instanceof ApprovalNotPendingError || error instanceof WidgetNotPendingError;
}
