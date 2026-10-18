import { APICallError } from "ai";
import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { describe, expect, it, vi } from "vitest";
import { LAST_STEP_NOTE, LAST_STEP_TOOL_REFUSAL } from "../../../src/agent-run/last-step";
import type { ModelCallEvent, ToolCallEvent, TurnObserver } from "../../../src/agent-run/turn-observer";
import type { UsageRecord } from "../../../src/conversation/types";
import { SpendingLimitReachedError } from "../../../src/spending/spending-limits";
import type { SpendingLimits } from "../../../src/spending/spending-limits";
import { createInMemoryChatStorage } from "../../../src/storage/in-memory-storage";
import { runHelper as runHelperFromIndex } from "../../../src/index";
import { helperToolsModel, runHelper } from "../../../src/helpers/run-helper";
import type { HelperStepReport } from "../../../src/helpers/helper-types";
import { tool } from "ai";
import { z } from "zod";
import { mockCatalog, mockEnv, mockModelId, readAll } from "../support/mock-model";
import {
  answersDone,
  askInNewChat,
  callsHelper,
  helperCalls,
  helperChatModel,
  helperPart,
  helperService,
  helperText,
  lastAnswer,
  researchHelper,
  searchTool,
} from "../support/helper-fixtures";
import type { HelperScript } from "../support/helper-fixtures";

const promptJson = (prompt: LanguageModelV4Prompt | undefined) => JSON.stringify(prompt);
const searchStep = (id: string, query: string) => helperCalls({ id, toolName: "search", input: { query } });
/** Модель помощника, которая ищет, пока ей не запретят вызовы, а тогда пишет итог. */
const alwaysSearching: HelperScript = (options) =>
  options.toolChoice?.type === "none" ? helperText("Итог по шагам") : searchStep(`s-${Math.random()}`, "ещё");

const overloaded = () =>
  new APICallError({ message: "529", url: "https://p.test", requestBodyValues: {}, statusCode: 529, responseBody: "overloaded", responseHeaders: { "retry-after-ms": "1" } });

function recordingObserver() {
  const models: ModelCallEvent[] = [];
  const tools: ToolCallEvent[] = [];
  const observer: TurnObserver = { modelCall: (event) => models.push(event), toolCall: (event) => tools.push(event) };
  return { observer, models, tools };
}

function usageRecords(storage: ReturnType<typeof createInMemoryChatStorage>) {
  const records: UsageRecord[] = [];
  const insert = storage.insertUsageRecord.bind(storage);
  vi.spyOn(storage, "insertUsageRecord").mockImplementation(async (record) => {
    records.push(record);
    await insert(record);
  });
  return records;
}

