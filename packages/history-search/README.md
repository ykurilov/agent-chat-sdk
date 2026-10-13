# @ykurilov/agent-chat-history-search

Инструмент агента «поиск по старой переписке». Когда ядро сжимает историю, старые сообщения заменяет короткая сводка,
а точные детали (число, адрес, слова человека) в ней могут потеряться. Инструмент ищет их в оригиналах, которые
остаются в базе. Отдельное расширение: приложению, которому он не нужен, он не нужен и в сборке.

```ts
import { createHistorySearchTools, historySearchInstructions } from "@ykurilov/agent-chat-history-search";

const historySearch = createHistorySearchTools({ storage });

createChatHandler({
  …,
  storage,
  agent: {
    instructions: `${appInstructions}\n${historySearchInstructions}`,
    tools: (model) => ({ ...appTools, ...historySearch(model) }),
  },
});
```

В браузерной части подпись «Поиск по старой переписке» подключается отдельно и не тянет код поиска:

```tsx
import { withHistorySearchTitles } from "@ykurilov/agent-chat-history-search/labels";
<ChatLabelsProvider labels={withHistorySearchTitles(russianLabels)}>…</ChatLabelsProvider>;
// по-английски: withHistorySearchTitles(englishLabels, englishHistorySearchTitles)
```

Оба словаря есть и в корне пакета: `import { englishHistorySearchTitles, historySearchTitles } from "@ykurilov/agent-chat-history-search"`.

- Инструмент один: `search_earlier_conversation({ query })`. Ищет только в том, что заменила сводка, в текущей ветке чата.
  То, что и так перед глазами модели, не ищется. Чужие чаты не видны: чат берётся из хода, а не из запроса модели.
- Ищутся слова человека и агента, вызовы инструментов и их результаты. Рассуждения и картинки не читаются.
- Слова находятся по началу слова в тексте, регистр и «ё» не важны, окончания подрезаются: «документа» найдёт «документы».
  Адреса, версии и имена файлов (`10.0.0.5`, `report_v2.pdf`) ищутся целиком.
- Сначала сообщения, где нашлось больше слов запроса. По умолчанию до 5 находок с фрагментом в 300 знаков
  (`maxResults`, `snippetChars`).
- Работает на любом хранилище ядра: память, SQLite, PostgreSQL. Своих индексов не заводит.
- История не сжималась, запрос пустой, ничего не нашлось: инструмент так и отвечает, модель не выдумывает.
- Описание инструмента и `historySearchInstructions` постоянные, поэтому кэш модели не страдает.
