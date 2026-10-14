// Стили, без которых доска `@xyflow/react` не работает: слои, места узлов и ручек, мини-карта, панели. Взяты из
// `@xyflow/react/dist/base.css` (MIT) и урезаны. Цвета — переменные `--flow-board-*`: их задаёт скин, а здесь только
// нейтральные запасные значения. Стиль вставляется рядом с доской, приложению ничего импортировать не нужно.

export const FLOW_BOARD_CSS = `
.react-flow { direction: ltr; position: relative; width: 100%; height: 100%; overflow: hidden; z-index: 0; }
.react-flow__container, .react-flow__edgelabel-renderer, .react-flow__viewport-portal {
  position: absolute; width: 100%; height: 100%; top: 0; left: 0;
}
.react-flow__pane { z-index: 1; touch-action: none; }
.react-flow__pane.draggable { cursor: grab; }
.react-flow__pane.dragging { cursor: grabbing; }
.react-flow__viewport { transform-origin: 0 0; z-index: 2; pointer-events: none; }
.react-flow__renderer { z-index: 4; }
.react-flow__background { pointer-events: none; z-index: -1; }
.react-flow__background-pattern.dots { fill: var(--flow-board-dots, rgba(128, 128, 128, 0.35)); }
.react-flow .react-flow__edges { position: absolute; }
.react-flow .react-flow__edges svg { overflow: visible; position: absolute; pointer-events: none; }
.react-flow__edge { pointer-events: visibleStroke; }
.react-flow__edge.inactive { pointer-events: none; }
.react-flow__edge:focus, .react-flow__edge:focus-visible { outline: none; }
.react-flow__connection { pointer-events: none; }
.react-flow__connection-path { stroke: var(--flow-board-connection, currentColor); stroke-width: 2; fill: none; stroke-dasharray: 4 4; }
svg.react-flow__connectionline { z-index: 1001; overflow: visible; position: absolute; }
.react-flow__nodes { pointer-events: none; transform-origin: 0 0; }
.react-flow__node {
  position: absolute; user-select: none; pointer-events: all; transform-origin: 0 0; box-sizing: border-box; cursor: default;
}
.react-flow__node.draggable { cursor: grab; }
.react-flow__node.draggable.dragging { cursor: grabbing; }
.react-flow__node:focus, .react-flow__node:focus-visible { outline: none; }
.react-flow__handle {
  position: absolute; pointer-events: none; width: 10px; height: 10px; min-width: 5px; min-height: 5px; border-radius: 999px;
  background: var(--flow-board-handle-fill, #fff); border: 1.5px solid var(--flow-board-handle, currentColor);
}
.react-flow__handle.connectingfrom, .react-flow__handle.connectionindicator { pointer-events: all; cursor: crosshair; }
.react-flow__handle-left { top: 50%; left: 0; transform: translate(-50%, -50%); }
.react-flow__handle-right { top: 50%; right: 0; transform: translate(50%, -50%); }
.react-flow__handle-top { top: 0; left: 50%; transform: translate(-50%, -50%); }
.react-flow__handle-bottom { top: auto; bottom: 0; left: 50%; transform: translate(-50%, 50%); }
.react-flow__panel { position: absolute; z-index: 5; margin: 16px; }
.react-flow__panel.top { top: 0; }
.react-flow__panel.bottom { bottom: 0; }
.react-flow__panel.left { left: 0; }
.react-flow__panel.right { right: 0; }
.react-flow__panel.top.center, .react-flow__panel.bottom.center { left: 50%; transform: translateX(-16px) translateX(-50%); }
.react-flow__minimap { background: var(--flow-board-minimap, #fff); border-radius: 12px; overflow: hidden; }
.react-flow__minimap-svg { display: block; }
.react-flow__minimap-mask { fill: var(--flow-board-minimap-mask, rgba(128, 128, 128, 0.15)); }
.react-flow__minimap-node { fill: var(--flow-board-minimap-node, rgba(128, 128, 128, 0.35)); }
.flow-board__new-exit.react-flow__handle {
  top: auto; bottom: 10px; right: 0; transform: translate(50%, 0); opacity: 0.55;
}
.flow-board__new-exit.react-flow__handle:hover { opacity: 1; }
@media (max-width: 860px) {
  .flow-board__legend, .flow-board__minimap { display: none; }
}
`;
