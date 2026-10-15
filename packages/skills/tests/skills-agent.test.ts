import { createHash } from "node:crypto";
import type { Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createChatService, createInMemoryChatStorage } from "@ykurilov/agent-chat-core";
import type { AgentToolsModel, AgentViewerSource, ContextBlocksInput } from "@ykurilov/agent-chat-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, summarizingModel, textParts } from "../../core/tests/unit/support/mock-model";
import { compactionRecord } from "../../core/tests/unit/support/compaction-fixtures";
import { createSkills, withSkills } from "../src/index";
import { memorySkillStore } from "../src/store/memory";
import type { SkillStatus, SkillStore } from "../src/types";

type Prompt = MockLanguageModelV4["doStreamCalls"][number]["prompt"];
type LanguageModelV4StreamPart = Parameters<typeof streamOf>[0][number];

const HEADING = "Навыки — готовые указания для отдельных задач. Если задача человека подходит под навык, до начала работы загрузи его указания инструментом use_skill и следуй им. Не подходит — не загружай.";
const ADMINS = new Set(["boss"]);
const userMessage = (id: string, text: string) => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });
const bytes = (prompt: Prompt) => prompt.map((message) => JSON.stringify(message));
const lastUserTexts = (prompt: Prompt) => {
  const last = [...prompt].reverse().find((message) => message.role === "user")!;
  return typeof last.content === "string" ? [last.content] : last.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));
};
const callSkill = (name: string, id = `call-${name}`): LanguageModelV4StreamPart[] => [
  streamStart,
  { type: "tool-call", toolCallId: id, toolName: "use_skill", input: JSON.stringify({ name }) },
  finishPart("tool-calls"),
];
const answer = [streamStart, ...textParts(["Готово"]), finishPart()];
/** Результат `use_skill` с телом: заголовок с версией и отпечатком тела. */
const loaded = (name: string, version: number, body: string) =>
  `<skill name="${name}" version="${version}" hash="${createHash("sha256").update(body).digest("hex").slice(0, 12)}">\n${body}\n</skill>`;

async function addSkill(store: SkillStore, name: string, status: SkillStatus, whenToUse = `Когда нужно ${name}.`, body = `# ${name}\nУказания.`) {
  await store.create({ name, whenToUse, body, status, author: "boss" }, "2026-10-15T10:00:00.000Z");
}

/** Права хода, как у приложения: админ ли владелец чата. */
const adminViewer: AgentViewerSource = ({ ownerId }) => ({ isAdmin: ADMINS.has(ownerId) });

/** Служба ядра с навыками; модель отвечает по сценарию, потом «Готово». `isAdmin` пакета — только для экрана: в ходе не зовётся. */
function build(store: SkillStore = memorySkillStore(), viewer: AgentViewerSource | null = adminViewer) {
  const scripts: LanguageModelV4StreamPart[][] = [];
  const model = mockModel(() => streamOf(scripts.shift() ?? answer));
  const storage = createInMemoryChatStorage();
  const logged: string[] = [];
  const errors: string[] = [];
  const skills = createSkills({
    store,
    isAdmin: () => {
      throw new Error("isAdmin пакета в ходе не зовётся: права хода — agent.viewer");
    },
    chatStorage: storage,
    log: (line) => void logged.push(line),
    logError: (message) => void errors.push(message),
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });
  const service = createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: withSkills({ instructions: "Ты помощник.", ...(viewer && { viewer }) }, skills),
    env: mockEnv,
  });
  const say = async (owner: string, chatId: string, id: string, text: string, ...script: LanguageModelV4StreamPart[][]) => {
    scripts.push(...script);
    await readAll(await service.sendMessage(owner, chatId, userMessage(id, text)));
  };
  const queue = (...script: LanguageModelV4StreamPart[][]) => void scripts.push(...script);
  /** Результаты `use_skill` в чате по порядку. */
  const skillOutputs = async (chatId: string) =>
    (await storage.listMessages(chatId)).flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "tool-use_skill" && "output" in part ? [String(part.output)] : [])),
    );
  return { service, storage, store, model, skills, logged, errors, say, queue, skillOutputs };
}

