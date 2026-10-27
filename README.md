# Agent Chat SDK

Готовый чат с ИИ-агентом для вашего веб-приложения. Ставите несколько пакетов, пишете два коротких файла — и
у приложения есть окно чата, где агент отвечает по частям, думает вслух, вызывает ваши функции и помнит переписку.

Свой чат с нуля — это недели: поток ответа, кнопка «Стоп», обрывы связи, повторы, хранение истории, выбор модели,
подсчёт расходов. Здесь всё это уже сделано и проверено тестами.

## Что умеет

- Ответ печатается по мере готовности. Его можно остановить, повторить или переделать.
- Агент вызывает ваши функции: «статус заказа», «записать на приём» и любые другие.
- Переписка хранится в SQLite или PostgreSQL. Сервер можно перезапустить посреди ответа: ничего не потеряется.
- Модели DeepSeek, GLM, GPT, Gemini и Claude через DeepSeek, Fireworks, Together AI и OpenRouter. Человек выбирает
  модель прямо в поле ввода.
- По желанию: поиск в интернете, голосовой ввод и голосовой разговор, вложения, список чатов, долгая память, лимиты
  расходов, картинки и схемы в ответах, фоновые задачи, чат в Telegram, VK и MAX.
- Сценарии: разговор идёт по карте шагов (знакомство → разбор → напоминание), а не по одной длинной инструкции.
- Проверка ответа перед отправкой: ловит чужие слова на другом языке и выдуманные ссылки.
- Внешний вид отделён от поведения. Стандартный вид - Одуванчик через `/chat`; явный Тандем или свой скин сохраняют приоритет.

Версия 0.87.1.

## Установка

Нужны Node.js 22 и pnpm 10. Пакеты лежат в общем каталоге npm, ключи для установки не нужны.

## Первый чат за 10 минут

Пример — приложение на Hono (сервер) и React со сборкой Vite (страница). Понадобится ключ хотя бы одного провайдера
моделей: DeepSeek, Fireworks, Together AI или OpenRouter.

**1. Новая папка и пакеты.**

```bash
mkdir my-chat && cd my-chat
pnpm init && pnpm pkg set type=module
pnpm add @ykurilov/agent-chat-core @ykurilov/agent-chat-server @ykurilov/agent-chat-storage-sqlite \
  @ykurilov/agent-chat-react @ykurilov/agent-chat-skin-oduvanchik "@tandem/ui@npm:@ykurilov/tandem-ui@^0.7.0" \
  hono @hono/node-server react react-dom
pnpm add -D tsx typescript @types/node @types/react @types/react-dom vite @vitejs/plugin-react tailwindcss @tailwindcss/vite
```

pnpm может написать «Ignored build scripts: better-sqlite3». Это не ошибка: у хранилища есть готовые сборки.

**2. Ключ модели.** Файл `.env` в корне папки (в git его не кладите):

```ini
DEEPSEEK_API_KEY=ваш-ключ
```

Подойдёт и `OPENROUTER_API_KEY`, `FIREWORKS_API_KEY` или `TOGETHER_API_KEY`. Ключ остаётся на сервере, браузер его не видит.

**3. Сервер.**

```ts
// server/index.ts
import { serve } from "@hono/node-server";
import { standardCatalog } from "@ykurilov/agent-chat-core";
import { createChatHandler } from "@ykurilov/agent-chat-server";
import { mountChat } from "@ykurilov/agent-chat-server/hono";
import { createSqliteChatStorage } from "@ykurilov/agent-chat-storage-sqlite";
import { Hono } from "hono";

process.loadEnvFile(".env"); // ключ модели → process.env

const storage = createSqliteChatStorage({ filePath: "chat.sqlite" }); // таблицы создаются сами

const chat = createChatHandler({
  basePath: "/api/chat",
  storage,
  // Входа в примере нет: все посетители — один пользователь. В своём приложении берите id из сессии.
  resolveUser: async () => ({ id: "me" }),
  catalog: standardCatalog, // модель выбирается по ключу, который есть в .env
  agent: { instructions: "Ты — дружелюбный помощник. Отвечай по-русски, коротко и по делу." },
});

const app = new Hono();
mountChat(app, chat); // адреса /api/chat и /api/chat/*
await chat.recoverInterruptedAnswers(); // ответы, оборванные прошлым запуском, помечаются прерванными

serve({ fetch: app.fetch, port: 3000 });
console.log("Сервер чата: http://localhost:3000");
```

**4. Страница.** Четыре файла:

```html
<!-- index.html -->
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Чат с агентом</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/main.tsx
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const [chatId, setChatId] = useState<string | null>(null);

  useEffect(() => {
    // Новый чат при каждом открытии страницы. В своём приложении храните id чата: в адресе страницы или в базе.
    void fetch("/api/chat", { method: "POST" })
      .then((response) => response.json() as Promise<{ id: string }>)
      .then(({ id }) => setChatId(id));
  }, []);

  if (!chatId) return null;
  return (
    <div style={{ height: "100dvh" }}>
      <AgentChat api="/api/chat" chatId={chatId} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
```

```css
/* src/styles.css */
@import "tailwindcss";
@import "@ykurilov/agent-chat-skin-oduvanchik/styles.css";
@source "../node_modules/@tandem/ui/dist";
@source "../node_modules/@ykurilov/agent-chat-skin-oduvanchik/dist";
```

```ts
// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": "http://localhost:3000" } }, // запросы чата — на сервер из шага 3
});
```

