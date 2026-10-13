import type { ImageGenerationRequest, ImageGenerationResult, ImageProviderConnection, ImageProviderDescription, ImageTaskState } from "./image-catalog";
import { ImageGenerationError } from "./image-generation-error";
import { hideSecrets } from "./hide-secrets";
import { waitForImageTask } from "./image-task-polling";

const KIE_URL = "https://api.kie.ai/api/v1";
/** Цена кредита KIE (пакеты от $5 за 1000 кредитов). */
const CREDIT_USD = 0.005;
/** Причина для модели — не длиннее этого, знаков. */
const MAX_REASON_LENGTH = 300;
/** Ответ KIE на неизвестную задачу: `{ code: 422, msg: "recordInfo is null" }`. */
const UNKNOWN_TASK_CODE = 422;

interface KieAnswer {
  code?: unknown;
  msg?: unknown;
  data?: {
    taskId?: unknown;
    state?: unknown;
    resultJson?: unknown;
    failCode?: unknown;
    failMsg?: unknown;
    creditsConsumed?: unknown;
  } | null;
}

const isStatus = (code: number) => Number.isInteger(code) && code >= 100 && code < 600;

async function readAnswer(response: Response): Promise<KieAnswer | undefined> {
  try {
    return (await response.json()) as KieAnswer;
  } catch {
    return undefined;
  }
}

/** Код ответа: KIE часто кладёт его в тело при HTTP 200. */
function answerCode(response: Response, answer: KieAnswer | undefined): number {
  const code = typeof answer?.code === "number" ? answer.code : response.status;
  return response.ok && isStatus(code) ? code : response.status;
}

const reasonOf = (code: number, answer: KieAnswer | undefined, connection: ImageProviderConnection) =>
  hideSecrets(`KIE ${code}${typeof answer?.msg === "string" && answer.msg ? `: ${answer.msg}` : ""}`, connection).slice(0, MAX_REASON_LENGTH);

const costOf = (credits: unknown) => (typeof credits === "number" && Number.isFinite(credits) && credits >= 0 ? credits * CREDIT_USD : undefined);

function headersOf(connection: ImageProviderConnection): Record<string, string> {
  return { ...connection.headers, Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" };
}

/** Тело `createTask`: модель и `input` с полями профиля. Модели правки получают исходник, а пропорцию берут у него. */
function taskBody(request: ImageGenerationRequest) {
  return {
    model: request.providerModelId,
    input: {
      prompt: request.prompt,
      ...(request.imageUrl === undefined ? { aspect_ratio: request.aspectRatio ?? `${request.width}:${request.height}` } : { image_url: request.imageUrl }),
      ...request.providerSettings,
    },
  };
}

/** Адреса из `resultJson` (JSON-строка `{"resultUrls":[…]}`). */
function resultUrls(resultJson: unknown): string[] {
  if (typeof resultJson !== "string") return [];
  try {
    const urls = (JSON.parse(resultJson) as { resultUrls?: unknown }).resultUrls;
    return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === "string" && url.length > 0) : [];
  } catch {
    return [];
  }
}

async function submit(request: ImageGenerationRequest, connection: ImageProviderConnection): Promise<string> {
  let response: Response;
  let answer: KieAnswer | undefined;
  try {
    response = await connection.fetch(`${connection.baseURL ?? KIE_URL}/jobs/createTask`, {
      method: "POST",
      headers: headersOf(connection),
      body: JSON.stringify(taskBody(request)),
      ...(request.abortSignal && { signal: request.abortSignal }),
    });
    answer = await readAnswer(response);
  } catch (error) {
    if (request.abortSignal?.aborted) throw request.abortSignal.reason ?? error;
    throw new ImageGenerationError("Провайдер недоступен", { refusedBeforeWork: false });
  }
  const code = answerCode(response, answer);
  const taskId = answer?.data?.taskId;
  if (code === 200 && typeof taskId === "string" && taskId.length > 0) return taskId;
  if (code >= 400 && code < 500 && code !== 408) throw new ImageGenerationError(reasonOf(code, answer, connection), { refusedBeforeWork: true });
  throw new ImageGenerationError(`Провайдер ответил ошибкой: ${reasonOf(code, answer, connection)}`, { refusedBeforeWork: false });
}

async function check(taskId: string, connection: ImageProviderConnection, abortSignal?: AbortSignal): Promise<ImageTaskState> {
  const response = await connection.fetch(`${connection.baseURL ?? KIE_URL}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: headersOf(connection),
    ...(abortSignal && { signal: abortSignal }),
  });
  const answer = await readAnswer(response);
  const code = answerCode(response, answer);
  if (code === UNKNOWN_TASK_CODE && !answer?.data) return { status: "failed", reason: "Задача не найдена у провайдера" };
  // Временный сбой: опрос повторит.
  if (code >= 500 || code === 408 || code === 429 || !answer) throw new Error(`KIE ответил ${code}`);
  if (code !== 200) throw new ImageGenerationError(reasonOf(code, answer, connection), { refusedBeforeWork: false });

  const data = answer.data ?? {};
  const costUsd = costOf(data.creditsConsumed);
  if (data.state === "success") {
    const urls = resultUrls(data.resultJson);
    if (urls.length === 0) return { status: "failed", reason: "Провайдер не вернул картинку", ...(costUsd !== undefined && { costUsd }) };
    // Цена — за задачу целиком: на первом адресе.
    const results: ImageGenerationResult[] = urls.map((url, index) => ({ url, ...(index === 0 && costUsd !== undefined && { costUsd }) }));
    return { status: "ready", results };
  }
  if (data.state === "fail") {
    const reason = [data.failCode, data.failMsg].filter((part) => (typeof part === "string" || typeof part === "number") && String(part).length > 0).join(": ");
    return { status: "failed", reason: hideSecrets(reason || "Провайдер не смог создать картинку", connection).slice(0, MAX_REASON_LENGTH), ...(costUsd !== undefined && { costUsd }) };
  }
  return { status: "pending" };
}

/**
 * KIE.ai: задача в очереди (`createTask`) и проверка её состояния (`recordInfo`), Bearer-ключ `KIE_API_KEY`. Цена —
 * `creditsConsumed` × $0.005. Отказ 4xx при отправке — до работы, расхода нет; 5xx и обрыв — задача могла уйти.
 */
export const kieProvider: ImageProviderDescription = {
  id: "kie",
  displayName: "KIE.ai",
  apiKeyEnv: "KIE_API_KEY",
  baseURL: KIE_URL,
  queue: { submit, check },
  async generate(request, connection) {
    const deadline = Date.now() + request.timeoutMs;
    const taskId = await submit(request, connection);
    const outcome = await waitForImageTask({
      check: (abortSignal) => check(taskId, connection, abortSignal),
      deadline,
      ...(request.abortSignal && { abortSignal: request.abortSignal }),
    });
    if (outcome.status === "ready") return outcome.results;
    if (outcome.status === "failed") throw new ImageGenerationError(outcome.reason, { refusedBeforeWork: false });
    throw new ImageGenerationError(`Провайдер не ответил за ${Math.round(request.timeoutMs / 1000)} с`, { refusedBeforeWork: false });
  },
};
