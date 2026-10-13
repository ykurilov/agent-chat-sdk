import { describe, expect, it } from "vitest";
import { createMemorySandboxJournal } from "../../src/index";
import { setupSandbox } from "./support/sandbox-setup";

const KEY = "sk-test-12345678";

describe("ключи из chat.env не попадают в журнал", () => {
  it("журнал как в примере доков (без своего env): ключ из chat.env прячется во всех кусках", async () => {
    const journal = createMemorySandboxJournal({ logError: () => {} });
    const setup = setupSandbox({ sandbox: { journal }, chat: { env: { MOCK_API_KEY: "не-настоящий-ключ", OPENAI_KEY: KEY } } });
    const chatId = await setup.createChat();
    await setup.send(chatId, `мой ключ ${KEY}, перескажи`);

    const entries = await journal.listForChat(chatId);
    expect(entries.length).toBeGreaterThan(0);
    const everything = JSON.stringify(await Promise.all(entries.map((entry) => journal.getCall(entry.id))));
    expect(everything).toContain("мой ключ");
    expect(everything).not.toContain(KEY);
    expect(everything).toContain("[скрыто]");
  });
});
