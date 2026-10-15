// Живая проверка навыков на DeepSeek 4.1 Flash (SC-003): на «сделай игру» агент сам зовёт `use_skill` с навыком игр,
// на просьбу не про игры — не зовёт. Ключ — только из окружения (`pnpm secrets:load` или `.env.local`), в вывод не попадает.
// Запуск: `pnpm test:live skills`. Обращений к модели — 3–4: вызов навыка и ответ, плюс один ответ без навыка.
import { createChatService, createInMemoryChatStorage, standardCatalog } from "@ykurilov/agent-chat-core";
import { afterAll, describe, expect, it } from "vitest";
import { createSkills, memorySkillStore, withSkills } from "../../src/index";

if (!process.env.DEEPSEEK_API_KEY) throw new Error("Нет DEEPSEEK_API_KEY: выполните `pnpm secrets:load`");

const GAME_MARK = "По навыку игр";
let modelCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (String(input).includes("/chat/completions")) modelCalls += 1;
  return originalFetch(input, init);
};
afterAll(() => {
  globalThis.fetch = originalFetch;
  console.info(`[live] обращений к модели: ${modelCalls}`);
});

async function build() {
  const store = memorySkillStore();
  const at = new Date().toISOString();
  await store.create(
    {
      name: "разработка-игр",
      whenToUse: "Когда просят сделать, придумать или спланировать игру: браузерную, текстовую, любую.",
      body: `# Разработка игр\n\n- Первая строка ответа — «${GAME_MARK}».\n- Игра — один HTML-файл на canvas, без библиотек.`,
      status: "everyone",
      author: "boss",
    },
    at,
  );
  await store.create(
    { name: "оформление-договора", whenToUse: "Когда просят составить или проверить договор.", body: "# Договоры\n\nУказания.", status: "everyone", author: "boss" },
    at,
  );
  const storage = createInMemoryChatStorage();
  const skills = createSkills({ store, isAdmin: () => false, chatStorage: storage, log: () => {} });
  const service = createChatService({
    storage,
    catalog: standardCatalog,
    defaultChoice: { modelId: "deepseek-4.1-flash", providerId: "deepseek" },
    agent: withSkills({ instructions: "Ты помощник. Отвечай по-русски, коротко." }, skills),
    env: process.env,
  });
  return { store, service };
}

async function ask(text: string) {
  const { store, service } = await build();
  const chat = await service.createChat("anna");
  const stream = await service.sendMessage("anna", chat.id, { id: "q1", role: "user", parts: [{ type: "text", text }] });
  for await (const _chunk of stream) {
    // ход дочитывается до конца
  }
  const { messages } = await service.getHistory("anna", chat.id);
  const answer = messages.findLast((message) => message.role === "assistant");
  expect(answer?.metadata?.status, `ответ: ${JSON.stringify(answer?.metadata)}`).toBe("complete");
  const parts = answer?.parts ?? [];
  const skillCalls = parts.flatMap((part) => (part.type === "tool-use_skill" && "input" in part ? [(part.input as { name?: string }).name] : []));
  const reply = parts.map((part) => (part.type === "text" ? part.text : "")).join("");
  return { skillCalls, reply, stats: await store.loadStats("разработка-игр", 5) };
}

describe("навыки на DeepSeek 4.1 Flash", () => {
  it("«сделай игру» — агент загружает навык игр и следует ему", async () => {
    const { skillCalls, reply, stats } = await ask("Сделай игру «угадай число» для браузера. Пока только план в 3 пунктах, без кода.");
    console.info(`[live] игра: use_skill ${JSON.stringify(skillCalls)}; начало ответа: ${JSON.stringify(reply.slice(0, 80))}`);
    expect(skillCalls).toEqual(["разработка-игр"]);
    expect(stats.total).toBe(1);
    expect(reply).toContain(GAME_MARK);
  });

  it("просьба не про игры — навык не загружается", async () => {
    const { skillCalls, reply, stats } = await ask("Сколько будет 17 умножить на 23? Ответь числом.");
    console.info(`[live] не игра: use_skill ${JSON.stringify(skillCalls)}; ответ: ${JSON.stringify(reply.slice(0, 80))}`);
    expect(skillCalls).toEqual([]);
    expect(stats.total).toBe(0);
    expect(reply).toContain("391");
  });
});
