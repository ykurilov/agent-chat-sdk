# Скин Одуванчик

`@ykurilov/agent-chat-skin-oduvanchik` - скин SDK Agent Chat, договор `ChatSkin` v31. Нейтральный фон, системный шрифт, оранжевый акцент, чёрная кнопка отправки (светлая в тёмной теме), сфера работы агента и значки Phosphor.

## Подключение

Стандартный вход SDK с оформлением Одуванчик:

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
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";

<div style={{ height: "100dvh" }}>
  <AgentChat api="/api/chat" chatId="chat-id"
    composerOptions={{ variant: "standard" }} />
</div>
```

`AgentChat`, `ChatWorkspace`, `AgentPanel` и их типы свойств экспортируются из `/chat`. Все свойства исходных компонентов сохраняются; `skin` необязателен и по умолчанию равен `oduvanchikSkin`. Провайдер панели и хуки берутся из `@ykurilov/agent-chat-react/panel`. CSS подключается явно один раз, JavaScript его не импортирует.

Явный скин всегда имеет приоритет:

```tsx
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";
<AgentChat api="/api/chat" chatId="chat-id" skin={tandemSkin} />;
```

Для Тандема вместо CSS Одуванчика используйте `@import "@tandem/ui/styles.css";` и `@source` на `agent-chat-skin-tandem/dist` и `@tandem/ui/dist`. Свой скин передаётся так же. Не смешивайте две глобальные палитры на одной странице.

Низкоуровневый `@ykurilov/agent-chat-react` по-прежнему требует `skin`: существующие импорты и экспорты не меняются. Зависимость направлена из скина в React, обратной зависимости и глобальной регистрации нет.

Тема задаётся на корневом элементе: `document.documentElement.dataset.theme = "dark"` или `"light"`. Если атрибута нет, действует системная тема. Класс `dark` для «Одуванчика» не требуется. CSS задаёт общую палитру страницы; разные скины с разными темами на одной странице одновременно не поддерживаются.

В `oduvanchikSkin` входят `ChatListSkin` и `AgentPanelSkin`: список чатов и панель агента справа, которая на телефоне занимает экран. `oduvanchikMemorySkin` подключается отдельно в `AgentMemory`.

Для нового чата экспортируется `OduvanchikWelcome` с большой сферой: приложение передаёт `title`, `description`, `suggestions: [{ label, category? }]` и `onPick`. Это дополнительная композиция, SDK не вставляет её автоматически в пустую ленту. Сфера отдельно - `OduvanchikSphere`.

## Встроенная панель без глобальных стилей (0.87.8)

Подключите **вместо** `/styles.css` готовый файл:

```ts
import "@ykurilov/agent-chat-skin-oduvanchik/embedded.css";
```

Он содержит скомпилированные утилиты и ограничивает сброс, компоненты и переменные элементами Одуванчика, включая его порталы. Tailwind, `@source` и CSS Тандема в приложении ради панели не требуются. Заголовки, кнопки, фон, шрифт и отступы остальной страницы сохраняются. Для тёмной темы задайте `data-theme="dark"` на `html`: так тема доступна порталам в `body`. Системная тема также поддерживается. Глобальный вариант остаётся для существующих полноэкранных страниц.

`useAgentPanel().focusComposer()` открывает текущий чат, закрывает список и запрашивает фокус. Работает повторно при открытой панели, не создаёт чат и не заменяет черновик. `showChat()` открывает текущий чат без дополнительного запроса фокуса. Эти методы заменяют программные клики по кнопкам скина.

## Поправки во время ответа

Скин поддерживает `ChatSkin.steering`: при доступном серверном праве `steer` поле принимает поправки, а кнопки отправки и остановки видны одновременно во всех трёх вариантах поля. Реплика с ожидающей поправкой показывает `labels.steeringPending`; после применения пометка исчезает. Модель и вложения во время хода не переключаются. `steering={false}` у `AgentChat` выключает эту возможность.

## Редактор сценария

С 0.78.0 вход `@ykurilov/agent-chat-skin-oduvanchik/flows` экспортирует `oduvanchikFlowEditorSkin` и тип `OduvanchikFlowEditorSkin`. Это полный договор `FlowEditorSkin` v1, включая все дополнительные части. Подключите `@ykurilov/agent-chat-flows` той же версии SDK: это optional peer, который не требуется обычному `/chat` или корневому скину.

```tsx
"use client";
import { FlowTestChat, FlowLabelsProvider, russianFlowLabels } from "@ykurilov/agent-chat-flows/react";
import type { FlowTestChatProps } from "@ykurilov/agent-chat-flows/react";
import { oduvanchikFlowEditorSkin } from "@ykurilov/agent-chat-skin-oduvanchik/flows";
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";

