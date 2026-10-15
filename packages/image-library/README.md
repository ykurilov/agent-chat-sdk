# @ykurilov/agent-chat-image-library

Готовые картинки от агента: инструменты `find_images` и `show_image` поверх каталога приложения. В ленте — картинка по
ширине ответа с подписью, по нажатию — окно просмотра. Ничего не генерирует. Отдельное расширение: приложению без
библиотеки картинок пакет не нужен.

Серверу без экрана React не нужен: `react` и `@ykurilov/agent-chat-react` — необязательные зависимости (peer). Для
`@ykurilov/agent-chat-image-library/react` оба должны стоять в приложении.

## Сервер

```ts
import { createImageLibrary } from "@ykurilov/agent-chat-image-library";

const library = createImageLibrary({
  images: [{ id: "cell", title: "Строение клетки", alt: "Схема клетки: ядро, мембрана, митохондрии", url: "/library/cell.png", width: 1200, height: 800 }],
  // или images: () => readCatalog() — каталог меняется без перезапуска
  // или source: { search(query, { ownerId, chatId }), get(id, { ownerId, chatId }) } — для большой базы
  // allowedHosts: ["cdn.school.ru"] — если картинки лежат не на своём сайте
});

createChatHandler({
  …,
  agent: { tools: (model) => ({ ...appTools(model), ...library.tools(model) }) },
});
```

- Модель ищет через `find_images` (до 8 результатов) и показывает через `show_image` по id. Id не из каталога — ошибка
  инструмента `ImageLibraryError`: в ленте строка «ошибка», модель получает тот же текст.
- После показа модель видит только «показано: название». Адрес и размеры остаются в сообщении для экрана.
- Описания инструментов постоянные: кэш модели не зависит от каталога.

## Экран

```tsx
import { imageLibraryClient } from "@ykurilov/agent-chat-image-library/react";

<AgentChat … images={imageLibraryClient} />
// вместе с генерацией картинок: images={[imagesClient, imageLibraryClient]}
// картинки с CDN: createImageLibraryClient({ allowedHosts: ["cdn.school.ru"] })
```

Скин с договором версии 26 рисует картинку по ширине ответа с подписью; в Тандеме это есть. Скин версии 25 показывает её
плиткой ближайшей обычной пропорции (1:1, 3:2, 2:3, 16:9, 9:16) без подписи.

Подробно — [docs/image-library.md](../../docs/image-library.md).
