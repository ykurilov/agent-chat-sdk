# @ykurilov/agent-chat-skills

Навыки агента: готовые указания для отдельных задач («разработка игр», «оформление договора»), которые админ пишет
на экране приложения, а агент загружает сам, когда задача подходит. Инструкция агента не растёт, кэш модели не ломается.

Пример. Навык `game-dev`: «Когда просят сделать игру» и две страницы указаний. Человек пишет «сделай змейку» — агент
зовёт `use_skill("game-dev")`, получает указания и работает по ним. Человек пишет «поправь цвет кнопки» — навык не
грузится, запрос короткий.

`react`, `better-sqlite3` и `pg` — необязательные зависимости (peer): ставьте те, что нужны.

## Сервер

```ts
import { createSkills, createSkillsHandler, withSkills } from "@ykurilov/agent-chat-skills";
import { sqliteSkillStore } from "@ykurilov/agent-chat-skills/sqlite"; // или postgresSkillStore(pool) из …/postgres
import { mountChat } from "@ykurilov/agent-chat-server/hono";

const skills = createSkills({
  store: sqliteSkillStore("./data/chat.db"), // тот же файл, что у чатов, или свой
  isAdmin: (user) => adminIds.has(user.id), // доступ к экрану навыков; можно async
  chatStorage: storage, // хранилище чатов: по истории ветки видно, загружен ли навык
});

const handler = createChatHandler({
  …,
  // Права на ход: один раз в начале хода, из базы приложения. Нет viewer — навыки «только админам» не видит никто.
  // По ownerId: в копии чата человека userId — сотрудник, а права нужны человека.
  agent: withSkills({ instructions, tools, viewer: async ({ ownerId }) => ({ isAdmin: await users.isAdmin(ownerId) }) }, skills),
});
mountChat(app, handler);
mountChat(app, createSkillsHandler({ skills, resolveUser })); // адреса экрана, по умолчанию /api/skills
```

`withSkills` добавляет блок контекста `skills` после блоков приложения и инструмент `use_skill` к инструментам
приложения. Совпадение имени — ошибка при запуске. Next.js: `createNextRouteHandlers(skillsHandler)` в
`app/api/skills/[[...path]]/route.ts`.

Ещё `withSkills` добавляет к `agent.serviceBlocks` форматы навыков (`skills.serviceBlocks`): тело `<skill …>` и список
навыков с заголовком `listHeading`. Если модель повторит их в ответе, ядро вырежет их до экрана и записи.

Настройки `createSkills`: `maxBodyChars` (по умолчанию 50 000), `modelTexts` (`englishSkillsModelTexts` для
англоязычного агента), `log` и `logError` (по умолчанию `console`).

## Экран

```tsx
import { SkillsAdmin } from "@ykurilov/agent-chat-skills/react";
import { tandemSkillsSkin } from "@ykurilov/agent-chat-skin-tandem/skills";

<SkillsAdmin skin={tandemSkillsSkin} />
```

Список со статусом и числом загрузок, создание и правка с предпросмотром markdown, статус, история версий с разницей
и откатом, удаление, последние чаты, где навык загружали. Подписи — `SkillsLabelsProvider` (`englishSkillsLabels`).
Подписи шагов в ленте чата — `skillsStepPhrases` и `skillsTitles` из `@ykurilov/agent-chat-skills/labels`.

## Что важно знать

- **Навык.** `name` — строчные латинские или русские буквы, цифры, дефис, 2–48 знаков, не меняется. `whenToUse` — одна
  строка до 300 знаков. `body` — markdown. Статус: `off`, `admins`, `everyone`. Новый навык выключен.
- **Кэш модели.** Список навыков (`- name: whenToUse`, по имени) лежит в блоке контекста хода, а не в инструкции и не
  в описании инструмента. Инструкция и инструменты одни на все чаты. Пока навыки не правят, запрос к модели от хода к
  ходу начинается одинаково. Правка навыка меняет только новый вопрос: старая часть запроса остаётся байт в байт.
- **Повторная загрузка.** Тело приходит как `<skill name="…" version="N" hash="…">…</skill>`; `hash` — отпечаток тела,
  он отличает навык, созданный заново с тем же именем. То же тело ещё видно модели в ветке или уже отдано в этом ходе
  (два вызова в одном шаге) — ответ «уже загружен выше» без тела. Новая версия, сжатие истории или другая ветка — тело
  заново.
- **Видимость.** `everyone` — всем; `admins` — когда у хода `viewer.isAdmin` (`agent.viewer` ядра, права из базы
  приложения, один раз в начале хода); `off` — никому. Список и все вызовы `use_skill` хода решают по одним правам.
  Групповой ход видит только `everyone`. В копии чата человека у сотрудника права человека, если `viewer` считает
  права по `ownerId` (в копии `userId` — сотрудник): он видит то же, что увидел бы человек. Нет `agent.viewer` —
  `admins` не видит никто, в журнал одна подсказка. Невидимый навык инструмент не отдаёт: ответ как про несуществующий.
- **Доступ к экрану.** `resolveUser` → `isAdmin` пакета на каждом запросе. Не админ получает 404 на любом адресе, экран
  показывает «не найдено». Правки — только со своего сайта и сайтов из `allowedOrigins`.
- **Одновременная правка.** Правка и откат несут `expectedVersion`; навык успели изменить — 409, экран предлагает
  загрузить свежую версию. Откат проверяется нынешними правилами: старая версия длиннее нынешнего `maxBodyChars` — 400.
- **Черновик.** Уход к другому навыку, «Новый» или откат при несохранённых правках сперва спрашивает
  (`discardingDraft` в `SkillEditor`); закрытие вкладки предупреждает браузером.
- **Предел запроса.** Считается от `maxBodyChars` с запасом, не меньше 256 КБ; больше — 413.
- **Учёт.** Каждая загрузка: навык, версия, чат, человек, ход, время; строка `skills: loaded "…" vN chat=… owner=… turn=…`
  в журнал сервера. Сбой записи не ломает ход.
- **Хранилища.** Память (`memorySkillStore`, тесты), SQLite, PostgreSQL (схема `agent_chat`). Таблицы `skills`,
  `skill_versions`, `skill_loads`, миграции сами при открытии. Список для вопроса модели и экрана — `listBrief`, без
  тел. Символ NUL все хранилища убирают при записи (PostgreSQL его не хранит), проверка «не пусто» — после чистки.
