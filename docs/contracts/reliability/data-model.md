# Data Model: Надёжность хода агента

Схема базы не меняется. Меняются типы ядра и то, что пишется в существующие поля.

## Вид ошибки

```ts
// packages/core/src/conversation/types.ts и копия в packages/react/src/chat-types.ts
type ChatErrorKind = "overloaded" | "rate_limited" | "insufficient_funds" | "invalid_key" | "context_overflow" | "other";
```

- Новый вид `context_overflow`. Пишется в `StoredMessage.error.kind` (JSON-поле, как остальные виды).
- Надпись: `labels.errors.context_overflow` = «Переписка не помещается в модель. Начните новый чат или выберите модель с большим окном» (`packages/react/src/labels.tsx`). Тандем показывает её через `labels.errors[kind]` без правки.
- Ломает исчерпывающий `switch` по виду у приложений → «ломает» в CHANGELOG `core` и `react`.

## Висящий вызов (часть сообщения)

| Состояние до | После `closeHangingToolCalls` |
|---|---|
| `input-available` | `output-error`, `errorText = HANGING_TOOL_CALL_REASON` |
| `output-available` с `preliminary: true` | `output-error`, тот же текст |
| `input-streaming` | без изменений (движок пропускает) |
| `approval-requested`, `approval-responded` | без изменений (их закрывает `denyPendingApprovals`) |
| `output-available`, `output-error`, `output-denied` | без изменений |

`HANGING_TOOL_CALL_REASON` лежит в `tool-approval/approval-parts.ts` рядом с остальными текстами для модели.

## Выполненные шаги ответа

`partsForContinuation(parts, { sameModel: boolean })`:

- берёт части до последней части-вызова с окончательным результатом (`output-available` без `preliminary`, `output-error`, `output-denied`) включительно;
- висящие вызовы внутри диапазона закрывает (таблица выше);
- `input-streaming` выбрасывает;
- при `sameModel = false` выбрасывает `reasoning` и вычищает `providerMetadata`, `callProviderMetadata`, `resultProviderMetadata`;
- нет ни одного вызова с окончательным результатом → `null` (продолжать нечего);
- вызов, уже закрытый текстом `HANGING_TOOL_CALL_REASON` (конец хода, восстановление) или отказом «ход прерван», считается законченным: действие могло выполниться, модель должна это видеть.

## Продолжение хода (вход `runAgentTurn`)

```ts
resume?: {
  message: AgentChatMessage;   // база продолжения: решения подтверждений или скопированные шаги
  usage: TokenUsage | null;    // расход до паузы; у копии для «Повторить» — null
  replay?: boolean;            // true — сначала отдать клиенту куски, воспроизводящие части message
}
```

- Подтверждение: `replay` нет, сообщение уже в базе и у клиента (как сейчас).
- «Повторить»: сообщение-сосед вставлено в базу `chat-service` со статусом `streaming`, `replay: true`.

## Сообщение ответа

| Поле | Что меняется |
|---|---|
| `parts` | при `stopped`/`error`/`interrupted` висящие вызовы закрыты текстом `HANGING_TOOL_CALL_REASON` |
| `providerId` | после перехода на запасного — провайдер, который реально ответил (`FinishedMessagePatch.providerId?`) |
| `error.kind` | может быть `context_overflow` |
| `usage` | у соседа-продолжения считается только его ход; `usage.estimated: true` — хоть один шаг прикинут по длине (FR-050, FR-051); у идущего ответа — весь расход сообщения: до паузы на подтверждение и ход с оценкой идущего шага (FR-052); там же `pendingSteps` — расход по шагам с провайдером каждого, у законченного ответа его нет |
| `parts` | `data-length-cut` (`data: true`) в конце — ответ оборван пределом длины (FR-054) |

