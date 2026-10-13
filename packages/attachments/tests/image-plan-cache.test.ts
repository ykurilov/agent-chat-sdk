import { describe, expect, it } from "vitest";
import { createImagePlanCache } from "../src/image-plan-cache";

const copy = (size: number) => ({ kind: "fitted" as const, mediaType: "image/jpeg", bytes: new Uint8Array(size) });
const original = { kind: "original" as const, mediaType: "image/png" };

describe("кэш решений по картинкам: предел по памяти копий, а не по числу", () => {
  it("решения без копий не вытесняют друг друга, пока их меньше предела числа", async () => {
    const cache = createImagePlanCache({ maxPlans: 1_000, maxCopyBytes: 100 });
    for (let index = 0; index < 500; index += 1) cache.set(`k${index}`, Promise.resolve(original));
    await Promise.resolve();
    expect(await cache.get("k0")).toEqual(original);
    expect(await cache.get("k499")).toEqual(original);
  });

  it("копии сверх предела байт вытесняются: первыми — давно не нужные", async () => {
    const cache = createImagePlanCache({ maxPlans: 1_000, maxCopyBytes: 100 });
    cache.set("a", Promise.resolve(copy(40)));
    cache.set("b", Promise.resolve(copy(40)));
    await new Promise((resolve) => setImmediate(resolve));
    await cache.get("a");
    cache.set("c", Promise.resolve(copy(40)));
    await new Promise((resolve) => setImmediate(resolve));

    expect(cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toEqual(copy(40));
    expect(await cache.get("c")).toEqual(copy(40));
    expect(cache.copyBytes()).toBe(80);
  });

  it("копия больше всего предела не запоминается", async () => {
    const cache = createImagePlanCache({ maxPlans: 1_000, maxCopyBytes: 100 });
    cache.set("small", Promise.resolve(copy(10)));
    cache.set("huge", Promise.resolve(copy(500)));
    await new Promise((resolve) => setImmediate(resolve));
    expect(cache.get("huge")).toBeUndefined();
    expect(await cache.get("small")).toEqual(copy(10));
    expect(cache.copyBytes()).toBe(10);
  });

  it("сверх предела числа вытесняется самое давнее", async () => {
    const cache = createImagePlanCache({ maxPlans: 2, maxCopyBytes: 100 });
    cache.set("a", Promise.resolve(original));
    cache.set("b", Promise.resolve(original));
    cache.set("c", Promise.resolve(original));
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("неудача и «файла нет» не запоминаются", async () => {
    const cache = createImagePlanCache({ maxPlans: 10, maxCopyBytes: 100 });
    cache.set("gone", Promise.resolve(undefined));
    cache.set("broken", Promise.reject(new Error("диск")));
    await new Promise((resolve) => setImmediate(resolve));
    expect(cache.get("gone")).toBeUndefined();
    expect(cache.get("broken")).toBeUndefined();
  });
});
