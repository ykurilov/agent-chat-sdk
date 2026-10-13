import { describe, expect, it } from "vitest";
import { WebToolError } from "../src/web-tool-error";
import { assertPublicWebAddress } from "../src/page-address";

describe("assertPublicWebAddress", () => {
  it.each(["https://example.com", "http://example.com/a/b?c=1#d", "https://sub.example.co.uk:8443/x", "http://172.32.0.1", "http://8.8.8.8", "http://100.63.255.255", "http://198.20.0.1", "http://[2606:4700::1111]/", "http://[::ffff:808:808]/"])(
    "пропускает публичный адрес %s",
    (address) => {
      expect(assertPublicWebAddress(address).href).toBe(new URL(address).href);
    },
  );

  it.each([
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "не адрес",
    "example.com",
    "",
  ])("отклоняет %s как неверный адрес", (address) => {
    expect(() => assertPublicWebAddress(address)).toThrowError(WebToolError);
    try {
      assertPublicWebAddress(address);
    } catch (error) {
      expect((error as WebToolError).kind).toBe("bad_address");
    }
  });

  it.each([
    "http://localhost",
    "http://localhost:3000/admin",
    "http://127.0.0.1",
    "http://127.1.2.3:8080",
    "http://10.0.0.5",
    "http://172.16.0.1",
    "http://172.31.255.255",
    "http://192.168.1.1",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://printer.local",
    "http://db.internal/",
    "http://intranet",
    // IPv4 внутри IPv6
    "http://[::7f00:1]/",
    "http://[::a00:1]/",
    "http://[::ffff:7f00:1]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[::ffff:c0a8:1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b::a00:1]/",
    "http://[64:ff9b:1::1]/",
    "http://[2002:7f00:1::1]/",
    "http://[2002:c0a8:101::1]/",
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    "http://[2001:db8::1]/",
    // особые диапазоны IPv4
    "http://100.64.0.1",
    "http://100.127.255.254",
    "http://192.0.0.1",
    "http://192.0.2.10",
    "http://198.18.0.1",
    "http://198.19.255.1",
    "http://198.51.100.7",
    "http://203.0.113.9",
    "http://224.0.0.1",
    "http://255.255.255.255",
    "http://0.1.2.3",
    // запись адреса числом или шестнадцатеричной
    "http://2130706433/",
    "http://0x7f000001/",
  ])("отклоняет локальный или частный адрес %s", (address) => {
    expect(() => assertPublicWebAddress(address)).toThrowError(/локальн|частн|внутренн/i);
  });

  it("отклоняет адрес с логином и паролем: они утекли бы в сервис", () => {
    expect(() => assertPublicWebAddress("https://user:pass@example.com")).toThrowError(WebToolError);
  });

  it("в тексте ошибки нет пароля из адреса", () => {
    try {
      assertPublicWebAddress("https://user:secret-pass@example.com");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-pass");
    }
  });
});