`FinishedMessagePatch = { status } & Partial<Pick<StoredMessage, "parts" | "usage" | "reasoningDurationsMs" | "error" | "providerId">>`. Адаптеры SQLite, PostgreSQL и хранилище в памяти пишут его в существующий столбец `provider_id`. Свои хранилища приложений без поля продолжают работать: ответ останется с выбранным провайдером, расход в журнале — с фактическим.

## Настройки агента

```ts
interface AgentSettings {
  // …прежние поля
  /** Предел результата инструмента в знаках. По умолчанию 50 000, не меньше 1000. */
  toolResultMaxLength?: number | { default?: number; byTool?: Record<string, number> };
  /**
   * Запасные провайдеры той же модели при перегрузке и лимите до первого куска ответа.
   * По умолчанию — включены, порядок из `providerModelIds` модели (только провайдеры с ключом на сервере).
   */
  providerFallback?: false | { byModel?: Record<string, string[] | false> };
  /**
   * Срок ответа серверного инструмента, мс (FR-045). По умолчанию 120 000; 0 или Infinity — без предела.
   * Свой срок по имени — byTool (0 — без предела, например «спроси человека»).
   * Браузерные инструменты — по своему `browserToolTimeoutMs`.
   */
  toolTimeoutMs?: number | { default?: number; byTool?: Record<string, number> };
  /**
   * Сроки молчания потока модели, мс (FR-046). По умолчанию { firstChunkMs: 90 000, betweenChunksMs: 120 000 };
   * false — без предела; у срока 0 или Infinity — без него. Время работы инструмента не считается.
   */
  modelSilenceTimeout?: false | { firstChunkMs?: number; betweenChunksMs?: number };
  /** Серверные инструменты, которые идут по одному (FR-049): true — все, список — названные. */
  sequentialTools?: true | readonly string[];
  /** Запасной часовой пояс IANA для даты в запросе (FR-056), когда пояс браузера не пришёл или не настоящий. */
  timeZone?: string;
}
```

Запрос хода (`TurnRequestContext`, тело `messages`, `edit`, `regenerate`, `retry`, `approvals`) получает `timeZone?: string` — пояс браузера. Сервер берёт его, только если это строка; ядро проверяет, что это IANA-пояс.

Проверка в `createChatService`: срок ожидания не 0, не `Infinity` и не число от 1000 до 2³¹−1 → ошибка с именем настройки; `modelSilenceTimeout` не `false` и не объект → ошибка. Предел результата не число, не целое или меньше 1000 → ошибка; в `byModel` — неизвестный провайдер модели → ошибка с именем модели и провайдера.

## Строка журнала сбоя

Одна строка, только в `logError`:

```text
[сбой провайдера] чат=<chatId> модель=<modelId> провайдер=<providerId> вид=<kind> код=<HTTP или code> имя=<error.name> тело=<до 4000 знаков, секреты → [скрыто]>
[повтор] чат=… модель=… провайдер=… попытка=2 код=503 пауза=3412мс
[запасной провайдер] чат=… модель=… с=fireworks на=together причина=overloaded кэш потерян
[результат обрезан] чат=… инструмент=list_tasks знаков=184220 предел=50000
[переполнение] чат=… модель=… провайдер=… сжатие=начато|готово|нечего сжимать|не вышло
[автопродолжение] чат=… модель=… провайдер=… попытка=1 из 2 пауза=2310мс причина=overloaded знаков написано=1840
[инструмент не ответил] чат=… инструмент=slow_report срок=120000мс
[молчание модели] чат=… модель=… провайдер=… ждали=первый-кусок срок=90000мс
```

## Попытка хода (внутреннее)

```ts
type AttemptResult =
  | { outcome: "ok" }
  | { outcome: "aborted" }
  | { outcome: "failed"; kind: ChatErrorKind; error: unknown; contentSeen: boolean };

type NextAttempt =
  | { action: "fallback"; providerId: string }
  | { action: "compact-and-continue" }
  | { action: "auto-continue"; pauseMs: number }   // этап 6а, FR-037–FR-044
  | { action: "fail" };
```

