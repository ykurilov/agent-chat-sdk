# Видео от агента

Агент присылает человеку видео из каталога приложения: «покажи короткий урок про промпты» — в ленте карточка с обложкой,
названием и длительностью. Нажал — плеер YouTube или Kinescope играет прямо в ленте, есть кнопка «На весь экран». Агент может
начать с нужной минуты, тогда на карточке написано «с 3:20». Это отдельный пакет `@ykurilov/agent-chat-videos`.

Без пакета ничего не меняется.

## Включить

```bash
pnpm add @ykurilov/agent-chat-videos
```

```ts
// сервер
import { createVideoLibrary } from "@ykurilov/agent-chat-videos";

const videos = createVideoLibrary({
  videos: [
    {
      id: "prompts-intro",
      title: "Промпты: с чего начать",
      url: "https://www.youtube.com/watch?v=aircAruvnKk", // YouTube или Kinescope
      description: "Как писать запросы, чтобы модель понимала с первого раза.",
      durationSeconds: 1153,
      poster: "/posters/prompts.jpg", // https:// или путь от корня; нет — нейтральная заглушка
      chapters: [{ title: "Примеры", startSeconds: 200 }],
    },
  ],
});

createChatHandler({
  …,
  agent: {
    instructions: appInstructions,
    tools: (model) => ({ ...appTools(model), ...videos.tools(model) }),
  },
});
```

```tsx
// страница
import { videosClient } from "@ykurilov/agent-chat-videos/react";
<AgentChat … videos={videosClient} />; // так же у ChatWorkspace и AgentPanel
```

Ссылки понимаются такие: `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/embed|shorts|live/…`, `m.youtube.com`,
`youtube-nocookie.com`; `kinescope.io/<код>` и `kinescope.io/embed/<код>`. Свои домены Kinescope не поддерживаются.

Каталог-массив проверяется сразу при `createVideoLibrary`: повтор id, пустое название, ссылка не с YouTube и не с Kinescope,
обложка не https, глава за концом видео — исключение с id записи.

## Как агент находит видео

Каталог в запрос модели не попадает. У агента два инструмента:

- `find_videos({ query })` — ищет по словам и отдаёт до 8 подходящих: id, название, описание (до 300 знаков), длительность и главы
  с «3:20» и секундой. Ничего не нашлось — пустой список и совет попробовать другие слова.
- `show_video({ id, startSeconds? })` — показывает одно видео по id. Сервер принимает только id из каталога. Начало — целое
  от 0 и меньше длительности, иначе вызов кончается ошибкой `VideoLibraryError` со словами для модели. Длительность в каталоге не указана — начало сверху не ограничено.
- Функция каталога упала или `search` вернул не список — причина в журнале сервера (`logError`). `find_videos`
  и `show_video` кончаются ошибкой `catalog_unavailable` с нейтральным «каталог видео сейчас недоступен» без текста
  исключения. «Ничего не нашлось» — обычный результат с пустым списком.

Модель видит коротко: `{ "показано": "Промпты: с чего начать", "с": "3:20" }`. Всё нужное карточке хранится в сообщении,
поэтому карточка переживает перезагрузку и удаление видео из каталога.

Описания и схемы инструментов постоянные: начало запроса одно и то же при любом каталоге, кэш модели цел.

Встроенный поиск по массиву: без регистра, «ё» как «е», по началам слов — «промптов» находит «промпты». Название весит больше
глав, главы — больше описания. Слова «видео», «урок», «про» не считаются, если в запросе есть другие. Синонимы («ролик» про
«видео») он не находит: для этого — свой поиск.

## Большая база и права человека

Для тысяч видео или своего поиска (по смыслу, по купленным курсам) вместо массива — две функции:

```ts
const videos = createVideoLibrary({
  source: {
    search: (query, { ownerId, chatId }) => db.findLessons(query, { buyer: ownerId }), // до 8 записей
    get: (id, { ownerId }) => db.lessonFor(id, ownerId), // нет у человека — undefined
  },
  logError: (message) => logger.warn(message),
});
```

Список живёт в базе, а поиск нужен встроенный — `source.search` зовёт тот же поиск, что и массив, на свежем списке:

```ts
import { createVideoLibrary, searchVideos } from "@ykurilov/agent-chat-videos";

const videos = createVideoLibrary({
  source: {
    search: async (query) => searchVideos(await db.listVideos(), query), // до 8 записей, порядок как у массива
    get: (id) => db.videoById(id),
  },
});
```

Записи из функций проверяются на каждом вызове: негодная пропускается, в журнал уходит причина и id, без содержимого записи.
`get`, вернувший запись с чужим id, — отказ.

## На экране

Пока вызов идёт, ничего не показано. Отказ — ошибка инструмента (`VideoLibraryError`, `kind`: `not_in_catalog`,
`catalog_unavailable`, `start_after_end`): в ленте строка «show_video: ошибка» с текстом, модель получает тот же текст.

- До нажатия к YouTube и Kinescope не уходит ни одного запроса: обложка только из каталога, своей нет — заглушка.
- YouTube играет с `youtube-nocookie.com`, плеер получает `referrerpolicy="strict-origin-when-cross-origin"` (без него YouTube
  отказывается играть).
- Адрес плеера экран собирает сам из площадки и кода видео, код проверяется по допустимым знакам. Подделанная запись в базе
  не превратится в чужой iframe.
- «На весь экран» — только если браузер умеет разворачивать элемент страницы. На iPhone кнопки нет, у самого плеера своя.
- Голосовой режим говорит «видео на экране» один раз на видео; что за видео, называет сама модель.

Скин версии 14: необязательная часть `AgentVideo` получает `AgentVideoView` (`id`, `title`, `provider`, `embedUrl`, `pageUrl`,
`poster?`, `duration?`, `start?`). Плеер скин грузит только по нажатию, `embedUrl` уже с автозапуском и стартом. Скин без
`AgentVideo` (версии 13 и раньше) показывает видео ссылкой через `AgentText`: «▶ [Название](страница видео) · с 3:20».
Надписи — группа `videos` (`play`, `from`, `fullscreen`) и `voice.videoOnScreen`.

Для сервера без экрана React не нужен: у пакета `react` и `@ykurilov/agent-chat-react` необязательные.

Пример — `apps/demo` (каталог `server/demo-videos.ts`, в e2e площадки подменены). Живая проверка: `pnpm test:live videos` —
дешёвая модель через OpenRouter находит урок и показывает его с нужной главы.