export function ScenarioEditor(props: Omit<FlowTestChatProps, "skin">) {
  return <FlowLabelsProvider labels={russianFlowLabels}>
    <FlowTestChat {...props} skin={oduvanchikFlowEditorSkin}
      header="compact" inspector="collapsible" minimap="collapsed" fullscreen
      testChat={{ ...props.testChat,
        renderChat: (chatId, { noticeLines }) =>
          <AgentChat api="/api/chat" chatId={chatId} noticeLines={noticeLines} />,
      }} />
  </FlowLabelsProvider>;
}
```

Приложение передаёт прежние `value`, `savedValue`, `onChange`, `onSave`, `catalog`, `checks`, `testChat` и `advanceSteps`; высота задаётся контейнером. `readOnly={locked}` оставляет просмотр и тестовый чат, блокируя правки. `FlowEditor` без тестового чата принимает тот же скин. В Next App Router импортируйте UI из клиентского модуля с `"use client"`; не передавайте объект скина из Server Component. Node SSR и разрешение типов этого входа проверяются отдельно от Next SSR; одна успешная сборка Next не доказывает рендер всех вкладок.

CSS страницы с редактором **и** чатом (Tailwind CSS 4):

```css
@import "tailwindcss";
@import "@ykurilov/agent-chat-skin-oduvanchik/styles.css";
@import "@ykurilov/agent-chat-skin-oduvanchik/flows/styles.css";
@source "../node_modules/@ykurilov/agent-chat-skin-oduvanchik/dist";
@source "../node_modules/@tandem/ui/dist";
```

Базовый `/styles.css` подключает DS один раз, `/flows/styles.css` добавляет оформление редактора. Этот же порядок используется на странице только с редактором. Не добавляйте отдельно токены, DS CSS или палитру Тандема. Компоненты редактора используют DS напрямую, без примитивов Тандема. Его оформление ограничено `.oduvanchik-flow`, не переписывает `--surface`, `--action` и другие переменные Тандема. Явный Тандем сохраняет прежние скин и CSS.

При переходе с Тандема меняются импорт и значение `skin`; формат JSON, runtime, guard подтверждений, адреса сервера и сохранённые настройки доски прежние. Общие переходы редактируются в отдельном разделе, без глобального узла на холсте. Пример с настоящим тестовым чатом и моделью-заглушкой: `apps/demo/skin-gallery/oduvanchik-flows.tsx`.

## Что оформлено

Лента и ответ без пузыря; сообщение человека на серой поверхности; действия под ответом; карточка шагов v28 со значками, раскрытием и неизвестным видом шага; раздумья с заголовком; карточка подтверждения с полосой акцента; поле ввода с чёрной отправкой, остановкой, файлами, вставкой/перетаскиванием и выбором модели. Поле сохраняет черновик при появлении меню, вложений и голоса. Enter отправляет, Shift+Enter переносит строку; Enter при IME-композиции не отправляет.

Сохранены части текущего договора: голос и диалоговый голосовой режим, ошибки и лимиты, служебные строки, ветки и редактор сообщения, виджеты, изображения/видео, просмотр медиа, фоновые задачи и помощники. Тексты берутся из словаря SDK; текст нового чата задаёт приложение.

## Что пока осталось базовым

Сложные виджеты, просмотр медиа, редакторы памяти и диалоговый голосовой режим используют нейтральные примитивы `@tandem/ui` с переменными «Одуванчика». Это не полная замена примитивов на `ds-react`. Песочница экспортируется из `/sandbox`. Отдельные расширения `messengers`, `skills`, `mcp`, `client-card` здесь не экспортируются; для их административных экранов пока остаётся скин Тандема.

Все значки внутри официального скина, включая копирование кода, уведомления, выбранный голос, стрелки меню и закрытие диалогов, - Phosphor regular. Внутренние `primitives` адаптированы из `@ykurilov/tandem-ui@0.7.0` (MIT, [лицензия](TANDEM_NOTICES.md)): Markdown сохраняет `react-markdown`/`remark-gfm`, меню и диалоги - Radix, клавиатуру, фокус и порталы. Свойств подмены значков в исходных компонентах нет. Адаптеры поддерживаются здесь; сторонний пакет Тандема не изменяется. Транзитивная зависимость `lucide-react` остаётся у `@tandem/ui`, но компоненты Одуванчика её значки не рисуют. Приложение не импортирует эти внутренние компоненты и не подменяет значки CSS-правилами.

### Как обновить приложение

С 0.72.0 стандартный путь - `import { AgentChat, ChatWorkspace, AgentPanel } from "@ykurilov/agent-chat-skin-oduvanchik/chat"`. Для перехода заменить импорт компонентов экрана на `/chat`, убрать явный `skin={tandemSkin}` и заменить CSS Тандема на CSS Одуванчика из примера выше. Обновить все пакеты SDK одной версией. Одно обновление зависимостей не перекрасит приложение с прежним импортом и явно выбранным Тандемом. Сохранённые данные и сервер не меняются; у Одуванчика во время ответа доступен «Стоп», отправки поправок во время ответа пока нет.


После выпуска обновить `@ykurilov/agent-chat-*` одной версией и пересобрать приложение с прежними `oduvanchikSkin` и CSS. Дополнительных зависимостей и настроек от приложения не требуется: Markdown и Radix устанавливаются зависимостями скина. Удалить временные переопределения значков в приложении, если они были добавлены. Договор скина и данные не меняются. Проверочная витрина `/oduvanchik-icons.html` показывает реальные компоненты скина с Markdown, уведомлениями, голосовым меню и подтверждением удаления памяти.

Сфера и переменные подключены из опубликованных `@ykurilov/ds-react@^0.3.0` и `@ykurilov/ds-tokens@^0.2.0`. Эти пакеты, Phosphor и CSS входят в зависимости скина; приложение предоставляет React и React DOM 19. Локальных копий сферы/токенов нет.

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
<AgentChat api="/api/chat" chatId="chat-id"
  composerOptions={composerOptions} />;
```

