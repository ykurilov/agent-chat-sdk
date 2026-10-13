# Data Model: виджеты, схемы, картинки, окно просмотра (024)

Схема базы не меняется. Новых обязательных операций хранилища нет (FR-033). Всё ниже живёт в частях сообщения агента (формат AI SDK `UIMessage`) и в файлах хранилища вложений.

## Вызов виджета (часть сообщения агента)

Обычная часть инструмента `tool-<имя>`:

| Поле | Значение |
|---|---|
| `type` | `tool-ask_choice`, `tool-ask_multi_choice`, `tool-ask_rating`, `tool-ask_form`, `tool-suggest_replies` или `tool-<имя своего виджета>` |
| `toolCallId` | id вызова от модели; адрес ответа |
| `input` | вход виджета (ниже) |
| `state` | `input-available` — ждёт; `output-available` — отвечен или закрыт сообщением; `output-error` — негодный вход (модель видит ошибку, виджет не показан) |
| `output` | ответ (ниже) |

### Входы базовых виджетов

| Виджет | Вход | Пределы |
|---|---|---|
| `ask_choice` | `{ question, options: string[] }` | вопрос 1–300 знаков; 2–8 вариантов по 1–80, без повторов |
| `ask_multi_choice` | `{ question, options: string[], min?, max? }` | как выше; `1 ≤ min ≤ max ≤ options.length`, по умолчанию `min=1`, `max=options.length` |
| `ask_rating` | `{ question, scale: "stars" } \| { question, scale: "range", from: 0\|1, to: 2..10, fromLabel?, toLabel? }` | подписи до 40 знаков |
| `ask_form` | `{ title, fields: Field[] }`, `Field = { name, label, kind: "text"\|"number"\|"date"\|"select", required?, min?, max?, options?, multiline? }` | 1–5 полей; `name` — латиница/цифры/`_`, без повторов; `select` — 2–8 вариантов; `number` — `min ≤ max`; `date` — `YYYY-MM-DD`, `min`/`max` датами |
| `suggest_replies` | `{ replies: string[] }` | 1–4 по 1–60 знаков |

### Ответы (результат вызова, то, что видит модель)

| Виджет | `output` |
|---|---|
| `ask_choice` | `{ "выбрано": "<вариант>" }` |
| `ask_multi_choice` | `{ "выбрано": ["<вариант>", …] }` — в порядке вариантов |
| `ask_rating` | `{ "оценка": <целое> }` |
| `ask_form` | `{ "поля": { "<name>": <строка \| число \| "YYYY-MM-DD" \| вариант> } }` — необязательные пустые поля опускаются; текст до 2000 знаков |
| свой виджет | значение по `answerSchema`, JSON ≤ 16 КБ |
| любой ждущий, закрытый сообщением | `{ "ответ": "сообщением" }` |
| `suggest_replies` | `"показано"` |

Признак «закрыт сообщением» экран берёт из этого же `output` — отдельного поля нет.

### Состояния ждущего виджета

```text
input-available ──ответ (POST)──────────────▶ output-available {ответ}
       │
       ├──сообщение человека (send/edit)─────▶ output-available {"ответ":"сообщением"}
       │
       └──негодный вход (проверка схемы)─────▶ output-error (модель видит причину, ход идёт дальше)
```

Активен только вызов в `input-available` в последнем ответе текущей ветки со статусом `awaiting_approval`. В остальных ветках ждущий виджет виден, но не нажимается (FR-007, Edge Cases).

### Ответ агента, который ждёт

`StoredMessage.status = "awaiting_approval"` — «ждёт человека»: есть хотя бы один запрос подтверждения или вызов ждущего виджета без результата. Продолжение — когда ждущих не осталось. `updateAwaitingMessage(messageId, { parts, status?, alive? })` — без изменений.

### Гонка двух копий

В шаге ждёт не больше одного виджета: лишние ждущие вызовы того же шага сразу получают `output-error` «Задавай один вопрос за раз». Внутри копии ответы чата идут по очереди (`whileStarting`). Между копиями защищает условная запись `updateAwaitingMessage` (только из `awaiting_approval`): ответ, закрывающий последнее ожидание, переводит статус в `streaming`, и вторая запись не проходит → 409. Если вместе с виджетом ждёт запрос подтверждения, статус после ответа остаётся `awaiting_approval`; тогда работает правило 022 «запросы одного чата — на одной копии». Контрактный тест SC-003 — для одиночного виджета на двух службах поверх одного хранилища.

## Свой виджет (описание)

| Поле | Значение |
|---|---|
| `name` | имя инструмента: `^[a-z][a-z0-9_]{0,63}$`, не начинается с `ask_`/`suggest_` |
| `description` | описание для модели |
| `inputSchema` | схема входа (Zod или JSON Schema, как у `tool()`) |
| `answerSchema` | схема ответа; сервер проверяет ею |
| `question?(input)` | короткий текст для запасного вида и голоса |

Страница: `widgets: { [name]: ComponentType<CustomWidgetProps> }`.

## Схема

Блок ` ```mermaid ` в тексте ответа. Не хранится отдельно. Вид для скина: `{ source, state: "streaming" | "ready" | "failed", svg? }`.

## Модель картинок и провайдер

```ts
interface ImageProviderDescription {
  id: string;                 // "runware"
  displayName: string;
  apiKeyEnv: string;          // "RUNWARE_API_KEY"
  baseURL?: string;           // по умолчанию https://api.runware.ai/v1
  headers?: Record<string, string>;
  generate(request: ImageGenerationRequest, connection): Promise<ImageGenerationResult[]>;
}
interface ImageModelProfile {
  id: string;                               // "gpt-image-2"
  displayName: string;
  providerModelIds: Record<string, string>; // { runware: "openai:gpt-image@2" }
  aspectRatios: Record<AspectRatio, { width: number; height: number }>;
  providerSettings?: Record<string, unknown>;
  pricePerImageUsd: number;                 // запасная цена (нет cost в ответе, «Стоп»)
}
type AspectRatio = "1:1" | "3:2" | "2:3" | "16:9" | "9:16";
```

Каталог правится как каталог ядра: `extendImageCatalog(base, { removeModels, addModels, addProviders, connectProviders })`.

## Вход и итог инструмента картинок

- Вход `generate_images`: `{ prompt: 2..2000 знаков, count: 1..8, aspectRatio: AspectRatio = "1:1" }`.
- Итог (результат вызова, видит модель): `{ "создано": 2, "заказано": 3, "картинки": [{ "номер": 1, "id": "<uuid>" }, …], "ошибки": [{ "номер": 2, "причина": "…" }] }`, при «Стопе» — `"остановлено": true`.
- Картинка: файл `StoredAttachment { kind: "image", attached: true, chatId, ownerId, name: "image-<n>.<ext>", mediaType, size }`; ширина и высота — в итоге вызова для заглушек и окна просмотра.

## Расход

`UsageRecord { source: "images", modelId: "<id модели картинок>", providerId: "runware", costUsd, messageId: null, все токены 0 }` — одна запись на картинку.

## Элемент окна просмотра

```ts
type MediaViewerItem =
  | { kind: "image"; key: string; src: string; alt: string; width?: number; height?: number }
  | { kind: "diagram"; key: string; svg: string; source: string };
```

`key` — id вложения или `messageId:номер блока`: по нему возвращается фокус.
