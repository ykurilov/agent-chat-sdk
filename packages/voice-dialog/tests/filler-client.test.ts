import { describe, expect, it } from "vitest";
import { createFillerClient } from "../src/browser/filler-client";
import type { FillerManifest } from "../src/protocol";

const MANIFEST: FillerManifest = {
  phrases: [
    { id: "thinking-0", category: "thinking", text: "Хмм…" },
    { id: "thinking-1", category: "thinking", text: "Так…" },
    { id: "web-0", category: "web", text: "Сейчас поищу в интернете." },
    { id: "web-1", category: "web", text: "Гляну, что пишут." },
  ],
};

/** 1 секунда звука: 24 000 отсчётов по 2 байта. */
const ONE_SECOND = new Uint8Array(48_000).fill(3);

interface Deferred {
  url: string;
  respond(response: Response): void;
}

/** Подмена сети: ответы выдаёт тест, когда захочет. */
function manualFetch() {
  const pending: Deferred[] = [];
  const urls: string[] = [];
  const fetchImpl = ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return new Promise<Response>((resolve) => pending.push({ url, respond: resolve }));
  }) as typeof fetch;
  const flush = async () => {
    for (let step = 0; step < 30; step += 1) await Promise.resolve();
  };
  return { fetchImpl, pending, urls, flush };
}

/** Подмена сети: сервер отвечает сразу по таблице адресов. */
function routedFetch(routes: Record<string, () => Response>) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const route = routes[url.split("?")[0]!];
    if (!route) return new Response("нет", { status: 404 });
    return route();
  }) as typeof fetch;
  return { fetchImpl, urls };
}

const audioRoutes = (ids: string[]) => Object.fromEntries(ids.map((id) => [`/api/voice-dialog/fillers/${id}`, () => new Response(ONE_SECOND)]));

