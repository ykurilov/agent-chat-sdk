# Для авторов скинов: `ChatSkin` v21

Что нового — поправка на лету: человек пишет агенту, пока тот отвечает.

- `ChatSkin` поднялся с версии 20 до **21**;
- у `ChatSkin` появился необязательный признак `steering: true` — скин рисует поправки;
- у `Composer` появилось необязательное `canSteer`;
- у `UserMessage` появилось необязательное `pending`;
- в словаре — надпись `steeringPending` («Агент учтёт на следующем шаге»).

**Скин версии 20 работает без правок.** Без `steering: true` поправок нет: слой поведения не передаёт `canSteer`, и
поле во время ответа не отправляет, как раньше. Чтобы включить, поддержите `canSteer` и `pending` и поставьте в скин
`steering: true`:

```ts
const skin: ChatSkin = { …, steering: true };
```

## `Composer.canSteer`

`canSteer?: boolean` приходит, только пока идёт ответ и поле принимает поправки (`busy` при этом `true`).

- Поле не блокировать. Рядом с «Стоп» (`onStop`) рисовать «Отправить».
- `canSteer === true` — в поле есть текст или готовые файлы, «Отправить» активна. `false` — поле пустое, кнопка неактивна.
- Отправка — тот же `onSubmit`, что и обычно. Enter тоже работает как обычно.

```tsx
Composer: ({ busy, canSteer, canSubmit, onSubmit, onStop, … }) => (
  <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <textarea … />
    {busy && <button type="button" onClick={onStop}>Стоп</button>}
    {(!busy || canSteer !== undefined) && <button type="submit" disabled={!canSubmit && canSteer !== true}>Отправить</button>}
  </form>
),
```

## `UserMessage.pending`

`pending?: boolean` — поправка ждёт, пока агент её возьмёт. Показать под сообщением `labels.steeringPending`
(`useChatLabels()`). Агент взял поправку — сообщение приходит уже без `pending`. Кнопок правки у ждущей поправки нет.

В Тандеме — «Остановить» рядом с «Отправить» в нижнем ряду рамки поля и мелкая подпись под сообщением
(`data-steering-pending`). На узком экране ряд занят до края, поэтому кнопка голосового режима на время ответа прячется.
