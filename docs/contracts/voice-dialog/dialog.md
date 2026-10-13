# Договор: сервер и протокол голосового диалога (016)

Пакет `@ykurilov/agent-chat-voice-dialog`. Серверная часть — `@ykurilov/agent-chat-voice-dialog/server`, подключение к Hono — `…/hono`, браузерная — корень пакета.
Как и relay диктовки (013), работает там, где есть WebSocket (Hono/Node). Next.js WebSocket не держит: как диктовка, для него — свой Node-сервер рядом (описать в README).

## Настройка сервера

```ts
mountDialogRelay(app, {
  path: "/api/voice-dialog",                    // WebSocket: {path}/stream; HTTP: {path}/voices, {path}/voice
  upgradeWebSocket,                              // адаптер сервера, как у mountVoiceRelay (`createNodeWebSocket` из @hono/node-ws)
  storage,                                       // ChatStorage: getChat, insertUsageRecord, необязательные setVoiceCut / getVoiceChoice / setVoiceChoice
  resolveUser,                                   // как у чата
  spendingLimits?,                               // { assertWithinLimit({ userId, chatId }) } — как в фиче 012
  speech: {
    voices: [{ id, name }],                      // список голосов приложения (обязательно, ≥ 1)
    defaultVoiceId,                              // обязательно, из списка
    model?: "eleven_v4_turbo" | "eleven_v4",     // по умолчанию eleven_v4_turbo
    pricePerThousandChars: { eleven_v4_turbo: number, eleven_v4: number }, // USD; обязательно на используемую модель
    apiKey?, env?,                               // ELEVENLABS_API_KEY; только на сервере
    baseUrl?, headers?,                          // для прокси, как у Soniox
    maxCharsPerReply?: 2000, maxCharsPerMinute?: 4000, // потолки знаков; минутный — на человека, общий для всех его соединений
    language?: "ru",
  },
  recognition?: { language?, model?, endpointLatencyLevel?: 2, maxEndpointDelayMs?: 1500, apiKey?, env?, baseUrl?, headers?, context? }, // baseUrl — адрес WebSocket Soniox; context — структурный `context` Soniox (general, text, terms, translation_terms), как у диктовки
  idleSeconds?: 180, maxSessionSeconds?: 1800,
  rateLimit?: RateLimit | false,                 // включения режима в окне
  maxConnectionsPerUser?: 2,
  allowedOrigins?: string[],                    // только в `mountDialogRelay` (Hono): страницы, которым можно поднимать сокет
  now?, logError,
})
```

Ключи Soniox и ElevenLabs ни в один ответ, журнал и сообщение об ошибке не попадают.

## WebSocket `{path}/stream?chatId=…`

Проверка Origin (`mountDialogRelay`, если задан `allowedOrigins`): заголовок Origin сравнивается со списком как адрес (схема, хост, порт); чужой и `null` — HTTP 403 до подъёма сокета, запрос без Origin проходит. Адрес запроса не сравнивается: при подъёме `@hono/node-ws` теряет в нём порт. Список записывается как `https://app.example`; запись не адрес — ошибка при запуске. Диктовка (`packages/voice`) не затронута.

Допуск при соединении: `resolveUser` (нет — 4401), чат принадлежит пользователю (нет — 4403), частота и число соединений (4429), лимит расходов (4402).

### Клиент → сервер