describe("клиент заполнителей", () => {
  it("тянет список фраз и звук голоса; длительность считает по длине звука", async () => {
    const { fetchImpl, urls } = routedFetch({
      "/api/voice-dialog/fillers": () => Response.json(MANIFEST),
      ...audioRoutes(MANIFEST.phrases.map((phrase) => phrase.id)),
    });
    const client = createFillerClient({ basePath: "/api/voice-dialog/", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");

    expect(client.phrases("voice-1", "thinking").map((phrase) => phrase.id)).toEqual(["thinking-0", "thinking-1"]);
    expect(client.phrases("voice-1", "web")[0]).toMatchObject({ id: "web-0", category: "web", text: "Сейчас поищу в интернете.", durationMs: 1000 });
    expect(urls).toContain("/api/voice-dialog/fillers/web-0?voiceId=voice-1&chatId=chat-1");
    expect(client.phrases("voice-1", "long")).toEqual([]);
  });

  it("голоса не смешиваются: звук другого голоса не отдаётся", async () => {
    const { fetchImpl } = routedFetch({ "/api/voice-dialog/fillers": () => Response.json(MANIFEST), ...audioRoutes(["thinking-0"]) });
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");

    expect(client.phrases("voice-1", "thinking")).toHaveLength(1);
    expect(client.phrases("voice-2", "thinking")).toEqual([]);
  });

  it("список фраз спрашивается один раз, а уже загруженный звук — тоже", async () => {
    const { fetchImpl, urls } = routedFetch({ "/api/voice-dialog/fillers": () => Response.json(MANIFEST), ...audioRoutes(MANIFEST.phrases.map((phrase) => phrase.id)) });
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");
    const first = urls.length;
    await client.load("voice-1", "chat-1");

    expect(first).toBe(1 + MANIFEST.phrases.length);
    expect(urls).toHaveLength(first);
  });

  it("недостающее догружается при следующем вызове: сбой одной фразы не мешает остальным", async () => {
    let webFails = true;
    const { fetchImpl } = routedFetch({
      "/api/voice-dialog/fillers": () => Response.json(MANIFEST),
      ...audioRoutes(["thinking-0", "thinking-1", "web-1"]),
      "/api/voice-dialog/fillers/web-0": () => (webFails ? new Response("занято", { status: 503 }) : new Response(ONE_SECOND)),
    });
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");
    expect(client.phrases("voice-1", "web").map((phrase) => phrase.id)).toEqual(["web-1"]);

    webFails = false;
    await client.load("voice-1", "chat-1");
    expect(client.phrases("voice-1", "web").map((phrase) => phrase.id).sort()).toEqual(["web-0", "web-1"]);
  });

  it("лимит расходов (402) и обрыв сети не бросают ошибку наружу", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/voice-dialog/fillers") return Response.json(MANIFEST);
      if (url.includes("thinking-0")) return new Response("{}", { status: 402 });
      throw new TypeError("network");
    }) as typeof fetch;
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await expect(client.load("voice-1", "chat-1")).resolves.toBeUndefined();

    expect(client.phrases("voice-1", "thinking")).toEqual([]);
  });

  it("пустой или нечётный по длине звук не берётся в расчёт; пустой — пропускается", async () => {
    const { fetchImpl } = routedFetch({
      "/api/voice-dialog/fillers": () => Response.json(MANIFEST),
      "/api/voice-dialog/fillers/thinking-0": () => new Response(new Uint8Array(0)),
      "/api/voice-dialog/fillers/thinking-1": () => new Response(new Uint8Array(24_001)),
    });
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");

    expect(client.phrases("voice-1", "thinking").map((phrase) => phrase.id)).toEqual(["thinking-1"]);
    expect(client.phrases("voice-1", "thinking")[0]!.durationMs).toBe(500);
  });

  it("сервер без заполнителей (404 на списке): больше не спрашивает", async () => {
    const { fetchImpl, urls } = routedFetch({});
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");
    await client.load("voice-2", "chat-1");

    expect(urls).toEqual(["/api/voice-dialog/fillers"]);
    expect(client.phrases("voice-1", "thinking")).toEqual([]);
  });

  it("сбой списка (не 404) — следующий вызов пробует снова", async () => {
    let broken = true;
    const { fetchImpl, urls } = routedFetch({
      "/api/voice-dialog/fillers": () => (broken ? new Response("сбой", { status: 500 }) : Response.json(MANIFEST)),
      ...audioRoutes(MANIFEST.phrases.map((phrase) => phrase.id)),
    });
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await client.load("voice-1", "chat-1");
    expect(urls).toHaveLength(1);
    broken = false;
    await client.load("voice-1", "chat-1");

    expect(client.phrases("voice-1", "web")).toHaveLength(2);
  });

  it("два вызова подряд не качают одно и то же дважды", async () => {
    const net = manualFetch();
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: net.fetchImpl });

    const first = client.load("voice-1", "chat-1");
    const second = client.load("voice-1", "chat-1");
    await net.flush();
    expect(net.urls).toEqual(["/api/voice-dialog/fillers"]);
    net.pending[0]!.respond(Response.json(MANIFEST));
    for (let round = 0; round < 6; round += 1) {
      await net.flush();
      for (const request of net.pending.slice(1)) request.respond(new Response(ONE_SECOND));
    }
    await Promise.all([first, second]);

    const audioUrls = net.urls.filter((url) => url.includes("voiceId"));
    expect(new Set(audioUrls).size).toBe(audioUrls.length);
    expect(client.phrases("voice-1", "web")).toHaveLength(2);
  });

  it("качает не больше трёх фраз разом, сначала по одной из каждого вида", async () => {
    const net = manualFetch();
    const client = createFillerClient({ basePath: "/api/voice-dialog", fetch: net.fetchImpl });

    const loading = client.load("voice-1", "chat-1");
    await net.flush();
    net.pending[0]!.respond(Response.json(MANIFEST));
    await net.flush();

    const audioRequests = () => net.pending.filter((request) => request.url.includes("voiceId"));
    expect(audioRequests()).toHaveLength(3);
    expect(audioRequests().map((request) => request.url.split("?")[0]!.split("/").pop())).toEqual(["thinking-0", "web-0", "thinking-1"]);

    for (const request of [...net.pending]) request.respond(new Response(ONE_SECOND));
    for (let round = 0; round < 5; round += 1) {
      await net.flush();
      for (const request of net.pending) request.respond(new Response(ONE_SECOND));
    }
    await loading;
    expect(client.phrases("voice-1", "web")).toHaveLength(2);
  });
});
