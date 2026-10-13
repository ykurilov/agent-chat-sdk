// Живой замер: какие хозяева модели внутри OpenRouter видят картинку в результате инструмента.
// Картинка «слева жёлтая половина, справа фиолетовая» идёт в результате инструмента тем же путём, что и в ходе агента
// (провайдер OpenRouter из каталога). Каждый хозяин — отдельно: `provider.only` и `allow_fallbacks: false`.
// Платный и долгий, поэтому только по запросу: OPENROUTER_HOSTS_PROBE=1, итог — JSON в OPENROUTER_HOSTS_PROBE_OUT.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { generateText, jsonSchema, tool, type ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { standardCatalog, type ReasoningLevelId } from "../../src";
import { openrouterProvider } from "../../src/models/providers/openrouter";

const apiKey = process.env.OPENROUTER_API_KEY;
const enabled = Boolean(apiKey && process.env.OPENROUTER_HOSTS_PROBE);
const attemptsPerHost = Number(process.env.OPENROUTER_HOSTS_PROBE_ATTEMPTS ?? 2);
// Перепроверка части хозяев: OPENROUTER_HOSTS_PROBE_TAGS=fireworks,deepseek; уровень рассуждений — OPENROUTER_HOSTS_PROBE_REASONING.
const onlyTags = process.env.OPENROUTER_HOSTS_PROBE_TAGS?.split(",").filter(Boolean);
const reasoningLevel = process.env.OPENROUTER_HOSTS_PROBE_REASONING as ReasoningLevelId | undefined;

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** PNG 256×128: левая половина жёлтая, правая фиолетовая; base64. */
function halvesPng(): string {
  const width = 256;
  const height = 128;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const pixels = Array.from({ length: width }, (_, x) => (x < width / 2 ? [240, 210, 20] : [140, 30, 200])).flat();
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(pixels)]);
  const data = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", data),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64");
}

const picture = halvesPng();

const messages: ModelMessage[] = [
  { role: "user", content: "Call show_picture, then tell me what you see: which colors, and where." },
  { role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "show_picture", input: {} }] },
  {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "show_picture",
      output: { type: "content", value: [{ type: "text", text: "The picture:" }, { type: "file", data: { type: "data", data: picture }, mediaType: "image/png" }] },
    }],
  },
];

type Verdict = "sees" | "wrong" | "error";

function verdictOf(text: string): Verdict {
  const lower = text.toLowerCase();
  return /yellow/.test(lower) && /purple|violet|magenta|lavender/.test(lower) ? "sees" : "wrong";
}

interface Endpoint { tag: string; provider_name: string; quantization?: string }

async function endpointsOf(providerModelId: string): Promise<Endpoint[]> {
  const response = await fetch(`https://openrouter.ai/api/v1/models/${providerModelId}/endpoints`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const body = (await response.json()) as { data: { endpoints: Endpoint[] } };
  return body.data.endpoints;
}

async function probe(providerModelId: string, defaultLevel: ReasoningLevelId | undefined, tag: string) {
  const profile = standardCatalog.models.find((model) => model.providerModelIds.openrouter === providerModelId)!;
  const reasoning = defaultLevel ? openrouterProvider.reasoningRequest!(defaultLevel, { profile, providerModelId }) : undefined;
  try {
    const result = await generateText({
      model: openrouterProvider.createLanguageModel(providerModelId, apiKey!),
      messages,
      tools: { show_picture: tool({ description: "Shows you a picture.", inputSchema: jsonSchema({ type: "object", properties: {} }) }) },
      maxOutputTokens: 4000,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(150_000),
      providerOptions: {
        openrouter: { ...reasoning?.providerOptions?.openrouter, provider: { only: [tag], allow_fallbacks: false } },
      },
    });
    return { verdict: verdictOf(result.text), answer: result.text.slice(0, 300) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const body = (error as { responseBody?: string }).responseBody;
    return { verdict: "error" as Verdict, answer: `${message} ${body ?? ""}`.slice(0, 300) };
  }
}

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) results.push(...(await Promise.all(items.slice(start, start + size).map(work))));
  return results;
}

const models = standardCatalog.models.filter((model) => model.acceptsImages && model.providerModelIds.openrouter);

describe.skipIf(!enabled)("OpenRouter: кто из хозяев модели видит картинку в результате инструмента", () => {
  it.each(models)("$id", async (model) => {
    const providerModelId = model.providerModelIds.openrouter!;
    const endpoints = (await endpointsOf(providerModelId)).filter((endpoint) => !onlyTags || onlyTags.includes(endpoint.tag));
    const runs = endpoints.flatMap((endpoint) => Array.from({ length: attemptsPerHost }, () => endpoint));
    const results = await inBatches(runs, Number(process.env.OPENROUTER_HOSTS_PROBE_BATCH ?? 8), async (endpoint) => ({
      tag: endpoint.tag,
      host: endpoint.provider_name,
      quantization: endpoint.quantization,
      ...(await probe(providerModelId, reasoningLevel ?? model.reasoning.defaultLevel, endpoint.tag)),
    }));
    const out = process.env.OPENROUTER_HOSTS_PROBE_OUT;
    if (out) writeFileSync(`${out}-${model.id}.json`, JSON.stringify({ model: model.id, providerModelId, date: new Date().toISOString(), results }, null, 2));
    for (const result of results) console.log(`${model.id} | ${result.tag} | ${result.verdict} | ${result.answer.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(results.length).toBeGreaterThan(0);
  }, 900_000);
});
