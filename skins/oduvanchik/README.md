# Скин Одуванчик

`@ykurilov/agent-chat-skin-oduvanchik` - скин SDK Agent Chat, договор `ChatSkin` v29. Нейтральный фон, системный шрифт, оранжевый акцент, чёрная кнопка отправки (светлая в тёмной теме), сфера работы агента и значки Phosphor.

## Подключение

После публикации пакета:

```sh
pnpm add @ykurilov/agent-chat-react @ykurilov/agent-chat-skin-oduvanchik
```

В главном CSS приложения с Tailwind CSS 4:

```css
@import "tailwindcss";
@import "@ykurilov/agent-chat-skin-oduvanchik/styles.css";
@source "../node_modules/@ykurilov/agent-chat-skin-oduvanchik/dist";
@source "../node_modules/@tandem/ui/dist";
```

`@tandem/ui` - опубликованная зависимость скина (npm-алиас `@ykurilov/tandem-ui`). При строгой структуре pnpm добавьте её напрямую, чтобы Tailwind видел её классы: `pnpm add @tandem/ui@npm:@ykurilov/tandem-ui@^0.7.0`. Пути `@source` указаны от CSS-файла: поправьте их под приложение.

```tsx
import { AgentChat } from "@ykurilov/agent-chat-react";
import { oduvanchikSkin } from "@ykurilov/agent-chat-skin-oduvanchik";

<div className="oduvanchik-chat" style={{ height: "100dvh" }}>
  <AgentChat api="/api/chat" chatId="chat-id" skin={oduvanchikSkin}
    composerOptions={{ variant: "standard" }} />
</div>
```

Тема задаётся на корневом элементе: `document.documentElement.dataset.theme = "dark"` или `"light"`. Если атрибута нет, действует системная тема. Класс `dark` для «Одуванчика» не требуется. CSS задаёт общую палитру страницы; разные скины с разными темами на одной странице одновременно не поддерживаются.

В `oduvanchikSkin` входят `ChatListSkin` и `AgentPanelSkin`: список чатов и панель агента справа, которая на телефоне занимает экран. `oduvanchikMemorySkin` подключается отдельно в `AgentMemory`.

Для нового чата экспортируется `OduvanchikWelcome` с большой сферой: приложение передаёт `title`, `description`, `suggestions: [{ label, category? }]` и `onPick`. Это дополнительная композиция, SDK не вставляет её автоматически в пустую ленту. Сфера отдельно - `OduvanchikSphere`.

## Что оформлено

Лента и ответ без пузыря; сообщение человека на серой поверхности; действия под ответом; карточка шагов v28 со значками, раскрытием и неизвестным видом шага; раздумья с заголовком; карточка подтверждения с полосой акцента; поле ввода с чёрной отправкой, остановкой, файлами, вставкой/перетаскиванием и выбором модели. Поле сохраняет черновик при появлении меню, вложений и голоса. Enter отправляет, Shift+Enter переносит строку; Enter при IME-композиции не отправляет.

Сохранены части текущего договора: голос и диалоговый голосовой режим, ошибки и лимиты, служебные строки, ветки и редактор сообщения, виджеты, изображения/видео, просмотр медиа, фоновые задачи и помощники. Тексты берутся из словаря SDK; текст нового чата задаёт приложение.

## Что пока осталось базовым

Сложные виджеты, просмотр медиа, редакторы памяти и диалоговый голосовой режим используют нейтральные примитивы `@tandem/ui` с переменными «Одуванчика». Это не полная замена примитивов на `ds-react`. Отдельные расширения `sandbox`, `flows`, `messengers`, `skills`, `mcp`, `client-card` здесь не экспортируются; для их административных экранов пока остаётся скин Тандема.

Все значки внутри официального скина, включая копирование кода, уведомления, выбранный голос, стрелки меню и закрытие диалогов, - Phosphor regular. Внутренние `primitives` адаптированы из `@ykurilov/tandem-ui@0.7.0` (MIT, [лицензия](TANDEM_NOTICES.md)): Markdown сохраняет `react-markdown`/`remark-gfm`, меню и диалоги - Radix, клавиатуру, фокус и порталы. Свойств подмены значков в исходных компонентах нет. Адаптеры поддерживаются здесь; сторонний пакет Тандема не изменяется. Транзитивная зависимость `lucide-react` остаётся у `@tandem/ui`, но компоненты Одуванчика её значки не рисуют. Приложение не импортирует эти внутренние компоненты и не подменяет значки CSS-правилами.

