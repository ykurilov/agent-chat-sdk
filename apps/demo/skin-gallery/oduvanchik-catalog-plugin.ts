import type { Plugin } from "vite";
import type { ModelMenu } from "@ykurilov/agent-chat-core";

/** Local-only gallery fixture. Public catalog data; no real keys and no model calls. */
export function oduvanchikCatalogPlugin(): Plugin {
  return { name: "oduvanchik-catalog", configureServer(server) {
    let menuPromise: Promise<ModelMenu> | undefined;
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith("/oduvanchik-catalog/")) return next();
      void (async () => {
        menuPromise ??= server.ssrLoadModule("@ykurilov/agent-chat-core").then(({ standardCatalog, buildModelMenu }) => buildModelMenu(standardCatalog,
          Object.fromEntries(standardCatalog.providers.map((provider: { apiKeyEnv: string }) => [provider.apiKeyEnv, "gallery-only"])),
          { providerId: "deepseek", modelId: "deepseek-4.1-flash" }));
        const menu = await menuPromise;
        response.setHeader("Content-Type", "application/json");
        if (request.method === "GET" && request.url === "/oduvanchik-catalog/models") return response.end(JSON.stringify(menu));
        if (request.method === "PUT" && request.url?.endsWith("/model")) {
          let body = "";
          for await (const chunk of request) body += chunk;
          const value = JSON.parse(body) as { modelId?: string; providerId?: string; reasoning?: string };
          const model = menu.providers.find((provider) => provider.id === value.providerId)?.models.find((candidate) => candidate.id === value.modelId);
          if (!model || (value.reasoning && !model.reasoning.levels.includes(value.reasoning as never))) { response.statusCode = 400; return response.end("{}"); }
          return response.end(JSON.stringify(value));
        }
        response.statusCode = 404; response.end("{}");
      })().catch((error) => { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); });
    });
  } };
}
