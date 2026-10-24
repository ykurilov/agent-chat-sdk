import dns from "node:dns";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { downloadGeneratedImage } from "../src/download-image";
import { ImageGenerationError } from "../src/image-generation-error";

/*
 * Склад картинок без своего fetch приложения, без внешней сети. Системный DNS подменён: любое имя → 127.0.0.1, где
 * стоит «внутренний» сервер, — так ответил бы подменённый DNS. Закреплённый `fetch` спрашивает имя у `resolveHost`
 * в момент соединения и во внутреннюю сеть не идёт; сервер считает каждое соединение.
 */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let port = 0;
let connections = 0;
let redirectTo = "";
const server = createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { location: redirectTo });
    return response.end();
  }
  response.writeHead(200, { "content-type": "image/png" });
  response.end(png);
});
server.on("connection", () => {
  connections += 1;
});

const originalLookup = dns.lookup;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  (dns as { lookup: unknown }).lookup = ((_hostname: string, options: unknown, callback?: unknown) => {
    const done = (typeof options === "function" ? options : callback) as (error: Error | null, address: unknown, family?: number) => void;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
    if (all) done(null, [{ address: "127.0.0.1", family: 4 }]);
    else done(null, "127.0.0.1", 4);
  }) as never;
});

afterAll(async () => {
  (dns as { lookup: unknown }).lookup = originalLookup;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  connections = 0;
  server.closeAllConnections();
});

const internalAnswer = async () => ["127.0.0.1"];
const failureOf = (promise: Promise<unknown>) => promise.then(() => expect.unreachable("скачалось"), (error: unknown) => error as ImageGenerationError);

describe("скачивание картинки без своего fetch приложения", () => {
  it("имя склада при соединении указало во внутреннюю сеть — «неверный адрес», соединения нет", async () => {
    const error = await failureOf(downloadGeneratedImage({ url: `https://store.rebind.test:${port}/a.png`, maxImageBytes: 1024, resolveHost: internalAnswer }));
    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error.reason).toBe("Картинка не скачалась: неверный адрес");
    expect(connections).toBe(0);
  });

  it("сайт подключения из настройки качается обычным fetch, в том числе с localhost", async () => {
    const trustedOrigin = `http://127.0.0.1:${port}`;
    const file = await downloadGeneratedImage({ url: `${trustedOrigin}/a.png`, trustedOrigin, maxImageBytes: 1024, resolveHost: internalAnswer });
    expect(Array.from(file.bytes)).toEqual(Array.from(png));
  });

  it("переадресация с доверенного сайта на другой не наследует доверия: снова проверка при соединении", async () => {
    const trustedOrigin = `http://127.0.0.1:${port}`;
    redirectTo = `https://store.rebind.test:${port}/b.png`;
    const error = await failureOf(downloadGeneratedImage({ url: `${trustedOrigin}/redirect`, trustedOrigin, maxImageBytes: 1024, resolveHost: internalAnswer }));
    expect(error.reason).toBe("Картинка не скачалась: неверный адрес");
    expect(connections).toBe(1);
  });
});
