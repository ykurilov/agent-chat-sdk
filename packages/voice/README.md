# @ykurilov/agent-chat-voice

Голосовой ввод для чата с агентом через Soniox: человек нажимает микрофон в поле ввода, слова появляются в поле
по ходу речи, он правит и отправляет сам. Отдельное расширение: приложению без голоса пакет не нужен, а чат без него
кнопки микрофона не рисует.

Пакет про **диктовку в поле**. Голосовой разговор с агентом (говорит человек, отвечает голос) сюда не входит:
для него будет отдельный пакет, а серверную часть связи с Soniox он возьмёт отсюда (см. «Сессия Soniox»).

Два режима, оба держат главный ключ на сервере:

- **Через сервер** (`mode: "relay"`) — **основной и рекомендуемый путь**. Браузер шлёт звук на ваш сервер по WebSocket,
  сервер пересылает его в Soniox и возвращает текст. Ключ Soniox не покидает сервер даже в виде временного, работает
  из России (сервер ходит через прокси), и только в этом режиме есть чистка текста моделью. Цена: серверу нужен WebSocket.
- **Напрямую** (по умолчанию, **не рекомендуется**): сервер выдаёт браузеру временный ключ Soniox, браузер соединяется
  с Soniox сам. Оставлен для приложений, которые уже так работают. Временный ключ всё же уходит в браузер, чистки
  текста нет, а из России браузер до Soniox не достаёт.

## Через сервер (рекомендуется)

```ts
import { createVoiceRelay } from "@ykurilov/agent-chat-voice/server";
import { mountVoiceRelay } from "@ykurilov/agent-chat-voice/hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";

const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
const relay = createVoiceRelay({
  resolveUser: async (request) => currentUser(request), // допуск проверяется до подъёма WebSocket; нет пользователя → 401
  // ключ: SONIOX_API_KEY из окружения (или apiKey: "…")
  websocketUrl: process.env.SONIOX_WEBSOCKET_URL,       // из России — адрес маршрута прокси до stt-rt.soniox.com
  upstreamHeaders: { "X-Proxy-Token": process.env.PROXY_TOKEN! }, // сервер может добавить заголовок
  polish: { provider: "together" },                     // чистка текста моделью, по желанию (ниже)
  allowedOrigins: ["https://school.getcourse.ru"],      // по желанию: чужие страницы, которым можно; свой сайт проходит всегда
});
mountVoiceRelay(app, "/api/voice/stream", relay, upgradeWebSocket);
injectWebSocket(serve({ fetch: app.fetch, port: 8787 }));
```

```tsx
const voice = createVoiceInput({ api: "/api/voice", mode: "relay" }); // адрес — {api}/stream на том же сайте
// другой адрес: relayUrl: "wss://voice.example.com/stream" или "/voice/stream" (от адреса страницы)
```

Настройки: `model` (по умолчанию `stt-rt-v5`, последняя real-time модель Soniox), `languageHints` (по умолчанию `["ru"]`),
`allowedLanguageHints`, `context` (тема и термины для точности), `maxSessionSeconds` (по умолчанию 300), `rateLimit`,
`polishRateLimit`, `maxConnectionsPerUser`, `logError`, `websocketUrl`, `upstreamHeaders`, `polish`, `spending`.

Определение конца фразы Soniox (`enable_endpoint_detection`) включено: слова закрепляются быстрее.

**Стоп и финал.** По «стоп» клиент шлёт серверу `finalize`, сервер передаёт его Soniox, и тот закрепляет всё сказанное
и присылает метку `<fin>`. Только после неё текст считается готовым. Если Soniox не ответил за `stopTimeoutMs`
(3 секунды по умолчанию), остаётся то, что уже пришло, без ошибки.

**Частота.** Один человек может начать не больше 10 диктовок в минуту (`rateLimit: { maxSessions, perSeconds }`,
`rateLimit: false` — выключить). Сверх этого — 429 и «слишком часто» у человека. Отдельно: не больше 2 соединений
одновременно на человека (`maxConnectionsPerUser`, `false` — без предела); лишнее — 429 или код закрытия 4429. Счётчики живут
в памяти одного процесса; общие лимиты (на всё приложение, на несколько процессов, на расходы Soniox) — задача приложения.

**Почему отказали.** Браузер не видит HTTP-ответ на подъём WebSocket: для него любой такой отказ — «нет связи».
Поэтому сервер поднимает соединение и сразу закрывает его кодом причины, а браузер показывает свою подпись:

