import { describe, expect, it, vi } from "vitest";
import { assertResolvesPublic, isPrivateAddress, isHttpAddress } from "../src/page-address";
import { WebToolError } from "../src/web-tool-error";

describe("isPrivateAddress (адреса, которые вернул DNS)", () => {
  it.each(["127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1"])(
    "%s — частный",
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );

  it.each(["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:808:808"])("%s — публичный", (address) =>
    expect(isPrivateAddress(address)).toBe(false),
  );

  it("не адрес считается частным: лучше отказать, чем пустить", () => {
    expect(isPrivateAddress("не адрес")).toBe(true);
  });
});

describe("assertResolvesPublic", () => {
  it("публичное имя проходит", async () => {
    await expect(assertResolvesPublic(new URL("https://example.com"), async () => ["93.184.216.34", "2606:2800:220:1::1"])).resolves.toBeUndefined();
  });

  it("если хоть один адрес частный, имя отклоняется", async () => {
    const failure = assertResolvesPublic(new URL("https://evil.example"), async () => ["93.184.216.34", "10.0.0.5"]);
    await expect(failure).rejects.toThrowError(WebToolError);
    await expect(failure).rejects.toThrowError(/локальн|частн|внутренн/i);
  });

  it("имя, которое указывает на 127.0.0.1, отклоняется", async () => {
    await expect(assertResolvesPublic(new URL("https://localtest.example"), async () => ["127.0.0.1"])).rejects.toThrowError(WebToolError);
  });

  it("имя не нашлось или DNS отказал — отклоняется, подробности ошибки DNS не пробрасываются", async () => {
    const failure = assertResolvesPublic(new URL("https://nowhere.example"), async () => {
      throw new Error("getaddrinfo ENOTFOUND secret-resolver.internal");
    });
    await expect(failure).rejects.toThrowError(WebToolError);
    await expect(failure).rejects.not.toThrowError(/secret-resolver/);
    await expect(assertResolvesPublic(new URL("https://empty.example"), async () => [])).rejects.toThrowError(WebToolError);
  });

  it("адрес-число не разрешается по DNS: он уже проверен как адрес", async () => {
    const resolve = vi.fn(async () => ["10.0.0.1"]);
    await assertResolvesPublic(new URL("http://8.8.8.8/"), resolve);
    await assertResolvesPublic(new URL("http://[2606:4700::1111]/"), resolve);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe("isHttpAddress", () => {
  it.each(["http://a.example", "https://a.example/x?y=1"])("%s — да", (value) => expect(isHttpAddress(value)).toBe(true));
  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://a.example", "a.example", "", "//a.example"])("%s — нет", (value) =>
    expect(isHttpAddress(value)).toBe(false),
  );
});
