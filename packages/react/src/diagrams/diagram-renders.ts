import type { DiagramsClient } from "../agent-chat-extensions";
import type { DiagramColors } from "../skin-contract";

export type DiagramRenderResult = { svg: string } | { error: string };

/** Столько готовых рисунков помнит чат; самый старый забывается первым. */
const KEPT_RESULTS = 200;

/**
 * Готовые рисунки чата по `source + colors`. Рисунок, уже готовый, отдаётся сразу: сообщение, которое лента убрала
 * и вернула, показывает схему без заглушки, и лента не прыгает.
 */
export interface DiagramRenders {
  get(source: string, colors: DiagramColors): DiagramRenderResult | undefined;
  request(source: string, colors: DiagramColors): Promise<DiagramRenderResult>;
}

export function createDiagramRenders(client: DiagramsClient): DiagramRenders {
  const results = new Map<string, DiagramRenderResult>();
  const inFlight = new Map<string, Promise<DiagramRenderResult>>();
  const keyOf = (source: string, colors: DiagramColors) => `${JSON.stringify(colors)}\n${source}`;
  return {
    get: (source, colors) => results.get(keyOf(source, colors)),
    request(source, colors) {
      const key = keyOf(source, colors);
      const ready = results.get(key);
      if (ready) return Promise.resolve(ready);
      const running = inFlight.get(key);
      if (running) return running;
      const result = Promise.resolve()
        .then(() => client.render(source, colors))
        .catch((error: unknown): DiagramRenderResult => ({ error: error instanceof Error ? error.message : String(error) }))
        .then((outcome) => {
          inFlight.delete(key);
          if (results.size >= KEPT_RESULTS) results.delete(results.keys().next().value!);
          results.set(key, outcome);
          return outcome;
        });
      inFlight.set(key, result);
      return result;
    },
  };
}