Бюджеты на ход (раздельные): `fallbackUsed` (0/1), `overflowCompactionUsed` (0/1), `autoContinues` (0–2).

`contentSeen` — был ли в этом ходе хоть один содержательный кусок от модели (текст, рассуждение, вызов, `data-*`), с начала хода, а не попытки. Куски копии при «Повторить» (`replay`) не считаются.

## Автопродолжение (внутреннее, этап 6а)

- `AUTO_CONTINUE_NOTE` (`agent-run/auto-continue.ts`) дословно: «Ответ прервался из-за сбоя связи с моделью. Продолжи с того места, где оборвался текст выше: не повторяй уже написанное и не вызывай заново инструменты, у которых есть результат».
- `autoContinueNoteMessage(answerParts)`: сообщение `role: "user"` последним в запросе, в историю не пишется. Ответ оборвался на тексте — к пометке добавлены последние 80 знаков строкой JSON и просьба продолжить ровно со следующего знака.
- `hasAnswerContent(parts)`: в ответе для модели есть что-то кроме `step-start`. Нет — запрос как новый, без ответа и пометки.
- `messageForAutoContinue(message)` / `partsLeftOutOfAutoContinue(parts)`:
  - выбрасывает `reasoning` в состоянии `streaming`, если оно в конце после последней законченной части;
  - выбрасывает `input-streaming`;
  - текст `streaming` оставляет;
  - висящие вызовы закрывает `buildModelRequest`.
- `createOpenPartsTracker()`: `text-end` / `reasoning-end` по id незакрытых частей.
- `closingChunksForHangingCalls(parts)`: вызовы последнего шага. Запущенный без результата — `tool-output-error` с `HANGING_TOOL_CALL_REASON`; `input-streaming` — `tool-input-error` с `input: {}` и `UNSENT_TOOL_CALL_REASON` («Вызов оборвался: аргументы не дошли, инструмент не запускался»).
- `createSeamJoiner()` / `needsLineBreak(before, after)`: начало продолжения придерживается до 12 знаков; законченная строка нумерованного списка или таблицы + следующий элемент без переноса → перенос подставлен.
- `AUTO_CONTINUE_PAUSES_MS = [2000, 5000]`, разброс 0–25%. `retry-after` только удлиняет паузу, не больше 10 000 мс.

## Запись расхода (`UsageRecord`, этап 8)

| Поле | Что меняется |
|---|---|
| `estimated?` | `true` — числа «примерно»: шаг без чисел провайдера, шаг, оборванный «Стопом» или сбоем, или расход, записанный при восстановлении после перезапуска (FR-050–FR-052) |

Колонка `estimated` (`boolean`, по умолчанию `false`): SQLite — миграция `0011_usage_estimated`, PostgreSQL — `0010_usage_estimated`. Свои хранилища без колонки продолжают работать: пометка теряется, числа и деньги те же. `sumUsage` пометку не отдаёт: оценка считается в сумме вместе с остальными.

`UsageFilter` получает `messageId?` и `source?`: восстановление после перезапуска так узнаёт, что из расхода ответа уже в журнале, и пишет только разницу. Свои хранилища, которые не знают этих полей, вернут сумму шире — восстановление тогда запишет меньше, но не задвоит.

## Расход хода (внутреннее, этап 8)

`createTurnUsage` (`agent-run/turn-usage.ts`) хранит расход каждого шага всех попыток хода. Шаг с числами провайдера — как есть, без чисел — оценка по письму (`estimateTextTokens`: латиница, цифры, пробелы — токен на 3 знака; знаки препинания, кириллица, другие алфавиты — на 2; иероглифы, кана, хангыль, эмодзи — токен на знак): вход — запрос шага (инструкция, инструменты, сообщения; файл — 1600 токенов), но не меньше входа и выхода прошлого шага; из кэша — прошлый вход, если у прошлого шага было чтение из кэша; выход — написанное. Начатый и недописанный шаг попытки (видно по кускам `start-step` и написанному) входит в итог, только если в нём что-то написано. Итог — сумма шагов; размер контекста — по последнему шагу.

