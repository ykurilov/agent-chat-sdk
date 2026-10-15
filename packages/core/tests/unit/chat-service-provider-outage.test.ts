import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { PROVIDER_OUTAGE_PAUSE_MS } from "../../src/provider-errors/provider-outages";
import { finishPart, mockCatalog, streamOf, streamStart, textParts } from "./support/mock-model";
import { askInNewChat, helperService, lastAnswer } from "./support/helper-fixtures";

const noMoney = () =>
  new APICallError({ message: "402", url: "https://p.test", requestBodyValues: {}, statusCode: 402, responseBody: "Insufficient Balance", responseHeaders: {} });

describe("служба: у основного провайдера кончились деньги", () => {
  it("пауза основного общая для чатов службы и идёт по её часам: второй чат — сразу к запасному, после паузы основной пробуется снова", async () => {
    let time = new Date(2026, 9, 14, 12).getTime();
    const primary = new MockLanguageModelV4({
      doStream: async () => {
        throw noMoney();
      },
    });
    const backup = new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf([streamStart, ...textParts(["Ответ запасного"]), finishPart()]) }) });
    const logged: string[] = [];
    const { service } = helperService({
      model: primary,
      helpers: {},
      extra: {
        catalog: mockCatalog({ mock: primary, "mock-backup": backup }),
        now: () => new Date(time),
        logError: (line) => logged.push(line),
      },
    });

    const first = await askInNewChat(service);
    time += 60_000;
    const second = await askInNewChat(service, "ещё", "u2");

    expect(primary.doStreamCalls).toHaveLength(1);
    expect(backup.doStreamCalls).toHaveLength(2);
    for (const { chat } of [first, second]) {
      expect((await lastAnswer(service, chat.id)).metadata).toMatchObject({ status: "complete", providerId: "mock-backup" });
    }
    expect(logged.filter((line) => line.startsWith("[ВНИМАНИЕ провайдер]"))).toEqual([
      "[ВНИМАНИЕ провайдер] mock: кончились деньги — ходы идут через запасной mock-backup",
    ]);

    time += PROVIDER_OUTAGE_PAUSE_MS;
    await askInNewChat(service, "и ещё", "u3");
    expect(primary.doStreamCalls).toHaveLength(2);
  });
});
