import { createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepSeekServices, createDeepSeekWebTools } from "../src/deepseek/deepseek-services";
import { executeOptions } from "./support";

const hit = { title: "Title", url: "https://example.com/article", snippet: "Brief", summary: "Long summary", date: "2026-10-28T00:00:00Z", content: "Full page" };
const reply = (results = [hit]) => Response.json({ results });
const turn = { profile: { acceptsImages: true }, providerId: "any-provider", ownerId: "a", chatId: "c" };
const key = "test-only-deepseek-key";
afterEach(() => vi.useRealTimers());

describe("DeepSeek web services", () => {
  it("uses POST JSON, normalized proxy /v1, bearer headers and complete result fields", async () => {
    const request = vi.fn<typeof fetch>(async () => reply());
    const services = createDeepSeekServices({ apiKey: key, baseUrl: "https://proxy.example/deepseek/v1/", headers: { authorization: "bad", "X-Proxy-Token": "proxy" }, fetch: request, needContent: true });
    expect(await services.search.search(" query ", { limit: 50 })).toEqual([hit]);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe("https://proxy.example/deepseek/v1/tools/search");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
    expect(new Headers(init?.headers).get("x-proxy-token")).toBe("proxy");
    expect(JSON.parse(init!.body as string)).toEqual({ query: "query", count: 50, need_content: true });
  });
  it("validates Unicode query/count and unsafe addresses before network", async () => {
    const request = vi.fn<typeof fetch>(async () => reply());
    const s = createDeepSeekServices({ apiKey: key, fetch: request });
    await s.search.search("😀".repeat(128), { limit: 1 });
    for (const query of [" ", "😀".repeat(129)]) await expect(s.search.search(query, { limit: 1 })).rejects.toMatchObject({ kind: "bad_query" });
    for (const limit of [0, 51, 1.5]) await expect(s.search.search("q", { limit })).rejects.toThrow();
    for (const url of ["http://127.0.0.1/", "https://user:password@example.com", "file:///tmp/a", `https://example.com/${"a".repeat(8192)}`, `https://example.com/${"😀".repeat(1000)}`]) await expect(s.reader.readPage(url, {})).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("reads Markdown and bounds optional search text without exposing unsupported URLs", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply([{ ...hit, url: "javascript:bad" }, hit])).mockResolvedValueOnce(Response.json({ title: "Page", content: "# Markdown" }));
    const s = createDeepSeekServices({ apiKey: key, fetch: request, needContent: true, searchContentCharacterLimit: 4 });
    expect(await s.search.search("q", { limit: 5 })).toEqual([{ ...hit, content: "Full" }]);
    expect(await s.reader.readPage(hit.url, {})).toEqual({ title: "Page", url: hit.url, markdown: "# Markdown" });
    expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({ url: hit.url });
  });
  it("retries 429 with Retry-After and 5xx, but counts a single final result", async () => {
    vi.useFakeTimers();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("rate", { status: 429, headers: { "Retry-After": "2" } })).mockResolvedValueOnce(new Response("fail", { status: 503 })).mockResolvedValueOnce(reply());
    const s = createDeepSeekServices({ apiKey: key, fetch: request, retryDelayMs: 100 });
    const result = s.search.search("q", { limit: 1 });
    await vi.advanceTimersByTimeAsync(1999); expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200); await expect(result).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
  });
  it("honors Retry-After as an HTTP date", async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("rate",{status:429,headers:{"Retry-After":"Tue, 01 Jan 2030 00:00:02 GMT"}})).mockResolvedValueOnce(reply());
    const result=createDeepSeekServices({apiKey:key,fetch:request,retryDelayMs:1}).search.search("q",{limit:1});
    await vi.advanceTimersByTimeAsync(1999);expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);await expect(result).resolves.toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
  });
  it.each([[400,"bad_query"],[401,"invalid_key"],[402,"insufficient_funds"],[403,"bad_address"],[404,"unavailable"],[413,"bad_response"]])("does not retry HTTP %s and redacts provider bodies", async (status,kind) => {
    const request = vi.fn<typeof fetch>(async () => new Response(`secret ${key}`, { status: status as number }));
    const call = createDeepSeekServices({ apiKey: key, fetch: request }).search.search("q", { limit: 1 });
    await expect(call).rejects.toMatchObject({ kind });
    await expect(call).rejects.not.toThrow(key); expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounded retries exhaust, malformed responses never retry", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response("rate", { status: 429 }));
    await expect(createDeepSeekServices({ apiKey: key, fetch: request, retryDelayMs: 0 }).search.search("q", { limit: 1 })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(request).toHaveBeenCalledTimes(3);
    request.mockClear();request.mockResolvedValue(Response.json({ results: [{}] }));
    await expect(createDeepSeekServices({ apiKey: key, fetch: request }).search.search("q", { limit: 1 })).rejects.toMatchObject({ kind: "bad_response" });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("cancels a backoff and a fetch ignoring abort; retires deadline timers", async () => {
    vi.useFakeTimers();
    const stop = new AbortController();
    const request = vi.fn<typeof fetch>(async () => new Response("rate", { status: 429 }));
    const call = createDeepSeekServices({ apiKey: key, fetch: request }).search.search("q", { limit: 1, signal: stop.signal });
    const rejected = expect(call).rejects.toThrow("Stopped");
    await vi.advanceTimersByTimeAsync(10);stop.abort(new Error("Stopped"));await rejected;
    await vi.advanceTimersByTimeAsync(60000);expect(request).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
    const ignored = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const timeout = createDeepSeekServices({ apiKey: key, fetch: ignored, timeoutMs: 30 }).search.search("q", { limit: 1 });
    const timed = expect(timeout).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(30);await timed;expect(vi.getTimerCount()).toBe(0);
    await expect(createDeepSeekServices({ apiKey: key, fetch: ignored }).search.search("q", { limit: 1, signal: stop.signal })).rejects.toThrow("Stopped");
    expect(ignored).toHaveBeenCalledTimes(1);
  });
});

describe("DeepSeek single configuration, labels and spending", () => {
  it("preserves tool names and emits rich sources; bills only positive results, including filtered raw results", async () => {
    const storage = createInMemoryChatStorage();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply([])).mockResolvedValueOnce(Response.json({ title: "Page", content: "text" })).mockResolvedValueOnce(Response.json({ title: "Page", content: "" })).mockResolvedValueOnce(reply([{ ...hit, url: "javascript:bad" }]));
    const tools = createDeepSeekWebTools({ apiKey: key, fetch: request, spending: { storage } })(turn);
    expect(Object.keys(tools)).toEqual(["web_search", "read_page"]);
    const run = (name: string,input:unknown) => tools[name]!.execute!(input as never, executeOptions());
    expect(await run("web_search",{query:"q"})).toContain("Long summary");
    expect(await run("web_search",{query:"q"})).toContain("Ничего не найдено");
    await run("read_page",{url:hit.url});await run("read_page",{url:hit.url});await run("web_search",{query:"q"});
    const sums=await storage.sumUsage({ownerId:"a",chatId:"c",source:"web_tools"});
    expect(sums.reduce((a,x)=>a+x.costUsd,0)).toBeCloseTo(3*0.00075);
    expect(sums.every(x=>x.providerId==="deepseek")).toBe(true);
  });
  it("records no failures/timeouts or empty results, one fee after a 429 retry; disk failure doesn't retry a paid API call", async () => {
    const insert = vi.fn(async () => {});
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("rate",{status:429})).mockResolvedValueOnce(reply()).mockResolvedValueOnce(new Response("fail",{status:401})).mockResolvedValueOnce(reply([]));
    const tools = createDeepSeekWebTools({apiKey:key,fetch:request,retryDelayMs:0,spending:{storage:{insertUsageRecord:insert}}})(turn);
    await tools.web_search!.execute!({query:"q"},executeOptions());
    await expect(tools.web_search!.execute!({query:"q"},executeOptions())).rejects.toMatchObject({kind:"invalid_key"});
    await tools.web_search!.execute!({query:"q"},executeOptions());expect(insert).toHaveBeenCalledTimes(1);
    const log=vi.fn();insert.mockRejectedValue(new Error("disk"));request.mockResolvedValue(reply());
    const broken=createDeepSeekWebTools({apiKey:key,fetch:request,spending:{storage:{insertUsageRecord:insert},logError:log}})(turn);
    await expect(broken.web_search!.execute!({query:"q"},executeOptions())).resolves.toContain("Title");
    expect(request).toHaveBeenCalledTimes(5);expect(log).toHaveBeenCalledOnce();
  });
  it("captures ownership before async responses; accepts a zero price override", async () => {
    const insert = vi.fn(async () => {}); const request = vi.fn<typeof fetch>(async () => reply());
    const model={...turn}; const tools=createDeepSeekWebTools({apiKey:key,fetch:request,spending:{storage:{insertUsageRecord:insert},pricePerCallUsd:{web_search:0,read_page:0}}})(model);
    model.ownerId="other";model.chatId="other";
    await tools.web_search!.execute!({query:"q"},executeOptions());
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ownerId:"a",chatId:"c",costUsd:0,providerId:"deepseek",source:"web_tools"}));
  });
  it("keeps an HTTP-date backoff inside the total deadline, without any usage record", async () => {
    vi.useFakeTimers();vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const insert=vi.fn(async()=>{});
    const request=vi.fn<typeof fetch>(async()=>new Response("retry",{status:408,headers:{"Retry-After":"Tue, 01 Jan 2030 00:02:00 GMT"}}));
    const tools=createDeepSeekWebTools({apiKey:key,fetch:request,timeoutMs:25,spending:{storage:{insertUsageRecord:insert}}})(turn);
    const call=tools.web_search!.execute!({query:"q"},executeOptions());
    const failed=expect(call).rejects.toMatchObject({kind:"timeout"});
    await vi.advanceTimersByTimeAsync(25);await failed;
    expect(request).toHaveBeenCalledTimes(1);expect(insert).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it("times out a body ignoring cancellation, without accounting or repeating it", async () => {
    vi.useFakeTimers();const insert=vi.fn(async()=>{});
    const request=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(){}})));
    const tools=createDeepSeekWebTools({apiKey:key,fetch:request,timeoutMs:20,spending:{storage:{insertUsageRecord:insert}}})(turn);
    const failed=expect(tools.read_page!.execute!({url:hit.url},executeOptions())).rejects.toMatchObject({kind:"timeout"});
    await vi.advanceTimersByTimeAsync(20);await failed;
    expect(request).toHaveBeenCalledTimes(1);expect(insert).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it("accounts HTTP200 nonempty payload before schema validation, without retrying it", async () => {
    const insert=vi.fn(async()=>{});const request=vi.fn<typeof fetch>(async()=>Response.json({results:[{url:hit.url}]}));
    const tools=createDeepSeekWebTools({apiKey:key,fetch:request,spending:{storage:{insertUsageRecord:insert}}})(turn);
    await expect(tools.web_search!.execute!({query:"q"},executeOptions())).rejects.toMatchObject({kind:"bad_response"});
    expect(insert).toHaveBeenCalledOnce();expect(request).toHaveBeenCalledOnce();
  });
  it("does not shorten a long Retry-After to the exponential-backoff cap", async () => {
    vi.useFakeTimers();const request=vi.fn<typeof fetch>(async()=>new Response("rate",{status:429,headers:{"Retry-After":"120"}}));
    const call=createDeepSeekServices({apiKey:key,fetch:request,timeoutMs:45000}).reader.readPage(hit.url,{});
    const failed=expect(call).rejects.toMatchObject({kind:"timeout"});
    await vi.advanceTimersByTimeAsync(30000);expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);await failed;expect(request).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects invalid configuration before network", () => {
    for(const bad of [{maxRetries:-1},{maxRetries:11},{retryDelayMs:Infinity},{timeoutMs:0},{searchResultLimit:51},{baseUrl:"https://u:p@proxy.example"},{apiKey:""}]) expect(()=>createDeepSeekWebTools({apiKey:key,...bad})).toThrow();
  });
});
