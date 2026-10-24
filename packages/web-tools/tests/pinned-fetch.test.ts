import dns from "node:dns";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createWebTools } from "../src/create-web-tools";
import { createPinnedFetch } from "../src/pinned-fetch";
import type { PageReaderService, PageScreenshotService, WebSearchService } from "../src/services";
import { WebToolError } from "../src/web-tool-error";
import { sampleHits, samplePage } from "./support";

/*
 * Подмена DNS (DNS rebinding) без внешней сети. Проверка имени видит публичный адрес, а системный DNS при соединении
 * отвечает внутренним — `rebind.test` → 127.0.0.1, где стоит «внутренний» сервер. Перехват `net.connect` записывает,
 * на какой адрес соединение пошло на самом деле, и любой не-локальный адрес переводит на 127.0.0.1: наружу ни одного
 * соединения, даже к публичному адресу из ответа.
 */
const PUBLIC = "93.184.216.34";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let port = 0;
const hits: string[] = [];
let redirectTo = "";
const server = createServer((request, response) => {
  hits.push(request.headers.host ?? "");
  if (request.url === "/redirect") {
    response.writeHead(302, { location: redirectTo });
    return response.end();
  }
  response.writeHead(200, { "content-type": "image/png" });
  response.end(png);
});

const systemLookups: string[] = [];
const connectedTo: string[] = [];
const originalLookup = dns.lookup;
const originalConnect = net.connect;

type Lookup = (hostname: string, options: object, callback: (error: Error | null, address: unknown, family?: number) => void) => void;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  // Один и тот же объект модуля у теста, у undici и у встроенного fetch: подмена видна всем.
  expect(createRequire(import.meta.url)("node:net")).toBe(net);
  (dns as { lookup: unknown }).lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    systemLookups.push(hostname);
    const done = (typeof options === "function" ? options : callback) as (error: Error | null, address: unknown, family?: number) => void;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (all) done(null, [{ address: "127.0.0.1", family: 4 }]);
    else done(null, "127.0.0.1", 4);
  }) as never;
  (net as { connect: unknown }).connect = ((options: Record<string, unknown>, ...rest: unknown[]) => {
    const lookup = (options.lookup as Lookup | undefined) ?? (dns.lookup as unknown as Lookup);
    const routed: Lookup = (hostname, lookupOptions, callback) =>
      lookup(hostname, lookupOptions, (error, address, family) => {
        if (error) return callback(error, address, family);
        const list = Array.isArray(address) ? (address as Array<{ address: string; family: number }>) : [{ address: address as string, family: family ?? 4 }];
        connectedTo.push(...list.map((item) => item.address));
        const local = list.map((item) => ({ address: item.address.startsWith("127.") ? item.address : "127.0.0.1", family: 4 }));
        if (Array.isArray(address)) callback(null, local);
        else callback(null, local[0]!.address, 4);
      });
    return (originalConnect as (...args: unknown[]) => net.Socket)({ ...options, lookup: routed }, ...rest);
  }) as never;
});

afterAll(async () => {
  (dns as { lookup: unknown }).lookup = originalLookup;
  (net as { connect: unknown }).connect = originalConnect;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  hits.length = 0;
  systemLookups.length = 0;
  connectedTo.length = 0;
});

const seesImages = { profile: { acceptsImages: true, toolResultImageProviders: ["openai"] }, providerId: "openai" };

function webTools(resolveHost: (hostname: string) => Promise<string[]>) {
  const search: WebSearchService = { search: async () => sampleHits };
  const reader: PageReaderService = { readPage: async () => samplePage };
  const screenshots: PageScreenshotService = { takeScreenshot: async () => ({ imageUrl: "unused" }) };
  return createWebTools({ search, reader, screenshots, resolveHost })(seesImages);
}

async function screenshotFor(resolveHost: (hostname: string) => Promise<string[]>) {
  const tool = webTools(resolveHost).page_screenshot!;
  const output = { pageUrl: "https://example.com", screenshotUrl: `http://rebind.test:${port}/shot.png` };
  return (await tool.toModelOutput!({ toolCallId: "call-1", input: { url: "https://example.com" }, output })) as { type: string; value: unknown };
}