| Причина | Код закрытия | Ошибка в браузере | Подпись по умолчанию |
|---|---|---|---|
| не вошёл (`resolveUser` → `null`) | 4401 | `forbidden` | «Нет доступа к диктовке» |
| приложение отказало (`{ refused: { code } }`) | по `code`, ниже | | |
| — `code: "limit"` или `"spending_limit_reached"` | 4402 | `limit` | «Лимит расходов исчерпан, диктовка недоступна» |
| — `code: "too_long"` | 4413 | `too_long` | «Запись слишком длинная» |
| — `code: "rate_limited"` | 4429 | `rate_limited` | «Слишком много диктовок подряд…» |
| — `code: "service_unavailable"` | 4502 | `service_unavailable` | «Сервис распознавания речи недоступен» |
| — любой другой `code` | 4403 | `forbidden` | «Нет доступа к диктовке» |
| лимит расходов (`spending`) | 4402 | `limit` | как у `limit` |
| слишком часто | 4429 | `rate_limited` | |
| нет ключа Soniox, Soniox недоступен | 4502 | `service_unavailable` | |
| кусок звука больше предела сервера (`maxFrameBytes`) | 1009 | `too_long` | |
| нет приветствия 10 с после подъёма (`helloTimeoutMs`) | 4400 | `other` | |
| чужая страница (Origin) | HTTP 403, соединения нет | `network` | |

Коды — `RELAY_CLOSE` из `@ykurilov/agent-chat-voice/server` (и из корня пакета для браузера). В режиме «напрямую» те же
причины приходят статусом ответа: 401/403 → `forbidden`, 402 → `limit`, 429 → `rate_limited`.

### Next.js: свой сервер (custom server)

Route handlers Next.js не держат WebSocket. Голос встаёт на тот же HTTP-сервер, что и Next.js, обработчиком `upgrade`.
Проверки те же, что у Hono: своя страница (Origin), вход, частота, лимит расходов, причина отказа кодом закрытия.
Нужен пакет `ws` (`pnpm add ws`).

```ts
// server.ts — запуск: node server.ts (Node 22.18+) или node --import tsx server.ts (вместо next start)
import { createServer } from "node:http";
import next from "next";
import { createVoiceUpgrade, sharedVoiceRelay } from "@ykurilov/agent-chat-voice/node";

// Свой обработчик upgrade Next.js вешает на `httpServer` (без него — на сервер первого запроса) и закрывает
// соединения, которые совпали с его маршрутом. Отдельный сервер, который не слушает порт, держит этот обработчик
// в стороне: голос Next.js не видит, а свои соединения (горячая перезагрузка) получает через `emit` ниже.
const nextUpgrades = createServer();
const app = next({ dev: process.env.NODE_ENV !== "production", httpServer: nextUpgrades });
const handle = app.getRequestHandler();
await app.prepare();

const voiceUpgrade = createVoiceUpgrade({ path: "/api/voice/stream", relay: sharedVoiceRelay });
const server = createServer((request, response) => handle(request, response));
server.on("upgrade", (request, socket, head) => {
  if (!voiceUpgrade(request, socket, head)) nextUpgrades.emit("upgrade", request, socket, head);
});
server.listen(Number(process.env.PORT ?? 3000));
```

```ts
// instrumentation.ts (или любой модуль, который Next.js грузит при старте): ретранслятор живёт рядом с кодом приложения
import { shareVoiceRelay } from "@ykurilov/agent-chat-voice/node";
import { createVoiceRelay } from "@ykurilov/agent-chat-voice/server";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  shareVoiceRelay(createVoiceRelay({ resolveUser: currentUser, spending: { service: chatService, recognitionUsdPerHour: 0.12 } }));
}
```

- `createVoiceUpgrade({ path, relay, maxFrameBytes, authorizeTimeoutMs })` возвращает обработчик `upgrade`: `true` — соединение голоса,
  `false` — адрес чужой, отдайте его Next.js. `relay` — ретранслятор или функция, которая его отдаёт.
- **Не вешайте Next.js на тот же сервер**, что и голос (`httpServer: nextUpgrades` обязателен). Иначе после первой
  страницы Next.js сам подпишется на `upgrade` настоящего сервера и при маршруте, который ловит любой адрес
  (`app/[...slug]`), закроет соединение голоса: диктовка оборвётся с «нет связи». `app.getUpgradeHandler()` вместо
  `emit` не подходит: горячую перезагрузку он не обслуживает. Проверено вживую на Next.js 16.3 (`next build` и `next dev`).
- `shareVoiceRelay` / `sharedVoiceRelay` — мостик внутри процесса. Next.js собирает свой код отдельно от `server.ts`,
  и общий модуль у них — разные копии; мостик держит ретранслятор на `globalThis`. Пока его нет — ответ 503.
