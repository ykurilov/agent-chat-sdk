import { describe, expect, it } from "vitest";
import { createChatService } from "../../src/chat-service";
import type { AgentSettings } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

function usageFinish(input: number, cacheRead: number) {
  return {
    ...finishPart(),
    usage: {
      inputTokens: { total: input, noCache: input - cacheRead, cacheRead, cacheWrite: 0 },
      outputTokens: { total: 10, text: 10, reasoning: 0 },
    },
  };
}

const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

/** Два хода подряд в одном чате: в первом кэш читался, во втором не прочитан вовсе. */
async function twoTurns(agent: Partial<AgentSettings> = {}): Promise<string[]> {
  const lines: string[] = [];
  const answers = [usageFinish(20_000, 15_000), usageFinish(21_000, 0)];
  const model = mockModel(() => streamOf([streamStart, ...textParts(["Ответ"]), answers.shift()!]));
  const service = createChatService({
    storage: createInMemoryChatStorage(),
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник.", ...agent },
    env: mockEnv,
    logError: (line) => lines.push(line),
  });
  const chat = await service.createChat("anna");
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u1", "Привет")));
  await readAll(await service.sendMessage("anna", chat.id, userMessage("u2", "Как дела?")));
  return lines.filter((line) => line.startsWith("[промах кэша]"));
}

describe("createChatService: журнал промахов кэша", () => {
  it("включён по умолчанию: второй ход без чтения кэша пишет строку", async () => {
    expect(await twoTurns()).toHaveLength(1);
  });

  it("cacheMissLog: false выключает журнал", async () => {
    expect(await twoTurns({ cacheMissLog: false })).toEqual([]);
  });
});
