# Data Model: выбор модели

## Профиль модели (`ModelProfile`, ядро)

| Поле | Тип | Правило |
|---|---|---|
| `id`, `displayName`, `contextWindowTokens`, `acceptsImages`, `providerModelIds`, `providerOptions?` | как в 001 | без изменений |
| `reasoning.replayPastTurns` | boolean | как в 001 |
| `reasoning.levels` | `ReasoningLevelId[]` | порядок меню от малого к большому; `[]` — выбора уровня нет |
| `reasoning.defaultLevel` | `ReasoningLevelId` | обязателен при непустом `levels` и входит в него |
| `reasoning.encrypted` | boolean (необязательное) | рассуждения зашифрованы: у провайдера просят пересказ, человеку показывается только он |

`ReasoningLevelId` = `"off" | "on" | "minimal" | "low" | "medium" | "high" | "max"`.

## Описание провайдера (`ProviderDescription`, ядро)

Добавляется `reasoningRequest(level, model): { reasoning?; providerOptions? }` — перевод уровня в
запрос (R1). Бросает ошибку на уровень, который провайдер не умеет. `requestOptions` не меняется.

## Каталог (`ModelCatalog`)

Проверки сборки (`createModelCatalog`): профиль ссылается только на провайдеров каталога; у профиля
с уровнями есть уровень по умолчанию из его уровней; каждый уровень каждой модели переводится каждым
её провайдером; `id` моделей и провайдеров уникальны.

Изменения приложением (`extendCatalog(base, change)`): `addModels`, `removeModels`, `addProviders`,
`removeProviders` (новое; вместе с провайдером из профилей убираются его id, модель без провайдеров
исчезает), `pinModelVersions: { [modelId]: { [providerId]: providerModelId } }` (новое: подменяет id модели
у провайдера, остальное в профиле не меняется).

## Выбор в чате (`Chat`, ядро и хранилища)

| Поле | Тип | Правило |
|---|---|---|
| `modelId`, `providerId` | string | как в 001 |
| `reasoning` | string (необязательное) | id уровня; отсутствует — уровень по умолчанию модели |

Эффективный выбор чата = сохранённый, если он доступен (модель в каталоге, провайдер её обслуживает
и у него есть ключ, уровень есть у модели), иначе выбор по умолчанию (уровень — по умолчанию модели).
История и сообщения не меняются.

Переходы: создание чата → выбор по умолчанию; `PUT …/model` → выбор чата целиком (отсутствие
`reasoning` сбрасывает уровень); ответ запускается на эффективном выборе и записывает его в чат.

## Список для меню (`ModelMenu`, ответ `GET …/models`)

```ts
{
  providers: Array<{
    id: string; displayName: string
    models: Array<{
      id: string; displayName: string
      reasoning: { levels: ReasoningLevelId[]; defaultLevel: ReasoningLevelId | null }
    }>
  }>
  defaultChoice: { modelId: string; providerId: string; reasoning: ReasoningLevelId | null }
}
```

Провайдер без ключа на сервере или без моделей в список не попадает. Ключей, имён переменных и адресов
провайдеров в ответе нет.
