import { cleanSvg } from "./clean-svg";
import type { DiagramColors, DiagramsClient } from "./diagram-types";

/** Длиннее — не рисуем: тяжёлая схема подвесила бы страницу. */
export const MAX_SOURCE_LENGTH = 20_000;
/** Больше узлов и связей — не рисуем. */
export const MAX_DIAGRAM_NODES = 200;
/** Столько готовых рисунков помнится; самый старый забывается первым. */
const CACHE_SIZE = 100;

type Mermaid = typeof import("mermaid").default;
type RenderResult = { svg: string } | { error: string };

// Связь в схеме: «-->», «---», «==>», «-.->», «~~~», «->>» и подобные.
const LINK = /<?(?:-{2,}|={2,}|-\.+-|~{3,}|->>)[>ox]?/g;

/**
 * Оценка числа узлов и связей: каждая строка-утверждение — узел, каждая связь сверх первой в строке — ещё узел
 * («A-->B-->C» — три). Заголовок («graph TD») и комментарии («%%») не считаются.
 */
export function countDiagramNodes(source: string): number {
  const statements = source
    .split(/[\n;]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("%%"))
    .slice(1);
  return statements.reduce((total, statement) => total + Math.max(1, statement.match(LINK)?.length ?? 0), 0);
}

function mermaidConfig(colors: DiagramColors) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    // Подписи — текстом SVG, а не HTML: без foreignObject, и рисунок остаётся векторным.
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    // Ошибка разбора не рисуется на странице: скин сам покажет исходник.
    suppressErrorRendering: true,
    maxTextSize: MAX_SOURCE_LENGTH,
    theme: "base" as const,
    themeVariables: {
      darkMode: colors.dark,
      background: colors.background,
      fontFamily: "inherit",
      textColor: colors.text,
      primaryColor: colors.node,
      primaryTextColor: colors.text,
      primaryBorderColor: colors.line,
      secondaryColor: colors.background,
      secondaryTextColor: colors.text,
      secondaryBorderColor: colors.accent,
      tertiaryColor: colors.background,
      tertiaryTextColor: colors.text,
      tertiaryBorderColor: colors.line,
      mainBkg: colors.node,
      nodeBorder: colors.line,
      lineColor: colors.line,
      clusterBkg: colors.background,
      clusterBorder: colors.accent,
      edgeLabelBackground: colors.background,
      actorBkg: colors.node,
      actorBorder: colors.line,
      actorTextColor: colors.text,
      signalColor: colors.line,
      signalTextColor: colors.text,
      noteBkgColor: colors.background,
      noteTextColor: colors.text,
      noteBorderColor: colors.accent,
    },
  };
}

/**
 * Рисовальщик схем: mermaid грузится при первом рисунке (FR-024), рисует в строгом режиме, рисунок чистится (FR-027).
 * Рисунки идут по одному: настройки mermaid общие, и схема в другой теме не должна взять чужие цвета.
 */
export function createDiagramsClient(): DiagramsClient {
  let mermaid: Promise<Mermaid> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let renderCount = 0;
  const cache = new Map<string, Promise<RenderResult>>();

  const load = () => (mermaid ??= import("mermaid").then((module) => module.default));

  async function draw(source: string, colors: DiagramColors): Promise<RenderResult> {
    if (source.length > MAX_SOURCE_LENGTH) return { error: `Схема длиннее ${MAX_SOURCE_LENGTH} знаков` };
    if (countDiagramNodes(source) > MAX_DIAGRAM_NODES) return { error: `В схеме больше ${MAX_DIAGRAM_NODES} узлов` };
    try {
      const api = await load();
      api.initialize(mermaidConfig(colors));
      const { svg } = await api.render(`agent-chat-diagram-${++renderCount}`, source);
      const clean = cleanSvg(svg);
      return clean ? { svg: clean } : { error: "Рисовальщик не вернул рисунок" };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    render(source, colors) {
      const key = `${JSON.stringify(colors)}\n${source}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const result = queue.then(() => draw(source, colors));
      queue = result;
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    },
  };
}
