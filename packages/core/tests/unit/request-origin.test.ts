import { describe, expect, it, vi } from "vitest";
import { createRequestOriginCheck, originRefusalHint } from "../../src/request-origin/request-origin";

/** Запрос страницы `origin` к API на `host`, как его шлёт браузер. */
function fromPage(origin: string, site: string | null = "same-site", host = "api.example.com") {
  return new Request(`https://${host}/api/chat`, {
    method: "POST",
    headers: { origin, host, ...(site !== null && { "sec-fetch-site": site }) },
  });
}

describe("allowedOrigins: шаблон поддоменов https://*.example.com", () => {
  const check = createRequestOriginCheck({ allowedOrigins: ["https://*.example.com"] });

  it("поддомены любой глубины проходят", () => {
    expect(check(fromPage("https://app.example.com"))).toBe(true);
    expect(check(fromPage("https://a.b.example.com", "cross-site"))).toBe(true);
    expect(check(fromPage("https://APP.Example.com"))).toBe(true);
  });

  it("похожие чужие адреса, сам домен, другая схема и другой порт — отказ", () => {
    for (const origin of ["https://evil-example.com", "https://example.com", "https://app.example.com.evil.io", "http://app.example.com", "https://app.example.com:8443", "null"]) {
      expect(check(fromPage(origin, "cross-site")), origin).toBe(false);
    }
  });

  it("шаблон с портом совпадает только с этим портом", () => {
    const withPort = createRequestOriginCheck({ allowedOrigins: ["http://*.localhost:5173"] });
    expect(withPort(fromPage("http://app.localhost:5173"))).toBe(true);
    expect(withPort(fromPage("http://app.localhost:5174"))).toBe(false);
    expect(withPort(fromPage("http://app.localhost"))).toBe(false);
  });

  it("слишком широкий или кривой шаблон — ошибка при создании", () => {
    for (const wrong of ["https://*.com", "https://*", "*.example.com", "https://app.*.example.com", "https://*example.com", "https://**.example.com", "https://*.example.com/page", "https://*.com.", "https://*.example.com."]) {
      expect(() => createRequestOriginCheck({ allowedOrigins: [wrong] }), wrong).toThrow(/allowedOrigins/);
    }
  });

  it("сообщение об ошибке предупреждает: общие суффиксы вроде *.co.uk проверка не ловит", () => {
    expect(() => createRequestOriginCheck({ allowedOrigins: ["https://*.com"] })).toThrow(/co\.uk/);
  });
});

describe("причина отказа", () => {
  it("чужая страница по Sec-Fetch-Site — cross_site", () => {
    const onRefused = vi.fn();
    createRequestOriginCheck({ onRefused })(fromPage("https://evil.example", "cross-site"));
    expect(onRefused).toHaveBeenCalledWith({ origin: "https://evil.example", reason: "cross_site" });
  });

  it("без Sec-Fetch-Site Origin не совпал с Host (прокси подменил Host) — host_mismatch с тем, что видел сервер", () => {
    const onRefused = vi.fn();
    createRequestOriginCheck({ onRefused })(fromPage("https://app.example.com", null, "127.0.0.1:3000"));
    expect(onRefused).toHaveBeenCalledWith({ origin: "https://app.example.com", reason: "host_mismatch", hosts: ["127.0.0.1:3000"] });
  });

  it("подсказка для журнала: при host_mismatch — про Host/X-Forwarded-Host за прокси, иначе — про allowedOrigins", () => {
    const mismatch = originRefusalHint({ origin: "https://app.example.com", reason: "host_mismatch", hosts: ["127.0.0.1:3000"] });
    expect(mismatch).toMatch(/Origin не совпал с Host/);
    expect(mismatch).toMatch(/127\.0\.0\.1:3000/);
    expect(mismatch).toMatch(/за прокси передайте Host\/X-Forwarded-Host/);
    expect(mismatch).toMatch(/proxy_set_header Host \$host/);
    expect(originRefusalHint({ origin: "https://evil.example", reason: "cross_site" })).toMatch(/https:\/\/evil\.example.*allowedOrigins/s);
  });
});