### Как обновить приложение

После выпуска обновить `@ykurilov/agent-chat-*` одной версией и пересобрать приложение с прежними `oduvanchikSkin` и CSS. Дополнительных зависимостей и настроек от приложения не требуется: Markdown и Radix устанавливаются зависимостями скина. Удалить временные переопределения значков в приложении, если они были добавлены. Договор скина и данные не меняются. Проверочная витрина `/oduvanchik-icons.html` показывает реальные компоненты скина с Markdown, уведомлениями, голосовым меню и подтверждением удаления памяти.

Сфера и переменные подключены из опубликованных `@ykurilov/ds-react@^0.1.0` и `@ykurilov/ds-tokens@^0.1.0`. Эти пакеты, Phosphor и CSS входят в зависимости скина; приложение предоставляет React и React DOM 19. Локальных копий сферы/токенов нет.

## Три вида поля

`composerOptions.variant` у `AgentChat`, `ChatWorkspace` или `AgentPanel`:

- `compact` - одна строка текста и отправка;
- `standard` - обычный вид по умолчанию: меню «+», файлы/картинки/проекты, контекст и голос;
- `extended` - модель с поиском и группами, провайдер «Через», рассуждения, инструменты и микрофон. На телефоне фишки открывают общую шторку «Настройки ответа».

Во всех видах Enter отправляет, Shift+Enter переносит строку, ввод через IME не вызывает случайной отправки. Пустое поле не отправляется; готовые вложения учитываются. Поле растёт. Во время ответа кнопка становится «Стоп», фишки заблокированы. Одуванчик не предлагает отправку поправки поверх идущего ответа; остальные скины сохраняют свой выбор поддержки `canSteer`.

Выбор модели/провайдера/уровня уже связан со штатным `GET …/models` и `PUT …/model` через `useModelChoice`. В расширенном виде подпись под ответом берётся из его метаданных, а не из текущего выбора; у старых ответов неизвестный уровень пропускается. «Показывать ход мысли» меняет отображение, не права доступа. Цена - базовые USD за миллион токенов: вход / выход; пики, кэш и длинный контекст в этой подсказке не пересчитываются.

```tsx
import type { ComposerOptions } from "@ykurilov/agent-chat-react";

const composerOptions: ComposerOptions = {
  variant: "extended",
  context: { label: "Мастерская", onPick: openContextPicker },
  projects: [{ id: "webinar", label: "Лендинг вебинара", onPick: attachProject }],
  contextAttachments: selectedProjects.map(project => ({
    id: project.id, label: project.name, onRemove: () => removeProject(project.id),
  })),
  tools: availableTools.map(tool => ({
    id: tool.id, label: tool.name, enabled: tool.enabled,
    onChange: (enabled: boolean) => saveToolSetting(tool.id, enabled),
  })),
};
<AgentChat api="/api/chat" chatId="chat-id" skin={oduvanchikSkin}
  composerOptions={composerOptions} />;
```

`openContextPicker`, `attachProject`, `saveToolSetting` - обработчики приложения. Проекты передаются агенту через контекст приложения (например `appBridge`); переключатели инструментов приложение связывает с разрешёнными серверными настройками хода. Скин сам не включает инструменты ядра и не выдаёт проект за загруженный файл. Без `attachments` загрузки файлов нет, без `voice` нет микрофона. [Полный общий договор](../../docs/skin-v29.md).

## Проверка вида

`apps/demo/skin-gallery/oduvanchik.html` - новый чат, шаги, файл и подтверждение. `/oduvanchik-composers.html` - все три вида поля с каталогом SDK и имитацией ответа. Запуск: `pnpm --filter @ykurilov/agent-chat-demo exec vite --config skin-gallery/vite.config.ts`, адрес `/oduvanchik.html`. Перед локальной витриной собрать `@ykurilov/agent-chat-react`, затем этот скин. Браузерный сценарий трёх полей: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts oduvanchik-composers.spec.ts --workers=1`. Прежний сценарий: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts oduvanchik.spec.ts --workers=1`.

Снимки сохраняются через `screenshotFolder("agent-chat-oduvanchik-composers")` (прежняя витрина - `agent-chat-skin-oduvanchik`); `E2E_SCREENSHOT_DIR` меняет папку. Публиковать пакет следует вместе с общей группой версий SDK.
