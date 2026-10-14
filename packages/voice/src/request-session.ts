import type { SonioxContext } from "./soniox-messages";
import { VoiceError } from "./voice-errors";

/** Параметры одной диктовки, которые отдаёт сервер приложения. */
export interface VoiceSessionParameters {
  apiKey: string;
  websocketUrl: string;
  model: string;
  languageHints: string[];
  /** Самая долгая диктовка, секунд. */
  maxSessionSeconds?: number;
  context?: SonioxContext;
}

/** Просит у сервера приложения временный ключ и настройки распознавания. */
export async function requestSession(api: string, fetchImpl: typeof fetch, languageHints?: string[]): Promise<VoiceSessionParameters> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${api.replace(/\/+$/, "")}/session`,
      languageHints
        ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ languageHints }) }
        : { method: "POST" },
    );
  } catch {
    throw new VoiceError("network");
  }
  if (response.status === 429) throw new VoiceError("rate_limited");
  if (response.status === 402) throw new VoiceError("limit");
  if (response.status === 401 || response.status === 403) throw new VoiceError("forbidden");
  if (!response.ok) throw new VoiceError("service_unavailable");

  const body = (await response.json().catch(() => null)) as Partial<VoiceSessionParameters> | null;
  if (
    !body ||
    typeof body.apiKey !== "string" ||
    typeof body.websocketUrl !== "string" ||
    typeof body.model !== "string" ||
    !Array.isArray(body.languageHints)
  ) {
    throw new VoiceError("service_unavailable");
  }
  return {
    apiKey: body.apiKey,
    websocketUrl: body.websocketUrl,
    model: body.model,
    languageHints: body.languageHints,
    ...(typeof body.maxSessionSeconds === "number" && { maxSessionSeconds: body.maxSessionSeconds }),
    ...(body.context && { context: body.context }),
  };
}
