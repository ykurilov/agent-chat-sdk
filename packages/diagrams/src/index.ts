// Пакет схем (docs/contracts/agent-widgets/diagrams.md): рисовальщик блоков ```mermaid для экрана чата.
import { createDiagramsClient } from "./diagrams-client";

export type { DiagramColors, DiagramsClient } from "./diagram-types";
export { createDiagramsClient } from "./diagrams-client";
export { cleanSvg } from "./clean-svg";

/** Готовый рисовальщик для `<AgentChat diagrams={diagramsClient} />`: mermaid грузится при первой схеме. */
export const diagramsClient = /* @__PURE__ */ createDiagramsClient();
