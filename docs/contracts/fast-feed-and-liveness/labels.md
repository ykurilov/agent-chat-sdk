# Contract: словарь надписей — дополнения 002

Дополняет [договор 001](../basic-agent-dialog/labels.md). Добавляются два
ключа; остальные без изменений.

```ts
interface ChatLabels {
  …как в 001,
  reconnecting: string        // "Переподключаемся…"
  connectionLost: string      // "Нет связи с сервером"
}
```

- `reconnecting` — `ConnectionNotice state="reconnecting"`, пока вкладка сама пробует
  подключиться (FR-013).
- `connectionLost` — `ConnectionNotice state="offline"`; кнопка рядом — прежний `retry`
  («Повторить») (FR-013a).

Приложение меняет обе надписи через `ChatLabelsProvider`, как остальные (FR-016). Проверка:
тест подменяет `connectionLost` и видит новую надпись; поиск по исходникам скина по-прежнему
не находит русских строк (`scripts/check-rules.mjs`).

Ключи добавлены в `ChatLabels` как обязательные: словарь приложения, собранный как
`{ ...russianLabels, … }`, получает их сам; словарь, написанный целиком, не соберётся без
них — это часть несовместимого изменения 0.2.0.
