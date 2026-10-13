# @ykurilov/agent-chat-videos

Видео от агента: инструменты `find_videos` и `show_video` поверх каталога приложения (YouTube и Kinescope), карточка
с плеером в ленте. Отдельное расширение: приложению без видео пакет не нужен.

Серверу без экрана React не нужен: `react` и `@ykurilov/agent-chat-react` — необязательные зависимости (peer). Для
`@ykurilov/agent-chat-videos/react` оба должны стоять в приложении.

## Сервер

```ts
import { createVideoLibrary } from "@ykurilov/agent-chat-videos";

const videos = createVideoLibrary({
  videos: [{ id: "intro", title: "Вводный урок", url: "https://youtu.be/aircAruvnKk", durationSeconds: 1153 }],
  // или source: { search(query, { ownerId, chatId }), get(id, { ownerId, chatId }) } — для большой базы
});

createChatHandler({
  …,
  agent: { tools: (model) => ({ ...appTools(model), ...videos.tools(model) }) },
});
```

- Модель ищет через `find_videos` (до 8 результатов, с главами) и показывает через `show_video` по id. Чужой id — отказ.
- Можно начать с нужной секунды (`startSeconds`), на карточке — «с 3:20».
- Описания инструментов постоянные: кэш модели не зависит от каталога.

## Экран

```tsx
import { videosClient } from "@ykurilov/agent-chat-videos/react";

<AgentChat … videos={videosClient} />
```

Скину нужен `AgentVideo` (договор скина, версия 14); в Тандеме он есть. Без него видео показано ссылкой в тексте ответа,
без `videos` — обычной строкой инструмента. До нажатия к площадкам не уходит ни одного запроса.

Подробно — [docs/videos.md](../../docs/videos.md). Живая проверка: `pnpm test:live videos`.
