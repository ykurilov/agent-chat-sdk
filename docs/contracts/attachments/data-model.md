# Data Model: Вложения

Схема баз чата **не меняется**.

## Часть сообщения пользователя (UIMessage)

`{ type: "file", url: "attachment:<uuid>", mediaType, filename }` — ставится до текстовой части. `mediaType` и `filename` при приёме перезаписываются данными из записи вложения.

## Запись вложения (`StoredAttachment`)

| Поле | Смысл |
|---|---|
| `id` | серверный UUID |
| `chatId`, `ownerId` | к какому чату и человеку привязан |
| `name` | исходное имя (для показа; в путь не входит) |
| `mediaType` | определён по содержимому |
| `kind` | `image` / `pdf` / `text` |
| `size` | байты |
| `createdAt` | ISO |
| `attached` | `true`, когда вошёл в отправленное сообщение |
| `extractedText`, `textTruncated` | для `pdf`/`text`; для картинок нет |

## Интерфейс `AttachmentStorage`

`save(record, bytes)`, `get(id)`, `readBytes(id)`, `markAttached(id)`, `remove(id)`, `removeUnattachedOlderThan(date)`.
Диск: `<папка>/<id>.bin` + `<id>.json`, запись через временный файл и переименование; `id` проверяется как UUID до обращения к файловой системе.
