# Модель данных 016

## Поля и записи, которые добавляются (всё необязательное)

| Что | Где | Форма |
|---|---|---|
| Источник расхода «озвучка» | ядро, `UsageSource` | `"answer" \| "compaction" \| "speech"`; колонка `source` — текст без ограничения, миграция не нужна |
| Запись расхода озвучки | `UsageRecord` | `source:"speech"`, `modelId` = модель озвучки (`eleven_v4_turbo`), `providerId:"elevenlabs"`, `inputTokens` = число знаков, отправленных на озвучку (соглашение), остальные счётчики 0, `costUsd` = знаки / 1000 × цена, `messageId` сообщения агента (если известно) |
| Отметка обрыва | `StoredMessage.voiceCut`, `ChatMessageMetadata.voiceCut` | `{ partIndex: number, charOffset: number, spokenTail: string } \| null` — часть текста сообщения и знак, до которого дошла озвучка; хвост последних ≈ 60 озвученных знаков |
| Выбор голоса | таблица `voice_choices` | `owner_id` (ключ), `voice_id`, `updated_at` |

## Хранилище (необязательные методы `ChatStorage`)

- `setVoiceCut?(input: { ownerId, chatId, messageId, voiceCut: VoiceCut }): Promise<void>` — хранилище проверяет владельца; чужое сообщение — тихо ничего.
- `getVoiceChoice?(ownerId): Promise<string | null>`
- `setVoiceChoice?(ownerId, voiceId): Promise<void>`

Нет методов — пакет диалога это видит и не падает (голос живёт до перезагрузки; отметка обрыва — только на экране).

## Миграции

- SQLite (`packages/storage-sqlite/drizzle`) и Postgres (`packages/storage-postgres/drizzle`): одна миграция на каждое хранилище: колонка `voice_cut` (текст JSON у SQLite, `json` у Postgres — как остальные JSON-колонки; пустая по умолчанию) в таблице сообщений и таблица `voice_choices`.
- Номера: ветка 015 занимает SQLite `0007_user_model_choices` и Postgres `0006_user_model_choices` (сверено 2026-09-30 после слияния 015: общего хранилища «на человека» у неё нет, только своя таблица и два своих метода), поэтому наши — SQLite `0008_voice_dialog`, Postgres `0007_voice_dialog`.

## Состояния режима (в браузере, не хранятся)

`off → connecting → listening → thinking → speaking → listening`; из `thinking`/`speaking` при перебивании → `interrupted → listening`; из любого состояния → `off` (выход, простой, блокировка) или `error` (с надписью, затем `off` либо `listening`, если ошибка только озвучки).

## Объекты диалога на сервере (в памяти, на время режима)

- Сессия диалога: `{ userId, chatId, sonioxSession, speechStream|null, startedAt, lastSpeechAt }`.
- Реплика: `{ replyId, messageId|null, sentChars, spokenText, audioBytes, alignmentTimeline, startedAt }`.
