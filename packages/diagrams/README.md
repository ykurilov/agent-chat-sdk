# @ykurilov/agent-chat-diagrams

Схемы в ответах агента: блок ` ```mermaid ` рисуется на экране и открывается в окне просмотра. Отдельное расширение:
приложению без схем пакет не нужен, и в его сборке нет ни байта mermaid (он грузится отдельным куском при первой схеме).
Серверу пакет не нужен.

```bash
pnpm add @ykurilov/agent-chat-diagrams
```

```ts
// сервер: одна постоянная строка в инструкции агента
createChatHandler({ …, agent: { instructions: appInstructions, diagrams: true } });
```

```tsx
// страница
import { diagramsClient } from "@ykurilov/agent-chat-diagrams";
<AgentChat … diagrams={diagramsClient} />;
```

- Рисует `mermaid` 12 в строгом режиме; цвета берутся у скина (`diagramColors`), смена темы перерисовывает схему.
- Готовый SVG чистится (`cleanSvg`): без скриптов, `foreignObject`, ссылок наружу и обработчиков событий.
- Пределы: до 20 000 знаков и 200 узлов. Не нарисовалось — скин показывает исходный текст блоком кода.
- Без `diagrams` блок остаётся обычным кодом.

Скину нужны необязательные `renderDiagram` и `onOpenDiagram` у `AgentText` (договор версии 13); в Тандеме они есть.
Подробно — [docs/diagrams.md](../../docs/diagrams.md).
