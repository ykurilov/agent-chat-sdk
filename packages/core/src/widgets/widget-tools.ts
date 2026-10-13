import { asSchema, tool } from "ai";
import type { ToolSet } from "ai";
import type { AgentToolsModel, AgentToolsSource } from "../agent-run/run-agent-turn";
import { BASIC_WIDGET_NAMES, basicWidgetTool, checkBasicWidgetAnswer } from "./basic-widgets";
import type { WidgetAnswerCheck } from "./basic-widgets";
import { logValue } from "../text/log-value";
import { defineWidget } from "./define-widget";
import type { WidgetAnswerCheckFunction } from "./widget-answer-check";
import type { AgentWidgetSettings, BasicWidgetName, WidgetDescription, WidgetSetInput } from "./widget-types";

/** Самый большой ответ на виджет в JSON, байт: как у браузерных инструментов. */
export const WIDGET_ANSWER_MAX_BYTES = 16 * 1024;

/** Срок проверки ответа приложением по умолчанию, мс. */
const DEFAULT_WIDGET_CHECK_TIMEOUT_MS = 5000;

/** Виджеты агента из `agent.widgets`, проверенные при создании службы. */
export interface AgentWidgets {
  /** Инструменты виджетов по имени; нет настройки — пусто. */
  tools: ToolSet;
  /** Имена ждущих виджетов: их вызов без результата ставит ход на паузу. Подсказок здесь нет. */
  waiting: ReadonlySet<string>;
  /**
   * Ответ человека на вызов ждущего виджета `toolName` с входом `input`: базовый — по входу вызова, свой — по
   * `answerSchema`; JSON больше 16 КБ — отказ. Годный — с ответом, каким его увидит модель.
   */
  checkAnswer(toolName: string, input: unknown, answer: unknown): Promise<WidgetAnswerCheck>;
  /** Проверка ответа приложением (`checkAnswer` приложения): своя у виджета, иначе общая; нет ни той, ни другой — `undefined`. */
  appCheckOf(toolName: string): WidgetAnswerCheckFunction | undefined;
  /** Срок проверки приложения, мс. */
  checkTimeoutMs: number;
  /** Виджеты, которые чат может выключить (`enabledFor`): все имена; нет `enabledFor` — пусто. */
  switchable: ReadonlySet<string>;
  /** Инструменты виджетов, включённых в чате запроса: по `enabledFor`, без него — все. Неизвестное имя — строка в журнал. */
  toolsFor(model: AgentToolsModel, logError: (message: string) => void): ToolSet;
}

const REJECTED: WidgetAnswerCheck = { ok: false };

/** Сколько разных неизвестных имён из `enabledFor` пишется в журнал: дальше — одна строка и тишина. */
const UNKNOWN_WIDGET_NAMES_LOGGED = 100;

