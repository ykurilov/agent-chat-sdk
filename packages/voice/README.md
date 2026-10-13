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
// другой адрес: relayUrl: "wss://voice.example.com/stream"
```

Настройки: `model` (по умолчанию `stt-rt-v5`, последняя real-time модель Soniox), `languageHints` (по умолчанию `["ru"]`),
`context` (тема и термины для точности), `maxSessionSeconds` (по умолчанию 300), `rateLimit`, `polishRateLimit`, `maxConnectionsPerUser`, `logError`,
`websocketUrl`, `upstreamHeaders`, `polish`.

Определение конца фразы Soniox (`enable_endpoint_detection`) включено: слова закрепляются быстрее.

**Стоп и финал.** По «стоп» клиент шлёт серверу `finalize`, сервер передаёт его Soniox, и тот закрепляет всё сказанное
и присылает метку `<fin>`. Только после неё текст считается готовым. Если Soniox не ответил за `stopTimeoutMs`
(3 секунды по умолчанию), остаётся то, что уже пришло, без ошибки.

**Частота.** Один человек может начать не больше 10 диктовок в минуту (`rateLimit: { maxSessions, perSeconds }`,
`rateLimit: false` — выключить). Сверх этого — 429 и «слишком часто» у человека. Отдельно: не больше 2 соединений
одновременно на человека (`maxConnectionsPerUser`, `false` — без предела); лишнее — 429 или код закрытия 4429. Счётчики живут
в памяти одного процесса; общие лимиты (на всё приложение, на несколько процессов, на расходы Soniox) — задача приложения.

**Next.js.** Route handlers Next.js не держат WebSocket, готового обработчика для них нет. Варианты: поднять рядом
маленький Node-сервер на Hono (код выше, отдельный порт или поддомен, `relayUrl` указывает на него; вход
`resolveUser` читает тот же cookie, поэтому нужен общий домен) или собственный сервер Next.js.

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
- **Расходы.** Лимиты `@ykurilov/agent-chat-limits` чистку **не учитывают**: считаются только ответы агента в чате.
  Чистка дешёвая (короткий текст, быстрая модель), поэтому у неё свой небольшой лимит: 6 чисток в минуту на человека
  (`polishRateLimit: { maxSessions, perSeconds }`, `polishRateLimit: false` — выключить). Он работает и при `rateLimit: false`.
  Сверх лимита текст остаётся как сказал Soniox, без ошибки. Для жёсткого бюджета ограничивайте расходы сами.

### Как устроено

`createVoiceRelay` даёт `authorize(request)` и `accept(socket, user)`. Клиент шлёт `{"audio_format":"auto"}`, сервер
соединяется с Soniox и отвечает `{"ready":true,"max_session_seconds":300,"polish":true}` (`polish` только если чистка включена),
после этого клиент шлёт куски звука, команду `{"type":"finalize"}` по «стоп» и, если нужно, пустое сообщение (конец звука).
Ответы Soniox сервер пересылает как есть, после `<fin>` присылает `{"polished":{"text":"…"}}` (`null` — оставить как есть).
Коды закрытия: 4400 нарушен протокол, 4401 не допущен, 4408 вышло время, 4429 слишком часто, 4502 Soniox недоступен.
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

Один адрес: `POST /api/voice/session` → `{ apiKey, websocketUrl, model, languageHints, context? }`.
Нет ключа на сервере или Soniox не ответил — 503/502: чат работает, человек видит «Сервис распознавания речи недоступен».
Настройки: `model`, `languageHints`, `context`, `tokenLifetimeSeconds`, `maxSessionSeconds`, `rateLimit`, `logError`.
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
- Нет доступа к микрофону, нет микрофона, нет связи, сервис недоступен — понятная надпись из словаря чата
  (`voiceErrors`), чат работает дальше.
- Подписи — `voiceStart`, `voiceStop`, `voiceConnecting`, `voicePolishing`, `voiceErrors` в словаре `russianLabels`.
- Формат записи выбирается явно: webm/opus (Chrome, Firefox), затем ogg/opus, затем mp4 (Safari). Soniox сам
  определяет контейнер. Нужен `https` или `localhost`.
- Предел диктовки — 5 минут. За две секунды до него запись останавливается, слова сохраняются, человек видит
  «Запись остановлена: предел 5 минут». Отправка сообщения во время диктовки останавливает диктовку.

Договор скина версии 5: `Composer` получает необязательное свойство `voice` (`VoiceInputView`); нет его — кнопку не рисовать.
Необязательное `voice.polishing` — признак «идёт чистка»; скин, который его не знает, работает как раньше.
Подробнее — `docs/contracts/voice-input/voice.md`.

## Проверка вживую

`pnpm secrets:load` кладёт ключ из `~/.config/soniox/.env` в `.env.local`; `pnpm test:live soniox` озвучивает
русскую фразу (`say -v Milena`), отправляет в Soniox тем же путём, что браузер, и ждёт текст. Из России добавьте
`SONIOX_API_BASE_URL` и `PROXY_TOKEN`. `soniox-formats` проверяет куски webm/opus, ogg/opus и mp4/AAC,
`soniox-relay` — весь путь «клиент → сервер Hono → Soniox» (для России ещё `SONIOX_WEBSOCKET_URL`), с замером, когда пришли предварительные слова и финал
после `finalize`, и одним вызовом чистки, если есть `TOGETHER_API_KEY`.
