export interface DecisionSettings {
  apiKey: string;
  /** Адрес OpenRouter приложения, обычно `…/api/v1`; прокси работает так же. */
  baseUrl: string;
  /** Свои заголовки приложения (например, `X-Proxy-Token` прокси). Ключ и тип содержимого они не подменяют. */
  headers?: Record<string, string>;
  /** Для тестов. */
  fetch?: typeof fetch;
}

export interface DecisionQuestion {
  /** Ключ ответа: `id` условия сценария. */
  id: string;
  instructions: string;
}

export interface DecisionRequest {
  model: string;
  /** Что оценивать: любой JSON. */
  state: unknown;
  questions: DecisionQuestion[];
  signal?: AbortSignal;
}

export interface DecisionResponse {
  /** Вероятность «да» (`noul`, 0…1) по `id` вопроса. Вопроса без числового ответа здесь нет: цена всё равно списана. */
  answers: Record<string, number>;
  /** Цена вызова, доллары (`usage.cost`). */
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/** Адрес `/api/alpha/decisions` рядом с `…/api/v1` приложения: прокси с путём работает так же. */
export function decisionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base.slice(0, -"/v1".length)}/alpha/decisions` : `${base}/alpha/decisions`;
}

interface DecisionsReply {
  answers?: Record<string, { noul?: unknown } | undefined>;
  usage?: { cost?: unknown; input_tokens?: unknown; output_tokens?: unknown };
}

const asCount = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Клиент OpenRouter `/api/alpha/decisions`: вопросы `noul`, на каждый — вероятность «да». */
export async function requestDecision(settings: DecisionSettings, request: DecisionRequest): Promise<DecisionResponse> {
  const questions = Object.fromEntries(request.questions.map(({ id, instructions }) => [id, { type: "noul", instructions }]));
  const response = await (settings.fetch ?? globalThis.fetch)(decisionsUrl(settings.baseUrl), {
    method: "POST",
    headers: { ...settings.headers, authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: request.model, state: request.state, questions }),
    ...(request.signal && { signal: request.signal }),
  });
  if (!response.ok) {
    const details = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`OpenRouter decisions: ответ ${response.status}${details ? ` — ${details}` : ""}`);
  }
  const reply = (await response.json()) as DecisionsReply;
  const answers: Record<string, number> = {};
  for (const { id } of request.questions) {
    const probability = reply.answers?.[id]?.noul;
    if (typeof probability === "number" && Number.isFinite(probability)) answers[id] = probability;
  }
  return { answers, cost: asCount(reply.usage?.cost), inputTokens: asCount(reply.usage?.input_tokens), outputTokens: asCount(reply.usage?.output_tokens) };
}
