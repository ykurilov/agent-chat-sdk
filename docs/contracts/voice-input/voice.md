# Договор: голосовой ввод (009)

> С версии 0.11: в relay добавлены `finalize`, чистка текста и `polish` в «готово» — см. `docs/contracts/voice-realtime/relay.md`.

## HTTP (сервер приложения)

`POST {basePath}/session` — параметры одной диктовки. Тело запроса не нужно.

- `401 {"error":{"kind":"invalid"}}` — `resolveUser` вернул `null`.
- `200`:

```json
{
  "apiKey": "temp:…",
  "expiresAt": "2026-09-30T02:32:16.399Z",
  "websocketUrl": "wss://stt-rt.soniox.com/transcribe-websocket",
  "model": "stt-rt-v5",
  "languageHints": ["ru"],
  "maxSessionSeconds": 300,
  "context": { "text": "…" }
}
```

  Ответ идёт с `Cache-Control: no-store`, как и все отказы.
- `429 {"error":{"kind":"rate_limited"}}` + `Retry-After` — человек превысил `rateLimit` (по умолчанию 10 сессий за 60 с, в памяти процесса). 401 и 503 в счёт не идут.
- `503`, если `resolveUser` бросил исключение (пишется в `logError`).

  `context` — только если задан в настройках. Главного ключа в ответе нет.
- `502 {"error":{"kind":"service_unavailable"}}` — Soniox или сеть не выдали ключ (таймаут 10 с).
- `503 {"error":{"kind":"service_unavailable"}}` — на сервере нет `SONIOX_API_KEY`.
- Любой другой путь или метод — `404 {"error":{"kind":"not_found"}}`.

Запрос к Soniox: `POST {apiBaseUrl}/v1/auth/temporary-api-key`, `Authorization: Bearer <главный ключ>` плюс `apiHeaders`,
тело `{usage_type:"transcribe_websocket", expires_in_seconds:60, single_use:true, max_session_duration_seconds:300, client_reference_id:<id пользователя>}`.

## WebSocket (браузер ↔ Soniox)

1. Первое сообщение — JSON: `{api_key, model, audio_format:"auto", language_hints, context?}`.
2. Затем бинарные куски записи (`MediaRecorder`, ~120 мс).
3. Конец звука — пустое текстовое сообщение `""`.
4. Ответы: `{tokens:[{text,is_final,…}]}`; ошибка — `{error_code,error_message}`; конец — `{finished:true}` и закрытие.
   Служебные токены `<fin>`, `<end>` в текст не попадают.

## WebSocket (режим relay: браузер ↔ сервер приложения ↔ Soniox)

`GET {basePath}/stream` поднимается до WebSocket. Допуск (401, 429, 503) — обычным HTTP-ответом до подъёма.

1. Клиент: `{"audio_format":"auto"}` (или `{"audio_format":"pcm_s16le","sample_rate":8000–48000,"num_channels":1|2}`).
2. Сервер соединяется с Soniox (главный ключ, `websocketUrl`, `upstreamHeaders`) и отвечает `{"ready":true,"max_session_seconds":300}`. До этого клиент не пишет.
3. Клиент шлёт бинарные куски записи, в конце — пустое текстовое сообщение `""`.
4. Сервер пересылает ответы Soniox как есть (главный ключ в них заменён на `***`).
5. Коды закрытия: 1000 нормально; 4400 нарушен протокол; 4401 не допущен; 4408 вышло время (клиент дописывает остаток и показывает `time_limit`); 4429 частота; 4502 Soniox недоступен. Клиент: 4401/4502 → `service_unavailable`, 4429 → `rate_limited`, 4400 → `other`, остальное → `network`.

Формат записи в браузере выбирается по `MediaRecorder.isTypeSupported`: `audio/webm;codecs=opus` → `audio/ogg;codecs=opus` → `audio/mp4`.
Клиент сам останавливает запись за 2 с до `maxSessionSeconds` и сообщает `time_limit`.

## Пакет `@ykurilov/agent-chat-voice`

| Точка входа | Что даёт | Где работает |
|---|---|---|
| `.` | `createVoiceInput({ api, mode?, relayUrl?, … })` → `VoiceInput` для `AgentChat`; вид ошибок `VoiceErrorKind` | браузер |
| `./server` | `createVoiceHandler(options)` → `{ basePath, fetch }`; `createVoiceRelay(options)` → `{ authorize, accept }` | сервер |
| `./hono` | `mountVoiceRelay(app, path, relay, upgradeWebSocket)` | сервер Hono на Node (`@hono/node-ws`) |

`VoiceHandlerOptions`: `basePath`, `resolveUser`, `apiKey?` (иначе `env.SONIOX_API_KEY`), `env?`, `apiBaseUrl?`, `websocketUrl?`,
`apiHeaders?`, `model?`, `languageHints?`, `context?`, `tokenLifetimeSeconds?`, `maxSessionSeconds?`, `rateLimit?` (`{maxSessions, perSeconds}` или `false`), `logError?`, `fetch?` (подмена для тестов).

Монтирование — теми же `mountChat` / `createNextRouteHandlers` пакета `server`: они принимают всё, у чего есть `basePath` и `fetch`.

## Пакет `@ykurilov/agent-chat-react`

```ts
type VoiceErrorKind = "permission_denied" | "no_microphone" | "unsupported" | "network" | "service_unavailable" | "rate_limited" | "time_limit" | "other";

interface DictatedText { finalText: string; interimText: string }

interface VoiceSession {
  /** Закончить запись, дождаться остатка речи; после этого приходит onEnd. */
  stop(): void;
  /** Оборвать сразу, ничего не ждать, слушателя больше не звать (смена чата, закрытие экрана). */
  cancel(): void;
}

interface VoiceListener {
  onConnected(): void;                 // микрофон и соединение готовы, идёт запись
  onText(text: DictatedText): void;    // накопленный текст диктовки целиком
  onError(kind: VoiceErrorKind): void; // после ошибки onEnd тоже приходит
  onEnd(): void;                       // диктовка закончена, ресурсы освобождены
}

interface VoiceInput { start(listener: VoiceListener): VoiceSession }
```

`AgentChatProps.voice?: VoiceInput`.

### Договор скина, версия 5

```ts
interface VoiceInputView {
  state: "idle" | "connecting" | "listening" | "stopping";
  /** Нажатие: начать диктовку или закончить. Во время подключения — отменить. */
  onToggle: () => void;
  /** Готовая надпись ошибки. */
  error?: string;
}
// Composer: + voice?: VoiceInputView
```

Без `voice` компонент кнопку не рисует. Подписи — `useChatLabels()`: `voiceStart`, `voiceStop`, `voiceConnecting`, `voiceErrors[kind]`.
