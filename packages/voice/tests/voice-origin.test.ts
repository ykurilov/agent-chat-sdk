import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createVoiceHandler, createVoiceRelay } from "../src/server";
import type { VoiceHandlerOptions, VoiceRelayOptions } from "../src/server";

const crossSite = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };

function handlerWith(options: Partial<VoiceHandlerOptions> = {}) {
  const fetchStub = vi.fn(async () => Response.json({ api_key: "temp:KEY", expires_at: "2026-09-30T02:32:16.399Z" }, { status: 201 }));
  const resolveUser = vi.fn(async () => ({ id: "anna" }));
  const logError = vi.fn();
  const handler = createVoiceHandler({
    basePath: "/api/voice",
    resolveUser,
    apiKey: "main-secret-key",
    fetch: fetchStub as unknown as typeof fetch,
    logError,
    ...options,
  });
  return { handler, fetchStub, resolveUser, logError };
}

function relayWith(options: Partial<VoiceRelayOptions> = {}) {
  const resolveUser = vi.fn(async () => ({ id: "anna" }));
  const logError = vi.fn();
  const relay = createVoiceRelay({ resolveUser, apiKey: "main-secret-key", logError, ...options });
  return { relay, resolveUser, logError };
}

const session = (headers: Record<string, string> = {}) => new Request("http://app.test/api/voice/session", { method: "POST", headers });
/** Адрес подъёма WebSocket в Node приходит без порта (`@hono/node-ws`), порт есть только в заголовке Host. */
const upgrade = (headers: Record<string, string> = {}) => new Request("http://localhost/api/voice/stream", { headers });

describe("голос: страницы с чужих сайтов", () => {
  it("временный ключ Soniox чужой странице не выдаётся: 403, Soniox не звали", async () => {
    const { handler, fetchStub, resolveUser } = handlerWith();
    const response = await handler.fetch(session(crossSite));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { kind: "forbidden_origin" } });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchStub).not.toHaveBeenCalled();
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it("своя страница и запрос не из браузера получают ключ", async () => {
    const { handler } = handlerWith();
    expect((await handler.fetch(session({ origin: "http://app.test", "sec-fetch-site": "same-origin" }))).status).toBe(200);
    expect((await handler.fetch(session())).status).toBe(200);
  });

  it("страница из allowedOrigins получает ключ", async () => {
    const { handler } = handlerWith({ allowedOrigins: ["https://school.getcourse.ru"] });
    const response = await handler.fetch(session({ origin: "https://school.getcourse.ru", "sec-fetch-site": "cross-site" }));
    expect(response.status).toBe(200);
  });

  it("WebSocket с чужой страницы не допускается, хотя это GET", async () => {
    const { relay, resolveUser } = relayWith();
    const decision = await relay.authorize(upgrade({ ...crossSite, host: "localhost:5173" }));
    expect("refusal" in decision && decision.refusal.status).toBe(403);
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it("WebSocket своей страницы: старый браузер без Sec-Fetch-Site, Origin совпадает с Host (порт только в Host)", async () => {
    const { relay } = relayWith();
    expect(await relay.authorize(upgrade({ origin: "http://localhost:5173", host: "localhost:5173" }))).toEqual({ user: { id: "anna" }, chatId: "voice" });
    expect(await relay.authorize(upgrade({ origin: "http://localhost:5173", "sec-fetch-site": "same-origin" }))).toEqual({ user: { id: "anna" }, chatId: "voice" });
  });

  it("неверная запись в allowedOrigins — ошибка при создании", () => {
    expect(() => handlerWith({ allowedOrigins: ["getcourse.ru"] })).toThrow(/allowedOrigins/);
    expect(() => relayWith({ allowedOrigins: ["https://getcourse.ru/page"] })).toThrow(/allowedOrigins/);
  });

  it("отказ пишется в журнал один раз на адрес, с подсказкой про allowedOrigins", async () => {
    const { handler, logError } = handlerWith();
    await handler.fetch(session(crossSite));
    await handler.fetch(session(crossSite));
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]![0]).toMatch(/evil\.example.*allowedOrigins/s);
  });

  it("за прокси без Host старый браузер получает 403, а журнал подсказывает про Host/X-Forwarded-Host", async () => {
    const { relay, logError } = relayWith();
    await relay.authorize(upgrade({ origin: "https://app.example", host: "127.0.0.1:3000" }));
    expect(logError.mock.calls[0]![0]).toMatch(/^Голос: .*Origin не совпал с Host.*X-Forwarded-Host/s);
  });

  it("шаблон поддоменов в allowedOrigins: свой поддомен получает ключ, похожий чужой — нет", async () => {
    const { handler } = handlerWith({ allowedOrigins: ["https://*.example.com"] });
    expect((await handler.fetch(session({ origin: "https://app.example.com", "sec-fetch-site": "same-site" }))).status).toBe(200);
    expect((await handler.fetch(session({ origin: "https://evil-example.com", "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
});

describe("копия проверки страницы в голосовом пакете", () => {
  it("совпадает с проверкой в core, кроме первой строки-пометки", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const core = read("../../core/src/request-origin/request-origin.ts");
    const copy = read("../src/server/request-origin.ts");
    expect(copy.split("\n").slice(1).join("\n")).toBe(core);
  });
});
