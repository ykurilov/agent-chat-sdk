# Договор: пакет `@ykurilov/agent-chat-images` (US5)

Необязательный пакет. Зависит от `@ykurilov/agent-chat-core` (типы, `UsageSource`) и `@ykurilov/agent-chat-attachments` (хранилище и отдача файлов). Вход `./react` — для экрана; `react` и `@ykurilov/agent-chat-react` — необязательные peer-зависимости, как у вложений.

## Сервер

```ts
import { createImageGeneration, imageToolTimeoutMs, standardImageCatalog, extendImageCatalog } from "@ykurilov/agent-chat-images";

const images = createImageGeneration({
  attachments,                       // тот же объект createAttachments: из него берётся AttachmentStorage
  env: process.env,                  // ключ провайдера по apiKeyEnv; больше ниоткуда
  catalog?: ImageCatalog,            // по умолчанию standardImageCatalog
  model?: string,                    // по умолчанию "gpt-image-2"
  provider?: string,                 // по умолчанию первый провайдер модели
  spending?: {
    storage: Pick<ChatStorage, "insertUsageRecord">,
    limits?: Pick<SpendingLimits, "assertWithinLimit">,
  },
  maxImageBytes?: number,            // по умолчанию 10 МБ на файл
  requestTimeoutMs?: number,         // одна генерация, по умолчанию 150 000
  fetch?: typeof globalThis.fetch,   // для тестов и записи живых проверок
  logError?: (message: string) => void,
});

createChatHandler({
  …,
  attachments,
  agent: {
    tools: (model) => ({ ...appTools(model), ...images.tools(model) }),
    toolTimeoutMs: { byTool: { generate_images: imageToolTimeoutMs } }, // 180 000
  },
});
```

- `images.tools(model)` → `{ generate_images }`; без `ownerId`/`chatId` в `model` — пустой набор (нечего сохранять и некому писать расход).
- Ошибка настройки (нет модели в каталоге, у модели нет провайдера, нет ключа в `env`) — исключение при `createImageGeneration`, а не при первом вызове.
- Описание и схема инструмента постоянны: не зависят от модели, человека и времени (кэш).

## Инструмент `generate_images`

Вход: `{ prompt: string (2..2000), count: 1..8 = 1, aspectRatio: "1:1" | "3:2" | "2:3" | "16:9" | "9:16" = "1:1" }`.

Порядок вызова:

1. `limits.assertWithinLimit({ userId: ownerId, chatId })`; отказ → результат `{ "отказ": "лимит расходов исчерпан" }`, генерации нет.
2. `count` задач провайдеру параллельно, у каждой свой `taskUUID`, срок `requestTimeoutMs`, общий `abortSignal` вызова.
3. Каждая готовая задача: скачать по адресу провайдера (тот же `fetch`, без заголовков прокси к чужому хосту), проверить тип по содержимому (PNG, JPEG, WebP) и размер ≤ `maxImageBytes`, сохранить `AttachmentStorage.save({ id: uuid, chatId, ownerId, name: "image-<n>.<ext>", kind: "image", attached: true, … }, bytes)`.
4. Расход — запись на каждую отправленную задачу: `cost` из ответа, иначе `pricePerImageUsd`. Задача, отклонённая провайдером до работы (неверный ключ, нет денег, неверные параметры), расхода не пишет.
5. Результат вызова (data-model, «Вход и итог»). Хотя бы одна картинка — успех; ни одной — тоже результат (не исключение) с причинами, чтобы модель могла ответить человеку.

«Стоп» (`abortSignal`): ожидание обрывается, пришедшие после «Стопа» картинки не сохраняются, ушедшие задачи пишутся в расход по цене модели; ход останавливается как обычно.

## Провайдер Runware

`POST ${baseURL ?? "https://api.runware.ai/v1"}`, заголовки `Authorization: Bearer <ключ>`, `Content-Type: application/json` и `headers` подключения. Тело — массив из одной задачи:

```json
[{ "taskType": "imageInference", "taskUUID": "<uuid>", "model": "<id у Runware>", "positivePrompt": "<prompt>",
   "width": 816, "height": 816, "numberResults": 1, "outputType": "URL", "outputFormat": "JPG",
   "deliveryMethod": "sync", "includeCost": true, "providerSettings": { "openai": { "quality": "low" } } }]
```

Настройки модели (`providerSettings` или `settings`) — из профиля. Ответ: `data[0].imageURL`, `data[0].cost`; `errors[]` — причина для модели (код и короткий текст, без ключа и заголовков). Ключ и значения `headers` вычищаются из всех текстов ошибок и журналов.

## Каталог

```ts
extendImageCatalog(standardImageCatalog, {
  removeModels?: string[],
  addModels?: ImageModelProfile[],
  addProviders?: ImageProviderDescription[],
  connectProviders?: Record<string, { baseURL?: string; headers?: Record<string, string> }>, // прокси, как в 0.15
});
```

Стандартные модели: `gpt-image-2` (по умолчанию), `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `seedream-5-flash`, `seedream-5-lite` — id и настройки — в `packages/images/src/image-catalog.ts`.

## Экран

```tsx
import { imagesClient } from "@ykurilov/agent-chat-images/react";
<AgentChat … attachments={attachmentsClient} images={imagesClient} />
```

`imagesClient` сообщает слою поведения имя инструмента (`generate_images`) и превращает часть вызова в `GeneratedImagesView` для скина (договор скина v13): заглушки на `count` при `input-available`, картинки с адресами `{api}/{chatId}/attachments/{id}`, пометки упавших и «остановлено». Без `images` вызов показан обычной строкой инструмента.

## Ключ для живых проверок

`scripts/load-secrets.mjs` пишет `RUNWARE_API_KEY` в `.env.local` из `~/.claude/secrets/runware.env` (переопределение — `RUNWARE_API_KEY_FILE`). Значение не выводится.