describe("цикл помощника", () => {
  it("запрос помощника: его инструкция и инструменты, в сообщениях только задание — без истории чата", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода в Москве")] });
    const { service } = helperService({ model, helpers: { research: researchHelper() } });
    await askInNewChat(service, "узнай погоду, пожалуйста");
    const prompt = model.doGenerateCalls[0]!.prompt;
    expect(prompt[0]).toMatchObject({ role: "system", content: "Ты исследователь. Найди и коротко перескажи." });
    expect(prompt.slice(1)).toEqual([{ role: "user", content: [{ type: "text", text: "погода в Москве" }] }]);
    expect(promptJson(prompt)).not.toContain("узнай погоду, пожалуйста");
    expect(promptJson(prompt)).not.toContain("Ты помощник.");
  });

  it("основной агент получает итог помощника и продолжает ход", async () => {
    const model = helperChatModel({
      stream: [callsHelper("h1", "research", "погода")],
      generate: [searchStep("s1", "погода Москва"), helperText("В Москве +5")],
    });
    const { service } = helperService({ model, helpers: { research: researchHelper() } });
    const { chat } = await askInNewChat(service);
    const second = promptJson(model.doStreamCalls[1]!.prompt);
    expect(second).toContain("В Москве +5");
    expect(second).not.toContain("найдено: погода Москва");
    const answer = await lastAnswer(service, chat.id);
    expect(answer.metadata?.status).toBe("complete");
    expect(answer.parts.at(-1)).toMatchObject({ type: "text", text: "Готово" });
  });

  it("предел шагов — 10: последний шаг без вызовов и с пометкой «подведи итог»", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "копай")], generate: Array(20).fill(alwaysSearching) });
    const { service } = helperService({ model, helpers: { research: researchHelper() } });
    const { chat } = await askInNewChat(service);
    expect(model.doGenerateCalls).toHaveLength(10);
    const last = model.doGenerateCalls[9]!;
    expect(last.toolChoice).toEqual({ type: "none" });
    expect(promptJson(last.prompt)).toContain(LAST_STEP_NOTE);
    expect(helperPart((await lastAnswer(service, chat.id)).parts)!.output).toMatchObject({ status: "done", text: "Итог по шагам" });
  });

  it("свой предел шагов помощника (maxSteps)", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "копай")], generate: Array(20).fill(alwaysSearching) });
    const { service } = helperService({ model, helpers: { research: researchHelper({ maxSteps: 3 }) } });
    await askInNewChat(service);
    expect(model.doGenerateCalls).toHaveLength(3);
  });

  it("результат инструмента помощника режется пределом приложения", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "длинное")], generate: [searchStep("s1", "x")] });
    const helper = researchHelper({ tools: { search: searchTool(async () => "я".repeat(5000)) } });
    const { service } = helperService({ model, helpers: { research: helper }, extra: { agent: { toolResultMaxLength: { byTool: { search: 1000 } } } } });
    await askInNewChat(service);
    const second = promptJson(model.doGenerateCalls[1]!.prompt);
    expect(second).toContain("[Результат обрезан");
    expect(second).not.toContain("я".repeat(1001));
  });

  it("инструмент помощника не ответил за срок — помощник видит ошибку и продолжает", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "медленно")], generate: [searchStep("s1", "x")] });
    const helper = researchHelper({ tools: { search: searchTool(() => new Promise(() => {})) } });
    const { service } = helperService({ model, helpers: { research: helper }, extra: { agent: { toolTimeoutMs: { byTool: { search: 1000 } } } } });
    await askInNewChat(service);
    expect(promptJson(model.doGenerateCalls[1]!.prompt)).toContain("не ответил за 1 с");
  }, 10_000);

  it("сессия провайдера помощника — helper:<имя>:<владелец>, у основного агента — чат", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")] });
    const catalog = mockCatalog({ mock: model });
    const sessions: string[] = [];
    const provider = catalog.providers.find((item) => item.id === "mock")!;
    provider.requestOptions = ({ chatId }) => {
      sessions.push(chatId);
      return {};
    };
    const { service } = helperService({ model, helpers: { research: researchHelper() }, extra: { catalog } });
    const { chat } = await askInNewChat(service);
    expect(sessions).toContain("helper:research:anna");
    expect(sessions).toContain(chat.id);
  });

  it("два вызова помощника в разных чатах — побайтно одно начало запроса", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода"), answersDone(), callsHelper("h2", "research", "погода")] });
    const { service } = helperService({ model, helpers: { research: researchHelper() } });
    await askInNewChat(service, "первый чат");
    await askInNewChat(service, "второй чат", "u2");
    const [first, second] = model.doGenerateCalls;
    expect(second!.prompt).toEqual(first!.prompt);
    expect(second!.tools).toEqual(first!.tools);
    expect(JSON.stringify(second!.providerOptions)).toBe(JSON.stringify(first!.providerOptions));
  });

  it("провайдер помощника перегружен до ответа — шаг уходит резервному провайдеру", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: Array(4).fill(() => Promise.reject(overloaded())) });
    const backup = helperChatModel({ generate: [helperText("Ответ резервного")] });
    const { service } = helperService({ model, helpers: { research: researchHelper() }, extra: { catalog: mockCatalog({ mock: model, "mock-backup": backup }) } });
    const { chat } = await askInNewChat(service);
    expect(backup.doGenerateCalls).toHaveLength(1);
    expect(helperPart((await lastAnswer(service, chat.id)).parts)!.output).toMatchObject({ status: "done", text: "Ответ резервного" });
  });

  it.each([
    [402, "no", "insufficient_funds", "кончились деньги"],
    [401, "no", "invalid_key", "ключ не принят"],
    [403, '{"error":{"message":"Key limit exceeded (monthly limit).","metadata":{"limit_source":"openrouter_key_limit"}}}', "insufficient_funds", "исчерпан предел расходов ключа"],
  ] as const)("у провайдера помощника %i — сразу резервный, без повторов; строки журнала с причиной", async (statusCode, responseBody, kind, said) => {
    const refused = () =>
      Promise.reject(new APICallError({ message: String(statusCode), url: "https://p.test", requestBodyValues: {}, statusCode, responseBody, responseHeaders: {} }));
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: [refused] });
    const backup = helperChatModel({ generate: [helperText("Ответ резервного")] });
    const logged: string[] = [];
    const { service } = helperService({
      model,
      helpers: { research: researchHelper() },
      extra: { catalog: mockCatalog({ mock: model, "mock-backup": backup }), logError: (line) => logged.push(line) },
    });
    const { chat } = await askInNewChat(service);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(backup.doGenerateCalls).toHaveLength(1);
    expect(helperPart((await lastAnswer(service, chat.id)).parts)!.output).toMatchObject({ status: "done", text: "Ответ резервного" });
    expect(logged).toContain(`[запасной провайдер] чат=${chat.id} помощник=research модель=${mockModelId} с=mock на=mock-backup причина=${kind}`);
    expect(logged).toContain(`[ВНИМАНИЕ провайдер] mock: ${said} — ходы идут через запасной mock-backup`);
  });

  it("у провайдера помощника кончились деньги, резервного нет — помощник не справился с прежней причиной", async () => {
    const refused = () =>
      Promise.reject(new APICallError({ message: "402", url: "https://p.test", requestBodyValues: {}, statusCode: 402, responseBody: "no", responseHeaders: {} }));
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: [refused] });
    const { service } = helperService({ model, helpers: { research: researchHelper() } });
    const { chat } = await askInNewChat(service);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(helperPart((await lastAnswer(service, chat.id)).parts)!.output).toMatchObject({ status: "failed", error: "у провайдера модели кончились средства" });
  });
});

