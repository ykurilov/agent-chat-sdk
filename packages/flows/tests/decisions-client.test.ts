import { describe, expect, it } from "vitest";
import { decisionsUrl, requestDecision } from "../src/runtime/decisions-client";

interface Sent {
  url: string;
  init: RequestInit;
  body: any;
}

function fakeFetch(respond: () => Response): { fetch: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) });
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const ok = (answers: Record<string, unknown>, usage: Record<string, unknown> = { cost: 0.000021, input_tokens: 500, output_tokens: 12 }) =>
  new Response(JSON.stringify({ id: "gen-dec-1", model: "microsoft/microsoft-decision-1-20261009", provider: "Azure", answers, usage }), { status: 200 });

describe("адрес судьи", () => {
  it("/api/v1 приложения → /api/alpha/decisions рядом", () => {
    expect(decisionsUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(decisionsUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/alpha/decisions");
  });

  it("прокси с путём сохраняет путь", () => {
    expect(decisionsUrl("https://fr-api-route.example.com/openrouter/api/v1")).toBe("https://fr-api-route.example.com/openrouter/api/alpha/decisions");
  });

  it("адрес без /v1 — добавляется /alpha/decisions", () => {
    expect(decisionsUrl("https://proxy.example.com/api")).toBe("https://proxy.example.com/api/alpha/decisions");
  });
});

describe("requestDecision", () => {
  it("шлёт POST с ключом, state и вопросами noul по id; ответ — вероятности и цена", async () => {
    const { fetch, sent } = fakeFetch(() => ok({ x1: { type: "noul", noul: 0.96 }, x2: { type: "noul", noul: 0.04 } }));
    const result = await requestDecision(
      { apiKey: "sk-or-секрет", baseUrl: "https://openrouter.ai/api/v1", fetch },
      {
        model: "microsoft/microsoft-decision-1",
        state: { goal: "Узнать тему", conversation: [{ role: "human", text: "Курс по Excel" }] },
        questions: [
          { id: "x1", instructions: "Выполнено ли условие «Понятна тема»?" },
          { id: "x2", instructions: "Выполнено ли условие «Отказался»?" },
        ],
      },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(sent[0]!.init.method).toBe("POST");
    const headers = sent[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-or-секрет");
    expect(headers["content-type"]).toBe("application/json");
    expect(sent[0]!.body).toEqual({
      model: "microsoft/microsoft-decision-1",
      state: { goal: "Узнать тему", conversation: [{ role: "human", text: "Курс по Excel" }] },
      questions: {
        x1: { type: "noul", instructions: "Выполнено ли условие «Понятна тема»?" },
        x2: { type: "noul", instructions: "Выполнено ли условие «Отказался»?" },
      },
    });
    expect(result).toEqual({ answers: { x1: 0.96, x2: 0.04 }, cost: 0.000021, inputTokens: 500, outputTokens: 12 });
  });

  it("цены в ответе нет — расход 0, токены остаются", async () => {
    const { fetch } = fakeFetch(() => ok({ x1: { type: "noul", noul: 0.5 } }, { input_tokens: 40, output_tokens: 3 }));
    const result = await requestDecision({ apiKey: "k", baseUrl: "https://openrouter.ai/api/v1", fetch }, { model: "m", state: {}, questions: [{ id: "x1", instructions: "?" }] });
    expect(result).toMatchObject({ cost: 0, inputTokens: 40, outputTokens: 3 });
  });

  it("ответ не 2xx — ошибка со статусом, без ключа", async () => {
    const { fetch } = fakeFetch(() => new Response(JSON.stringify({ error: { code: 402, message: "Insufficient credits" } }), { status: 402 }));
    const error = await requestDecision({ apiKey: "sk-or-секрет", baseUrl: "https://openrouter.ai/api/v1", fetch }, { model: "m", state: {}, questions: [{ id: "x1", instructions: "?" }] }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("402");
    expect((error as Error).message).not.toContain("sk-or-секрет");
  });

  it("вопрос без числового ответа в answers не попадает; цена остаётся", async () => {
    const missing = fakeFetch(() => ok({ x1: { type: "noul", noul: 0.9 }, x2: { type: "noul", noul: "много" } }));
    const result = await requestDecision(
      { apiKey: "k", baseUrl: "https://openrouter.ai/api/v1", fetch: missing.fetch },
      { model: "m", state: {}, questions: [{ id: "x1", instructions: "?" }, { id: "x2", instructions: "?" }, { id: "x3", instructions: "?" }] },
    );
    expect(result.answers).toEqual({ x1: 0.9 });
    expect(result.cost).toBe(0.000021);
  });

  it("передаёт сигнал отмены в fetch", async () => {
    const { fetch, sent } = fakeFetch(() => ok({ x1: { type: "noul", noul: 1 } }));
    const controller = new AbortController();
    await requestDecision({ apiKey: "k", baseUrl: "https://openrouter.ai/api/v1", fetch }, { model: "m", state: {}, questions: [{ id: "x1", instructions: "?" }], signal: controller.signal });
    expect(sent[0]!.init.signal).toBe(controller.signal);
  });
});
