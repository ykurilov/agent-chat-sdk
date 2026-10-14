import { describe, expect, it } from "vitest";
import { requestDecision } from "../../src/runtime/decisions-client";
import { createFlowJudge } from "../../src/runtime/judge";

// T103: судья идёт через прокси приложения: свои адрес и заголовки (`X-Proxy-Token`).

interface Sent {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: init?.headers as Record<string, string> });
    return new Response(JSON.stringify({ answers: { x1: { type: "noul", noul: 0.9 } }, usage: { cost: 0.00002, input_tokens: 400, output_tokens: 8 } }), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

describe("клиент решений: заголовки прокси", () => {
  it("свои заголовки уходят в запрос рядом с ключом", async () => {
    const { fetch, sent } = fakeFetch();
    await requestDecision(
      { apiKey: "sk-or-секрет", baseUrl: "https://proxy.example.com/openrouter/api/v1", headers: { "X-Proxy-Token": "прокси-токен" }, fetch },
      { model: "microsoft/microsoft-decision-1", state: {}, questions: [{ id: "x1", instructions: "Выполнено?" }] },
    );
    expect(sent[0]!.url).toBe("https://proxy.example.com/openrouter/api/alpha/decisions");
    expect(sent[0]!.headers).toMatchObject({ "X-Proxy-Token": "прокси-токен", authorization: "Bearer sk-or-секрет", "content-type": "application/json" });
  });

  it("свои заголовки не подменяют ключ и тип содержимого", async () => {
    const { fetch, sent } = fakeFetch();
    await requestDecision(
      { apiKey: "sk-or-секрет", baseUrl: "https://openrouter.ai/api/v1", headers: { authorization: "Bearer чужой", "content-type": "text/plain" }, fetch },
      { model: "m", state: {}, questions: [{ id: "x1", instructions: "?" }] },
    );
    expect(sent[0]!.headers).toMatchObject({ authorization: "Bearer sk-or-секрет", "content-type": "application/json" });
  });

  it("без заголовков запрос как был", async () => {
    const { fetch, sent } = fakeFetch();
    await requestDecision({ apiKey: "k", baseUrl: "https://openrouter.ai/api/v1", fetch }, { model: "m", state: {}, questions: [{ id: "x1", instructions: "?" }] });
    expect(Object.keys(sent[0]!.headers).sort()).toEqual(["authorization", "content-type"]);
  });
});

describe("судья: openrouter.headers из настроек", () => {
  it("X-Proxy-Token доходит до запроса решений", async () => {
    const { fetch, sent } = fakeFetch();
    const judge = createFlowJudge(
      {
        fallback: { providerId: "openrouter", modelId: "google/gemini-3-flash" },
        openrouter: { apiKey: "sk-or-секрет", baseUrl: "https://fr-api-route.example.com/openrouter/api/v1", headers: { "X-Proxy-Token": "прокси-токен" } },
      },
      () => ({
        askModel: async () => {
          throw new Error("запасная модель не нужна");
        },
        recordUsage: async () => {},
        assertWithinLimit: async () => {},
      }),
      { fetch, env: {} },
    );
    const verdict = await judge.checkClaim({ ownerId: "o", chatId: "c", exitId: "x1", condition: "Понятна тема", messages: [{ role: "human", text: "Курс по Excel" }] });

    expect(verdict).toMatchObject({ exitId: "x1", confirmed: true, source: "decision" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://fr-api-route.example.com/openrouter/api/alpha/decisions");
    expect(sent[0]!.headers["X-Proxy-Token"]).toBe("прокси-токен");
  });

  it("порт судьи берётся по чату вопроса", async () => {
    const { fetch } = fakeFetch();
    const asked: string[] = [];
    const judge = createFlowJudge(
      { fallback: { providerId: "openrouter", modelId: "m" }, openrouter: { apiKey: "k" } },
      (chat) => {
        asked.push(`${chat.ownerId}/${chat.chatId}`);
        return { askModel: async () => ({ text: "", usage: {} }) as never, recordUsage: async () => {}, assertWithinLimit: async () => {} };
      },
      { fetch, env: {} },
    );
    await judge.checkClaim({ ownerId: "anna", chatId: "chat-7", exitId: "x1", condition: "Понятна тема", messages: [] });
    expect(new Set(asked)).toEqual(new Set(["anna/chat-7"]));
  });
});