describe("ход помощника в ответе", () => {
  it("часть helper_<имя>: шаги, итог и статус; переживает сохранение и чтение истории", async () => {
    const model = helperChatModel({
      stream: [callsHelper("h1", "research", "погода")],
      generate: [searchStep("s1", "погода Москва"), helperText("В Москве +5")],
    });
    const { service, build, storage } = helperService({ model, helpers: { research: researchHelper() } });
    const { chat, chunks } = await askInNewChat(service);
    const preliminary = chunks.filter((chunk) => chunk.type === "tool-output-available" && (chunk as { preliminary?: boolean }).preliminary);
    expect(preliminary.length).toBeGreaterThan(0);
    const expected = {
      task: "погода",
      status: "done",
      text: "В Москве +5",
      steps: [
        { type: "tool", toolName: "search", input: { query: "погода Москва" }, output: "найдено: погода Москва" },
        { type: "text", text: "В Москве +5" },
      ],
    };
    expect(helperPart((await lastAnswer(service, chat.id)).parts)).toMatchObject({ state: "output-available", output: expected });
    // Новый экземпляр службы на той же базе видит то же.
    expect(helperPart((await lastAnswer(build(storage), chat.id)).parts)!.output).toMatchObject(expected);
  });

  it("результат шага в части обрезан до 2 КБ, модель основного агента видит только итог", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "длинное")], generate: [searchStep("s1", "x"), helperText("Коротко")] });
    const helper = researchHelper({ tools: { search: searchTool(async () => "ю".repeat(10_000)) } });
    const { service } = helperService({ model, helpers: { research: helper } });
    const { chat } = await askInNewChat(service);
    const output = helperPart((await lastAnswer(service, chat.id)).parts)!.output!;
    expect(JSON.stringify(output.steps[0].output).length).toBeLessThanOrEqual(2200);
    const second = promptJson(model.doStreamCalls[1]!.prompt);
    expect(second).toContain("Коротко");
    expect(second).not.toContain("ююю");
  });

  it("итог помощника для основного агента режется пределом результата инструмента", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "много")], generate: [helperText("щ".repeat(5000))] });
    const { service } = helperService({ model, helpers: { research: researchHelper() }, extra: { agent: { toolResultMaxLength: { byTool: { helper_research: 1000 } } } } });
    await askInNewChat(service);
    const second = promptJson(model.doStreamCalls[1]!.prompt);
    expect(second).toContain("[Результат обрезан");
    expect(second).not.toContain("щ".repeat(1001));
  });
});

