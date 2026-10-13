import { describe, expect, it } from "vitest";
import { createImageCache } from "../src/image-cache";

const image = (size: number) => ({ bytes: new Uint8Array(size), mediaType: "image/png" });

describe("кэш снимков в памяти", () => {
  it("отдаёт то, что положили", () => {
    const cache = createImageCache({ maxEntries: 5, maxBytes: 1000, ttlMs: 1000 });
    const value = image(10);
    cache.set("a", value);
    expect(cache.get("a")).toBe(value);
    expect(cache.get("b")).toBeUndefined();
  });

  it("запись живёт ограниченное время", () => {
    let now = 0;
    const cache = createImageCache({ maxEntries: 5, maxBytes: 1000, ttlMs: 1000, now: () => now });
    cache.set("a", image(10));
    now = 999;
    expect(cache.get("a")).toBeDefined();
    now = 1001;
    expect(cache.get("a")).toBeUndefined();
  });

  it("не больше заданного числа записей: уходит самая давняя", () => {
    const cache = createImageCache({ maxEntries: 2, maxBytes: 1000, ttlMs: 1000 });
    cache.set("a", image(1));
    cache.set("b", image(1));
    cache.set("c", image(1));
    expect([cache.get("a"), cache.get("b"), cache.get("c")].map(Boolean)).toEqual([false, true, true]);
  });

  it("чтение обновляет давность: недавно нужная запись остаётся", () => {
    const cache = createImageCache({ maxEntries: 2, maxBytes: 1000, ttlMs: 1000 });
    cache.set("a", image(1));
    cache.set("b", image(1));
    cache.get("a");
    cache.set("c", image(1));
    expect([cache.get("a"), cache.get("b"), cache.get("c")].map(Boolean)).toEqual([true, false, true]);
  });

  it("не больше заданного объёма: давние записи уходят, пока не поместится", () => {
    const cache = createImageCache({ maxEntries: 10, maxBytes: 100, ttlMs: 1000 });
    cache.set("a", image(40));
    cache.set("b", image(40));
    cache.set("c", image(40));
    expect([cache.get("a"), cache.get("b"), cache.get("c")].map(Boolean)).toEqual([false, true, true]);
  });

  it("картинка больше всего объёма не сохраняется и не вытесняет остальные", () => {
    const cache = createImageCache({ maxEntries: 10, maxBytes: 100, ttlMs: 1000 });
    cache.set("a", image(40));
    cache.set("huge", image(101));
    expect(cache.get("huge")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
  });

  it("повторная запись под тем же ключом заменяет прежнюю и не двоит объём", () => {
    const cache = createImageCache({ maxEntries: 10, maxBytes: 100, ttlMs: 1000 });
    cache.set("a", image(60));
    cache.set("a", image(60));
    cache.set("b", image(30));
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeDefined();
  });
});
