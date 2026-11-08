import type { Plugin } from "vite";
/** Actual same-origin fetch/SSE sockets. No mocked fetch or production data. */
export function pageLifecycleFixturePlugin(): Plugin {
  return { name: "page-lifecycle-fixture", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === "/page-lifecycle-no-content") { res.writeHead(204).end(); return; }
      if (req.url === "/page-lifecycle-streamed.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<!doctype html><title>Streamed</title><p>Started");
        const timer = setTimeout(() => res.end(" and finished</p>"), 1500);
        res.on("close", () => clearTimeout(timer)); return;
      }
      if (req.url === "/page-lifecycle-delay.html" || req.url === "/page-lifecycle-long.html") {
        const timer = setTimeout(() => { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>Away</title><p>Away</p>"); }, req.url.includes("long") ? 10000 : 1500);
        res.on("close", () => clearTimeout(timer)); return;
      }
      if (!req.url?.startsWith("/page-lifecycle-api/")) return next();
      const path = new URL(req.url, "http://fixture").pathname;
      if (req.method === "POST") req.resume();
      const json = (data: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(data)); };
      if (path.endsWith("/models")) return json({ providers: [] });
      if (path.endsWith("/watch") || path.endsWith("/messages") || path.endsWith("/stream")) {
        const watch = path.endsWith("/watch");
        let interval: ReturnType<typeof setInterval> | undefined;
        const open = () => {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "x-agent-chat-history-match": "1", ...(watch ? {} : { "x-vercel-ai-ui-message-stream": "v1" }) });
          res.write(watch ? ": open\n\n" : 'data: {"type":"start","messageId":"a-live"}\n\ndata: {"type":"text-start","id":"t"}\n\ndata: {"type":"text-delta","id":"t","delta":"Ответ идёт"}\n\n');
          interval = setInterval(() => res.write(": ping\n\n"), 1000); interval.unref();
        };
        const timer = setTimeout(open, path.includes("pending") ? 2000 : 0);
        res.on("close", () => { clearTimeout(timer); clearInterval(interval); });
        return;
      }
      res.setHeader("x-agent-chat-history-version", "fixture-1");
      return json({ chat: { id: path.split("/")[2] }, messages: [], running: false, historyView: undefined, forks: [], compactions: [], compacting: false, capabilities: { modelChoice: false }, });
    });
  } };
}