describe("траты и лимит помощника", () => {
  it("каждый шаг — запись расхода source: helper на ответ основного агента", async () => {
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: [searchStep("s1", "x"), helperText("ok")] });
    const storage = createInMemoryChatStorage();
    const records = usageRecords(storage);
    const { service } = helperService({ model, storage, helpers: { research: researchHelper() } });
    const { chat } = await askInNewChat(service);
    const answer = await lastAnswer(service, chat.id);
    const helperRecords = records.filter((record) => record.source === "helper");
    expect(helperRecords).toHaveLength(2);
    for (const record of helperRecords) {
      expect(record).toMatchObject({ messageId: answer.id, chatId: chat.id, ownerId: "anna", modelId: mockModelId, providerId: "mock" });
    }
    expect(records.filter((record) => record.source === "answer")).toHaveLength(1);
  });

  it("лимит проверяется перед каждым шагом; исчерпан — модель основного агента получает «лимит исчерпан»", async () => {
    let checks = 0;
    const limits: SpendingLimits = {
      // 1 — до хода, 2 — до первого шага помощника, 3 — до второго.
      assertWithinLimit: vi.fn(async () => {
        checks += 1;
        if (checks >= 3) throw new SpendingLimitReachedError({ scope: "user", period: "month", resetsAt: null });
      }),
      status: vi.fn(async () => ({ state: "ok" as const })),
    };
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: [searchStep("s1", "x"), helperText("не дойдёт")] });
    const { service } = helperService({ model, helpers: { research: researchHelper() }, extra: { limits } });
    const { chat } = await askInNewChat(service);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(promptJson(model.doStreamCalls[1]!.prompt)).toContain("лимит исчерпан");
    expect(helperPart((await lastAnswer(service, chat.id)).parts)!.output).toMatchObject({ status: "failed" });
  });

  it("сбой провайдера помощника — «Помощник не справился: <причина>», ход продолжается", async () => {
    const failing = () =>
      Promise.reject(new APICallError({ message: "401", url: "https://p.test", requestBodyValues: {}, statusCode: 401, responseBody: "секретный текст провайдера" }));
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: [failing] });
    const { service } = helperService({ model, helpers: { research: researchHelper() }, extra: { logError: () => {} } });
    const { chat } = await askInNewChat(service);
    const second = promptJson(model.doStreamCalls[1]!.prompt);
    expect(second).toContain("Помощник не справился: ");
    expect(second).not.toContain("секретный текст провайдера");
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("complete");
  });

  it("«Стоп» останавливает помощника посреди работы; траты сделанных шагов записаны", async () => {
    let releaseSecond!: () => void;
    const secondStarted = new Promise<void>((resolve) => (releaseSecond = resolve));
    const model = helperChatModel({
      stream: [callsHelper("h1", "research", "долго")],
      generate: [
        searchStep("s1", "x"),
        (options) =>
          new Promise((_, reject) => {
            releaseSecond();
            options.abortSignal?.addEventListener("abort", () => reject(options.abortSignal!.reason));
          }),
      ],
    });
    const storage = createInMemoryChatStorage();
    const records = usageRecords(storage);
    const { service } = helperService({ model, storage, helpers: { research: researchHelper() } });
    const chat = await service.createChat("anna");
    const stream = await service.sendMessage("anna", chat.id, { id: "u1", role: "user", parts: [{ type: "text", text: "давай" }] });
    const reading = readAll(stream);
    await secondStarted;
    expect(await service.stop("anna", chat.id)).toBe(true);
    await reading;
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doStreamCalls).toHaveLength(1);
    expect(records.filter((record) => record.source === "helper")).toHaveLength(1);
    expect((await lastAnswer(service, chat.id)).metadata?.status).toBe("stopped");
  });
});

describe("наблюдатель хода видит помощника", () => {
  it("обращения помощника к модели — purpose: helper и messageId ответа; вызовы его инструментов — тоже", async () => {
    const { observer, models, tools } = recordingObserver();
    const model = helperChatModel({ stream: [callsHelper("h1", "research", "погода")], generate: [searchStep("s1", "x"), helperText("ok")] });
    const { service } = helperService({ model, helpers: { research: researchHelper() }, extra: { turnObserver: observer } });
    const { chat } = await askInNewChat(service);
    const answer = await lastAnswer(service, chat.id);
    const helperCalls = models.filter((event) => event.purpose === "helper");
    expect(helperCalls).toHaveLength(2);
    for (const event of helperCalls) expect(event).toMatchObject({ chatId: chat.id, ownerId: "anna", messageId: answer.id, status: "complete" });
    expect(helperCalls[0]!.request.instructions).toMatchObject({ content: "Ты исследователь. Найди и коротко перескажи." });
    expect(tools.find((event) => event.toolName === "search")).toMatchObject({ messageId: answer.id, input: { query: "x" } });
    expect(tools.find((event) => event.toolName === "helper_research")).toMatchObject({ messageId: answer.id });
  });
});