`openContextPicker`, `attachProject`, `saveToolSetting` - обработчики приложения. Проекты передаются агенту через контекст приложения (например `appBridge`); переключатели инструментов приложение связывает с разрешёнными серверными настройками хода. Скин сам не включает инструменты ядра и не выдаёт проект за загруженный файл. Без `attachments` загрузки файлов нет, без `voice` нет микрофона. [Договор вариантов поля](../../docs/skin-v29.md).

## Проверка вида

`apps/demo/skin-gallery/oduvanchik.html` - новый чат, шаги, файл и подтверждение. `/oduvanchik-composers.html` - все три вида поля с каталогом SDK и имитацией ответа. Запуск: `pnpm --filter @ykurilov/agent-chat-demo exec vite --config skin-gallery/vite.config.ts`, адрес `/oduvanchik.html`. Перед локальной витриной собрать `@ykurilov/agent-chat-react`, затем этот скин. Браузерный сценарий трёх полей: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts oduvanchik-composers.spec.ts --workers=1`. Прежний сценарий: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts oduvanchik.spec.ts --workers=1`.

Снимки сохраняются через `screenshotFolder("agent-chat-oduvanchik-composers")` (прежняя витрина - `agent-chat-skin-oduvanchik`); `E2E_SCREENSHOT_DIR` меняет папку. Публиковать пакет следует вместе с общей группой версий SDK.

## Песочница «Студия» (с 0.74.0)

```tsx
import { AgentSandbox } from "@ykurilov/agent-chat-skin-oduvanchik/sandbox";

<div style={{ height: "100dvh", minHeight: 0 }}>
  <AgentSandbox basePath="/api/sandbox"
    chatProps={{ composerOptions: { variant: "extended" } }} />
</div>;
```

Установить `@ykurilov/agent-chat-sandbox` той же версии, что остальные пакеты SDK. Скин берёт его как необязательный peer; обычные `/chat` и корневой экспорт скина не импортируют песочницу. Серверные `createSandboxHandler` и проверка `isAdmin` остаются в приложении, это не общедоступная страница чата. [Настройка сервера](../../docs/sandbox.md).

`AgentSandboxProps` сохраняет свойства исходного экрана. По умолчанию используются `oduvanchikSkin`, `oduvanchikSandboxSkin`, `oduvanchikStudioChatListSkin`; явные `skin`, `sandboxSkin`, `chatListSkin` имеют приоритет. Низкоуровневый `AgentSandbox` из `@ykurilov/agent-chat-sandbox/react` сохраняет три обязательных скина. CSS тот же, что для `/chat`, подключается явно один раз.

Студия использует опубликованные `StudioLayout`, `ScrollArea`, `Sheet` из DS 0.2.0. Высоту задаёт приложение; у flex/grid-предков требуется `min-height: 0`. Не оборачивать чат дополнительной прокруткой. Журнал содержит реальные вызовы `model`/`tool`, время, токены, стоимость и раскрываемые параметры; отсутствие цены или записи не подменяется демонстрационными данными. Во время хода сфера показывает работу, записи перечитываются после завершения. История чатов открывается отдельной панелью, журнал на ширине до 700 px - шторкой с клавиатурным фокусом.

В обычном чате и песочнице приветствие появляется после успешной загрузки пустой истории. Надписи задаются через `ChatLabelsProvider`: `labels={{ ...russianLabels, welcome: { title: "С чего начнём?", description: "Опишите задачу." } }}`. Во время загрузки, ошибки, ответа и подтверждения приветствия нет. Это оформление пустоты, не сохранённая реплика агента.

### Переход на Студию