Стандартный экран использует Одуванчик без `skin`. `ChatWorkspace` и `AgentPanel` доступны из того же `/chat`; провайдер панели и хуки остаются в `@ykurilov/agent-chat-react/panel`. [Другой скин и переход со старого импорта](skins/oduvanchik/README.md). Редактор `FlowEditor`/`FlowTestChat` также поддерживает официальный `oduvanchikFlowEditorSkin` из `/flows`; [подключение редактора и вложенного чата](skins/oduvanchik/README.md#редактор-сценария). Остальные административные расширения используют отдельные скины Тандема.

**5. Запуск.** В двух окнах терминала:

```bash
pnpm tsx server/index.ts   # сервер чата
pnpm vite                  # страница: откройте http://localhost:5173
```

Напишите агенту «Привет» — ответ начнёт печататься сразу.

**Дальше.**

- Свои функции для агента (инструменты), выбор модели по умолчанию, PostgreSQL вместо SQLite, вход пользователей —
  [docs/getting-started.md](docs/getting-started.md).
- Next.js вместо Hono — раздел [Next.js](docs/getting-started.md#nextjs) и пример [apps/next-example](apps/next-example).

## Документация

- [Подключение шаг за шагом](docs/getting-started.md) — от пустого приложения до работающего чата, все настройки.
- Возможности по желанию: [виджеты](docs/widgets.md), [картинки](docs/images.md), [схемы](docs/diagrams.md),
  [видео](docs/videos.md), [живые демонстрации](docs/live-demos.md), [помощники](docs/helpers.md),
  [фоновые задачи](docs/background.md), [мессенджеры](docs/messengers.md), [песочница](docs/sandbox.md),
  [агент внутри продукта](docs/in-product-agent.md), [сценарии](docs/flows.md),
  [проверка ответа](docs/reply-check.md), [простой вид работы агента](docs/work-view.md).
- Каждый пакет описан в своём README: папки [packages](packages) и [skins/tandem](skins/tandem).
- Точные описания HTTP-адресов, скина и словаря надписей — [docs/contracts](docs/contracts).
- Что менялось от версии к версии — [CHANGES.md](CHANGES.md).

## Пакеты

| Пакет | Что делает |
|---|---|
| [`@ykurilov/agent-chat-attachments`](packages/attachments) | вложения: файлы и картинки |
| [`@ykurilov/agent-chat-background`](packages/background) | фоновые задачи и помощники |
| [`@ykurilov/agent-chat-core`](packages/core) | ядро: модели, провайдеры, цикл агента, хранилище-договор |
| [`@ykurilov/agent-chat-diagrams`](packages/diagrams) | схемы в ответах |
| [`@ykurilov/agent-chat-flows`](packages/flows) | сценарии: разговор по карте шагов, дням и касаниям |
| [`@ykurilov/agent-chat-history-search`](packages/history-search) | поиск по истории чатов |
| [`@ykurilov/agent-chat-image-library`](packages/image-library) | библиотека готовых картинок |
| [`@ykurilov/agent-chat-images`](packages/images) | картинки от агента |
| [`@ykurilov/agent-chat-limits`](packages/limits) | лимиты расходов |
| [`@ykurilov/agent-chat-mcp`](packages/mcp) | серверы MCP, которые подключает админ: инструменты чужих сервисов для агента |
| [`@ykurilov/agent-chat-memory`](packages/memory) | долгая память о человеке |
| [`@ykurilov/agent-chat-messengers`](packages/messengers) | чат в Telegram, VK и MAX |
| [`@ykurilov/agent-chat-react`](packages/react) | экран чата на React и договор скина |
| [`@ykurilov/agent-chat-reply-check`](packages/reply-check) | проверка ответа перед отправкой: чужие слова и выдуманные ссылки |
| [`@ykurilov/agent-chat-sandbox`](packages/sandbox) | песочница для кода агента |
| [`@ykurilov/agent-chat-server`](packages/server) | сервер чата для Hono и Next.js |
| [`@ykurilov/agent-chat-skills`](packages/skills) | навыки агента: указания для отдельных задач, которые агент загружает сам |
| [`@ykurilov/agent-chat-storage-postgres`](packages/storage-postgres) | хранилище переписки в PostgreSQL |
| [`@ykurilov/agent-chat-storage-sqlite`](packages/storage-sqlite) | хранилище переписки в SQLite |
| [`@ykurilov/agent-chat-videos`](packages/videos) | видео в ответах |
| [`@ykurilov/agent-chat-voice`](packages/voice) | голосовой ввод (диктовка) |
| [`@ykurilov/agent-chat-voice-dialog`](packages/voice-dialog) | голосовой разговор с агентом |
| [`@ykurilov/agent-chat-web-tools`](packages/web-tools) | поиск и чтение сайтов для агента |
| [`@ykurilov/agent-chat-skin-oduvanchik`](skins/oduvanchik) | стандартный UI /chat и Студия /sandbox: Одуванчик по умолчанию |
| [`@ykurilov/agent-chat-skin-tandem`](skins/tandem) | готовый вид «Тандем» |

## Демо из этого репозитория

В `apps/demo` собраны все возможности сразу. Запуск с подставной моделью, без ключей и без платных запросов:

```bash
pnpm install
pnpm build
DEMO_MODEL=mock pnpm dev
```

## Лицензия

[MIT](LICENSE). Пользуйтесь, меняйте и встраивайте в свои продукты, в том числе платные. Часть кода перенесена из
открытых проектов — список в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
