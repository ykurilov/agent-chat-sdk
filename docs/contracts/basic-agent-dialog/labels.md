# Contract: словарь надписей

Объявлен в `@ykurilov/agent-chat-react` (`labels.ts`). Все надписи интерфейса берутся
отсюда (FR-027a). Русский по умолчанию.

```ts
interface ChatLabels {
  composerPlaceholder: string            // "Напишите сообщение"
  send: string                           // "Отправить"
  stop: string                           // "Остановить"
  copyAnswer: string                     // "Скопировать ответ"
  copied: string                         // "Скопировано"
  copyCode: string                       // "Скопировать код"
  reasoningRunning: string               // "Думает…"
  reasoningDone: (seconds: number) => string   // s => `Думал ${s} сек`
  toolRunning: (toolName: string) => string    // n => `${n}: выполняется`
  toolDone: (toolName: string) => string
  toolError: (toolName: string) => string
  screenshotAlt: string                  // "Снимок страницы" (картинка снимка в строке инструмента)
  screenshotUnavailable: string          // "Снимок не загрузился."
  answerStopped: string                  // "Остановлено"
  answerInterrupted: string              // "Ответ прерван"
  answerEmpty: string                    // "Модель не дала ответа"
  retry: string                          // "Повторить"
  chatNotFound: string                   // "Чат не найден"
  errors: Record<ChatErrorKind, string>  // overloaded: "Модель перегружена, попробуйте ещё раз" …
}

declare const russianLabels: ChatLabels

<ChatLabelsProvider labels={{ ...russianLabels, retry: "Ещё раз" }}>…</ChatLabelsProvider>
declare function useChatLabels(): ChatLabels
```

Приложение меняет любую надпись без правки скина. Проверка: тест подменяет `retry` и
видит новую надпись у `ErrorNotice`; поиск по исходникам скина не находит русских строк.