/** Виджеты по настройке агента. Чужой базовый, негодное имя своего или повтор имени — исключение. */
export function createAgentWidgets(settings: AgentWidgetSettings | undefined): AgentWidgets {
  const basic = settings?.basic === true ? BASIC_WIDGET_NAMES : (settings?.basic ?? []);
  for (const name of basic) {
    if (!BASIC_WIDGET_NAMES.includes(name)) throw new Error(`Базового виджета «${String(name)}» нет: есть ${BASIC_WIDGET_NAMES.join(", ")}`);
  }
  const custom = new Map<string, WidgetDescription>();
  for (const widget of settings?.custom ?? []) {
    defineWidget(widget);
    if (custom.has(widget.name)) throw new Error(`Свой виджет «${widget.name}» задан дважды`);
    custom.set(widget.name, widget);
  }
  const unsorted: ToolSet = Object.fromEntries([
    ...basic.map((name) => [name, basicWidgetTool(name)] as const),
    ...[...custom.values()].map((widget) => [widget.name, tool({ description: widget.description, inputSchema: widget.inputSchema })] as const),
  ]);
  const tools = Object.fromEntries(Object.entries(unsorted).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
  const checkTimeoutMs = settings?.checkAnswerTimeoutMs ?? DEFAULT_WIDGET_CHECK_TIMEOUT_MS;
  if (!Number.isInteger(checkTimeoutMs) || checkTimeoutMs < 1) throw new Error("agent.widgets.checkAnswerTimeoutMs — целое число миллисекунд больше нуля");
  const generalCheck = settings?.checkAnswer;
  const basicNames = new Set<string>(basic);
  const waiting = new Set(Object.keys(tools).filter((name) => name !== "suggest_replies"));
  const enabledFor = settings?.enabledFor;
  if (enabledFor !== undefined && typeof enabledFor !== "function") throw new Error("agent.widgets.enabledFor — функция чата, которая возвращает имена включённых виджетов");
  const switchable: ReadonlySet<string> = new Set(enabledFor ? Object.keys(tools) : []);
  // Неизвестное имя — одна строка в журнал на имя: набор спрашивается на каждый запрос. Имён в памяти не больше предела.
  const reportedUnknown = new Set<string>();

  return {
    tools,
    waiting,
    checkTimeoutMs,
    switchable,
    toolsFor(model, logError) {
      if (!enabledFor) return tools;
      const enabled = new Set(enabledFor({ chat: widgetSetChat(model) }));
      for (const name of enabled) {
        if (Object.hasOwn(tools, name) || reportedUnknown.has(name) || reportedUnknown.size > UNKNOWN_WIDGET_NAMES_LOGGED) continue;
        reportedUnknown.add(name);
        if (reportedUnknown.size > UNKNOWN_WIDGET_NAMES_LOGGED) {
          logError(`agent.widgets.enabledFor вернула больше ${UNKNOWN_WIDGET_NAMES_LOGGED} неизвестных имён: дальше они пропускаются молча`);
          continue;
        }
        logError(`agent.widgets.enabledFor вернула неизвестный виджет «${logValue(String(name).slice(0, 100))}» (чат ${logValue(model.chatId)}): имя пропущено`);
      }
      return Object.fromEntries(Object.entries(tools).filter(([name]) => enabled.has(name)));
    },
    appCheckOf(toolName) {
      const own = custom.get(toolName);
      if (own?.checkAnswer) return (answer, context) => own.checkAnswer!(answer, context);
      if (!generalCheck) return undefined;
      return (answer, context) => generalCheck({ toolName: context.toolName, toolCallId: context.toolCallId, input: context.input }, answer, context);
    },
    async checkAnswer(toolName, input, answer) {
      if (!waiting.has(toolName) || !fitsAnswerSize(answer)) return REJECTED;
      if (basicNames.has(toolName)) return checkBasicWidgetAnswer(toolName as BasicWidgetName, input, answer);
      // Схема без своей проверки (`jsonSchema` без `validate`) пропускает любой ответ — как вход такого инструмента в SDK.
      const validate = asSchema(custom.get(toolName)!.answerSchema).validate;
      if (!validate) return { ok: true, output: answer };
      try {
        const result = await validate(answer);
        return result.success ? { ok: true, output: result.value } : REJECTED;
      } catch {
        return REJECTED;
      }
    },
  };
}

/**
 * Инструменты виджетов рядом с инструментами приложения: и ответ, и сжатие видят один набор (кэш). Без виджетов — тот же
 * источник, что был; с `enabledFor` — функция: набор виджетов выбирается по чату запроса. Повтор имени: у набора — исключение сразу, у функции — ошибка хода и строка в журнал.
 */
export function withWidgetTools(
  tools: AgentToolsSource | undefined,
  widgets: AgentWidgets,
  logError: (message: string) => void,
): AgentToolsSource | undefined {
  const widgetNames = Object.keys(widgets.tools);
  if (widgetNames.length === 0) return tools;
  const clashMessage = (name: string) => `Инструмент «${name}» задан и приложением, и виджетом: переименуйте инструмент приложения`;
  const clash = (own: ToolSet) => widgetNames.find((name) => Object.hasOwn(own, name));
  if (typeof tools !== "function") {
    const name = clash(tools ?? {});
    if (name) throw new Error(clashMessage(name));
    if (widgets.switchable.size === 0) return { ...tools, ...widgets.tools };
    return (model) => ({ ...tools, ...widgets.toolsFor(model, logError) });
  }
  return (model) => {
    const own = tools(model);
    const name = clash(own);
    if (name) {
      logError(clashMessage(name));
      throw new Error(clashMessage(name));
    }
    return { ...own, ...widgets.toolsFor(model, logError) };
  };
}

function widgetSetChat(model: AgentToolsModel): WidgetSetInput["chat"] {
  return {
    id: model.chatId,
    ownerId: model.ownerId,
    ...(model.chat?.data && { data: model.chat.data }),
    ...(model.subject && { subject: model.subject }),
  };
}

function fitsAnswerSize(answer: unknown): boolean {
  const json = JSON.stringify(answer) as string | undefined;
  return json !== undefined && new TextEncoder().encode(json).length <= WIDGET_ANSWER_MAX_BYTES;
}