describe("runHelper для пакета фона", () => {
  function direct(model: ReturnType<typeof helperChatModel>, helper = researchHelper()) {
    const catalog = mockCatalog({ mock: model });
    const storage = createInMemoryChatStorage();
    const records = usageRecords(storage);
    const profile = catalog.models.find((item) => item.id === mockModelId)!;
    const toolsModel = helperToolsModel(
      { profile, providerId: "mock", chatId: "c1", ownerId: "anna", place: null, notifyDataChanged: () => {} },
      { storage, catalog, env: mockEnv, chatId: "c1", ownerId: "anna", messageId: null, usageSource: "background", logError: () => {} },
    );
    const steps: HelperStepReport[] = [];
    const run = (extra: Partial<Parameters<typeof runHelper>[0]> = {}) =>
      runHelper({ name: "research", helper, task: "погода", model: toolsModel, onStep: async (step) => void steps.push(step), abortSignal: new AbortController().signal, ...extra });
    return { run, steps, records };
  }

  it("экспортируется из index", () => {
    expect(runHelperFromIndex).toBe(runHelper);
  });

  it("done: onStep после каждого шага, траты source: background, итог и сообщения", async () => {
    const model = helperChatModel({ generate: [searchStep("s1", "Москва"), helperText("+5")] });
    const { run, steps, records } = direct(model);
    const result = await run();
    expect(result).toMatchObject({ status: "done", text: "+5" });
    expect(steps).toHaveLength(2);
    expect(steps[0]!.progress).toMatchObject({ status: "running", steps: [{ type: "tool", toolName: "search", output: "найдено: Москва" }] });
    expect(steps[1]!.progress).toMatchObject({ status: "done", text: "+5" });
    expect(steps[1]!.messages).toEqual(result.messages);
    expect(result.messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(records.map((record) => record.source)).toEqual(["background", "background"]);
    expect(records[0]).toMatchObject({ chatId: "c1", ownerId: "anna", messageId: null });
  });

  it("priorMessages: цикл продолжается с сохранённых шагов, старые шаги не повторяются и не оплачиваются", async () => {
    const first = helperChatModel({ generate: [searchStep("s1", "Москва"), helperText("+5")] });
    const { run: runFirst, steps } = direct(first);
    await runFirst();
    const saved = steps[0]!.messages;
    const second = helperChatModel({ generate: [helperText("+5 после перезапуска")] });
    const { run, records } = direct(second);
    const result = await run({ priorMessages: saved });
    expect(second.doGenerateCalls).toHaveLength(1);
    expect(JSON.stringify(second.doGenerateCalls[0]!.prompt)).toContain("найдено: Москва");
    expect(result).toMatchObject({ status: "done", text: "+5 после перезапуска" });
    expect(result.messages.slice(0, saved.length)).toEqual(saved);
    expect(records).toHaveLength(1);
  });

  it("предел шагов считает и сохранённые шаги", async () => {
    const first = helperChatModel({ generate: [searchStep("s1", "a"), searchStep("s2", "b")] });
    const { run: runFirst, steps } = direct(first, researchHelper({ maxSteps: 3 }));
    await runFirst();
    const saved = steps[1]!.messages;
    const second = helperChatModel({ generate: [helperText("итог")] });
    const { run } = direct(second, researchHelper({ maxSteps: 3 }));
    await run({ priorMessages: saved });
    expect(second.doGenerateCalls).toHaveLength(1);
    expect(second.doGenerateCalls[0]!.toolChoice).toEqual({ type: "none" });
  });

  it("помощник зовёт инструмент и на последнем шаге вопреки запрету: инструмент не выполнен, вызов закрыт отказом", async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => `найдено: ${query}`);
    const model = helperChatModel({ generate: [searchStep("s1", "a"), searchStep("s2", "b"), searchStep("s3", "c")] });
    const { run } = direct(model, researchHelper({ maxSteps: 3, tools: { search: searchTool(execute) } }));
    const result = await run();
    expect(execute.mock.calls.map(([input]) => input.query)).toEqual(["a", "b"]);
    expect(promptJson(result.messages as LanguageModelV4Prompt)).toContain(LAST_STEP_TOOL_REFUSAL);
    expect(result.status).toBe("done");
  });

  it("вызов с подтверждением на последнем шаге помощника: подтверждения не спрашивают, инструмент не выполнен", async () => {
    const execute = vi.fn(async ({ query }: { query: string }) => `сделано: ${query}`);
    const book = tool({ description: "Бронь", inputSchema: z.object({ query: z.string() }), needsApproval: true, execute });
    const model = helperChatModel({ generate: [helperCalls({ id: "b1", toolName: "book", input: { query: "10:00" } })] });
    const { run } = direct(model, researchHelper({ maxSteps: 1, tools: { book } }));
    expect((await run()).status).toBe("awaiting_approval");

    const last = helperChatModel({ generate: [searchStep("s1", "a"), helperCalls({ id: "b1", toolName: "book", input: { query: "10:00" } })] });
    const { run: runLast } = direct(last, researchHelper({ maxSteps: 2, tools: { search: searchTool(), book } }));
    const result = await runLast();
    expect(result.status).toBe("done");
    expect(execute).not.toHaveBeenCalled();
    expect(promptJson(result.messages as LanguageModelV4Prompt)).toContain(LAST_STEP_TOOL_REFUSAL);
  });

  it("failed: сбой провайдера — статус failed с понятной причиной", async () => {
    const failing = () =>
      Promise.reject(new APICallError({ message: "401", url: "https://p.test", requestBodyValues: {}, statusCode: 401, responseBody: "нет" }));
    const { run } = direct(helperChatModel({ generate: [failing] }));
    const result = await run();
    expect(result.status).toBe("failed");
    expect(result.text).not.toBe("");
  });

  it("awaiting_approval: опасный инструмент — цикл встаёт, в сообщениях запрос подтверждения", async () => {
    const execute = vi.fn(async () => "удалено");
    const remove = tool({ description: "Удалить", inputSchema: z.object({ path: z.string() }), needsApproval: true, execute });
    const model = helperChatModel({ generate: [helperCalls({ id: "r1", toolName: "remove", input: { path: "a" } })] });
    const { run, steps } = direct(model, researchHelper({ tools: { remove } }));
    const result = await run();
    expect(result.status).toBe("awaiting_approval");
    expect(execute).not.toHaveBeenCalled();
    expect(JSON.stringify(result.messages)).toContain("tool-approval-request");
    expect(steps.at(-1)!.progress).toMatchObject({ status: "awaiting_approval", pendingApproval: { toolName: "remove", input: { path: "a" } } });
  });

  it("модель не от службы — ошибка", async () => {
    const catalog = mockCatalog({ mock: helperChatModel() });
    const profile = catalog.models.find((item) => item.id === mockModelId)!;
    await expect(
      runHelper({
        name: "research",
        helper: researchHelper(),
        task: "x",
        model: { profile, providerId: "mock", chatId: "c1", ownerId: "anna", place: null, notifyDataChanged: () => {} },
        onStep: async () => {},
        abortSignal: new AbortController().signal,
      }),
    ).rejects.toThrow();
  });
});

