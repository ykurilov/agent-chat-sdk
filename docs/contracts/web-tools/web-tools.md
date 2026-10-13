# Contract: `@ykurilov/agent-chat-web-tools`

## Подключение

```ts
import { createWebTools, webToolsInstructions } from "@ykurilov/agent-chat-web-tools";
import { createFirecrawlServices } from "@ykurilov/agent-chat-web-tools/firecrawl";

const firecrawl = createFirecrawlServices({
  apiKey: process.env.FIRECRAWL_API_KEY!,
  baseUrl: process.env.FIRECRAWL_BASE_URL, // прокси; по умолчанию https://api.firecrawl.dev
  headers: process.env.PROXY_TOKEN ? { "X-Proxy-Token": process.env.PROXY_TOKEN } : undefined,
});
const webTools = createWebTools({
  search: firecrawl.search,
  reader: firecrawl.reader,
  screenshots: firecrawl.screenshots, // необязательно
});

createChatHandler({
  …,
  agent: {
    instructions: `${appInstructions}\n${webToolsInstructions}`,
    tools: (model) => ({ ...appTools, ...webTools(model) }),
  },
});
```

## Интерфейсы сервиса

```ts
interface WebSearchService {
  search(query: string, options: { limit: number; signal?: AbortSignal }): Promise<SearchHit[]>;
}
interface SearchHit { title: string; url: string; snippet: string }

interface PageReaderService {
  readPage(url: string, options: { signal?: AbortSignal }): Promise<PageContent>;
}
interface PageContent { url: string; title: string; markdown: string }

interface PageScreenshotService {
  takeScreenshot(url: string, options: { signal?: AbortSignal }): Promise<{ imageUrl: string }>;
}
```

## `createWebTools(options)`

| Параметр | По умолчанию | Смысл |
|---|---|---|
| `search`, `reader` | обязательны | реализации интерфейсов |
| `screenshots` | нет | без него `page_screenshot` не существует |
| `searchResultLimit` | 5 | число результатов поиска |
| `pageCharacterLimit` | 30 000 | предел текста страницы |
| `fetch` | глобальный | для скачивания снимка |

Возвращает `(model: { profile: { acceptsImages: boolean; toolResultImageProviders?: readonly string[] }; providerId: string }) => ToolSet`.

## Инструменты (описания и схемы постоянны)

| Имя | Вход | Результат |
|---|---|---|
| `web_search` | `{ query: string }` | Markdown-список или «Ничего не найдено по запросу …» |
| `read_page` | `{ url: string }` | `# Заголовок\nИсточник: адрес\n\nтекст` (с пометкой при обрезке) |
| `page_screenshot` | `{ url: string }` | `{ pageUrl, screenshotUrl }`; модель получает картинку |

`page_screenshot` есть в наборе только при `profile.acceptsImages` и `providerId ∈ profile.toolResultImageProviders`.

## `createFirecrawlServices({ apiKey, baseUrl?, headers?, fetch?, timeoutMs? })`

Возвращает `{ search, reader, screenshots }`. `timeoutMs` по умолчанию 30 000 (поиск) и 60 000 (чтение, снимок).

## `@ykurilov/agent-chat-web-tools/labels`

`webToolTitles`, `withWebToolTitles(labels)` — подписи «Поиск в интернете / Чтение страницы / Скриншот страницы» в
надписях чата. Не содержит кода Firecrawl.

## Ядро (`@ykurilov/agent-chat-core`)

`AgentSettings.tools?: ToolSet | ((model: { profile: ModelProfile; providerId: string }) => ToolSet)`. Экспортируется тип
`AgentToolsSource`.

## Ошибки

`WebToolError` (сообщение по-русски, без ключа и адреса сервиса). Виды: неверный адрес, нет доступа по ключу, лимит,
недостаточно средств, недоступен, тайм-аут, неожиданный ответ.