1. Первое сообщение (JSON): `{"type":"start","audio":{"format":"pcm_s16le","sampleRate":16000,"channels":1},"language"?:"ru"}`. Другое первое — 4400.
2. Бинарные кадры: звук PCM s16le 16 кГц, моно, кусками 20–100 мс.
3. Команды (JSON):
   - `{"type":"prepare","replyId":N}` — сообщение ушло агенту: сервер сразу открывает соединение озвучки (экономит ≈ 115 мс) и проверяет лимит.
   - `{"type":"speak","replyId":N,"text":"…","messageId"?:"…"}` — очередное говоримое предложение (уже очищенное от кода и разметки). Первое предложение реплики уходит в ElevenLabs с `flush`, остальные — по мере прихода.
   - `{"type":"end_reply","replyId":N}` — текст ответа закончился: дослать остаток и закрыть озвучку после последнего звука.
   - `{"type":"interrupt","replyId":N,"playedMs":M}` — перебивание: закрыть озвучку сразу, посчитать по `playedMs` и меткам времени, сколько знаков озвучено, записать расход; ответ `speech_cut`.
   - `{"type":"mark_cut","replyId":N,"messageId":"…","partIndex":I,"charOffset":C,"spokenTail":"…"}` — браузер перевёл озвученную позицию в позицию текста сообщения; сервер проверяет владельца и зовёт `storage.setVoiceCut?`; ответ `cut_saved` или `cut_rejected` (сообщение должно быть сообщением агента из этого чата). Хранилище без `setVoiceCut` — ответа нет: отметка живёт на экране.
   - `{"type":"voice","voiceId":"…"}` — сменить голос со следующей реплики (то же, что `PUT {path}/voice`, но без второго запроса); голос не из списка молча игнорируется.
   - `{"type":"ping"}` — держит соединение в паузах.
   - Любое другое — 4400.

### Сервер → клиент

- `{"type":"ready","maxSessionSeconds":N,"idleSeconds":N,"voiceId":"…","speech":true}` — `speech:false`, если озвучка на сервере недоступна (режим работает как «слушаю и пишу»).
- `{"type":"heard","settled":[{"text","confidence"}],"interim":[{"text","confidence"}]}` — слова распознавания; закреплённые приходят один раз, предварительные заново целиком (как у Soniox). Из них браузер решает про перебивание.
- `{"type":"phrase_end","text":"…","serverTimeMs":T}` — фраза закончена по определению конца фразы Soniox; текст — закреплённые слова фразы; `serverTimeMs` — метка для замера задержки.
- Бинарный кадр озвучки: `[4 байта replyId, big-endian][PCM s16le 24 кГц, моно]`.
- `{"type":"speech_started","replyId":N,"serverTimeMs":T}` — первый кусок звука отправлен (метка для замера).
- `{"type":"speech_done","replyId":N,"spokenChars":C}` — озвучка реплики закончена; расход записан.
- `{"type":"speech_cut","replyId":N,"spokenChars":C,"spokenTail":"…"}` — ответ на `interrupt`.
- `{"type":"speech_failed","replyId":N,"kind":"unavailable"|"limit"|"cap"}` — озвучки не будет (`limit` — лимит расходов, `cap` — потолок знаков); режим продолжает слушать.
- `{"type":"cut_saved","messageId"}` / `{"type":"cut_rejected","messageId"}`.
- `{"type":"idle_warning","secondsLeft":N}` — за 15 с до закрытия по простою.
- `{"type":"error","kind":"recognition_lost"|"invalid"|"service_unavailable"|"rate_limited"}` перед закрытием.

### Коды закрытия

Сбой при определении пользователя или проверке лимита расходов — `error(service_unavailable)` и 1011.

1000 — обычное (выход клиента, конец времени); 4400 — неверное сообщение; 4401 — нет пользователя; 4402 — лимит расходов; 4403 — чужой или отсутствующий чат; 4408 — простой или предел длительности; 4413 — звука с микрофона больше, чем бывает в реальном времени (окно 10 с, не больше 480 000 байт: 16 кГц × 2 байта × 1,5); 4429 — слишком часто / слишком много соединений; 4502 — Soniox недоступен или оборвался.

### Правила сервера

- Потолок знаков в минуту считается на человека по всем его соединениям. Запись расхода озвучки сессия не бросает без ожидания: проверка лимита перед следующей репликой ждёт записи предыдущей и видит её.
- Команды клиента сессия ставит в свою очередь (порядок сохраняется), ретранслятор их не ждёт: звук с микрофона и перебивание не стоят за долгой командой.

