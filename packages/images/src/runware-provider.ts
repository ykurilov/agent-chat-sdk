import type { ImageGenerationRequest, ImageProviderConnection, ImageProviderDescription } from "./image-catalog";
import { providerFailureKind } from "./image-failure";
import { ImageGenerationError } from "./image-generation-error";
import { hideSecrets } from "./hide-secrets";

const RUNWARE_URL = "https://api.runware.ai/v1";
/** Причина для модели — не длиннее этого, знаков. */
const MAX_REASON_LENGTH = 300;
/** Формат файла у Runware; без формата — JPG, как было. */
const outputFormats = { png: "PNG", jpeg: "JPG", webp: "WEBP" } as const;

interface RunwareError {
  code?: unknown;
  message?: unknown;
}
interface RunwareAnswer {
  data?: Array<{ imageURL?: unknown; cost?: unknown }>;
  errors?: RunwareError[];
}

/** Задача `imageInference` по contracts/images.md: одна картинка, адрес вместо байтов, цена в ответе. */
function taskBody(request: ImageGenerationRequest) {
  return [
    {
      taskType: "imageInference",
      taskUUID: request.taskUUID,
      model: request.providerModelId,
      positivePrompt: request.prompt,
      width: request.width,
      height: request.height,
      numberResults: 1,
      outputType: "URL",
      outputFormat: outputFormats[request.outputFormat ?? "jpeg"],
      deliveryMethod: "sync",
      includeCost: true,
      ...request.providerSettings,
    },
  ];
}

/** «код: текст» первых ошибок Runware, без ключа и заголовков подключения. */
function errorsText(errors: readonly RunwareError[] | undefined, connection: ImageProviderConnection): string | undefined {
  const lines = (errors ?? [])
    .map((error) => [error.code, error.message].filter((part) => typeof part === "string" && part.length > 0).join(": "))
    .filter((line) => line.length > 0);
  if (lines.length === 0) return undefined;
  return hideSecrets(lines.join("; "), connection).slice(0, MAX_REASON_LENGTH);
}

async function readAnswer(response: Response): Promise<RunwareAnswer | undefined> {
  try {
    return (await response.json()) as RunwareAnswer;
  } catch {
    return undefined;
  }
}

/**
 * Runware: `POST` задачи с Bearer-ключом и заголовками подключения. Отказ 4xx — до работы, расхода нет; 5xx, пустой
 * ответ, обрыв и срок — задача могла выполниться. «Стоп» пробрасывается как есть.
 */
export const runwareProvider: ImageProviderDescription = {
  id: "runware",
  displayName: "Runware",
  apiKeyEnv: "RUNWARE_API_KEY",
  baseURL: RUNWARE_URL,
  async generate(request, connection) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("timeout", "TimeoutError")), request.timeoutMs);
    const signal = request.abortSignal ? AbortSignal.any([request.abortSignal, timeout.signal]) : timeout.signal;
    let response: Response;
    let answer: RunwareAnswer | undefined;
    try {
      response = await connection.fetch(connection.baseURL ?? RUNWARE_URL, {
        method: "POST",
        headers: { ...connection.headers, Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(taskBody(request)),
        signal,
      });
      answer = await readAnswer(response);
    } catch (error) {
      if (request.abortSignal?.aborted) throw request.abortSignal.reason ?? error;
      if (timeout.signal.aborted) {
        throw new ImageGenerationError(`Провайдер не ответил за ${Math.round(request.timeoutMs / 1000)} с`, { refusedBeforeWork: false, kind: "transient" });
      }
      throw new ImageGenerationError("Провайдер недоступен", { refusedBeforeWork: false, kind: "transient" });
    } finally {
      clearTimeout(timer);
    }

    const reason = errorsText(answer?.errors, connection);
    const firstCode = answer?.errors?.find((error) => typeof error.code === "string")?.code;
    const providerCode = typeof firstCode === "string" ? hideSecrets(firstCode, connection).slice(0, 100) : undefined;
    const classification = { kind: providerFailureKind(response.status, providerCode, (answer?.errors ?? []).map((error) => typeof error.message === "string" ? error.message : "").join("; ")), ...(providerCode && { providerCode }) };
    if (response.status >= 400 && response.status < 500 && response.status !== 408) {
      throw new ImageGenerationError(reason ?? `Провайдер отказал: ${response.status}`, { refusedBeforeWork: true, ...classification });
    }
    if (!response.ok) throw new ImageGenerationError(`Провайдер ответил ошибкой ${response.status}${reason ? `: ${reason}` : ""}`, { refusedBeforeWork: false, ...classification });
    const image = answer?.data?.[0];
    if (!image || typeof image.imageURL !== "string") {
      throw new ImageGenerationError(reason ?? "Провайдер не вернул картинку", { refusedBeforeWork: false, ...classification });
    }
    const cost = typeof image.cost === "number" && Number.isFinite(image.cost) && image.cost >= 0 ? image.cost : undefined;
    return [{ url: image.imageURL, ...(cost !== undefined && { costUsd: cost }) }];
  },
};
