import type { FlexibleSchema } from "ai";
import type { AppStateAccess } from "../app-state/app-state";
import type { ChatSubject } from "../conversation/types";
import type { AppEvent } from "../turn-hooks/turn-hooks";

/** Базовые виджеты, которые ядро умеет показывать без кода приложения: четыре ждут ответа, `suggest_replies` — нет. */
export type BasicWidgetName = "ask_choice" | "ask_multi_choice" | "ask_rating" | "ask_form" | "suggest_replies";

/**
 * Свой виджет приложения (результат `defineWidget`): инструмент без `execute`, который ставит ход на паузу,
 * пока человек не ответит. Один и тот же модуль импортируют сервер (имя, схемы) и страница (имя для `widgets={{ … }}`).
 */
export interface WidgetDescription<Input = unknown, Answer = unknown> {
  /** Имя инструмента для модели: `^[a-z][a-z0-9_]{0,63}$`, без префиксов `ask_` и `suggest_`. */
  name: string;
  /** Описание для модели: когда звать виджет. Постоянная строка (кэш запроса). */
  description: string;
  /** Схема входа вызова; негодный вход модель видит как ошибку инструмента. */
  inputSchema: FlexibleSchema<Input>;
  /** Схема ответа человека; сервер проверяет ею ответ до записи. */
  answerSchema: FlexibleSchema<Answer>;
  /** Короткий текст вопроса для запасного вида и голоса. Метод, а не поле-функция: описания разных виджетов лежат в одном списке. */
  question?(input: Input): string;
  /**
   * Проверка ответа на сервере, с доступом к базе приложения («слот уже занят»). Зовётся после `answerSchema`, пока чат
   * удержан за этим ответом; `answer` — ответ, прошедший схему. Исход: `undefined` — принять как есть, `{ answer }` —
   * принять с заменой (её видят модель и экран), `{ refuse }` — отказать текстом до 300 знаков (виджет остаётся
   * открытым). Исключение — ошибка сервера (500), ничего не записано. Файл виджета читает и страница: серверный код
   * здесь не держите — задайте проверку на сервере (`custom: [{ ...widget, checkAnswer }]`) или общей
   * `agent.widgets.checkAnswer`.
   */
  checkAnswer?(answer: Answer, context: WidgetAnswerContext<Input>): WidgetAnswerVerdict<Answer> | Promise<WidgetAnswerVerdict<Answer>>;
}

/** Что видит проверка ответа виджета. В браузер и модели ничего из этого не уходит. */
export interface WidgetAnswerContext<Input = unknown> {
  ownerId: string;
  chatId: string;
  /** Ответ агента, в котором ждёт виджет. */
  messageId: string;
  toolName: string;
  toolCallId: string;
  /** Вход вызова виджета. */
  input: Input;
  /** Объект чата (`openSubjectChat`); у обычного чата нет. */
  subject?: ChatSubject;
  /** Данные чата (`chat.data`). */
  chatData?: Record<string, unknown>;
  /**
   * Состояние чата на ветке: читает свёртку до ответа, пишет так же, как `model.state` инструмента. Принятые записи
   * ложатся в ответ вместе с результатом виджета; отказ и исключение их отбрасывают. После конца проверки запись не
   * принимается (строка в журнал).
   */
  state: AppStateAccess;
  /**
   * Сигнал отмены проверки: срабатывает, когда вышел срок проверки (`checkAnswerTimeoutMs`) или человек нажал «Стоп» в
   * этом чате. После отмены ответ не пишется и виджет остаётся открытым, но служба не может остановить вашу работу сама:
   * слушайте сигнал и бросайте то, что уже не нужно (запрос в базу, бронь), например `fetch(url, { signal: ctx.signal })`.
   */
  signal: AbortSignal;
  /**
   * Положить событие приложения в ответ, как `model.emitAppEvent` инструмента: неверная форма — `TypeError` сразу.
   * Принятые события ложатся частями `data-app-event` в ответ вместе с результатом виджета и доходят до вкладки после
   * того, как сервер принял ответ, до продолжения хода. Отказ и исключение их отбрасывают; после конца проверки событие
   * не принимается (строка в журнал). Модели не уходит. Ядро ставит всегда.
   */
  emitAppEvent?(event: AppEvent): void;
}

/** Исход проверки ответа виджета; `void` — принять как есть. */
export type WidgetAnswerVerdict<Answer = unknown> = void | undefined | { answer: Answer } | { refuse: string };

/** Что проверка знает о вызове, когда проверяет не свой виджет: общая `agent.widgets.checkAnswer`. */
export interface WidgetCallInfo {
  toolName: string;
  toolCallId: string;
  input: unknown;
}

/** Какие виджеты включены у агента: `agent.widgets` в настройках обработчика чата. Нет настройки — виджетов нет. */
export interface AgentWidgetSettings {
  /** `true` — все пять базовых; список — только перечисленные. */
  basic?: true | BasicWidgetName[];
  /** Свои виджеты приложения. */
  custom?: WidgetDescription[];
  /**
   * Общая проверка ответа на сервере для всех виджетов без своей `checkAnswer`: базовых и своих. Те же исходы и тот же
   * `context`, что у `WidgetDescription.checkAnswer`.
   */
  checkAnswer?(call: WidgetCallInfo, answer: unknown, context: WidgetAnswerContext): WidgetAnswerVerdict | Promise<WidgetAnswerVerdict>;
  /**
   * Срок проверки ответа, мс: она держит чат занятым, зависшая не должна держать его вечно. По умолчанию 5 000. Держите
   * его заметно меньше срока запроса на странице (`requestTimeoutMs` у `AgentChat`, 10 000): иначе страница сдастся
   * раньше сервера и покажет сбой связи вместо отказа или ошибки проверки.
   */
  checkAnswerTimeoutMs?: number;
  /**
   * Какие виджеты включены в чате: имена базовых и своих виджетов. Нет — включены все. Выключенных модель не видит вовсе:
   * их нет среди инструментов запроса; прошлые вызовы выключенного виджета идут модели текстом, а не вызовом (строгий
   * провайдер не примет вызов инструмента, которого нет в запросе). Инструкцию под набор пишет приложение
   * (`chatInstructions`): ядро текст инструкции не меняет.
   *
   * Зовётся на каждый запрос к модели (ход, повтор, продолжение после ответа на виджет, сжатие) с данными чата к
   * началу хода. Синхронная и без побочных действий: те же данные — тот же набор. Иначе запрос меняется и кэш модели
   * сбрасывается; смена набора сама по себе тоже сбрасывает кэш — меняйте данные чата, от которых он зависит, редко.
   * Неизвестное имя — строка в журнал, имя пропускается; исключение — ошибка хода.
   */
  enabledFor?(input: WidgetSetInput): readonly string[];
}

/** Вход `AgentWidgetSettings.enabledFor`: чат, в котором идёт запрос. */
export interface WidgetSetInput {
  chat: {
    id: string;
    ownerId: string;
    /** Данные чата (`Chat.data`) к началу хода; нет данных — поля нет. */
    data?: Record<string, unknown>;
    /** Объект чата (`openSubjectChat`); обычный чат — поля нет. */
    subject?: ChatSubject;
  };
}
