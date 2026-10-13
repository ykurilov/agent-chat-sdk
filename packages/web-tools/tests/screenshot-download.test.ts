import { describe, expect, it, vi } from "vitest";
import { downloadScreenshot } from "../src/screenshot-download";
import { publicHost } from "./support";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const image = () => new Response(png, { headers: { "content-type": "image/png" } });
const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

/** Сеть по таблице «адрес → ответ»; записывает, куда и с какими настройками ходили. */
function network(routes: Record<string, () => Response>) {
  const calls: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, redirect: init?.redirect });
    const respond = routes[url];
    return respond ? respond() : new Response("нет", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const start = "https://storage.example/shot.png";

describe("downloadScreenshot: переходы", () => {
  it("сам не идёт по переходам: fetch зовётся с redirect: manual", async () => {
    const { fetch, calls } = network({ [start]: image });
    await downloadScreenshot(start, fetch, { resolveHost: publicHost });
    expect(calls[0]?.redirect).toBe("manual");
  });

  it("публичный переход (в том числе относительный) выполняется, картинка скачивается", async () => {
    const { fetch, calls } = network({
      [start]: () => redirect("/other/shot.png"),
      "https://storage.example/other/shot.png": () => redirect("https://cdn.example/final.png", 301),
      "https://cdn.example/final.png": image,
    });
    const result = await downloadScreenshot(start, fetch, { resolveHost: publicHost });
    expect(result?.mediaType).toBe("image/png");
    expect(calls.map((call) => call.url)).toEqual([start, "https://storage.example/other/shot.png", "https://cdn.example/final.png"]);
    expect(calls.every((call) => call.redirect === "manual")).toBe(true);
  });

  it.each(["http://169.254.169.254/latest/meta-data", "http://localhost:8080/x", "http://[::7f00:1]/", "file:///etc/passwd", "ftp://a.example/x", "data:image/png;base64,AAAA"])(
    "переход на %s не выполняется",
    async (target) => {
      const { fetch, calls } = network({ [start]: () => redirect(target), [target]: image });
      expect(await downloadScreenshot(start, fetch, { resolveHost: publicHost })).toBeUndefined();
      expect(calls.map((call) => call.url)).toEqual([start]);
    },
  );

  it("переход на имя, которое указывает во внутреннюю сеть, не выполняется (проверка по DNS на каждом переходе)", async () => {
    const { fetch, calls } = network({ [start]: () => redirect("https://rebind.example/x.png"), "https://rebind.example/x.png": image });
    const resolveHost = async (host: string) => (host === "rebind.example" ? ["10.0.0.7"] : ["93.184.216.34"]);
    expect(await downloadScreenshot(start, fetch, { resolveHost })).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("переход без адреса назначения — снимка нет", async () => {
    const { fetch } = network({ [start]: () => new Response(null, { status: 302 }) });
    expect(await downloadScreenshot(start, fetch, { resolveHost: publicHost })).toBeUndefined();
  });

  it("не больше трёх переходов подряд", async () => {
    const { fetch, calls } = network({
      [start]: () => redirect("https://a.example/1"),
      "https://a.example/1": () => redirect("https://a.example/2"),
      "https://a.example/2": () => redirect("https://a.example/3"),
      "https://a.example/3": () => redirect("https://a.example/4"),
      "https://a.example/4": image,
    });
    expect(await downloadScreenshot(start, fetch, { resolveHost: publicHost })).toBeUndefined();
    expect(calls).toHaveLength(4);
  });

  it("ровно три перехода допустимы", async () => {
    const { fetch } = network({
      [start]: () => redirect("https://a.example/1"),
      "https://a.example/1": () => redirect("https://a.example/2"),
      "https://a.example/2": () => redirect("https://a.example/3"),
      "https://a.example/3": image,
    });
    expect((await downloadScreenshot(start, fetch, { resolveHost: publicHost }))?.mediaType).toBe("image/png");
  });
});

describe("downloadScreenshot: проверка по DNS", () => {
  it("имя указывает на частный адрес — в сеть не ходим", async () => {
    const { fetch, calls } = network({ [start]: image });
    expect(await downloadScreenshot(start, fetch, { resolveHost: async () => ["93.184.216.34", "192.168.1.10"] })).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("DNS не отвечает — снимка нет, в сеть не ходим", async () => {
    const { fetch, calls } = network({ [start]: image });
    expect(await downloadScreenshot(start, fetch, { resolveHost: async () => Promise.reject(new Error("ENOTFOUND")) })).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("data-адрес не разрешается по DNS", async () => {
    const resolveHost = vi.fn(async () => ["10.0.0.1"]);
    const dataUrl = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
    const result = await downloadScreenshot(dataUrl, globalThis.fetch, { resolveHost });
    expect(result?.mediaType).toBe("image/png");
    expect(resolveHost).not.toHaveBeenCalled();
  });
});