- Ретранслятор можно создать и прямо в `server.ts` и передать `relay: relay`, если всё нужное (`resolveUser`, служба
  чата) доступно оттуда.
- `maxFrameBytes` — предел одного куска звука, по умолчанию 1 МиБ; больше — закрытие 1009 и «Запись слишком длинная».
  Тот же предел есть у ретранслятора (`createVoiceRelay({ maxFrameBytes })`, он действует и для Hono); здесь кусок
  отрезается ещё на входе, не попадая в память целиком.
- `authorizeTimeoutMs` — сколько ждать проверки входа (`resolveUser`, лимит), по умолчанию 10 с; дольше — HTTP 503.
- Сеть не роняет процесс: путь, который не разбирается (`GET //`), получает HTTP 400, обрыв во время проверки входа
  просто закрывает сокет.
- Тот же обработчик подходит для Express и голого `node:http`.

Другой путь — маленький Node-сервер на Hono рядом (код выше, отдельный порт или поддомен, `relayUrl` указывает на него;
вход `resolveUser` читает тот же cookie, поэтому нужен общий домен).

### Учёт расходов и лимиты

```ts
const relay = createVoiceRelay({
  resolveUser,
  spending: { service: chatService, recognitionUsdPerHour: 0.12 }, // chatService = createChatService(...)
  polish: { askModel: chatService.askModel, model: { providerId: "together", modelId: "deepseek-ai/DeepSeek-V4.1-Flash" } },
});
```

- До диктовки сервер проверяет лимит расходов (`service.assertWithinLimit`): исчерпан — соединение закрывается кодом 4402,
  человек видит «Лимит расходов исчерпан, диктовка недоступна». Soniox не зовётся.
- Секунды звука пишутся в журнал расхода видом `voice_input` один раз в конце диктовки: от первого куска звука до конца
  соединения, начатая секунда — целая, не больше предела записи. Цена — `секунды × recognitionUsdPerHour / 3600`,
  `inputTokens` — секунды. Так голос попадает в общие лимиты (`@ykurilov/agent-chat-limits`) и отчёты.
- Чат расхода — `?chat=` адреса соединения (его ставит `createVoiceInput`, `AgentChat` передаёт текущий чат), если это
  чат вошедшего: сервер проверяет его `service.assertOwnChat`. Нет его, чужой или странный — метка `"voice"`, так чужой
  адрес не тратит лимит чужого чата. Свой выбор — `spending.chatId(request, user)`. Расход всегда на вошедшем человеке.
- Чистка текста пишется видом `voice_polish` (ниже).
- Только режим «через сервер»: «напрямую» звук идёт мимо сервера, и секунд он не видит.

### Язык записи

Браузер может назвать язык каждой записи: `AgentChat` передаёт язык словаря подписей (`labels.locale`), своё приложение —
`createVoiceInput({ languageHints: () => ["ru", "en"] })` или `voice.start(listener, { language: "en" })`.
Сервер не верит браузеру на слово: берёт только коды языков из двух-трёх букв (`en-US` → `en`), без повторов, не больше
трёх. `allowedLanguageHints: ["ru", "en"]` сужает выбор. Ничего годного — подсказка сервера (`languageHints`). Старый
сервер поле `language_hints` в приветствии просто не читает.

**Из России** нужен маршрут прокси и для WebSocket: обычного маршрута на `api.soniox.com` мало, нужен ещё
`stt-rt.soniox.com` с проверкой токена и заголовками `Upgrade`/`Connection`.

### Чистка текста моделью

После «стоп» сервер может прогнать надиктованное через модель: убрать «э-э», повторы и оговорки, расставить знаки и заглавные.
Модель не пересказывает, не отвечает на вопрос из текста, не меняет смысл и язык.

```ts
polish: { provider: "together" }                                  // ключ TOGETHER_API_KEY из окружения сервера
polish: { provider: "together", model: "…", apiKey: "…", timeoutMs: 5000 }
polish: { provider: "together", baseUrl: "https://proxy.example.com/together/v1", headers: { "X-Proxy-Token": process.env.PROXY_TOKEN! } } // через прокси
polish: { clean: async (text) => myModel(text) }                  // своя чистка: вернуть исправленный текст
polish: { askModel: chatService.askModel, model: { providerId, modelId } } // модель службы чата: учёт и лимиты сами
```

- По умолчанию модель `deepseek-ai/DeepSeek-V4.1-Flash` у Together (без рассуждений, температура 0). Запрос устроен под кэш модели:
  постоянная инструкция первой, надиктованный текст последним.
