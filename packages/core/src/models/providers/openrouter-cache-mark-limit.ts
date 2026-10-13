/**
 * Сколько меток `cache_control` модель примет в одном запросе через OpenRouter; `undefined` — предела нет, тело запроса
 * не трогается. Claude (у всех хозяев: Anthropic, Google Vertex, Amazon Bedrock) — не больше 4, иначе ошибка 400
 * «A maximum of 4 blocks with cache_control may be provided».
 */
export function openrouterCacheMarkLimit(providerModelId: string): number | undefined {
  return /^~?anthropic\//.test(providerModelId) ? 4 : undefined;
}

/** `fetch`, который перед отправкой срезает лишние метки кэша в теле запроса (`limitCacheMarks`). */
export function fetchWithCacheMarkLimit(base: typeof globalThis.fetch | undefined, limit: number): typeof globalThis.fetch {
  return (input, init) => {
    const body = init?.body;
    const limited = typeof body === "string" ? limitCacheMarks(body, limit) : body;
    return (base ?? globalThis.fetch)(input, limited === body ? init : { ...init, body: limited });
  };
}

interface MarkSlot {
  holder: Record<string, unknown>;
  system: boolean;
}

/**
 * Тело запроса OpenRouter (JSON в форме OpenAI), в котором меток `cache_control` не больше `limit`. Меток не больше —
 * та же строка, байт в байт. Больше — снимаются лишние, остаются самые ценные:
 * 1. последняя метка — до неё этот запрос пишет кэш, по ней читает следующий шаг или ход;
 * 2. метка инструкции — начало запроса, которое не меняется ни при сжатии, ни при правке истории;
 * 3. дальше — более поздние: каждая метка кэширует всё до себя, а поздняя покрывает больше переписки.
 * Снимаются самые ранние метки истории после инструкции: их начало запроса и так в кэше по более поздней метке
 * (Anthropic ищет записанное до 20 блоков назад от метки). Метки на верхнем уровне и у инструментов ставит не SDK — они
 * не снимаются, но место занимают. Порядок оставшихся меток прежний, поэтому правило Anthropic «часовая метка не после
 * пятиминутной» не нарушается: подпоследовательность верного порядка тоже верна.
 */
export function limitCacheMarks(body: string, limit: number): string {
  if (countMarkKeys(body) <= limit) return body;
  const request = JSON.parse(body) as { cache_control?: unknown; tools?: unknown; messages?: unknown };
  const fixed = (request.cache_control !== undefined ? 1 : 0) + listOf(request.tools).filter((tool) => isRecord(tool) && tool.cache_control !== undefined).length;
  const slots = markSlots(request.messages);
  const room = Math.max(0, limit - fixed);
  if (slots.length <= room) return body;
  const kept = new Set<MarkSlot>();
  const keep = (slot: MarkSlot | undefined) => {
    if (slot && kept.size < room) kept.add(slot);
  };
  keep(slots.at(-1));
  for (const slot of slots) if (slot.system) keep(slot);
  for (const slot of [...slots].reverse()) keep(slot);
  for (const slot of slots) if (!kept.has(slot)) delete slot.holder.cache_control;
  return JSON.stringify(request);
}

/** Ключи `"cache_control":` в JSON: внутри строк кавычка экранирована, поэтому совпадение — только настоящий ключ. */
function countMarkKeys(body: string): number {
  return body.split('"cache_control":').length - 1;
}

/** Метки сообщений по порядку: на самом сообщении и на его частях. */
function markSlots(messages: unknown): MarkSlot[] {
  const slots: MarkSlot[] = [];
  for (const message of listOf(messages)) {
    if (!isRecord(message)) continue;
    const system = message.role === "system";
    if (message.cache_control !== undefined) slots.push({ holder: message, system });
    for (const part of listOf(message.content)) {
      if (isRecord(part) && part.cache_control !== undefined) slots.push({ holder: part, system });
    }
  }
  return slots;
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
