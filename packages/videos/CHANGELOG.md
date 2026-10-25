# @ykurilov/agent-chat-videos

## 0.83.2

### Patch Changes

- @ykurilov/agent-chat-react@0.83.2

## 0.83.1

### Patch Changes

- @ykurilov/agent-chat-react@0.83.1

## 0.83.0

### Patch Changes

- @ykurilov/agent-chat-react@0.83.0

## 0.82.1

### Patch Changes

- @ykurilov/agent-chat-react@0.82.1

## 0.82.0

### Patch Changes

- @ykurilov/agent-chat-react@0.82.0

## 0.81.0

### Patch Changes

- Updated dependencies [038b6e2]
  - @ykurilov/agent-chat-react@0.81.0

## 0.80.1

### Patch Changes

- @ykurilov/agent-chat-react@0.80.1

## 0.80.0

### Patch Changes

- @ykurilov/agent-chat-react@0.80.0

## 0.79.1

### Patch Changes

- @ykurilov/agent-chat-react@0.79.1

## 0.79.0

### Patch Changes

- @ykurilov/agent-chat-react@0.79.0

## 0.78.0

### Patch Changes

- @ykurilov/agent-chat-react@0.78.0

## 0.77.0

### Patch Changes

- @ykurilov/agent-chat-react@0.77.0

## 0.76.0

### Patch Changes

- @ykurilov/agent-chat-react@0.76.0

## 0.75.0

### Patch Changes

- Updated dependencies [dfb9869]
  - @ykurilov/agent-chat-react@0.75.0

## 0.74.0

### Patch Changes

- Updated dependencies [3140c17]
  - @ykurilov/agent-chat-react@0.74.0

## 0.73.0

### Patch Changes

- @ykurilov/agent-chat-react@0.73.0

## 0.72.0

### Patch Changes

- @ykurilov/agent-chat-react@0.72.0

## 0.71.1

### Patch Changes

- Updated dependencies [519914e]
  - @ykurilov/agent-chat-react@0.71.1

## 0.71.0

### Patch Changes

- Updated dependencies [8b8c651]
  - @ykurilov/agent-chat-react@0.71.0

## 0.70.1

### Patch Changes

- @ykurilov/agent-chat-react@0.70.1

## 0.70.0

### Patch Changes

- @ykurilov/agent-chat-react@0.70.0

## 0.69.1

### Patch Changes

- @ykurilov/agent-chat-react@0.69.1

## 0.69.0

### Patch Changes

- Updated dependencies [e6c03dc]
  - @ykurilov/agent-chat-react@0.69.0

## 0.68.0

### Patch Changes

- @ykurilov/agent-chat-react@0.68.0

## 0.67.0

### Patch Changes

- @ykurilov/agent-chat-react@0.67.0

## 0.66.0

### Patch Changes

- @ykurilov/agent-chat-react@0.66.0

## 0.65.1

### Patch Changes

- @ykurilov/agent-chat-react@0.65.1

## 0.65.0

### Patch Changes

- Updated dependencies [814ee7f]
  - @ykurilov/agent-chat-react@0.65.0

## 0.64.0

### Patch Changes

- Updated dependencies [99cded9]
  - @ykurilov/agent-chat-react@0.64.0

## 0.63.2

### Patch Changes

- @ykurilov/agent-chat-react@0.63.2

## 0.63.1

### Patch Changes

- Updated dependencies [8bcee93]
  - @ykurilov/agent-chat-react@0.63.1

## 0.63.0

### Patch Changes

- @ykurilov/agent-chat-react@0.63.0

## 0.62.0

### Patch Changes

- @ykurilov/agent-chat-react@0.62.0

## 0.61.0

### Patch Changes

- @ykurilov/agent-chat-react@0.61.0

## 0.60.0

### Patch Changes

- @ykurilov/agent-chat-react@0.60.0

## 0.59.0

### Patch Changes

- @ykurilov/agent-chat-react@0.59.0

## 0.58.0

### Patch Changes

- @ykurilov/agent-chat-react@0.58.0

## 0.57.0

### Patch Changes

- @ykurilov/agent-chat-react@0.57.0

## 0.56.0

### Minor Changes

