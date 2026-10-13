import { describe, expect, it } from "vitest";
import { createVoiceClient, voicesForMenu } from "../src/browser/voices";

const narrator = { id: "narrator", name: "Диктор аудиокниг" };
const pirate = { id: "pirate", name: "Старый пират" };

interface Call {
  url: string;
  method: string;
  body?: string;
}

function fakeFetch(responses: Array<Response | (() => Response)>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    const next = responses.shift();
    if (!next) throw new Error("лишний запрос");
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const listResponse = (current: string, persisted = true) => Response.json({ voices: [narrator, pirate], current, persisted });

describe("loadVoices", () => {
  it("читает список с сервера по базовому пути и запоминает текущий голос", async () => {
    const { fetchImpl, calls } = fakeFetch([listResponse("narrator")]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    const loaded = await client.loadVoices();

    expect(loaded).toEqual({ voices: [narrator, pirate], current: "narrator", persisted: true });
    expect(calls).toEqual([{ url: "/api/voice-dialog/voices", method: "GET", body: undefined }]);
    expect(client.currentVoiceId()).toBe("narrator");
  });

  it("лишний слэш в конце базового пути не ломает адрес", async () => {
    const { fetchImpl, calls } = fakeFetch([listResponse("narrator")]);

    await createVoiceClient({ basePath: "/api/voice-dialog/", fetch: fetchImpl }).loadVoices();

    expect(calls[0]?.url).toBe("/api/voice-dialog/voices");
  });

  it("ошибка сервера — понятная ошибка, а не тихий пустой список", async () => {
    const { fetchImpl } = fakeFetch([new Response("нет", { status: 401 })]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await expect(client.loadVoices()).rejects.toThrow(/401/);
  });

  it("ответ не того вида — ошибка", async () => {
    const { fetchImpl } = fakeFetch([Response.json({ voices: "нет" })]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });

    await expect(client.loadVoices()).rejects.toThrow();
  });
});

describe("selectVoice", () => {
  it("отправляет PUT с голосом и меняет текущий выбор", async () => {
    const { fetchImpl, calls } = fakeFetch([listResponse("narrator"), new Response(null, { status: 204 })]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });
    await client.loadVoices();

    await client.selectVoice("pirate");

    expect(calls[1]).toEqual({ url: "/api/voice-dialog/voice", method: "PUT", body: JSON.stringify({ voiceId: "pirate" }) });
    expect(client.currentVoiceId()).toBe("pirate");
  });

  it("сервер отказал (400) — ошибка, выбор остаётся прежним", async () => {
    const { fetchImpl } = fakeFetch([listResponse("narrator"), new Response(null, { status: 400 })]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });
    await client.loadVoices();

    await expect(client.selectVoice("pirate")).rejects.toThrow(/400/);

    expect(client.currentVoiceId()).toBe("narrator");
  });

  it("смена во время реплики действует со следующей: идущая реплика остаётся на своём голосе", async () => {
    const { fetchImpl } = fakeFetch([listResponse("narrator"), new Response(null, { status: 204 })]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });
    await client.loadVoices();

    expect(client.beginReply()).toBe("narrator");
    await client.selectVoice("pirate");

    expect(client.voiceOfReply()).toBe("narrator");
    expect(client.beginReply()).toBe("pirate");
    expect(client.voiceOfReply()).toBe("pirate");
  });

  it("смена вне реплики действует со следующей реплики; до первой реплики голос — выбранный", async () => {
    const { fetchImpl } = fakeFetch([listResponse("narrator"), new Response(null, { status: 204 })]);
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fetchImpl });
    await client.loadVoices();

    await client.selectVoice("pirate");

    expect(client.voiceOfReply()).toBe("pirate");
    expect(client.beginReply()).toBe("pirate");
  });

  it("пока голоса не загружены, вызывать beginReply можно: голос ещё неизвестен", () => {
    const client = createVoiceClient({ basePath: "/api/voice-dialog", fetch: fakeFetch([]).fetchImpl });

    expect(client.beginReply()).toBeUndefined();
    expect(client.currentVoiceId()).toBeUndefined();
  });
});

describe("меню голосов", () => {
  it("два и больше голосов — меню есть", () => {
    expect(voicesForMenu({ voices: [narrator, pirate], current: "narrator", persisted: true })).toEqual([narrator, pirate]);
  });

  it("один голос или ни одного — меню не показывать", () => {
    expect(voicesForMenu({ voices: [narrator], current: "narrator", persisted: true })).toBeUndefined();
    expect(voicesForMenu({ voices: [], current: "", persisted: false })).toBeUndefined();
  });
});
