import { describe, expect, it, vi } from "vitest";
import { createDeepSeekServices } from "../src/deepseek/deepseek-services";
import { createFirecrawlServices } from "../src/firecrawl/firecrawl-services";
import { MAX_SERVICE_RESPONSE_BYTES } from "../src/read-limited-text";

/** Ответ службы без конца: сколько кусков отдано, видно снаружи. */
function endlessResponse() {
  const state = { pulled: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(0x61));
    },
  });
  return { state, response: new Response(body, { status: 200, headers: { "content-type": "application/json" } }) };
}

const pageUrl = "https://example.com/article";
const maxChunks = MAX_SERVICE_RESPONSE_BYTES / (1024 * 1024) + 4;

describe("ответ веб-службы читается с пределом", () => {
  it("Firecrawl: ответ больше предела — bad_response, тело не дочитывается", async () => {
    const endless = endlessResponse();
    const fetch = vi.fn(async () => endless.response) as unknown as typeof globalThis.fetch;
    const { reader } = createFirecrawlServices({ apiKey: "fc-test-only", fetch });
    await expect(reader.readPage(pageUrl, {})).rejects.toMatchObject({ kind: "bad_response" });
    expect(endless.state.pulled).toBeLessThan(maxChunks);
  });

  it("DeepSeek: ответ больше предела — bad_response, тело не дочитывается", async () => {
    const endless = endlessResponse();
    const fetch = vi.fn(async () => endless.response) as unknown as typeof globalThis.fetch;
    const { reader } = createDeepSeekServices({ apiKey: "test-only-deepseek-key", fetch });
    await expect(reader.readPage(pageUrl, {})).rejects.toMatchObject({ kind: "bad_response" });
    expect(endless.state.pulled).toBeLessThan(maxChunks);
  });
});
