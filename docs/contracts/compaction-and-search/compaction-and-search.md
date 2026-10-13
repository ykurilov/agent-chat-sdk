# Contracts: сжатие и поиск

## ChatStorage (ядро)

```ts
insertCompaction(record: StoredCompaction): Promise<void>
listCompactions(chatId: string): Promise<StoredCompaction[]>   // по порядку добавления
listMessageLinks(chatId: string): Promise<MessageLink[]>      // { id, parentId, createdAt } в порядке listMessages; для лёгкого /compactions
```

## ChatService (ядро)

```ts
getHistory(userId, chatId) → { chat, messages, running, compactions, compacting }
getCompactions(userId, chatId) → { compactions, compacting }
compactNow(userId, chatId) → Promise<CompactionOutcome>   // "compacted" | "nothing-to-compact" | "failed"
```

## HTTP (server)

`GET /:chatId/compactions` → `{ compactions: CompactionMarker[], compacting: boolean }` (в `createChatHandler` — настройка `compaction?: CompactionSettings | false`); нет чата/чужой — как в
`GET /:chatId`. «Сжать сейчас» по HTTP нет.

## Набор инструментов (ядро)

`AgentToolsModel = { profile, providerId, chatId }` (добавлено `chatId`).

## Скин (договор v4)

`CompactionDivider: ComponentType<{ summary: string; open: boolean; onOpenChange(open: boolean): void }>`. Надписи компонент берёт из `useChatLabels()` (`historyCompacted`, `historyCompactedHint`). Слой поведения кладёт разделитель в элемент ленты сообщения `throughMessageId` (после него), раскрытие хранится в хранилище раскрытых частей чата.

## Пакет поиска

```ts
createHistorySearchTools(options: { storage: ChatStorage; maxResults?: number; snippetChars?: number }):
  (model: AgentToolsModel) => ToolSet          // { search_earlier_conversation }
historySearchInstructions: string               // постоянный текст
withHistorySearchTitles(labels): labels
```

Вход инструмента: `{ query: string }`. Выход: Markdown-строка (нумерованный список находок) либо «ничего не найдено» /
«история не сжималась».
