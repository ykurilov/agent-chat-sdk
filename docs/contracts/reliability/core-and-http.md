# Договор: ядро, react и HTTP (022)

## Ядро (`@ykurilov/agent-chat-core`)

```ts
/** Ломает: новый вид `context_overflow`. */
export type ChatErrorKind = "overloaded" | "rate_limited" | "insufficient_funds" | "invalid_key" | "context_overflow" | "other";

export interface AgentSettings {
  // … прежние поля без изменений
  /**
   * Предел результата инструмента, знаков (строка как есть, остальное — JSON). Длиннее — начало и пометка
   * «[Результат обрезан: показано N из M знаков]», в журнал сервера строка без содержимого.
   * По умолчанию 50 000, не меньше 1000. Браузерные инструменты дополнительно режутся до 16 КБ, как раньше.
   * Новое в 022.
   */
  toolResultMaxLength?: number | { default?: number; byTool?: Record<string, number> };
  /**
   * Запасные провайдеры той же модели: при перегрузке или лимите после тихих повторов, если ход ещё не получил
   * ни одного куска ответа, ход один раз идёт к следующему провайдеру с ключом на сервере.
   * Не задано — включено, порядок из `providerModelIds` модели. `false` — выключено. `byModel[modelId]` — свой порядок
   * (провайдеры этой модели) или `false` для модели. Новое в 022.
   */
  providerFallback?: false | { byModel?: Record<string, string[] | false> };
}

/** Текст для модели вместо результата прерванного вызова. Новое в 022. */
export const HANGING_TOOL_CALL_REASON: string;

/**
 * Обрезка без половинок эмодзи: результат не длиннее `maxLength` и не кончается высоким суррогатом.
 * Для пакетов-расширений (веб-инструменты). Новое в 022.
 */
export function cutAtCharBoundary(text: string, maxLength: number): string;

export interface FinishedMessagePatch {
  status: FinalAnswerStatus;
  parts?: …; usage?: …; reasoningDurationsMs?: …; error?: …;
  /** Провайдер, который реально ответил (после перехода на запасного). Новое в 022. */
  providerId?: string;
}
```

`ChatService` — без новых методов. Меняется поведение:

| Метод | Было | Стало |
|---|---|---|
| `retry` | всегда новый ответ-сосед с нуля | если у прежнего ответа (`error`, `interrupted`, `stopped`) есть вызов с результатом — сосед начинается с выполненных шагов, ход продолжается; иначе как было |
| `recoverInterruptedAnswers` | закрывает только подтверждения | ещё и висящие вызовы, текстом `HANGING_TOOL_CALL_REASON` |
| `sendMessage`, `editMessage`, `regenerate`, `answerApproval` | — | висящие вызовы старой истории закрываются в запросе, база не меняется |

Ошибки `createChatService` (новые): `toolResultMaxLength` не целое или меньше 1000; `providerFallback.byModel` с провайдером, которого нет у модели.

`ChatStorage` — договор тот же, плюс необязательное поле `providerId` в `finishMessage`. Свои хранилища, которые его не пишут, работают по-прежнему.

## Поток хода (UI-куски)

- Ответ на `/retry`-продолжение: `start` (id нового ответа, `modelId`, `providerId`) → куски, воспроизводящие скопированные части (`start-step`, `tool-input-available`, `tool-output-available|tool-output-error`, `text-*`, `reasoning-*`, `data-*`, `finish-step`) → обычные куски хода → итог. Переподключение получает то же с начала.
- Итоговый `message-metadata` может нести `providerId` (если ответил запасной).
- Кусок `error` несёт вид, в том числе `context_overflow`. Сырого текста провайдера в потоке нет.
- Автопродолжение (FR-037–FR-044) нового вида кусков не даёт. Сначала идут `text-end` / `reasoning-end` для незакрытых частей. После паузы (на ней идут только `: ping` сервера) — обычные куски шага того же сообщения, без второго `start`.
- Сжатие при переполнении внутри хода нового куска не даёт: поток просто идёт дольше. Признак «идёт сжатие» в `GET history` (`compacting`) выставляется как у обычного сжатия.

## HTTP (`@ykurilov/agent-chat-server`)

Маршруты не меняются. `POST {chat}/retry` отвечает потоком нового ответа, как раньше. Новых полей в телах запросов нет.

## React (`@ykurilov/agent-chat-react`)

```ts
/** Ломает: новый вид. */
export type ChatErrorKind = … | "context_overflow" | …;

export interface ChatLabels {
  errors: Record<ChatErrorKind, string>; // + context_overflow: «Переписка не помещается в модель. Начните новый чат или выберите модель с большим окном»
}
```

Своя таблица надписей приложения без `context_overflow` — ошибка типов (MINOR 0.x, запись «ломает»). Кнопка «Повторить» под ошибкой работает как раньше: у `context_overflow` она тоже есть. После повтора сжатая история может уже влезть.

## Скины

Договор скина не меняется. Тандем показывает `labels.errors[kind]`.
