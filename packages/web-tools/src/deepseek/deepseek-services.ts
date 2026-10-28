import { z } from "zod";
import type { ToolSet } from "ai";
import { cutAtCharBoundary } from "@ykurilov/agent-chat-core";
import { createWebTools } from "../create-web-tools";
import type { WebToolsModel, WebToolsSpending } from "../create-web-tools";
import { assertPublicWebAddress, isHttpAddress } from "../page-address";
import type { PageReaderService, SearchHit, WebSearchService } from "../services";
import { createWebUsageRecorder } from "../spending";
import { serviceFailure, WebToolError } from "../web-tool-error";

export interface DeepSeekOptions {
  apiKey: string;
  /** Origin или адрес прокси, с /v1 или без него. */
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  /** Общий срок вызова, включая повторы: 30с поиска / 60с чтения по умолчанию. */
  timeoutMs?: number;
  /** Повторы HTTP 408/429/5xx, по умолчанию 2, не больше 10. */
  maxRetries?: number;
  /** Начальная задержка повтора, по умолчанию 500мс; Retry-After учитывается в пределах общего срока. */
  retryDelayMs?: number;
  needContent?: boolean;
  /** Максимум знаков content одного результата поиска, по умолчанию 4000. */
  searchContentCharacterLimit?: number;
}
export interface DeepSeekServices { search: WebSearchService; reader: PageReaderService }
export interface DeepSeekWebToolsOptions extends DeepSeekOptions {
  searchResultLimit?: number;
  pageCharacterLimit?: number;
  /** Только успешный непустой ответ; providerId=deepseek. Цена по умолчанию $0.00075 за вызов. */
  spending?: Omit<WebToolsSpending, "pricePerCallUsd" | "providerId"> & {
    pricePerCallUsd?: { web_search: number; read_page: number };
  };
}

const resultSchema = z.object({
  title: z.string(), url: z.string(), snippet: z.string(), summary: z.string(),
  date: z.string().nullish(), content: z.string().optional(),
});
const searchSchema = z.object({ results: z.array(resultSchema) });
const pageSchema = z.object({ title: z.string(), content: z.string() });
const short = (text: string, limit: number) => cutAtCharBoundary(text, limit);

/** Низкоуровневые службы. Для автоматического учёта расходов используйте createDeepSeekWebTools. */
export function createDeepSeekServices(options: DeepSeekOptions): DeepSeekServices {
  return services(options);
}

/** Одна настройка для agent.tools; подписи остаются в /labels. Скриншоты DeepSeek не предоставляет. */
export function createDeepSeekWebTools(options: DeepSeekWebToolsOptions): (model: WebToolsModel) => ToolSet {
  const limit = options.searchResultLimit ?? 5;
  integer(limit, 1, 50, "searchResultLimit");
  const prices = { ...(options.spending?.pricePerCallUsd ?? { web_search: 0.00075, read_page: 0.00075 }) };
  for (const name of ["web_search", "read_page"] as const) if (!Number.isFinite(prices[name]) || prices[name] < 0) throw new Error("pricePerCallUsd: нужно число не меньше нуля");
  const record = options.spending && createWebUsageRecorder({ ...options.spending, pricePerCallUsd: prices, providerId: "deepseek" });
  // Проверить конфигурацию до первого хода. Для хода с расходами callback замыкает его owner/chat.
  const plain = createWebTools({ ...services(options), searchResultLimit: limit, pageCharacterLimit: options.pageCharacterLimit });
  if (!record) return plain;
  return (model: WebToolsModel) => {
    const { ownerId, chatId } = model;
    return createWebTools({
      ...services(options, async name => {
        if (ownerId && chatId) await record(name, prices[name], ownerId, chatId);
      }), searchResultLimit: limit, pageCharacterLimit: options.pageCharacterLimit,
    })(model);
  };
}

