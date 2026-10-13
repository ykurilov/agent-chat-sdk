# @ykurilov/agent-chat-images

Картинки от агента: инструмент `generate_images` через Runware или KIE.ai, файлы в хранилище вложений. Отдельное расширение: приложению
без картинок пакет не нужен. Требует `@ykurilov/agent-chat-attachments`.

Серверу без экрана React не нужен: `react` и `@ykurilov/agent-chat-react` — необязательные зависимости (peer). Для
`@ykurilov/agent-chat-images/react` оба должны стоять в приложении.

## Сервер

```ts
import { createImageGeneration } from "@ykurilov/agent-chat-images";

const images = createImageGeneration({
  attachments,                 // тот же объект createAttachments
  env: process.env,            // ключ RUNWARE_API_KEY — только отсюда
  spending: { storage, limits }, // расход картинок в лимиты; без него не учитывается
});

createChatHandler({
  …,
  attachments,
  agent: {
    tools: (model) => ({ ...appTools(model), ...images.tools(model) }),
  },
});
```

- По умолчанию GPT Image 2 в низком качестве. Ещё в каталоге: `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`,
  `seedream-5-flash`, `seedream-5-lite` (`model: "…"`).
- От 1 до 8 картинок за вызов, параллельно. Упала часть — удачные всё равно в чате, модель видит причины упавших.
- Цена каждой картинки (из ответа Runware, иначе `pricePerImageUsd` модели) пишется расходом `images`.
- Ошибка настройки (нет модели, провайдера или ключа) — исключение сразу при `createImageGeneration`.
- KIE.ai (`KIE_API_KEY`): `z-image`, `seedream-5-flash-kie` и разделение на слои `seedream-5-flash-layers`. Не успела к сроку —
  опрос идёт в фоне, повтор того же вызова не платит заново, о поздней картинке сообщает `onLateImage`.
- `quality` и `transparentBackground` — для GPT Image у Runware (прозрачный фон — только 2.5); `size: "1k"` — длинная сторона около 1024; `output: { format, maxSide }` — формат и размер файла (sharp).
- `purposes`: приложение задаёт назначения (имя → модель и описание), агент выбирает параметром `purpose`;
  `removeBackground` делает предмет без фона.

Свои модели, провайдеры и прокси:

```ts
const catalog = extendImageCatalog(standardImageCatalog, {
  addModels: [myModel],
  addProviders: [myProvider],
  connectProviders: { runware: { baseURL: "https://proxy.example/runware/v1", headers: { "x-proxy-token": token } } },
});
createImageGeneration({ attachments, env: process.env, catalog, model: "my-model" });
```

Ключ и значения `headers` вычищаются из причин сбоя и журнала.

### Ход не ждёт картинку

```ts
const images = createImageGeneration({
  attachments, env: process.env, spending: { storage, limits },
  mode: "background",                             // инструмент отвечает сразу, картинка приходит позже
  jobStore: sqliteImageJobStore("./data/chat.db"), // задачи переживают перезапуск; без него — в памяти
  onLateImage: ({ chatId, attachmentId }) => showInChat(chatId, attachmentId),
});
// при остановке сервера, до закрытия базы:
await images.stop();
```

- `deliver(image, delivery, ctx)` — картинка уходит приложению, а не во вложения (и в режиме `wait` тоже). Ответ приёмника модель видит в `результат`. Запись — условная, по `ctx.isCurrent()` (см. ниже).
- `maxImagesPerTurn` — не больше N картинок за ход агента. Повтор хода и запасной провайдер счёт не обнуляют.
- `pollIntervalMs`, `attempts`, `onQueued` — шаг опроса, число попыток и поля для ответа модели (только в фоне).

## Картинки в файлы приложения

Свой инструмент агента и своя очередь: картинка записывается файлом в собираемое приложение. Заказ отвечает сразу,
картинка приходит в `deliver` через несколько секунд или минут. Задачи лежат в базе: после перезапуска сервера очередь
сама допроверит их у провайдера, запишет расход ровно один раз и доставит картинку.

