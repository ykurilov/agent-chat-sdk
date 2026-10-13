# Договор: пакет `@ykurilov/agent-chat-diagrams` (US4)

Необязательный пакет. Зависимость — `mermaid` 12.x; загружается лениво при первой схеме.

## Сервер

```ts
createChatHandler({ …, agent: { diagrams: true } });
```

Ядро добавляет к инструкции одну постоянную строку `diagramsInstructions` (экспорт ядра, текст — в пакете не нужен): «Схемы рисуй блоком ```mermaid; не больше 50 узлов; без ссылок и HTML». Без дублей, как строки вложений и памяти. Пакет на сервере не нужен.

## Экран

```tsx
import { diagramsClient } from "@ykurilov/agent-chat-diagrams";
<AgentChat … diagrams={diagramsClient} />
```

```ts
interface DiagramsClient {
  render(source: string, colors: DiagramColors): Promise<{ svg: string } | { error: string }>;
}
interface DiagramColors { background: string; text: string; line: string; node: string; accent: string; dark: boolean }
```

- Первый `render` — `import("mermaid")`, `initialize({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, theme: "base", themeVariables: из colors })`.
- Готовый SVG чистится: удаляются `<script>`, `<foreignObject>`, `<a>` (текст остаётся), `<image>`, `<use>` с внешним адресом, атрибуты `on*`, `href`/`xlink:href` не с `#`, `style` с `url(` не на `#`.
- Источник больше 20 000 знаков или больше 200 узлов — `{ error }` без рисования.
- Результат кэшируется по `source + colors` (смена темы — перерисовка).
- Ошибка разбора — `{ error }`; скин показывает исходный текст блоком кода.

## Слой поведения

- Блок ` ```mermaid ` в `AgentText`: пока ответ печатается и блок не закрыт — `state: "streaming"`; закрыт — `render`; дальше `ready` или `failed`.
- Без `diagrams` блок — обычный код (как в 0.15).
- Голос: блок заменяется фразой «схема на экране» (`voice-dialog/src/browser/spoken-text.ts`), как код.
- Клик по готовой схеме — окно просмотра с одним элементом `{ kind: "diagram", key: "<messageId>:<номер блока>", svg, source }`.
