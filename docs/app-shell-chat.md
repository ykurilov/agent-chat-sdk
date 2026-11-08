# Стандартная навигация приложения с чатом

Новый путь для приложения на «Одуванчике» — `AppShellChatWorkspace` из `@ykurilov/agent-chat-skin-oduvanchik/chat`. Он использует опубликованный `AppShell` вида A из `@ykurilov/ds-react` ≥0.6.0. SDK обновляет список и названия, обрабатывает выбор, создание и права. Приложение передаёт собственные бренд, разделы и аккаунт. Старый `ChatWorkspace` и отдельный `AgentChat` совместимы.

## Готовый экран

```tsx
import { AppShellChatWorkspace } from "@ykurilov/agent-chat-skin-oduvanchik/chat";

<AppShellChatWorkspace api="/api/chat" initialChatId={chatId}
  onChatChange={onChatChange} historyVisibleCount={20}
  shell={{ brand, navigation, account, onSettings: openSettings,
    storageKey: "app-navigation" }} />;
```

Родитель задаёт высоту (`100dvh` для обычного веб-экрана, `ChatAppViewport` для полноэкранного мобильного приложения). CSS — прежний `styles.css` с Tailwind либо готовый `embedded.css`. Самостоятельный импорт компонентов настроек требует прямой зависимости приложения `@ykurilov/ds-react@^0.6.0` и его peer-зависимостей. Если приложение использует только embedded.css скина, для собственных настроек/порталов ds-react дополнительно подключаются `@ykurilov/ds-tokens/tokens.css` и `@ykurilov/ds-react/styles.css`.

`shell` — свойства AppShell, кроме `children` и `primaryAction`. Его `groups` сохраняются, после них добавляется группа SDK `agent-chat-history` (этот id зарезервирован). `historyVisibleCount` по умолчанию 20; «Ещё N», автоматическое раскрытие до активного пункта, сохранение сворачивания, мобильное закрытие и возврат фокуса делает AppShell. Строки чатов без значков. При создании повторные нажатия не вызывают новое действие, пока SDK сообщает `creating`.

Кнопка «Чаты» в шапке открывает управление списком: переименовать, удалить с подтверждением, повторить неудачную загрузку. Это окно, а не второй сайдбар. Ошибки создания/загрузки видны также в рабочей области. До получения права `chatList` история и создание скрыты, как в прежнем ChatWorkspace. Запрещённое право скрывает и окно управления.

`AppShell` создаёт единственный `main`; вокруг компонента не ставьте ещё один `main` или навигационную панель. Внутренний чат остаётся тем же AgentChat: Stop, streaming, branches, widgets, attachments, callbacks и разрешения не переопределяются. Остальные свойства ChatWorkspace, включая необязательный `skin`, сохраняются.

## Если у приложения уже есть AppShell

`ChatWorkspace.renderWorkspace(view)` заменяет только каркас. `view.children` — готовый чат, `view.activeTitle` — его название, `view.list` — строки и действия списка либо `undefined`, пока список запрещён/право неизвестно. Не создавайте второй useChatList.

```tsx
import { ChatWorkspace, appShellChatNavigation } from "@ykurilov/agent-chat-skin-oduvanchik/chat";
import { useChatLabels } from "@ykurilov/agent-chat-react";
import { AppShell } from "@ykurilov/ds-react";

function Workspace() {
  const labels = useChatLabels();
  return <ChatWorkspace api="/api/chat" renderWorkspace={view =>
    <AppShell brand={brand} navigation={navigation}
      {...appShellChatNavigation(view, labels)}>
      {view.children}
    </AppShell>
  } />;
}
```

`appShellChatNavigation` — чистое преобразование в `{ groups, primaryAction? }`, без загрузок и собственного состояния. Третий аргумент — visibleCount. Управление переименованием/удалением, ошибки и повтор загрузки при своей композиции показывает приложение через `view.list` (или готовый `OduvanchikChatList` в окне). Для готового экрана это делает SDK.

## Тема и аккаунт

Тема по умолчанию системная. `onSettings`/пункт аккаунта открывает настройки приложения с `ThemeSettings` из ds-react. Отдельной кнопки темы в панели, шапке или аккаунте не добавляется. `themeScript()` в head применяет сохранённый выбор до первого кадра. Блок `account` по умолчанию показывает почту, `show: "plan"` — тариф, `show: "name"` — только имя. Канон исходной дизайн-системы — `YKDesignSystem/NAVIGATION.md`.

## Как обновить приложение

После публикации согласованного выпуска обновите пакеты SDK одной версией. Вместо самостоятельной пары «список + чат» подключите AppShellChatWorkspace и передайте данные оболочки. Существующий сервер и данные не меняются. Уже работающие ChatWorkspace/AgentChat можно оставить; изменение оформления не применяется к ним молча.
