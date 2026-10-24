# @ykurilov/agent-chat-image-library

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
