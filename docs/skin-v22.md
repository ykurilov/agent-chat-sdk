# Для авторов скинов: `ChatSkin` v22

Что нового — [живые демонстрации](live-demos.md): блок ` ```html-demo ` в ответе запускается в изолированной рамке.

- `ChatSkin` поднялся с версии 21 до **22**;
- у `AgentText` появилось необязательное `renderDemo(source, blockIndex)`;
- у `ChatSkin` появилось необязательное `demoColors(dark)`;
- в словаре — группа `demo`: `loading`, `title`, `tooLarge`, `unfinished`, `leftPage`, `externalContent`.

**Скин версии 21 работает без правок.** Без `renderDemo` блок ` ```html-demo ` показывается обычным кодом.

## `AgentText.renderDemo`

Приходит, только если приложение включило `liveDemos`. Разбейте текст той же функцией, что и слой поведения.
`blockIndex` — номер блока среди демонстраций этого ответа (0, 1, …):

```tsx
AgentText: ({ markdown, renderDemo }) => {
  let demoIndex = 0;
  return splitAnswerFences(markdown, { demos: renderDemo !== undefined }).map((segment, index) => {
    if (segment.kind !== "demo" || !renderDemo) return <Markdown key={index} text={segment.markdown} />;
    const view = renderDemo(segment.source, demoIndex++);
    if (view.state === "streaming") return <p key={index} aria-busy>{labels.demo.loading}</p>;
    if (view.state === "code") return <div key={index}><Markdown text={segment.markdown} /><p>{labels.demo[view.reason]}</p></div>;
    return <div key={index} style={{ width: "100%" }}>{view.frame}</div>;
  });
},
```

- `frame` — готовая рамка с песочницей и высотой. Её не оборачивать в элементы, которые сжимают ширину: рамке нужна
  ширина ответа. Если пузырь ответа сжимается по тексту, растяните его, когда внутри демонстрация.
- `code` — показать исходный блок кодом и пометку `labels.demo[reason]`. Причины: `tooLarge`, `unfinished`, `leftPage`,
  `externalContent` (в чате чужой текст — демонстрации выключены).

## `ChatSkin.demoColors`

`demoColors(dark)` → `{ background, surface, text, muted, border, accent, onAccent }`: цвета темы для рамки. Нет — запасные
нейтральные. Цвет — обычная CSS-строка (`#fff`, `rgb(…)`); с подозрительными знаками берётся запасной.

В Тандеме — `tandemDemoColors` и `TandemLiveDemo` (`data-live-demo="streaming|code|ready"`).
