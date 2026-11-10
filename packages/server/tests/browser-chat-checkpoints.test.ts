import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { createBrowserChatHandler } from "../src/browser-chat/index";
import type { BrowserChatHandlerOptions, BrowserChatOperation, BrowserChatUsage } from "../src/browser-chat/types";
import type { BrowserChatSnapshot, ChatHistory } from "@ykurilov/agent-chat-core";
import { catalogWithModel, mockEnv, mockModelId, usage } from "./support/mock-catalog";

const key = new Uint8Array(32).fill(9);
const decode = (snapshot: BrowserChatSnapshot): ChatHistory => JSON.parse(gunzipSync(Buffer.from(snapshot.view, "base64")).toString());
const answerText = (history: ChatHistory) => history.messages.at(-1)!.parts.flatMap(part => part.type === "text" ? [part.text] : []).join("");
const message = (id: string, value: string): BrowserChatOperation => ({ type: "message", message: { id, role: "user", parts: [{ type: "text", text: value }] } });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
interface StreamRecord { type: string; snapshot?: BrowserChatSnapshot; chunks?: Array<{ type: string; delta?: string }> }

/** Модель отвечает кусками `deltas` с паузой `gapMs` между ними. */
function slowModel(deltas: string[], gapMs: number) {
  return new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream<LanguageModelV4StreamPart>({ async start(out) {
    out.enqueue({ type: "stream-start", warnings: [] }); out.enqueue({ type: "text-start", id: "text" });
    for (const delta of deltas) { out.enqueue({ type: "text-delta", id: "text", delta }); if (gapMs) await pause(gapMs); }
    out.enqueue({ type: "text-end", id: "text" }); out.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }); out.close();
  } }) }) });
}
function setup(model: MockLanguageModelV4, extra: Partial<BrowserChatHandlerOptions> = {}, onUsage?: (usage: BrowserChatUsage) => Promise<void>) {
  const handler = createBrowserChatHandler({ namespace: "checkpoints", snapshotKey: key, checkpointIntervalMs: 10, maxRequestBytes: 4 * 1024 * 1024,
    resolveUser: async () => ({ id: "owner" }),
    configure: () => ({ catalog: catalogWithModel(model), agent: { instructions: "Server" }, env: mockEnv, defaultChoice: { modelId: mockModelId, providerId: "mock" }, ...(onUsage && { onUsage }) }), ...extra });
  const rpc = (operation: BrowserChatOperation, snapshot: BrowserChatSnapshot | null = null) => handler.fetch(new Request("http://test/browser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: "local-chat", snapshot, operation }) }));
  return { handler, rpc };
}
async function recordsOf(response: Response): Promise<StreamRecord[]> {
  expect(response.status).toBe(200);
  if (response.headers.get("content-type")?.includes("application/json")) return [await response.json()];
  return (await response.text()).trim().split("\n").map(line => JSON.parse(line));
}
const last = (records: StreamRecord[]) => records.at(-1)!.snapshot!;
const streamedText = (records: StreamRecord[]) => records.flatMap(record => record.chunks ?? []).flatMap(chunk => chunk.type === "text-delta" ? [chunk.delta] : []).join("");

describe("browser-owned checkpoints", () => {
  it("длинный чат: снимок идёт реже, чем раз в checkpointIntervalMs, а показанный текст всё равно в последнем снимке", async () => {
    // Несжимаемая история ~300 КБ: снимок с ней тяжёлый, слать его каждые 10 мс — это мегабайты в секунду.
    const big = randomBytes(220_000).toString("base64");
    const first = setup(slowModel([big], 0));
    const one = last(await recordsOf(await first.rpc(message("u1", "Расскажи длинно"))));
    await first.handler.close();
    const deltas = Array.from({ length: 40 }, (_, index) => `часть ${index}. `);
    const second = setup(slowModel(deltas, 15));
    const records = await recordsOf(await second.rpc(message("u2", "Ещё"), one));
    expect(records.at(-1)!.type).toBe("end");
    expect(streamedText(records)).toBe(deltas.join(""));
    expect(answerText(decode(last(records)))).toBe(deltas.join(""));
    // Каждая пачка частей — только вместе со снимком, который их содержит.
    for (const record of records.filter(record => record.type === "data")) expect(record.snapshot).toBeDefined();
    const checkpoints = records.filter(record => record.snapshot).length;
    expect(checkpoints).toBeLessThanOrEqual(6);
    await second.handler.close();
  });

  it("медленный читатель не обрывает ход: промежуточные снимки пропускаются, конец доходит целиком", async () => {
    const deltas = Array.from({ length: 400 }, (_, index) => `${index}:${"ж".repeat(200)} `);
    const s = setup(slowModel(deltas, 1), { maxRequestBytes: 64 * 1024 });
    const response = await s.rpc(message("u1", "Пиши"));
    expect(response.status).toBe(200);
    // Браузер не читает поток, пока модель не закончила: очередь сервера переполнена бы старым способом.
    await vi.waitFor(async () => { await pause(50); expect(s.handler.activeRequests).toBe(1); }, { timeout: 3000 });
    await pause(1500);
    const records = await recordsOf(response);
    expect(records.at(-1)!.type).toBe("end");
    expect(streamedText(records)).toBe(deltas.join(""));
    await s.handler.close();
  });

  it("сбой onUsage не теряет расход: следующий запрос повторяет учёт той же записи", async () => {
    const billed: BrowserChatUsage[] = [];
    let billingDown = true;
    const onUsage = vi.fn(async (usage: BrowserChatUsage) => { if (billingDown) throw new Error("billing unavailable"); billed.push(usage); });
    const s = setup(slowModel(["Ответ"], 0), {}, onUsage);
    const one = last(await recordsOf(await s.rpc(message("u1", "Вопрос"))));
    expect(onUsage).toHaveBeenCalledTimes(1);
    const failedId = onUsage.mock.calls[0]![0].id;
    billingDown = false;
    const two = last(await recordsOf(await s.rpc({ type: "bootstrap" }, one)));
    expect(billed.map(usage => usage.id)).toEqual([failedId]);
    // Учтённое не повторяется.
    await recordsOf(await s.rpc({ type: "bootstrap" }, two));
    expect(billed.map(usage => usage.id)).toEqual([failedId]);
    await s.handler.close();
  });

  it("битый JSON — неверный запрос (400), а не сбой сервера", async () => {
    const onError = vi.fn();
    const s = setup(slowModel(["x"], 0), { onError });
    const response = await s.handler.fetch(new Request("http://test/browser", { method: "POST", headers: { "content-type": "application/json" }, body: '{"chatId":"local-chat","snap' }));
    expect(response.status).toBe(400);
    await s.handler.close();
  });
});