- Распознавание: `createSonioxSession` из пакета голоса, `stt-rt-v5`, `enable_endpoint_detection`, `endpoint_latency_adjustment_level`, `max_endpoint_delay_ms`; на `<end>` отправляется `phrase_end`.
- Озвучка: одно соединение на реплику; голос — выбор человека или по умолчанию; `language_code=ru`, `sync_alignment=true`, `pcm_24000`; ошибка ElevenLabs → `speech_failed`, реплика не пишется в расход сверх реально отправленных знаков.
- Позиция обрыва: каждый кусок `alignment` привязывается к абсолютному времени по накопленным байтам звука (48 000 байт = 1 с); позиция знака — последний знак, начавшийся раньше `playedMs`.
- Расход: одна запись `speech` на реплику при `speech_done`, `interrupt` или закрытии режима; число знаков — реально отправленное в ElevenLabs.
- Потолки: знаков на реплику и на минуту; выше — `speech_failed(cap)` (человек видит «дальше на экране»).
- Простой: нет слов дольше `idleSeconds` — предупреждение, затем 4408.

## HTTP

- `GET {path}/voices` → `{"voices":[{"id","name"}],"current":"…","persisted":true|false}`; `persisted:false` — хранилище не запоминает. 401 без пользователя.
- `PUT {path}/voice` тело `{"voiceId":"…"}` → 204; не из списка — 400; хранилище без метода — 204, выбор живёт до перезагрузки (`persisted:false` при следующем `GET` не обещает обратного).
- Ответы без кэша (`Cache-Control: no-store`).

## Браузерная часть (пакет)

`createVoiceDialogEngine({ basePath, fetch?, WebSocket?, audioContext?, mediaDevices?, now?, bargeIn?: { minConfidence, ignoreWords, stopWords, echoWindowMs } })` возвращает `VoiceDialogEngine` (интерфейс лежит в `@ykurilov/agent-chat-react`, как `VoiceInput` для диктовки):

- `open({ chatId, chat: DialogChatBridge, onView })` — включить режим (внутри нажатия пользователя, чтобы разблокировать звук);
- `close()`;
- `selectVoice(id)`, `loadVoices()`.

`DialogChatBridge` (реализует хук `useVoiceDialog` в react): `send(text)`, `stop(): Promise<void>`, `subscribeAssistantText(listener)` — приращения текста ответа с id сообщения и номером части (`partIndex` — номер текстовой части в `parts` сообщения; рассуждения и вызовы инструментов не приходят), `subscribeAnswerEnd(listener)`, `showCut(messageId, cut)` — отметка обрыва на экране сразу, не дожидаясь сервера (хранилище может не помнить обрыв).

- `send` уходит на `POST …/messages` с `voiceMode: true`; сервер запоминает сообщение голосовым (часть `data-voice-mode` в его `parts`, экран её не рисует), а модель получает пометку входа в режим один раз, у первого голосового сообщения подряд, и пометку возврата у первого текстового после него (`agent.voiceModeHint`, `agent.textModeNote`); если слова отправить нельзя (пусто, ответ ещё идёт, ответ ждёт подтверждения инструмента — голосом его не принять), мост сообщает `AnswerEnd { messageId: "", status: "error" }`, и режим возвращается в «слушаю».
- Слова уходят одной очередью: сначала `chat.stop()` прежнего ответа, потом следующие слова. Фразы, пришедшие, пока идёт остановка, склеиваются через пробел в одно сообщение: ничего не теряется.
- Конец ответа и приращения текста относятся к реплике по id сообщения: поздний конец или хвост перебитого ответа новую реплику не закрывает и не озвучивается. Пустой id (отказ отправки) закрывает реплику.
- Обрыв связи: три попытки открыть сокет заново (0,3 / 1 / 2 с), потом ошибка `network`; озвучка ответа, шедшего в момент обрыва, потеряна, его текст доходит.
- Сервер держит соединение с ElevenLabs живым сообщением `{"keep_alive": true}` раз в 10 с (ElevenLabs закрывает соединение после 20 с без данных).

Задержка: движок ведёт метки `phraseEndAt` (из `phrase_end`), `firstTextAt`, `firstSentenceAt`, `speechStartedAt`, `firstSampleAt` и отдаёт их в `onMetrics` (для теста и живой проверки; в продукте — необязательный колбэк, ничего никуда не шлёт).