- 1eadba9: Библиотека готовых картинок: новый пакет `@ykurilov/agent-chat-image-library` с инструментами `find_images` и
  `show_image` поверх каталога приложения. Картинка показывается по ширине ответа с подписью, по нажатию — окно просмотра.
  
  - `images` у `AgentChat`, `ChatWorkspace`, `AgentPanel` принимает и список клиентов: `images={[imagesClient, imageLibraryClient]}`.
    Одиночный клиент работает как раньше.
  - Договор скина версии 26: у `GeneratedImages` необязательные `wide` и `caption`. Тандем их рисует. Скин версии 25
    работает без правок: картинка будет плиткой ближайшей обычной пропорции (1:1, 3:2, 2:3, 16:9, 9:16) без подписи.
  
  Подробно и как подключить — `docs/image-library.md`.
  
  Отказ `show_image`, `show_video` и недоступный каталог в `find_images`, `find_videos` теперь ошибка инструмента (`ImageLibraryError`, `VideoLibraryError` с полем `kind`).
  В ленте строка «ошибка» вместо зелёной галочки, модель получает тот же текст. Код, который читал `{ отказ }` из
  результата `show_video` или `find_videos`, должен смотреть на `state: "output-error"` у части сообщения.

### Patch Changes

- Updated dependencies [1eadba9]
  - @ykurilov/agent-chat-react@0.56.0

## 0.55.0

### Patch Changes

- Updated dependencies [cdc7dd7]
  - @ykurilov/agent-chat-react@0.55.0

## 0.54.0

### Patch Changes

- Updated dependencies [c8fb0dd]
- Updated dependencies [73d3aaa]
  - @ykurilov/agent-chat-react@0.54.0

## 0.53.0

### Patch Changes

- Updated dependencies [b6a7786]
  - @ykurilov/agent-chat-react@0.53.0

## 0.52.0

### Patch Changes

- @ykurilov/agent-chat-react@0.52.0

## 0.51.0

### Patch Changes

- @ykurilov/agent-chat-react@0.51.0

## 0.50.0

### Patch Changes

- @ykurilov/agent-chat-react@0.50.0

## 0.49.0

### Patch Changes

- Updated dependencies [084cef7]
  - @ykurilov/agent-chat-react@0.49.0

## 0.48.0

### Patch Changes

- @ykurilov/agent-chat-react@0.48.0

## 0.47.0

### Patch Changes

- @ykurilov/agent-chat-react@0.47.0

## 0.46.2

### Patch Changes

- @ykurilov/agent-chat-react@0.46.2

## 0.46.1

### Patch Changes

- @ykurilov/agent-chat-react@0.46.1

## 0.46.0

### Patch Changes

- Updated dependencies [56d7528]
  - @ykurilov/agent-chat-react@0.46.0

## 0.45.0

### Patch Changes

- Updated dependencies [eb74c58]
- Updated dependencies [ac9aede]
  - @ykurilov/agent-chat-react@0.45.0

## 0.44.0

### Patch Changes

- Updated dependencies [6a2b5d9]
  - @ykurilov/agent-chat-react@0.44.0

## 0.43.0

### Patch Changes

- @ykurilov/agent-chat-react@0.43.0

## 0.42.0

### Patch Changes

- Updated dependencies [a385276]
  - @ykurilov/agent-chat-react@0.42.0

## 0.41.0

### Patch Changes

- Updated dependencies [9472fcb]
  - @ykurilov/agent-chat-react@0.41.0

## 0.40.0

### Patch Changes

- Updated dependencies [0e7aab3]
  - @ykurilov/agent-chat-react@0.40.0

## 0.39.1

### Patch Changes

- Updated dependencies [5c0f3af]
  - @ykurilov/agent-chat-react@0.39.1

## 0.39.0

### Patch Changes

- Updated dependencies [3b90429]
  - @ykurilov/agent-chat-react@0.39.0

## 0.38.0

### Patch Changes

- @ykurilov/agent-chat-react@0.38.0

## 0.37.0

### Patch Changes

- @ykurilov/agent-chat-react@0.37.0

## 0.36.0

### Patch Changes

- Updated dependencies [3487fb4]
- Updated dependencies [5f13c74]
  - @ykurilov/agent-chat-react@0.36.0

## 0.35.0

### Patch Changes

- Updated dependencies [6ceee78]
  - @ykurilov/agent-chat-react@0.35.0

## 0.34.0

### Patch Changes

- Updated dependencies [d039ce4]
  - @ykurilov/agent-chat-react@0.34.0

## 0.33.0

### Patch Changes

- @ykurilov/agent-chat-react@0.33.0

## 0.32.0

### Patch Changes

- Updated dependencies [4087a22]
  - @ykurilov/agent-chat-react@0.32.0

## 0.31.2

### Patch Changes

- @ykurilov/agent-chat-react@0.31.2

