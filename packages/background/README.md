# @ykurilov/agent-chat-background

Фоновые задачи для агента. Долгая работа не держит разговор: агент запускает задачу, человек пишет дальше, а когда
задача закончилась, в чат приходит служебное сообщение «Задача готова» с итогом. Задачи переживают перезапуск
сервера.

Задачей бывает:

- **фоновый инструмент** — ваша функция, которая работает долго (отчёт, выгрузка, обход сайтов);
- **фоновый помощник** — помощник ядра (`helpers`) с `background: true`: его работа идёт в фоне, шаги сохраняются.

Без этого пакета ничего не меняется: помощники работают внутри хода, фона нет.

## Подключить

```ts
import { backgroundTool, createBackgroundTasks } from "@ykurilov/agent-chat-background";
import { sqliteTaskStore } from "@ykurilov/agent-chat-background/sqlite";
import { z } from "zod";

const background = createBackgroundTasks({
  store: sqliteTaskStore("./data/chat.db"), // тот же файл, что у чатов, или свой
  tools: {
    build_report: backgroundTool({
      description: "Собрать большой отчёт по продажам. Занимает несколько минут.",
      inputSchema: z.object({ month: z.string() }),
      title: (input) => `Отчёт за ${input.month}`,
      run: async (input, { signal, reportProgress }) => {
        reportProgress("Читаю продажи");
        return await buildReport(input.month, signal); // signal сработает, если задачу отменили
      },
    }),
  },
});

const server = createChatServer({ …, background });
// или createChatHandler({ …, background }) — тогда появляются адреса {base}/:chatId/tasks
```

Помощник уходит в фон одной строкой в его описании:

```ts
agent: {
  helpers: {
    researcher: { description: "…", instructions: "…", model, tools: searchTools, background: true },
  },
},
```

`background: true` без подключённого `background` — ошибка при запуске, а не тихий отказ.

## Настройки `createBackgroundTasks`

| Настройка | Что | По умолчанию |
|---|---|---|
| `store` | Где лежат задачи: `memoryTaskStore()`, `sqliteTaskStore(путь)`, `postgresTaskStore(pool)` | обязательна |
| `tools` | Фоновые инструменты, имя → `backgroundTool({…})` | нет |
| `maxRunningPerUser` | Сколько задач человека идёт одновременно (ждущие подтверждения не считаются) | 3 |
| `timeoutMs` | Предел времени задачи; у инструмента можно свой `timeoutMs` | 30 минут |
| `leaseMs` | Аренда задачи копией сервера; продлевается раз в треть, минимум 3000 мс | 30 секунд |

Агент получает инструменты `check_tasks` (посмотреть задачи чата) и `cancel_task`, а в инструкцию — короткое правило, когда запускать
фон. Когда задач уже `maxRunningPerUser`, запуск отвечает «слишком много задач»: агент видит это и ждёт или
отменяет лишнее.

## Хранилища

```ts
import { memoryTaskStore } from "@ykurilov/agent-chat-background";            // тесты, живёт до перезапуска
import { sqliteTaskStore } from "@ykurilov/agent-chat-background/sqlite";     // файл
import { postgresTaskStore } from "@ykurilov/agent-chat-background/postgres"; // pg.Pool
```

Миграции лежат в `drizzle/` и применяются при создании хранилища. Таблицы SQLite можно держать в файле чатов.

Своё хранилище (`TaskStore`) обязано уметь `admitWithinLimit(admission, maxActive)`: подсчёт занятых мест и запись
одним действием базы — и для новой задачи (`create`), и для продолжения задачи с паузы (`resume`, условная правка как у
`update`). Без него `createBackgroundTasks` не запускается: иначе копии сервера на одной базе вместе превысили бы
`maxRunningPerUser`.

## Что бывает с задачей

`queued` → `running` → `done` / `failed` / `canceled` / `timed_out` / `interrupted`; на паузе — `awaiting_approval`.

- **Отмена.** Кнопка «Отменить» в карточке (вкладка или мессенджер) или `cancel_task` агента. Работа получает
  `signal` и должна его уважать.
- **Подтверждение.** Фоновый инструмент с `needsApproval: true` спрашивает до запуска. Фоновый помощник спрашивает,
  когда один из его инструментов просит подтверждения: задача встаёт на паузу и место не занимает. Ответ приходит
  кнопками на вкладке или в мессенджере. Ответ (и «Разрешить», и «Запретить») продолжает задачу и снова занимает место.
  Мест нет — ответ отклоняется отказом `TurnRefusedError` с кодом `too_many_tasks` (обработчик чата — `403
  turn_refused`, плашка — «ответ не принят», мессенджер — текст отказа): ничего не записано, вопрос ждёт, кнопки те же. Когда другая задача закончится, тот же
  ответ продолжит задачу один раз.
- **Перезапуск сервера.** Копия, которая взяла задачу, продлевает аренду. Копия упала — аренда истекает, и другая
  копия (или та же после старта) подбирает задачу. Фоновый помощник продолжает с сохранённых шагов: уже сделанные
  вызовы инструментов не повторяются. Фоновый инструмент по умолчанию получает `interrupted` («прервана»);
  `rerunAfterRestart: true` запускает его заново, поэтому такая работа должна быть безопасной для повтора.
  Больше трёх запусков одной задачи не бывает: дальше она получает `interrupted`.
- **Итог.** Служебное сообщение попадает в чат хотя бы один раз и будит агента; тот отвечает человеку по итогу.

Живая проверка: [`tests/live/helpers-background.live.test.ts`](tests/live/helpers-background.live.test.ts) (платная,
запускается отдельно: `pnpm exec vitest run --project live <файл>`).