- **Куда уходит текст.** Надиктованный текст отправляется в модель чистки (Together или ваша функция `clean`): это ещё один
  сторонний сервис рядом с Soniox. Упомяните его в политике приватности. Ключ Together остаётся на сервере и в браузер не попадает.
- Текст на чистку берёт сам сервер из ответов Soniox, клиент его не присылает: это не открытая дверь к модели.
- В поле заменяется только надиктованный кусок. Набранное до и после остаётся; дописанное руками во время чистки сохраняется;
  если человек поправил само надиктованное, чистка не применяется и его правка остаётся. Пока идёт чистка, у кнопки микрофона
  тихий признак (`VoiceInputView.polishing`, подпись `voicePolishing`).
- Сбой, ошибка HTTP, пустой, «раздутый» или слишком короткий ответ, ответ другими словами (меньше 70% слов из исходника: так
  выглядит «ответил на вопрос» или отказ), тишина дольше 5 секунд — остаётся текст Soniox, без ошибки на экране.
  Клиент ждёт чистку не дольше `polishTimeoutMs` (7 секунд по умолчанию).
- Нет ключа Together — чистка выключена, диктовка работает, причина в `logError`.
- **Расходы.** Чистка пишется в журнал расхода видом `voice_polish` и попадает в лимиты:
  - `askModel` службы чата — всегда: служба сама проверяет лимит и пишет расход (вариант по умолчанию для приложений
    с `createChatService`);
  - Together — вместе с `spending` и ценой модели `pricing: { inputPerMillion, outputPerMillion }` (доллары за миллион
    токенов); без цены при `spending` ретранслятор не создастся: расход прошёл бы мимо лимитов;
  - своя чистка — вместе с `spending`, если `clean` вернёт `{ text, usage: { inputTokens, outputTokens, costUsd, modelId } }`.
    Вернула просто текст (без `usage`) — её расход не учитывается: в журнал он не попадает, лимит его не видит. Лимит перед
    чисткой проверяется и в этом случае.
  Лимит исчерпан — чистки нет, текст остаётся как сказал Soniox. Расход пишется, как только модель ответила, даже если
  ответ отброшен проверками. Отдельно у чистки свой лимит частоты: 6 чисток в минуту на человека
  (`polishRateLimit: { maxSessions, perSeconds }`, `polishRateLimit: false` — выключить). Он работает и при `rateLimit: false`.

### Как устроено

`createVoiceRelay` даёт `authorize(request)` → `{ user, chatId }` или `{ refusal, closeCode? }`, и `accept(socket, user, chatId)`.
Клиент шлёт `{"audio_format":"auto","language_hints":["ru"]}` (`language_hints` необязательно), сервер
соединяется с Soniox и отвечает `{"ready":true,"max_session_seconds":300,"polish":true}` (`polish` только если чистка включена),
после этого клиент шлёт куски звука, команду `{"type":"finalize"}` по «стоп» и, если нужно, пустое сообщение (конец звука).
Ответы Soniox сервер пересылает как есть, после `<fin>` присылает `{"polished":{"text":"…"}}` (`null` — оставить как есть).
Приветствие нужно прислать за 10 с (`helloTimeoutMs`), сообщение — не больше 1 МиБ (`maxFrameBytes`).
Коды закрытия: 4400 нарушен протокол или нет приветствия, 4401 не вошёл, 4402 лимит расходов, 4403 нет доступа, 4408 вышло время, 4413 слишком
длинно, 4429 слишком часто, 4502 Soniox недоступен, 1009 кусок больше предела.
Полностью — `docs/contracts/voice-input/voice.md` и `docs/contracts/voice-realtime/relay.md`.

### Сессия Soniox (для повторного использования)

Связь сервера с Soniox вынесена в отдельный модуль без поля ввода и без WebSocket браузера:

```ts
import { createSonioxSession } from "@ykurilov/agent-chat-voice/server";

const session = createSonioxSession(
  { apiKey, model: "stt-rt-v5", languageHints: ["ru"], websocketUrl, logError },
  { onReady() {}, onMessage(raw, event) {}, onClosed(reason) {} },
);
session.begin({ audio_format: "auto" }); // потом sendAudio(chunk), finalize(), endAudio(), text(), close()
```

Она сама открывает соединение, шлёт первое сообщение, копит закреплённый и предварительный текст, ловит `<fin>`,
следит за пределом записи и не выдаёт ключ в ответах. На ней стоит `createVoiceRelay`; на ней же сможет стоять голосовой режим.