## Поправка расхода и «узнать расход генерации» (этап 8б)

| Что | Как |
|---|---|
| `UsageSource` | новое значение `answer_correction`: «настоящий расход минус оценка» оборванного шага (FR-058). Токены и деньги могут быть меньше нуля; пометки «примерно» нет; `createdAt` — начало хода, `messageId` — ответ |
| `TokenUsage.pendingSteps?` | `PendingStepUsage[]` — расход шагов идущего ответа с `providerId` каждого; только в идущей записи сообщения, для записи по провайдерам при восстановлении (FR-052) |
| `ProviderDescription.generationUsage?` | `GenerationUsage`: `generationId(headers)` — номер генерации из заголовков ответа; `lookup({ generationId, apiKey, fetch?, signal? })` — расход генерации или `null` («ещё не знаю»), другой отказ — ошибка. Есть у OpenRouter |

Колонка `source` — текст без ограничений: новое значение миграции не требует. Сумма записей ответа (`answer` + `answer_correction`) после сверки — настоящий расход.

## Знак жизни идущего ответа (этап 8в)

| Что | Как |
|---|---|
| `StoredMessage.alive?: "now" \| "released"` | знак жизни идущего ответа (FR-060), только для записи: время ставит само хранилище — PostgreSQL по `now()` базы, SQLite и память по часам машины; `"released"` — `RELEASED_ANSWER_ALIVE_AT` (`1970-01-01T00:00:00.000Z`), ответ брошен штатной остановкой (`flush`), следующий старт прерывает его сразу. `getMessage` и `listMessages` знак не отдают |
| `StreamingMessagePatch.alive?`, `AwaitingMessagePatch.alive?: "now"` | промежуточная запись и возврат в работу после подтверждения ставят знак; запись без поля его не стирает |
| `markAnswerAlive?(messageId)` | необязательный: пишет только знак «сейчас». Ответ уже не идёт — `MessageAlreadyFinishedError`. Нет метода — знак в тишине идёт полной записью |
| `listSilentAnswerIds?({ silentForMs, chatId? })` | необязательный: идущие ответы, у которых `coalesce(alive_at, created_at)` старше `silentForMs` по часам хранилища; `chatId` — только этого чата. Нет метода — служба при старте прерывает все идущие ответы (`listStreamingMessageIds()`), проверок дальше нет, в журнал — предупреждение |
| `ChatHistory.detachedAnswer` | последний ответ `streaming`, но его потока на этой копии нет: клиент перечитывает историю раз в 3 с, через 30 с показывает «прерван» сам |

Колонка `alive_at` (`text`, может быть пустой): SQLite — миграция `0012_message_alive_at`, PostgreSQL — `0011_message_alive_at`. Старые ответы без отметки сравниваются по времени создания. Общий набор проверок хранилища проверяет оба метода; без них тесты пропускаются.

Ход, чья запись получила `MessageAlreadyFinishedError` (ответ прервала другая копия), останавливается сам: ответ в базе не трогает, в журнал пишет расход сверх снимка в закрытом ответе (`usageMinusJournaled` с `getMessage().usage`), клиенту — «прерван» и `finish`. Восстановление кладёт в конечную запись ровно тот снимок, что пишет в журнал, а журнал читает до конечной записи: доля живого хода не вычитается и не задваивается. Повтор конечной записи, получивший `MessageAlreadyFinishedError`, сверяет ответ в базе: тот же статус и те же части — запись прошла, это успех.

Настройка вложений `AttachmentLimits.maxParallelImageFits` — одновременных ужатий картинок при загрузке (FR-062).