## 0.31.1

### Patch Changes

- @ykurilov/agent-chat-react@0.31.1

## 0.31.0

### Patch Changes

- @ykurilov/agent-chat-react@0.31.0

## 0.30.0

### Patch Changes

- @ykurilov/agent-chat-react@0.30.0

## 0.29.0

### Patch Changes

- @ykurilov/agent-chat-react@0.29.0

## 0.28.0

### Patch Changes

- Updated dependencies [d63ccaa]
- Updated dependencies [189cba9]
  - @ykurilov/agent-chat-react@0.28.0

## 0.27.0

### Patch Changes

- Updated dependencies [5e4ed28]
- Updated dependencies [e0bb519]
  - @ykurilov/agent-chat-react@0.27.0

## 0.26.2

### Patch Changes

- @ykurilov/agent-chat-react@0.26.2

## 0.26.1

### Patch Changes

- Updated dependencies [5b52515]
  - @ykurilov/agent-chat-react@0.26.1

## 0.26.0

### Patch Changes

- @ykurilov/agent-chat-react@0.26.0

## 0.25.0

### Patch Changes

- @ykurilov/agent-chat-react@0.25.0

## 0.24.0

### Patch Changes

- Updated dependencies [9b895cd]
  - @ykurilov/agent-chat-react@0.24.0

## 0.23.0

### Patch Changes

- Updated dependencies [30fb729]
  - @ykurilov/agent-chat-react@0.23.0

## 0.22.0

### Patch Changes

- @ykurilov/agent-chat-react@0.22.0

## 0.21.0

### Patch Changes

- @ykurilov/agent-chat-react@0.21.0

## 0.20.0

### Patch Changes

- Updated dependencies [fd16b01]
  - @ykurilov/agent-chat-react@0.20.0

## 0.19.0

### Patch Changes

- Updated dependencies [aa0fd51]
- Updated dependencies [6f26b93]
  - @ykurilov/agent-chat-react@0.19.0

## 0.18.6

### Patch Changes

- c688091: Встроенный поиск `searchVideos(videos, query)` экспортируется из корня пакета: приложение со списком роликов в базе зовёт его из `source.search`.
- @ykurilov/agent-chat-react@0.18.6

## 0.18.5

### Patch Changes

- Updated dependencies [56b9ab6]
  - @ykurilov/agent-chat-react@0.18.5

## 0.18.4

### Patch Changes

- @ykurilov/agent-chat-react@0.18.4

## 0.18.3

### Patch Changes

- Updated dependencies [ce3c26f]
  - @ykurilov/agent-chat-react@0.18.3

## 0.18.2

### Patch Changes

- Updated dependencies [7e7e966]
  - @ykurilov/agent-chat-react@0.18.2

## 0.18.1

### Patch Changes

- Updated dependencies [179ad9d]
  - @ykurilov/agent-chat-react@0.18.1

## 0.18.0

### Patch Changes

- Updated dependencies [43d7ebe]
  - @ykurilov/agent-chat-react@0.18.0

## 0.17.0

### Minor Changes

- e5d0860: Видео от агента: новый пакет `@ykurilov/agent-chat-videos`. Агент находит видео в каталоге приложения (`find_videos`) и
  присылает карточкой (`show_video`), можно с нужной минуты. По нажатию плеер YouTube (`youtube-nocookie.com`) или Kinescope
  играет в ленте, есть «На весь экран». До нажатия к площадкам не уходит ни одного запроса.
  
  - сервер: `createVideoLibrary({ videos })` или `({ source: { search, get } })`, `videos.tools(model)` в `agent.tools`;
  - страница: `videos={videosClient}` у `AgentChat`, `ChatWorkspace` и `AgentPanel`;
  - договор скина версии 14: необязательная часть `AgentVideo` (`AgentVideoView`); скин без неё показывает видео ссылкой;
  - надписи `videos.play`, `videos.from`, `videos.fullscreen` и `voice.videoOnScreen` («видео на экране» в голосовом режиме).
  
  Подробно: `docs/videos.md`.
  
  ### Как обновить приложение
  
  Обычному приложению делать ничего не нужно: видео включается отдельно, миграций нет.
  
  1. Полный словарь надписей, написанный вручную без `{ ...russianLabels }`, — добавьте `voice.videoOnScreen`.
  2. Проверка: `pnpm typecheck`, затем в чате отправить сообщение и получить ответ.

### Patch Changes

- Updated dependencies [e5d0860]
  - @ykurilov/agent-chat-react@0.17.0