## Напрямую (не рекомендуется)

Сервер выдаёт браузеру временный ключ Soniox (живёт минуту, один раз, диктовка до пяти минут), браузер соединяется с Soniox сам.
Чистки текста в этом режиме нет.

```ts
import { createVoiceHandler } from "@ykurilov/agent-chat-voice/server";
import { mountChat } from "@ykurilov/agent-chat-server/hono"; // или createNextRouteHandlers из …/next

const voice = createVoiceHandler({
  basePath: "/api/voice",
  resolveUser: async (request) => currentUser(request), // тот же вход, что у чата; null → 401
});
mountChat(app, voice);
```

Один адрес: `POST /api/voice/session` → `{ apiKey, websocketUrl, model, languageHints, context? }`. Тело запроса
`{ languageHints }` (необязательно) — язык этой записи, сервер проверяет его так же, как в режиме «через сервер».
Нет ключа на сервере или Soniox не ответил — 503/502: чат работает, человек видит «Сервис распознавания речи недоступен».
Настройки: `model`, `languageHints`, `allowedLanguageHints`, `context`, `tokenLifetimeSeconds`, `maxSessionSeconds`,
`rateLimit`, `logError`. Учёта расходов в этом режиме нет.
Ответ с ключом идёт с `Cache-Control: no-store`. Российский сервер: `apiBaseUrl`, `apiHeaders`, `websocketUrl`, но браузер
подключается к `websocketUrl` сам и заголовок добавить не может, поэтому прокси для WebSocket должен пускать без него.

## Браузер

```tsx
import { createVoiceInput } from "@ykurilov/agent-chat-voice";

const voice = createVoiceInput({ api: "/api/voice", mode: "relay" }); // один на приложение
<AgentChat api="/api/chat" chatId={chatId} skin={tandemSkin} voice={voice} />;
```

- Нажатие: запрос разрешения на микрофон → соединение с сервером → запись потоком. Повторное нажатие — стоп: остаток речи
  закрепляется (`finalize`), микрофон отпускается. Нажатие во время подключения отменяет запуск.
- Слова дописываются к тому, что уже набрано. Ручная правка во время диктовки остаётся, сказанное раньше не дублируется.
  Голос сам ничего не отправляет.
- Нет доступа к микрофону, нет микрофона, нет связи, сервис недоступен, лимит, нет доступа, слишком длинно — понятная
  надпись из словаря чата (`voiceErrors`), чат работает дальше.
- Подписи — `voiceStart`, `voiceStop`, `voiceConnecting`, `voicePolishing`, `voiceErrors` в словаре `russianLabels`.
  Подписи `limit`, `forbidden`, `too_long` в своём словаре можно не задавать: возьмутся подписи по умолчанию на языке
  словаря. `time_limit` — строка или функция от предела записи в секундах.
- `voice.start(listener, { chatId, language })`: чат расхода (режим «через сервер») и язык записи. `AgentChat` передаёт их
  сам. `onError(kind, details)`: у `time_limit` в `details.maxSessionSeconds` предел, названный сервером.
- Формат записи выбирается явно: webm/opus (Chrome, Firefox), затем ogg/opus, затем mp4 (Safari). Soniox сам
  определяет контейнер. Нужен `https` или `localhost`.
- Предел диктовки — `maxSessionSeconds` сервера (5 минут по умолчанию). За две секунды до него запись останавливается,
  слова сохраняются, человек видит «Запись остановлена: предел 5 минут» — с числом из настройки сервера. Отправка сообщения во время диктовки останавливает диктовку.

Договор скина версии 5: `Composer` получает необязательное свойство `voice` (`VoiceInputView`); нет его — кнопку не рисовать.
Необязательное `voice.polishing` — признак «идёт чистка»; скин, который его не знает, работает как раньше.
Подробнее — `docs/contracts/voice-input/voice.md`.

## Проверка вживую

`pnpm secrets:load` кладёт ключ из `~/.config/soniox/.env` в `.env.local`; `pnpm test:live soniox` озвучивает
русскую фразу (`say -v Milena`), отправляет в Soniox тем же путём, что браузер, и ждёт текст. Из России добавьте
`SONIOX_API_BASE_URL` и `PROXY_TOKEN`. `soniox-formats` проверяет куски webm/opus, ogg/opus и mp4/AAC,
`soniox-relay` — весь путь «клиент → сервер Hono → Soniox» (для России ещё `SONIOX_WEBSOCKET_URL`), с замером, когда пришли предварительные слова и финал
после `finalize`, и одним вызовом чистки, если есть `TOGETHER_API_KEY`.