describe("снимок без своего fetch приложения: имя проверяется в момент соединения (DNS rebinding)", () => {
  it("соединение идёт на тот адрес, что прошёл проверку; системный DNS второй раз не спрашивается", async () => {
    const converted = await screenshotFor(async () => [PUBLIC]);
    expect(systemLookups).toEqual([]);
    expect(connectedTo).toEqual([PUBLIC]);
    expect(converted.type).toBe("content");
  });

  it("имя при соединении указало во внутреннюю сеть — снимок не качается, внутренний сервер не тронут", async () => {
    const converted = await screenshotFor(async () => ["127.0.0.1"]);
    expect(hits).toEqual([]);
    expect(connectedTo).toEqual([]);
    expect(converted.type).toBe("text");
  });
});

describe("createPinnedFetch", () => {
  it("частный ответ DNS при соединении — отказ `bad_address`, соединения нет", async () => {
    const pinned = createPinnedFetch({ resolveHost: async () => ["10.0.0.5", PUBLIC], allowPrivateNetwork: false });
    try {
      const failure = await pinned.fetch(`http://rebind.test:${port}/x`).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(WebToolError);
      expect((failure as WebToolError).kind).toBe("bad_address");
      expect(hits).toEqual([]);
      expect(connectedTo).toEqual([]);
    } finally {
      await pinned.close();
    }
  });

  it("с разрешением частной сети ходит на проверенный адрес, мимо системного DNS; после close — отказ", async () => {
    const pinned = createPinnedFetch({ resolveHost: async () => ["127.0.0.1"], allowPrivateNetwork: true });
    const response = await pinned.fetch(`http://rebind.test:${port}/x`);
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    expect(hits).toEqual([`rebind.test:${port}`]);
    expect(systemLookups).toEqual([]);
    await pinned.close();
    await expect(pinned.fetch(`http://rebind.test:${port}/x`)).rejects.toThrowError(TypeError);
  });

  it("адрес-число во внутреннюю сеть (без DNS) — отказ `bad_address`, соединения нет", async () => {
    const pinned = createPinnedFetch({ resolveHost: async () => [PUBLIC], allowPrivateNetwork: false });
    try {
      for (const address of [`http://127.0.0.1:${port}/x`, `http://[::1]:${port}/x`, `http://[::ffff:127.0.0.1]:${port}/x`]) {
        const failure = await pinned.fetch(address).catch((error: unknown) => error);
        expect(failure, address).toBeInstanceOf(WebToolError);
        expect((failure as WebToolError).kind).toBe("bad_address");
      }
      expect(hits).toEqual([]);
    } finally {
      await pinned.close();
    }
  });

  it("переадресация (обычный follow) на адрес-число во внутреннюю сеть — отказ `bad_address`, второго соединения нет", async () => {
    const pinned = createPinnedFetch({ resolveHost: async () => [PUBLIC], allowPrivateNetwork: false });
    redirectTo = `http://127.0.0.1:${port}/inside`;
    try {
      const failure = await pinned.fetch(`http://rebind.test:${port}/redirect`).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(WebToolError);
      expect((failure as WebToolError).kind).toBe("bad_address");
      expect(hits).toEqual([`rebind.test:${port}`]);
    } finally {
      await pinned.close();
    }
  });

  it("с разрешением частной сети адрес-число открывается (встроенный транспорт MCP с allowPrivateNetwork)", async () => {
    const pinned = createPinnedFetch({ resolveHost: async () => [PUBLIC], allowPrivateNetwork: true });
    try {
      const response = await pinned.fetch(`http://127.0.0.1:${port}/x`);
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      expect(hits).toEqual([`127.0.0.1:${port}`]);
    } finally {
      await pinned.close();
    }
  });

  it("close до первого запроса ничего не грузит и не падает", async () => {
    const pinned = createPinnedFetch({ resolveHost: async () => [PUBLIC], allowPrivateNetwork: false });
    await expect(pinned.close()).resolves.toBeUndefined();
  });
});