function integer(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}: нужно целое число от ${min} до ${max}`);
}
function services(options: DeepSeekOptions, billable?: (name: "web_search" | "read_page") => Promise<void>): DeepSeekServices {
  const apiKey = options.apiKey?.trim();
  if (!apiKey || /[^\x21-\x7e]/.test(apiKey)) throw new Error("apiKey: нужен корректный ключ DeepSeek");
  let base: URL;
  try { base = new URL(options.baseUrl ?? "https://api.deepseek.com"); } catch { throw new Error("baseUrl: неверный HTTP(S) адрес"); }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("baseUrl: нужен HTTP(S) адрес без логина, пароля, query и fragment");
  const baseUrl = base.href.replace(/\/+$/, "").replace(/\/v1$/, "");
  const retries = options.maxRetries ?? 2, delay = options.retryDelayMs ?? 500;
  integer(retries, 0, 10, "maxRetries");
  if (!Number.isFinite(delay) || delay < 0 || delay > 30000) throw new Error("retryDelayMs: нужно число от 0 до 30000");
  if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2147483647)) throw new Error("timeoutMs: нужен положительный срок до 2147483647мс");
  const contentLimit = options.searchContentCharacterLimit ?? 4000;
  integer(contentLimit, 0, 100000, "searchContentCharacterLimit");
  const request = options.fetch ?? globalThis.fetch;
  let headers: Headers;
  try { headers = new Headers(options.headers); } catch { throw new Error("headers: неверный HTTP заголовок"); }
  headers.set("Content-Type", "application/json"); headers.set("Authorization", `Bearer ${apiKey}`);

  async function post<Schema extends z.ZodType>(path: string, body: unknown, schema: Schema, signal: AbortSignal | undefined, timeout: number): Promise<z.infer<Schema>> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    let timedOut = false;
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason ?? new DOMException("Aborted", "AbortError"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    aborted.catch(() => {});
    const forward = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", forward, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? timeout);
    try {
      for (let attempt = 0; ; attempt++) {
        controller.signal.throwIfAborted();
        const response = await Promise.race([request(`${baseUrl}/v1/tools/${path}`, {
          method: "POST", headers, body: JSON.stringify(body), signal: controller.signal,
        }), aborted]);
        const text = await Promise.race([response.text(), aborted]);
        if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt < retries) {
          const retry = response.headers.get("retry-after");
          const seconds = retry !== null && retry.trim() !== "" ? Number(retry) : NaN;
          const after = retry === null ? NaN : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
          const backoff = Math.min(30000, delay * 2 ** attempt);
          // Не повторять раньше Retry-After: если он длиннее бюджета, истечёт общий timeout.
          await wait(Math.min(2147483647, Math.max(backoff, Number.isFinite(after) ? after : 0)), controller.signal);
          continue;
        }
        if (response.status !== 200) {
          if (response.status === 400) throw new WebToolError(path === "search" ? "bad_query" : "bad_address", "Сервис отклонил параметры веб-запроса.");
          if (response.status === 401) throw serviceFailure("invalid_key");
          if (response.status === 402) throw serviceFailure("insufficient_funds");
          if (response.status === 403) throw new WebToolError("bad_address", "Сервис не разрешил чтение этого адреса.");
          if (response.status === 429) throw serviceFailure("rate_limited");
          if (response.status === 408 || response.status === 504) throw serviceFailure("timeout");
          throw serviceFailure(response.status >= 500 || response.status === 404 ? "unavailable" : "bad_response");
        }
        let value: unknown;
        try { value = JSON.parse(text); } catch { throw serviceFailure("bad_response"); }
        // Тариф определяется сырым результатом HTTP200, до фильтрации/проверки полей.
        const payload = value as { results?: unknown; content?: unknown } | null;
        if (path === "search" && Array.isArray(payload?.results) && payload.results.length) await billable?.("web_search");
        if (path === "fetch" && typeof payload?.content === "string" && payload.content.trim()) await billable?.("read_page");
        const parsed = schema.safeParse(value);
        if (!parsed.success) throw serviceFailure("bad_response");
        return parsed.data;
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      if (error instanceof WebToolError) throw error;
      throw serviceFailure(timedOut ? "timeout" : "unavailable");
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", forward); controller.signal.removeEventListener("abort", rejectAbort);
    }
  }
  return {
    search: { async search(query, { limit, signal }) {
      const trimmed = query.trim();
      if (!trimmed || Array.from(trimmed).length > 128) throw new WebToolError("bad_query", "Поисковый запрос DeepSeek должен содержать от 1 до 128 символов Unicode.");
      integer(limit, 1, 50, "limit");
      const data = await post("search", { query: trimmed, count: limit, need_content: options.needContent ?? false }, searchSchema, signal, 30000);
      return data.results.slice(0, limit).filter(item => isHttpAddress(item.url)).map((item): SearchHit => ({
        title: short(item.title, 500), url: item.url, snippet: short(item.snippet, 500),
        summary: short(item.summary, 1600), ...(item.date && { date: short(item.date, 80) }),
        ...(options.needContent && item.content && { content: short(item.content, contentLimit) }),
      }));
    } },
    reader: { async readPage(url, { signal }) {
      if (Array.from(url).length > 8192) throw new WebToolError("bad_address", "Адрес страницы длиннее 8192 символов.");
      const address = assertPublicWebAddress(url);
      if (address.href.length > 8192) throw new WebToolError("bad_address", "Адрес страницы после кодирования длиннее 8192 символов.");
      const data = await post("fetch", { url: address.href }, pageSchema, signal, 60000);
      return { url: address.href, title: data.title, markdown: data.content };
    } },
  };
}
function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