```ts
import { createImageQueue } from "@ykurilov/agent-chat-images";
import { sqliteImageJobStore } from "@ykurilov/agent-chat-images/sqlite";

const imageQueue = createImageQueue({
  env: process.env, // KIE_API_KEY
  purposes: {
    plain: { model: "z-image" },
    with_text: { model: "seedream-5-flash-kie" },
    no_background: { model: "z-image", removeBackground: { model: "seedream-5-flash-layers" } },
  },
  store: sqliteImageJobStore("./data/app.db"), // или postgresImageJobStore(pool) из "/postgres"
  spending: { storage, limits },
  pollIntervalMs: 3_000,     // проверять задачу каждые 3 с
  attemptTimeoutMs: 90_000,  // одна попытка — до 90 с
  attempts: 2,               // вторая попытка ждёт ту же задачу, не платит заново
  maxImagesPerTurn: 3,
  async deliver(image, job, ctx) {
    const { appId, path } = job.data as { appId: string; path: string };
    // Заглушку уже заменили — картинка не нужна: задача «отброшена», без ошибки.
    if (!(await isPlaceholder(appId, path))) return false;
    // Пока шли проверки, на этот файл могли заказать новую картинку: старая его не перезаписывает.
    if (!(await ctx.isCurrent())) return false;
    await writeAppFile(appId, path, image.bytes, { signal: ctx.signal });
    return { path }; // сохраняется в задаче: job.result
  },
});

// Инструмент агента:
const placeImage = (model: { ownerId: string; chatId: string; turnId?: string }) =>
  tool({
    description: "Заказать картинку для файла приложения",
    inputSchema: z.object({ appId: z.string(), path: z.string(), prompt: z.string(), purpose: z.enum(["plain", "with_text", "no_background"]) }),
    execute: async ({ appId, path, prompt, purpose }) =>
      imageQueue.order({
        ownerId: model.ownerId, chatId: model.chatId, turnId: model.turnId,
        key: `${appId}/${path}`, // новый заказ на тот же файл заменяет прежний, прежний ничего больше не заказывает
        group: appId,             // imageQueue.list({ group: appId }) — все картинки приложения
        purpose, prompt, aspectRatio: "16:9", data: { appId, path },
      }),
  });

// Кнопка «Повторить» у картинки, которая не получилась:
await imageQueue.retry({ ownerId, key: `${appId}/${path}` });
// Остановка сервера, до закрытия базы:
await imageQueue.stop();
```

- Ответ `order` — задача со статусом `generating` или отказ `{ status: "refused", reason }` (лимит расходов, предел хода).
  Дальше статус: `ready`, `failed` (с `reason`), `superseded` (заменена новым заказом), `discarded` (приёмник вернул `false`).
- «Повторить» не платит за то, что уже оплачено: идущая задача проверяется, готовая скачивается с того же адреса,
  у двухшаговой картинки (без фона) первый шаг не заказывается заново. Два нажатия подряд дают одну задачу.
- Каждое обращение к провайдеру ограничено сроком (`callTimeoutMs`, 30 с). Скачивание повторяется 3 раза.
- Приёмник могут позвать повторно (сервер упал между записью файла и отметкой «готово»): запись в тот же путь безопасна.
- Пока приёмник работает, задачу могут вытеснить новым заказом на то же место. Поэтому запись файла — условная:
  прямо перед ней `await ctx.isCurrent()`, `false` — не писать и вернуть `false`. `ctx.signal` срабатывает при вытеснении,
  «Повторить» и `stop()` — им удобно обрывать долгую обработку.
- `pendingUsd(ownerId, chatId)` — заказанное, но ещё не оплаченное: лимит видит параллельные заказы сразу.
- Провайдер без очереди (Runware) не сообщает «принял»: `order` ждёт его ответа не дольше `acceptWaitMs` (5 с).
  Отказ (неверный ключ, нет денег) приходит раньше — заказ сразу «не получилась».
- Открытая задача на место (`ownerId` + `key`) — одна, это держит база (уникальный индекс): два заказа на одно место
  с двух копий сервера не дают двух платных задач. Своё хранилище задач должно бросать `ImageJobKeyTakenError`.
- Сбой записи расхода (база недоступна) не теряет его: задача остаётся с работой, обход хранилища допишет расход.
  Хранилище чатов с `hasUsageRecord` отличает «уже записано» от «не записалось» надёжнее, чем по коду ошибки.

Допущения:

- Часы копий сервера не должны расходиться больше чем на `leaseMs` (30 с): по ним видно, что аренда истекла.
- Доставка — «хотя бы один раз»: после сбоя сервера между приёмником и отметкой «готово» приёмника зовут снова.
- Между приёмом результата у провайдера и записью расхода есть короткое окно, когда эта сумма не видна лимиту ни как
  заказанная, ни как потраченная: обычно доли секунды, при сбое записи расхода — до следующего обхода (`leaseMs`).
- Подсказка разделения фона доступна как `DEFAULT_REMOVE_BACKGROUND_PROMPT`.

## Экран

```tsx
import { imagesClient } from "@ykurilov/agent-chat-images/react";

<AgentChat … attachments={attachmentsClient} images={imagesClient} />
```

Скину нужен `GeneratedImages` (договор скина, версия 13); в Тандеме он есть. Клик открывает картинку в окне просмотра, в
карусели все картинки чата. Без `images` или без `GeneratedImages` вызов показан обычной строкой инструмента.

Подробно — [docs/images.md](../../docs/images.md): модели и цены, назначения, KIE и поздний результат, расход, прокси, экран.
Живая проверка: `pnpm test:live images`; пачка из трёх картинок включается `IMAGES_LIVE_BATCH=1`.
