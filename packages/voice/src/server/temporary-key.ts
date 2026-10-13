export interface TemporaryKeyRequest {
  apiBaseUrl: string;
  apiHeaders: Record<string, string>;
  mainKey: string;
  lifetimeSeconds: number;
  maxSessionSeconds: number;
  /** Кому выдан ключ: попадает в учёт Soniox. */
  userId: string;
  fetch: typeof fetch;
  timeoutMs: number;
}

export interface TemporaryKey {
  apiKey: string;
  expiresAt: string;
}

/** Soniox не выдал ключ: причина для журнала сервера (без ключей) и вид для ответа браузеру. */
export class TemporaryKeyError extends Error {}

/** Запрашивает у Soniox одноразовый ключ только на потоковое распознавание. */
export async function requestTemporaryKey(request: TemporaryKeyRequest): Promise<TemporaryKey> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await request.fetch(`${request.apiBaseUrl.replace(/\/+$/, "")}/v1/auth/temporary-api-key`, {
      method: "POST",
      headers: {
        ...request.apiHeaders,
        Authorization: `Bearer ${request.mainKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        usage_type: "transcribe_websocket",
        expires_in_seconds: request.lifetimeSeconds,
        single_use: true,
        max_session_duration_seconds: request.maxSessionSeconds,
        client_reference_id: request.userId.slice(0, 256),
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new TemporaryKeyError(`Soniox ответил ${response.status} на запрос временного ключа`);
    const body = (await response.json().catch(() => null)) as { api_key?: unknown; expires_at?: unknown } | null;
    if (typeof body?.api_key !== "string" || typeof body.expires_at !== "string") {
      throw new TemporaryKeyError("Soniox вернул неожиданный ответ на запрос временного ключа");
    }
    return { apiKey: body.api_key, expiresAt: body.expires_at };
  } catch (error) {
    if (error instanceof TemporaryKeyError) throw error;
    const timedOut = controller.signal.aborted;
    throw new TemporaryKeyError(
      timedOut
        ? `Soniox не ответил за ${request.timeoutMs / 1000} с`
        : `Не удалось связаться с Soniox: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}
