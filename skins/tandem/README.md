# Скин Тандема для чата с агентом

Компоненты чата под дизайн-систему Тандем. Реализуют договор скина из
`@ykurilov/agent-chat-react`.

Скин — пакет `@ykurilov/agent-chat-skin-tandem`: `import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem"`.
Отдельный компонент можно заменить, не трогая остальные: `{ ...tandemSkin, ToolCallRow: MyToolCallRow }`.
Если нужно поправить скин целиком, скопируйте `src/` из репозитория к себе и правьте как свой код.

Дизайн-система ставится вместе со скином как `@ykurilov/tandem-ui`. Приложению она нужна под именем `@tandem/ui`
(из CSS-файла приложения пакет скина не виден):

```bash
pnpm add @ykurilov/agent-chat-skin-tandem "@tandem/ui@npm:@ykurilov/tandem-ui@^0.7.0"
```

Версия Тандема (0.6.x) не равна версии SDK: какой Тандем нужен скину, написано в его `dependencies`.

Главный CSS-файл приложения (пути от CSS-файла до корня проекта поправьте под своё место):

```css
@import "tailwindcss";
@import "@tandem/ui/styles.css";
@source "../node_modules/@tandem/ui/dist";
@source "../node_modules/@ykurilov/agent-chat-skin-tandem/dist";
```

Ветки и правка: под сообщением собеседника — карандаш «Изменить сообщение», под ответом агента — «Переделать ответ»; там же переключатель «‹ 2/3 ›»
(`BranchSwitcher`), правка идёт на месте пузыря (`MessageEditor`). Строка с кнопками занимает прежний промежуток между сообщениями:
высота сообщения не меняется. На телефоне кнопки видны без наведения.

Простой вид работы агента (договор 28): рядом с «Сделано N шагов» — ряд значков шагов lucide (больше 8 — «+N»), в
раскрытом списке у каждой строки свой значок, в живой строке значок текущего шага заменяет точку. Раздумье с заголовком
от сервера показывает его вместо «Думал N сек», и в подробном виде тоже.

Свои кнопки приложения под ответом (`messageActions`, договор скина версии 17) стоят в том же ряду, после копирования: с иконкой —
кнопка-иконка с подсказкой, как копирование; без иконки — подпись текстом, как «Повторить». Пока обработчик идёт, кнопка неактивна.

Выбор модели в поле ввода: если чат передаёт `modelChoice`, `Composer` рисует вариант `extended` Тандема — меню
провайдеров с подменю моделей и выбор уровня рассуждений. На узком экране (телефон) меню плоское: «модель · провайдер».
Без `modelChoice` поле ввода прежнее.

Голос: если чат передаёт `voice`, рядом с полем появляется кнопка микрофона (`TandemVoiceButton`): в покое, подключение,
запись (нажата, пульсирует); ошибка — строкой под полем. Без `voice` кнопки нет.

Список чатов: `TandemChatWorkspace` и `TandemChatList` (договор скина версии 7, только для `ChatWorkspace`). На широком экране список слева, на узком — полоса с кнопкой «Чаты» и панель у левого края (без анимации: выезд панели в Тандеме идёт справа). Меню строки — «Переименовать» и «Удалить», удаление через окно подтверждения.

Экран памяти: `tandemMemorySkin` (`TandemMemoryScreen`, `TandemMemoryGroup`, `TandemMemoryNoteRow`, `TandemMemoryNoteEditor`, `TandemMemoryConfirm`) — договор скина версии 11 для `AgentMemory`. Всё переносится по строкам: на телефоне нет горизонтальной прокрутки. Строка вызова инструмента памяти называется «Работа с памятью» (`withMemoryToolTitles` из `@ykurilov/agent-chat-memory/labels`).

Панель агента: `TandemAgentPanelLauncher` и `TandemAgentPanel` (входят в `tandemSkin`; договор скина версии 12 для `AgentPanel` из `@ykurilov/agent-chat-react/panel`). Панель без затемнения страницы, на экране до 640 px — на весь экран, список чатов открывается поверх чата.

Панель подключения мессенджеров: `tandemMessengersSkin` из `@ykurilov/agent-chat-skin-tandem/messengers` (договор скина мессенджеров версии 1, `TandemMessengerConnectPanel`) — для `MessengerConnect` из `@ykurilov/agent-chat-messengers/react`:

```tsx
import { MessengerConnect } from "@ykurilov/agent-chat-messengers/react";
import { tandemMessengersSkin } from "@ykurilov/agent-chat-skin-tandem/messengers";

<MessengerConnect url="/api/messengers" skin={tandemMessengersSkin} />;
```

Надписей в коде скина нет: все берутся из словаря `useChatLabels()`. Это проверяет
`scripts/check-rules.mjs` в `pnpm test`.

Подключение целиком: [docs/getting-started.md](https://github.com/ykurilov/agent-chat-sdk/blob/main/docs/getting-started.md).

Журнал изменений и что делать при обновлении: [CHANGELOG.md](./CHANGELOG.md). Все пакеты SDK выходят вместе и с одной версией; обновление — `pnpm update "@ykurilov/agent-chat-*" --latest`.