Обновить SDK одной версией до 0.74.0 и пересобрать CSS. В песочнице заменить импорт экрана на `/sandbox`, убрать явные скины Тандема и использовать CSS Одуванчика. Серверные адреса, админские права, плагины, история и миграции не меняются. Прежний явный Тандем сохраняется с его CSS; остальные админские экраны (`flows`, `messengers`, `skills`, `mcp`, `client-card`) этим выпуском не переводятся.

Витрина: `/oduvanchik-studio.html?state=empty|dialog|working&theme=light|dark`. Сценарий: `pnpm --filter @ykurilov/agent-chat-demo exec playwright test -c skin-gallery/playwright.config.ts oduvanchik-studio.spec.ts --workers=1`. Снимки - `screenshotFolder("agent-chat-oduvanchik-studio")`. Живое демо `/sandbox`, явный Тандем - `/sandbox?skin=tandem`.

## Шапка, ход работы и итог приложения

Общая колонка `yk-chat-column` берётся из DS (730px, на телефоне с отступами). Поле 26–160px, микрофон и отправка круглые 40px. Действия под ответом доступны при наведении и клавиатурном фокусе, на устройствах без hover видны постоянно. Подсказка поля задаётся через `ChatLabelsProvider.composerPlaceholder`; по умолчанию короткая «Напишите сообщение».

Если приложение импортирует готовые части DS напрямую, объявите их в зависимостях приложения вместе с peer-зависимостями:

```sh
pnpm add @ykurilov/ds-react@^0.3.0 @ykurilov/ds-tokens@^0.2.0 @phosphor-icons/react@^2.1.10
```

```tsx
import { useState } from "react";
import { AgentChat } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { Button, ChatProgress, CompletionCard } from "@ykurilov/ds-react";
import "@ykurilov/agent-chat-skin-oduvanchik/styles.css";

function ApplicationChat() {
  // Значения загружает и изменяет приложение; SDK не выводит их из текста модели.
  const [showResult, setShowResult] = useState(false);
  return <AgentChat api="/api/chat" chatId="chat-id"
    header={{ title: "Название приложения", aside: <ChatProgress label="Шаг 2 из 3" value={2} max={3} /> }}
    completion={showResult ? <CompletionCard title="Заголовок результата"
      description="Пояснение приложения"
      items={[{ id: "one", label: "Пункт приложения", status: "done" }]}
      action={<Button variant="secondary" onClick={() => setShowResult(false)}>Продолжить</Button>}
      note="Подпись приложения" /> : undefined} />;
}
```

`header` и `completion` необязательны. Приложение показывает итог по своему состоянию. Карточка располагается после сообщений в том же скроллере, а поле скрывается с сохранением черновика и DOM. Снятие `completion` возвращает поле. Фокус автоматически не переносится; при явном действии приложение может направить его в поле. Во время ответа или активного голосового ввода итог отложен и управление остановкой доступно. Итог не закрывает серверный чат и не добавляет сообщений.

Требуются ds-react ^0.3.0 и ds-tokens ^0.2.0; стили DS уже входят в единственный импорт CSS скина. Для английских карточек передайте `statusNames={{ done: "done", later: "later" }}`; видимые `statusLabel` и все бизнес-слова принадлежат приложению. Явный Тандем остаётся доступен и использует собственный CSS. Общий headless React принимает нейтральные свойства без зависимости от DS; договор — [skin-v31](../../docs/skin-v31.md).

## Плотность панели в приложении

`AgentPanel` в режимах `push` и `overlay` использует `--yk-studio-body-size` для обычного текста ленты на всех ширинах экрана. Увеличение полноэкранной ленты до 16px на мониторах от 1600px к панели не применяется. При импорте `embedded.css` поведение то же; Tailwind в приложении не требуется.

Переменные задаются на родителе панели (например, на контейнере `AgentPanelProvider`) или на корне приложения:

```css
.my-agent-panel-host {
  --yk-studio-body-size: 14px;
  --yk-studio-composer-size: 14px;
  --yk-studio-panel-header-height: 36px;
  --yk-studio-panel-control-size: 28px;
}
```

`--yk-studio-composer-size` настраивает текст поля ввода. Без неё сохраняется прежний размер. На экранах до 48rem минимум составляет 16px, чтобы iOS не увеличивала страницу при фокусе.

У шапки панели по умолчанию высота 57px, у кнопок 44px. Компактные размеры применяются только к шапке `AgentPanel`, а не к заголовку полноэкранного чата. При `pointer: coarse` высота шапки и области нажатия кнопок остаётся не меньше 44px. Задавайте высоту шапки не меньше размера кнопок плюс 1px границы (кроме сенсорного минимума 44px). Для совпадения с шапкой приложения 36px подходят кнопки 28px.

Полноэкранный чат без этих переменных сохраняет прежние размеры и широкий breakpoint. Обновите все установленные пакеты SDK одной версией; дополнительных React props нет.
