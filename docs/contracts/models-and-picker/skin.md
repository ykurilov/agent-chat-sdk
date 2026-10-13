# Contract: договор скина, версия 3

Дополняет [версию 2](../fast-feed-and-liveness/skin.md); всё, что там не названо,
не меняется. Объявлен в `@ykurilov/agent-chat-react`.

## Что изменилось против версии 2

`Composer` получает необязательное свойство `modelChoice`. Скин, который его не использует, работает как раньше.

```ts
interface ModelChoiceView {
  providers: Array<{
    id: string; name: string
    models: Array<{ id: string; name: string }>
  }>
  /** Текущий выбор: провайдер и модель. */
  current: { providerId: string; modelId: string }
  onChange: (next: { providerId: string; modelId: string }) => void
  /** Уровни выбранной модели по порядку профиля; пустой массив — выбор уровня не показывать. */
  reasoningLevels: Array<{ id: string; name: string }>
  reasoning: string
  onReasoningChange: (levelId: string) => void
  /**
   * Что пошло не так, готовой надписью: список не загрузился (тогда `providers` пуст) или выбор не
   * сохранился (тогда выбор уже откачен). Скин показывает текст рядом с полем ввода.
   */
  error?: string
}

interface ComposerProps {
  // …как в версии 2
  modelChoice?: ModelChoiceView
}
```

## Правила для скина

- `modelChoice` нет — рисовать поле без выбора (вариант «минимальный»).
- Названия уровней — из `reasoningLevels[].name`, скин строк уровней не пишет; названия провайдеров и моделей — из
  `providers`.
- Меню провайдеров: одно меню, у каждого провайдера подменю с его моделями. Если провайдер один, скин вправе
  показать плоский список его моделей (так делает Тандем). Меню не шире экрана телефона.
- `providers` пуст (список ещё грузится или не загрузился) — меню не рисовать, поле ввода работает как без выбора.
- Выбор уровня показывается рядом с меню моделей, если `reasoningLevels` не пуст.
- Выбор можно менять в любой момент, в том числе пока идёт ответ; ввод текста и отправка меню не блокирует.

## Скин Тандема

`TandemComposer` при наличии `modelChoice` рисует `Composer variant="extended"` Тандема: `providers`,
`model={{ provider, model }}`, `onModelChange`, `reasoningOptions`, `reasoning`, `onReasoningChange`; без него —
`variant="minimal"`, как раньше. Кнопка «стоп» остаётся отдельной, как в версии 2.

## Проверка договора

Те же тесты поведения идут со скином-заглушкой и скином Тандема; новые: скин без `modelChoice` работает,
уровни выбранной модели меняются при смене модели, ввод текста не перерисовывает ленту (R10).