describe("чужой текст у помощника (043, выключатель живых демонстраций)", () => {
  const webSearch = () => tool({ ...searchTool(), metadata: { externalContent: true } });

  it("помощник вызвал инструмент с пометкой: итог помощника несёт externalContent, чат — тоже, клиент узнаёт до ответа", async () => {
    const model = helperChatModel({
      stream: [callsHelper("h1", "research", "погода")],
      generate: [searchStep("s1", "погода Москва"), helperText("В Москве +5")],
    });
    const { service } = helperService({ model, helpers: { research: researchHelper({ tools: { search: webSearch() } }) }, extra: { agent: { liveDemos: true } } });
    const { chat, chunks } = await askInNewChat(service);
    expect(helperPart((await lastAnswer(service, chat.id)).parts)?.output).toMatchObject({ status: "done", externalContent: true });
    const types = chunks.map((chunk) => chunk.type);
    expect(types).toContain("data-external-content");
    expect(types.indexOf("data-external-content")).toBeLessThan(types.lastIndexOf("text-delta"));
    expect((await service.getHistory("anna", chat.id)).externalContent).toBe(true);
  });

  it("помощник без инструментов с пометкой — признака нет; модели основного агента он не идёт", async () => {
    const model = helperChatModel({
      stream: [callsHelper("h1", "research", "погода")],
      generate: [searchStep("s1", "погода Москва"), helperText("В Москве +5")],
    });
    const { service } = helperService({ model, helpers: { research: researchHelper() } });
    const { chat } = await askInNewChat(service);
    expect(helperPart((await lastAnswer(service, chat.id)).parts)?.output).not.toHaveProperty("externalContent");
    expect((await service.getHistory("anna", chat.id)).externalContent).toBeUndefined();
    expect(promptJson(model.doStreamCalls[1]!.prompt)).not.toContain("externalContent");
  });
});