function blocksInput(ownerId: string, extra: Partial<ContextBlocksInput> = {}): ContextBlocksInput {
  return {
    chatId: "chat-1",
    ownerId,
    messageId: "answer-1",
    chat: {},
    channel: "web",
    audience: "private",
    modelId: mockModelId,
    providerId: "mock",
    abortSignal: new AbortController().signal,
    ...extra,
  };
}

describe("навыки в ходе агента", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
  });
  afterEach(() => vi.useRealTimers());

  it("в вопросе — список видимых навыков по имени, без тел; инструкция и описание инструмента без списка", async () => {
    const { store, service, model, say } = build();
    await addSkill(store, "zeta", "everyone");
    await addSkill(store, "game-dev", "everyone", "Когда просят сделать игру.");
    await addSkill(store, "secret", "admins");
    await addSkill(store, "draft", "off");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "привет");

    const call = model.doStreamCalls[0]!;
    expect(lastUserTexts(call.prompt)).toContain(`${HEADING}\n- game-dev: Когда просят сделать игру.\n- zeta: Когда нужно zeta.`);
    const all = JSON.stringify(call);
    expect(all).not.toContain("Указания.");
    expect(all).not.toContain("- secret:");
    expect(all).not.toContain("- draft:");
    expect(JSON.stringify(call.prompt[0])).not.toContain("game-dev");
    expect(JSON.stringify(call.tools)).not.toContain("game-dev");
  });

  it("навыков нет — блока нет", async () => {
    const { service, model, say } = build();
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "привет");
    expect(lastUserTexts(model.doStreamCalls[0]!.prompt).join("\n")).not.toContain("Навыки —");
  });

  it("кэш: два хода без правки — второй запрос начинается байт в байт как первый, инструменты те же; правка — меняется только новый вопрос", async () => {
    const { store, service, model, say } = build();
    await addSkill(store, "game-dev", "everyone", "Когда просят сделать игру.");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "раз");
    await say("anna", chat.id, "u2", "два");
    const [first, second] = [model.doStreamCalls[0]!, model.doStreamCalls[1]!];
    expect(bytes(second.prompt).slice(0, first.prompt.length)).toEqual(bytes(first.prompt));
    expect(lastUserTexts(second.prompt)).toEqual(["два"]);
    expect(JSON.stringify(second.tools)).toBe(JSON.stringify(first.tools));

    await store.updateText("game-dev", { whenToUse: "Игры и головоломки.", body: "v2", author: "boss", expectedVersion: 1 }, "2026-10-15T11:00:00.000Z");
    await say("anna", chat.id, "u3", "три");
    const third = model.doStreamCalls[2]!;
    expect(bytes(third.prompt).slice(0, second.prompt.length)).toEqual(bytes(second.prompt));
    expect(lastUserTexts(third.prompt)).toEqual(["три", `${HEADING}\n- game-dev: Игры и головоломки.`]);
    expect(JSON.stringify(third.tools)).toBe(JSON.stringify(first.tools));
  });

  it("список ушёл в сводку при сжатии истории — запрос несёт его заново один раз, дальше снова без повтора", async () => {
    const { store, storage, service, model, say } = build();
    await addSkill(store, "game-dev", "everyone", "Когда просят сделать игру.");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "раз");
    await say("anna", chat.id, "u2", "два");
    const messages = await storage.listMessages(chat.id);
    const firstAnswer = messages.find((message) => message.role === "assistant")!;
    await storage.insertCompaction(compactionRecord({ id: "k1", chatId: chat.id, fromMessageId: messages[0]!.id, throughMessageId: firstAnswer.id }));
    await say("anna", chat.id, "u3", "три");
    await say("anna", chat.id, "u4", "четыре");
    const list = `${HEADING}\n- game-dev: Когда просят сделать игру.`;
    const listCount = (prompt: Prompt) => JSON.stringify(prompt).split(JSON.stringify(list).slice(1, -1)).length - 1;
    // До сжатия список был один раз — в первом вопросе; второй ход его не повторял.
    expect(listCount(model.doStreamCalls[1]!.prompt)).toBe(1);
    expect(lastUserTexts(model.doStreamCalls[1]!.prompt)).toEqual(["два"]);
    // Первый вопрос ушёл в сводку: список снова в запросе, ровно один раз (у первого видимого вопроса).
    const afterCompaction = model.doStreamCalls[2]!.prompt;
    expect(JSON.stringify(afterCompaction)).not.toContain('"раз"');
    expect(listCount(afterCompaction)).toBe(1);
    expect(lastUserTexts(afterCompaction)).toEqual(["три"]);
    // Следующий ход начинается байт в байт как ход после сжатия и списка не повторяет.
    const next = model.doStreamCalls[3]!.prompt;
    expect(bytes(next).slice(0, afterCompaction.length)).toEqual(bytes(afterCompaction));
    expect(lastUserTexts(next)).toEqual(["четыре"]);
    expect(listCount(next)).toBe(1);
  });

  it("видимость по правам хода (viewer.isAdmin): админ видит «только админам»; не админ и группа — нет; копия чата у сотрудника — по правам человека", async () => {
    const { store, skills } = build();
    await addSkill(store, "game-dev", "everyone");
    await addSkill(store, "secret", "admins");
    const names = async (input: ContextBlocksInput) => (await skills.contextBlocks(input)).map((block) => block.text.split("\n").slice(1).join("|"));
    const both = ["- game-dev: Когда нужно game-dev.|- secret: Когда нужно secret."];
    const everyone = ["- game-dev: Когда нужно game-dev."];
    expect(await names(blocksInput("boss", { viewer: { isAdmin: true } }))).toEqual(both);
    expect(await names(blocksInput("anna", { viewer: { isAdmin: false } }))).toEqual(everyone);
    expect(await names(blocksInput("boss", { viewer: { isAdmin: true }, audience: "group" }))).toEqual(everyone);
    // Копия чата человека: ядро и песочница считают права по человеку — сотрудник видит то же, что человек.
    expect(await names(blocksInput("anna", { staff: { id: "boss" }, viewer: { isAdmin: false } }))).toEqual(everyone);
    expect(await names(blocksInput("boss", { staff: { id: "boss" }, viewer: { isAdmin: true } }))).toEqual(both);
  });

  it("без agent.viewer админские навыки не видит никто; подсказка в журнал один раз", async () => {
    const { store, service, model, say, skillOutputs, logged } = build(memorySkillStore(), null);
    await addSkill(store, "game-dev", "everyone");
    await addSkill(store, "secret", "admins");
    const chat = await service.createChat("boss");
    await say("boss", chat.id, "u1", "покажи", callSkill("secret"));
    const prompt = lastUserTexts(model.doStreamCalls[0]!.prompt).join("\n");
    expect(prompt).toContain("- game-dev:");
    expect(prompt).not.toContain("- secret:");
    expect(await skillOutputs(chat.id)).toEqual(["Навыка «secret» нет. Бери навыки только из списка «Навыки» в контексте."]);
    await say("boss", chat.id, "u2", "ещё");
    expect(logged.filter((line) => line.includes("agent.viewer"))).toEqual(["skills: навыки «только админам» не видны: задайте agent.viewer, который возвращает { isAdmin }"]);
  });

  it("use_skill: тело с версией приходит результатом; учёт загрузки и строка в журнал", async () => {
    const { store, storage, service, say, skillOutputs, logged } = build();
    await addSkill(store, "game-dev", "everyone", "Когда просят сделать игру.", "# Игры\nДелай на canvas.");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "сделай игру", callSkill("game-dev"));

    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "# Игры\nДелай на canvas.")]);
    const answerId = (await storage.listMessages(chat.id)).at(-1)!.id;
    expect(await store.loadStats("game-dev", 5)).toEqual({
      total: 1,
      recent: [{ name: "game-dev", version: 1, chatId: chat.id, ownerId: "anna", turnId: answerId, loadedAt: "2026-10-15T12:00:00.000Z" }],
    });
    expect(logged).toEqual([`skills: loaded "game-dev" v1 chat=${chat.id} owner=anna turn=${answerId}`]);
  });

  it("невидимый навык отвечает как несуществующий: выключенный, админский у не-админа; учёта нет", async () => {
    const { store, service, say, skillOutputs } = build();
    await addSkill(store, "secret", "admins");
    await addSkill(store, "draft", "off");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "покажи", callSkill("secret", "c1"), callSkill("draft", "c2"), callSkill("nothing", "c3"));
    const outputs = await skillOutputs(chat.id);
    expect(outputs).toEqual([
      "Навыка «secret» нет. Бери навыки только из списка «Навыки» в контексте.",
      "Навыка «draft» нет. Бери навыки только из списка «Навыки» в контексте.",
      "Навыка «nothing» нет. Бери навыки только из списка «Навыки» в контексте.",
    ]);
    expect(await store.loadCounts()).toEqual({});
  });

  it("админ загружает админский навык в своём чате", async () => {
    const { store, service, say, skillOutputs } = build();
    await addSkill(store, "secret", "admins", "Тайное.", "тело");
    const chat = await service.createChat("boss");
    await say("boss", chat.id, "u1", "сделай", callSkill("secret"));
    expect(await skillOutputs(chat.id)).toEqual([loaded("secret", 1, "тело")]);
  });

  it("права из базы (асинхронный agent.viewer) спрашиваются один раз на ход: список и все вызовы use_skill решают по ним", async () => {
    const asked: string[] = [];
    const viewer: AgentViewerSource = async ({ ownerId }) => {
      asked.push(ownerId);
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { isAdmin: ADMINS.has(ownerId) };
    };
    const { store, service, model, say, skillOutputs } = build(memorySkillStore(), viewer);
    await addSkill(store, "secret", "admins", "Тайное.", "тело 1");
    await addSkill(store, "secret-2", "admins", "Ещё тайное.", "тело 2");
    const chat = await service.createChat("boss");
    await say("boss", chat.id, "u1", "сделай", callSkill("secret", "c1"), callSkill("secret-2", "c2"));
    expect(lastUserTexts(model.doStreamCalls[0]!.prompt).join("\n")).toContain("- secret: Тайное.");
    expect(await skillOutputs(chat.id)).toEqual([loaded("secret", 1, "тело 1"), loaded("secret-2", 1, "тело 2")]);
    expect(asked).toEqual(["boss"]);

    await say("boss", chat.id, "u2", "дальше");
    expect(asked).toEqual(["boss", "boss"]);

    const anna = await service.createChat("anna");
    await say("anna", anna.id, "u3", "покажи", callSkill("secret"));
    expect((await skillOutputs(anna.id)).at(-1)).toBe("Навыка «secret» нет. Бери навыки только из списка «Навыки» в контексте.");
    expect(asked).toEqual(["boss", "boss", "anna"]);
  });

  it("повтор: тело уже выше — короткий ответ, в том же ходе и в следующем; новая версия — тело заново", async () => {
    const { store, service, say, skillOutputs } = build();
    await addSkill(store, "game-dev", "everyone", "Игры.", "v1");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "игра", callSkill("game-dev", "c1"), callSkill("game-dev", "c2"));
    await say("anna", chat.id, "u2", "ещё игра", callSkill("game-dev", "c3"));
    const already = "Навык «game-dev» версии 1 уже загружен выше в переписке — следуй тем указаниям.";
    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "v1"), already, already]);

    await store.updateText("game-dev", { whenToUse: "Игры.", body: "v2", author: "boss", expectedVersion: 1 }, "2026-10-15T11:00:00.000Z");
    await say("anna", chat.id, "u3", "третья игра", callSkill("game-dev", "c4"));
    expect((await skillOutputs(chat.id)).at(-1)).toBe(loaded("game-dev", 2, "v2"));
    expect((await store.loadStats("game-dev", 10)).total).toBe(2);
  });

  it("навык удалили и создали заново с тем же именем — модель получает новое тело, хотя версия снова 1", async () => {
    const { store, service, say, skillOutputs } = build();
    await addSkill(store, "game-dev", "everyone", "Игры.", "старое");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "игра", callSkill("game-dev", "c1"));
    await store.delete("game-dev");
    await addSkill(store, "game-dev", "everyone", "Игры.", "новое");
    await say("anna", chat.id, "u2", "ещё игра", callSkill("game-dev", "c2"));
    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "старое"), loaded("game-dev", 1, "новое")]);
  });

  it("два вызова одного навыка в одном шаге модели — тело один раз, второй получает «уже загружен»", async () => {
    const { store, service, say, skillOutputs } = build();
    await addSkill(store, "game-dev", "everyone", "Игры.", "v1");
    const chat = await service.createChat("anna");
    const twice: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "c1", toolName: "use_skill", input: JSON.stringify({ name: "game-dev" }) },
      { type: "tool-call", toolCallId: "c2", toolName: "use_skill", input: JSON.stringify({ name: " game-dev " }) },
      finishPart("tool-calls"),
    ];
    await say("anna", chat.id, "u1", "игра", twice);
    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "v1"), "Навык «game-dev» версии 1 уже загружен выше в переписке — следуй тем указаниям."]);
    expect((await store.loadStats("game-dev", 10)).total).toBe(1);
  });

  it("«Переделать» — тело на новой ветке заново; возврат на старую ветку — «уже загружен»", async () => {
    const { store, storage, service, say, queue, skillOutputs } = build();
    await addSkill(store, "game-dev", "everyone", "Игры.", "v1");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "игра", callSkill("game-dev", "c1"));
    const first = (await storage.listMessages(chat.id)).find((message) => message.role === "assistant")!;

    queue(callSkill("game-dev", "c2"));
    await readAll(await service.regenerate("anna", chat.id, first.id));
    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "v1"), loaded("game-dev", 1, "v1")]);

    await service.selectBranch("anna", chat.id, first.id);
    await say("anna", chat.id, "u2", "ещё игра", callSkill("game-dev", "c3"));
    const reply = (await storage.listMessages(chat.id)).find((message) => message.parentId === "u2")!;
    expect(reply.parts.flatMap((part) => (part.type === "tool-use_skill" && "output" in part ? [String(part.output)] : []))).toEqual(["Навык «game-dev» версии 1 уже загружен выше в переписке — следуй тем указаниям."]);
  });

  it("после сжатия истории тело ушло в сводку — загружается снова", async () => {
    const { store, storage, service, say, skillOutputs } = build();
    await addSkill(store, "game-dev", "everyone", "Игры.", "v1");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "игра", callSkill("game-dev", "c1"));
    await say("anna", chat.id, "u2", "дальше");
    const messages = await storage.listMessages(chat.id);
    const firstAnswer = messages.find((message) => message.role === "assistant")!;
    await storage.insertCompaction(compactionRecord({ id: "k1", chatId: chat.id, fromMessageId: messages[0]!.id, throughMessageId: firstAnswer.id }));
    await say("anna", chat.id, "u3", "ещё игра", callSkill("game-dev", "c2"));
    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "v1"), loaded("game-dev", 1, "v1")]);
  });

  it("сжатие истории в групповом чате: инструменты получают группу — админский навык не отдаётся даже админу", async () => {
    vi.useRealTimers();
    const store = memorySkillStore();
    await addSkill(store, "secret", "admins", "Тайное.", "тело");
    await addSkill(store, "game-dev", "everyone", "Игры.", "v1");
    const storage = createInMemoryChatStorage();
    const skills = createSkills({ store, isAdmin: () => true, chatStorage: storage, log: () => {}, logError: () => {} });
    const compactionModels: AgentToolsModel[] = [];
    const model = summarizingModel("## Цель\nсводка", [100, 600]);
    const service = createChatService({
      storage,
      catalog: mockCatalog({ mock: model }),
      defaultChoice: { modelId: mockModelId, providerId: "mock" },
      agent: withSkills(
        {
          instructions: "Ты помощник.",
          viewer: adminViewer,
          tools: (toolsModel) => {
            if (toolsModel.turnId === undefined) compactionModels.push(toolsModel);
            return {};
          },
        },
        skills,
      ),
      compaction: { thresholdTokens: 500, tailTokens: 100, summaryCeilingTokens: 100 },
      env: mockEnv,
      logError: () => {},
    });
    const chat = await service.createChat("boss");
    const group = { channel: "telegram" as const, group: { allowedTools: [], author: "Борис" } };
    await readAll(await service.sendMessage("boss", chat.id, userMessage("u1", "раз"), group));
    await readAll(await service.sendMessage("boss", chat.id, userMessage("u2", "два"), group));
    await vi.waitFor(() => expect(compactionModels.length).toBeGreaterThan(0));
    const toolsModel = compactionModels[0]!;
    expect(toolsModel).toMatchObject({ audience: "group", viewer: { isAdmin: true } });
    const useSkill = skills.tools(toolsModel).use_skill as Tool<{ name: string }, string>;
    const run = (name: string) => useSkill.execute!({ name }, { toolCallId: "c", messages: [], context: undefined }) as Promise<string>;
    expect(await run("secret")).toBe("Навыка «secret» нет. Бери навыки только из списка «Навыки» в контексте.");
    expect(await run("game-dev")).toBe(loaded("game-dev", 1, "v1"));
  });

  it("сбой учёта не ломает ход: тело отдано, ошибка в журнале", async () => {
    const store = memorySkillStore();
    store.recordLoad = async () => {
      throw new Error("база недоступна");
    };
    const { service, say, skillOutputs, errors } = build(store);
    await addSkill(store, "game-dev", "everyone", "Игры.", "v1");
    const chat = await service.createChat("anna");
    await say("anna", chat.id, "u1", "игра", callSkill("game-dev"));
    expect(await skillOutputs(chat.id)).toEqual([loaded("game-dev", 1, "v1")]);
    expect(errors.join("\n")).toContain("база недоступна");
  });
});

describe("withSkills", () => {
  const skills = createSkills({ store: memorySkillStore(), isAdmin: () => false, chatStorage: createInMemoryChatStorage(), log: () => {} });

  it("инструмент приложения с тем же именем — ошибка сразу", () => {
    expect(() => withSkills({ instructions: "", tools: { use_skill: {} as never } }, skills)).toThrow(/use_skill/);
  });

  it("блоки приложения идут первыми; ключ skills у приложения — ошибка", async () => {
    const store = memorySkillStore();
    await addSkill(store, "game-dev", "everyone");
    const own = createSkills({ store, isAdmin: () => false, chatStorage: createInMemoryChatStorage(), log: () => {} });
    const agent = withSkills({ instructions: "", contextBlocks: () => [{ key: "form", text: "форма" }] }, own);
    expect((await agent.contextBlocks!(blocksInput("anna")))!.map((block) => ("key" in block ? block.key : ""))).toEqual(["form", "skills"]);
    const taken = withSkills({ instructions: "", contextBlocks: () => [{ key: "skills", text: "моё" }] }, own);
    await expect(taken.contextBlocks!(blocksInput("anna"))).rejects.toThrow(/skills/);
  });
});
