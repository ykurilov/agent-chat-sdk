/**
 * Картинка в ответе инструмента для провайдеров, совместимых с OpenAI (Together, Fireworks). Их пакеты кладут ответ
 * инструмента из частей (`content`) строкой JSON: модель видит буквы base64 вместо картинки и думает без конца (живой
 * ход 2026-10-15). Сами провайдеры картинку видят, если она частью `image_url` (живой замер того же дня) — так её
 * передаёт и пакет DeepSeek. Обёртка `fetch` переписывает такую строку в части `text` и `image_url` перед отправкой.
 * Ответ без картинки, обычный текст и JSON инструмента не трогаются: запрос тот же, кэш цел.
 */
export function withToolResultImages(given?: typeof globalThis.fetch): typeof globalThis.fetch {
  return (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    // Без своего `fetch` — глобальный на момент запроса, как у пакета провайдера.
    const fetchImplementation = given ?? globalThis.fetch;
    if (typeof init?.body !== "string" || !init.body.includes('"role":"tool"')) return fetchImplementation(input, init);
    let body: { messages?: Array<{ role?: string; content?: unknown }> };
    try {
      body = JSON.parse(init.body);
    } catch {
      return fetchImplementation(input, init);
    }
    let changed = false;
    for (const message of body.messages ?? []) {
      if (message.role !== "tool" || typeof message.content !== "string") continue;
      const parts = imageContent(message.content);
      if (!parts) continue;
      message.content = parts;
      changed = true;
    }
    return fetchImplementation(input, changed ? { ...init, body: JSON.stringify(body) } : init);
  }) as typeof globalThis.fetch;
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/** Строка — части ответа инструмента с картинкой: части запроса. Иначе `undefined`. */
function imageContent(text: string): ContentPart[] | undefined {
  if (!text.startsWith("[")) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const parts: ContentPart[] = [];
  let images = 0;
  for (const part of value as Array<Record<string, any>>) {
    if (part?.type === "text" && typeof part.text === "string") {
      parts.push({ type: "text", text: part.text });
      continue;
    }
    const url = part?.type === "file" && typeof part.mediaType === "string" && part.mediaType.startsWith("image/") ? imageUrl(part.mediaType, part.data) : undefined;
    if (!url) return undefined;
    parts.push({ type: "image_url", image_url: { url } });
    images += 1;
  }
  return images > 0 ? parts : undefined;
}

/** Адрес картинки: ссылка как есть, данные — `data:`. Байты после `JSON.stringify` — объект с номерами. */
function imageUrl(mediaType: string, data: Record<string, any> | undefined): string | undefined {
  if (data?.type === "url" && typeof data.url === "string") return data.url;
  if (data?.type !== "data") return undefined;
  const raw = data.data;
  const base64 =
    typeof raw === "string" ? raw : raw && typeof raw === "object" ? Buffer.from(Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map((key) => raw[key])).toString("base64") : undefined;
  return base64 === undefined ? undefined : `data:${mediaType === "image/jpg" ? "image/jpeg" : mediaType};base64,${base64}`;
}
