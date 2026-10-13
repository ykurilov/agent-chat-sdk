import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { AgentSettings, ChatServiceOptions } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { mockCatalog, mockEnv, mockModel, mockModelId, readAll, reasoningAndTextParts, streamOf } from "./support/mock-model";

const question = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "Какое сегодня число?" }] };
const humanSaturday = "Сегодня: суббота, 3 октября 2026 г.";
const serverFriday = "Сегодня: пятница, 2 октября 2026 г.";

function build(agent: Partial<AgentSettings> = {}) {
  const model = mockModel(() => streamOf(reasoningAndTextParts(["Третье"])));
  const options: ChatServiceOptions = {
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
  };
  return { service: createChatService(options), model };
}

async function dateSeen(agent: Partial<AgentSettings>, timeZone?: unknown) {
  const { service, model } = build(agent);
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, question, { page: { timeZone } as never }));
  const prompt = JSON.stringify(model.doStreamCalls.at(-1)!.prompt);
  return prompt.match(/Сегодня: [^"]+/)?.[0];
}

describe("дата в хвосте — по часовому поясу человека", () => {
  const serverZone = process.env.TZ;
  beforeEach(() => {
    // Сервер в UTC; у человека 03:00 следующего дня (UTC+8).
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 2, 19, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (serverZone === undefined) delete process.env.TZ;
    else process.env.TZ = serverZone;
  });

  it("UTC-сервер, человек в +8, у него 03:00 — модель видит его дату", async () => {
    expect(await dateSeen({}, "Asia/Shanghai")).toBe(humanSaturday);
  });

  it("пояс не пришёл — пояс сервера", async () => {
    expect(await dateSeen({})).toBe(serverFriday);
  });

  it("пришёл не пояс — пояс из agent.timeZone, а без него пояс сервера", async () => {
    expect(await dateSeen({ timeZone: "Asia/Shanghai" }, "Mars/Olympus")).toBe(humanSaturday);
    expect(await dateSeen({}, "+08:00")).toBe(serverFriday);
    expect(await dateSeen({}, 8)).toBe(serverFriday);
  });

  it("пояс человека главнее agent.timeZone", async () => {
    expect(await dateSeen({ timeZone: "Asia/Shanghai" }, "UTC")).toBe(serverFriday);
  });

  it("agent.timeZone — не пояс: ошибка при создании службы", () => {
    expect(() => build({ timeZone: "Mars/Olympus" })).toThrow(/agent\.timeZone/);
    expect(() => build({ timeZone: "Europe/Moscow" })).not.toThrow();
  });
});

describe("пояс лимитов — та же настройка для даты агента", () => {
  const serverZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 2, 19, 0)));
  });
  afterEach(() => {
    vi.useRealTimers();
    if (serverZone === undefined) delete process.env.TZ;
    else process.env.TZ = serverZone;
  });

  const limitsIn = (timeZone?: string) => ({
    ...(timeZone && { timeZone }),
    assertWithinLimit: async () => undefined,
    status: async () => ({ state: "ok" as const }),
  });

  async function dateSeenWith(input: { agent?: Partial<AgentSettings>; limitsZone?: string; humanZone?: string }) {
    const model = mockModel(() => streamOf(reasoningAndTextParts(["Третье"])));
    const service = createChatService({
      storage: createInMemoryChatStorage(),
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: { instructions: "Ты помощник.", ...input.agent },
      env: mockEnv,
      limits: limitsIn(input.limitsZone),
    });
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, question, { page: { timeZone: input.humanZone } as never }));
    return JSON.stringify(model.doStreamCalls.at(-1)!.prompt).match(/Сегодня: [^"]+/)?.[0];
  }

  it("пояс человека не пришёл — дата по поясу лимитов, а не сервера", async () => {
    expect(await dateSeenWith({ limitsZone: "Asia/Shanghai" })).toBe(humanSaturday);
  });

  it("пояс человека по-прежнему главнее", async () => {
    expect(await dateSeenWith({ limitsZone: "Asia/Shanghai", humanZone: "UTC" })).toBe(serverFriday);
  });

  it("agent.timeZone и пояс лимитов совпадают — можно; расходятся — ошибка при создании службы", async () => {
    expect(await dateSeenWith({ agent: { timeZone: "Asia/Shanghai" }, limitsZone: "Asia/Shanghai" })).toBe(humanSaturday);
    await expect(dateSeenWith({ agent: { timeZone: "Europe/Moscow" }, limitsZone: "Asia/Shanghai" })).rejects.toThrow(/Europe\/Moscow.*Asia\/Shanghai|Asia\/Shanghai.*Europe\/Moscow/);
  });

  it("другое имя того же пояса (Asia/Calcutta и Asia/Kolkata, US/Eastern и America/New_York) — не ошибка", async () => {
    await expect(dateSeenWith({ agent: { timeZone: "Asia/Calcutta" }, limitsZone: "Asia/Kolkata" })).resolves.toBeDefined();
    await expect(dateSeenWith({ agent: { timeZone: "Asia/Kolkata" }, limitsZone: "Asia/Calcutta" })).resolves.toBeDefined();
    await expect(dateSeenWith({ agent: { timeZone: "US/Eastern" }, limitsZone: "America/New_York" })).resolves.toBeDefined();
    await expect(dateSeenWith({ agent: { timeZone: "Europe/Kiev" }, limitsZone: "Europe/Kyiv" })).resolves.toBeDefined();
  });
});
