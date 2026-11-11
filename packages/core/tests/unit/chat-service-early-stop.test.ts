import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BeforeTurnHandler } from "../../src/index";
import { STOP_REQUESTS_CHECK_EVERY_MS, createChatService } from "../../src/chat-service";
import { createInMemoryChatStorage } from "../../src/storage/in-memory-storage";
import type { ChatStorage } from "../../src/storage/chat-storage";
import { finishPart, mockCatalog, mockEnv, mockModel, mockModelId, readAll, streamOf, streamStart, textParts } from "./support/mock-model";

/*
 * Ранний «Стоп»: человек нажал «Стоп» сразу после отправки, и запрос остановки пришёл раньше, чем служба начала ход, —
 * в том числе на другую копию сервера. Остановка привязана к id запроса хода (`page.turnRequestId`): ход именно этого
 * запроса останавливается, как бы ни легли запросы, а следующий вопрос — нет.
 */

const user = (id: string, text = "Привет") => ({ id, role: "user" as const, parts: [{ type: "text" as const, text }] });

/** Модель: пока `holding`, ответ держится до остановки хода; иначе отвечает сразу. */
function holdingModel() {
  const state = { holding: false, calls: 0 };
  const model = new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => {
      state.calls += 1;
      const hold = state.holding;
      return {
        stream: new ReadableStream<LanguageModelV4StreamPart>({
          start(controller) {
            for (const part of [streamStart, ...textParts(["Ок"])]) controller.enqueue(part);
            if (!hold) {
              controller.enqueue(finishPart());
              controller.close();
              return;
            }
            abortSignal?.addEventListener("abort", () => controller.error(abortSignal.reason));
          },
        }),
      };
    },
  });
  return { model, state };
}

/** Копия сервера на общем хранилище. */
function serverCopy(storage: ChatStorage, model: MockLanguageModelV4, extra: Partial<Parameters<typeof createChatService>[0]> = {}) {
  return createChatService({
    storage,
    catalog: mockCatalog({ mock: model }),
    defaultChoice: { modelId: mockModelId, providerId: "mock" },
    agent: { instructions: "Ты помощник." },
    compaction: false,
    env: mockEnv,
    logError: () => {},
    ...extra,
  });
}

const lastAnswer = async (storage: ChatStorage, chatId: string) => (await storage.listMessages(chatId)).filter((message) => message.role === "assistant").at(-1);

afterEach(() => {
  vi.useRealTimers();
});

describe("ранний «Стоп» по id запроса хода", () => {
  it("«Стоп» пришёл раньше отправки: ход этого запроса останавливается сразу после старта", async () => {
    const storage = createInMemoryChatStorage();
    const { model } = holdingModel();
    const service = serverCopy(storage, model);
    const chat = await service.createChat("anna");
    expect(await service.stop("anna", chat.id, { turnRequestId: "turn-1" })).toBe(true);
    await readAll(await service.sendMessage("anna", chat.id, user("u1"), { page: { turnRequestId: "turn-1" } }));
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped" });
  });

  it("«Стоп» пришёл, пока запрос на проверках до хода (до занятия чата): ход останавливается", async () => {
    const storage = createInMemoryChatStorage();
    const { model } = holdingModel();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const beforeTurn = vi.fn<BeforeTurnHandler>(() => held.then(() => undefined));
    const service = serverCopy(storage, model, { beforeTurn });
    const chat = await service.createChat("anna");
    const sending = service.sendMessage("anna", chat.id, user("u1"), { page: { turnRequestId: "turn-1" } });
    await vi.waitFor(() => expect(beforeTurn).toHaveBeenCalledTimes(1));
    expect(await service.stop("anna", chat.id, { turnRequestId: "turn-1" })).toBe(true);
    release();
    await readAll(await sending);
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped" });
  });

  it("отправка на одной копии, «Стоп» раньше неё на другой: ход останавливается", async () => {
    const storage = createInMemoryChatStorage();
    const { model } = holdingModel();
    const first = serverCopy(storage, model);
    const second = serverCopy(storage, model);
    const chat = await first.createChat("anna");
    expect(await second.stop("anna", chat.id, { turnRequestId: "turn-1" })).toBe(true);
    await readAll(await first.sendMessage("anna", chat.id, user("u1"), { page: { turnRequestId: "turn-1" } }));
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped" });
  });

  it("ход идёт на одной копии, «Стоп» пришёл на другую: ход останавливается на ближайшей проверке", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const storage = createInMemoryChatStorage();
    const { model, state } = holdingModel();
    const first = serverCopy(storage, model);
    const second = serverCopy(storage, model);
    const chat = await first.createChat("anna");
    state.holding = true;
    const running = await first.sendMessage("anna", chat.id, user("u1"), { page: { turnRequestId: "turn-1" } });
    const reading = readAll(running);
    await vi.waitFor(() => expect(state.calls).toBe(1));
    expect(await second.stop("anna", chat.id, { turnRequestId: "turn-1" })).toBe(true);
    await vi.advanceTimersByTimeAsync(STOP_REQUESTS_CHECK_EVERY_MS);
    await reading;
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped" });
  });

  it("«Стоп» прошлого запроса не останавливает следующий вопрос — ни запоздавший, ни пришедший во время нового хода", async () => {
    const storage = createInMemoryChatStorage();
    const { model, state } = holdingModel();
    const service = serverCopy(storage, model);
    const chat = await service.createChat("anna");
    await readAll(await service.sendMessage("anna", chat.id, user("u1"), { page: { turnRequestId: "turn-1" } }));
    // Запоздавший «Стоп» первого хода: тот уже кончился.
    await service.stop("anna", chat.id, { turnRequestId: "turn-1" });
    await readAll(await service.sendMessage("anna", chat.id, user("u2"), { page: { turnRequestId: "turn-2" } }));
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "complete" });
    // «Стоп» первого хода, пока идёт третий: третий идёт дальше, его собственный «Стоп» — останавливает.
    state.holding = true;
    const reading = readAll(await service.sendMessage("anna", chat.id, user("u3"), { page: { turnRequestId: "turn-3" } }));
    await vi.waitFor(() => expect(state.calls).toBe(3));
    await service.stop("anna", chat.id, { turnRequestId: "turn-1" });
    expect((await service.getHistory("anna", chat.id)).running).toBe(true);
    expect(await service.stop("anna", chat.id, { turnRequestId: "turn-3" })).toBe(true);
    await reading;
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "stopped" });
  });

  it("ранний «Стоп» на другой копии не цепляется к новому вопросу с другим id", async () => {
    const storage = createInMemoryChatStorage();
    const { model } = holdingModel();
    const first = serverCopy(storage, model);
    const second = serverCopy(storage, model);
    const chat = await first.createChat("anna");
    await second.stop("anna", chat.id, { turnRequestId: "turn-1" });
    await readAll(await first.sendMessage("anna", chat.id, user("u1"), { page: { turnRequestId: "turn-2" } }));
    expect(await lastAnswer(storage, chat.id)).toMatchObject({ status: "complete" });
  });
});

/*
 * «Стоп» относится к ответу, на котором его нажали. Ответ на поправки — новый ответ со своим id запроса (id последней
 * поправки): «Стоп» прежнего ответа его не трогает, на какой бы копии «Стоп» ни приняли, а «Стоп» с его id —
 * останавливает, даже если пришёл в окне перехода к поправкам, раньше старта продолжения.
 */
describe("«Стоп» по id и продолжение на поправки", () => {
  /** Ход: модель зовёт инструмент `build`, он идёт, пока его не отпустят или не остановят; дальше модель отвечает «Учёл». */
  function steeringCopies() {
    let release!: () => void;
    let markStarted!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const build = tool({
      description: "Собрать сайт",
      inputSchema: z.object({}),
      execute: async (_input, { abortSignal }) => {
        markStarted();
        await Promise.race([released, new Promise((resolve) => abortSignal?.addEventListener("abort", resolve))]);
        return "собрано";
      },
    });
    let calls = 0;
    const model = mockModel(() =>
      streamOf(
        calls++ === 0
          ? [streamStart, { type: "tool-call", toolCallId: "c1", toolName: "build", input: "{}" }, finishPart("tool-calls")]
          : [streamStart, ...textParts(["Учёл"]), finishPart()],
      ),
    );
    /** Первое чтение чата после `holdHandOff` ждёт: переход к поправкам (он читает чат первым) стоит в своём окне. */
    let hold: { reached: () => void; opened: Promise<void> } | null = null;
    const inner = createInMemoryChatStorage();
    const storage: ChatStorage = Object.assign(Object.create(inner) as ChatStorage, {
      getChat: async (chatId: string) => {
        const held = hold;
        hold = null;
        if (held) {
          held.reached();
          await held.opened;
        }
        return inner.getChat(chatId);
      },
    });
    const copy = () =>
      createChatService({
        storage,
        catalog: mockCatalog({ mock: model }),
        defaultChoice: { modelId: mockModelId, providerId: "mock" },
        agent: { instructions: "Ты помощник.", tools: { build } },
        compaction: false,
        env: mockEnv,
        logError: () => {},
      });
    /** Держит переход к поправкам: `reached` — он встал в окне, `open` — отпустить. */
    const holdHandOff = () => {
      let open!: () => void;
      let reached!: () => void;
      const reachedWindow = new Promise<void>((resolve) => (reached = resolve));
      hold = { reached, opened: new Promise<void>((resolve) => (open = resolve)) };
      return { reached: reachedWindow, open };
    };
    return { first: copy(), second: copy(), storage, started, release, holdHandOff };
  }

  const statuses = async (storage: ChatStorage, chatId: string) =>
    (await storage.listMessages(chatId)).filter((message) => message.role === "assistant").map((message) => message.status);

  async function nextTurn(service: ReturnType<typeof serverCopy>, chatId: string) {
    const stream = await service.subscribe("anna", chatId);
    if (stream) await readAll(stream);
  }

  it("«Стоп» ответа пришёл на другую копию: ответ остановлен, продолжение на поправку идёт — как на своей копии", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { first, second, storage, started } = steeringCopies();
    const chat = await first.createChat("anna");
    const answering = readAll(await first.sendMessage("anna", chat.id, user("u1", "сделай сайт"), { page: { turnRequestId: "turn-1" } }));
    await started;
    await first.steer("anna", chat.id, user("p1", "синим"), { page: { turnRequestId: "turn-p1" } });
    expect(await second.stop("anna", chat.id, { turnRequestId: "turn-1" })).toBe(true);
    await vi.advanceTimersByTimeAsync(STOP_REQUESTS_CHECK_EVERY_MS);
    await answering;
    await nextTurn(first, chat.id);
    await vi.waitFor(async () => expect(await statuses(storage, chat.id)).toEqual(["stopped", "complete"]));
  });

  it("«Стоп» ответа в окне перехода к поправкам — на своей и на другой копии: продолжение идёт", async () => {
    for (const where of ["своя", "другая"] as const) {
      const { first, second, storage, started, release, holdHandOff } = steeringCopies();
      const chat = await first.createChat("anna");
      const answering = readAll(await first.sendMessage("anna", chat.id, user("u1", "сделай сайт"), { page: { turnRequestId: "turn-1" } }));
      await started;
      await first.steer("anna", chat.id, user("p1", "синим"), { page: { turnRequestId: "turn-p1" } });
      const handOff = holdHandOff();
      release();
      await answering;
      await handOff.reached;
      expect(await (where === "своя" ? first : second).stop("anna", chat.id, { turnRequestId: "turn-1" })).toBe(true);
      handOff.open();
      await nextTurn(first, chat.id);
      await vi.waitFor(async () => expect(await statuses(storage, chat.id), where).toEqual(["complete", "complete"]));
    }
  });

  it("«Стоп» продолжения (id поправки) в окне перехода, раньше его старта: продолжение остановлено", async () => {
    const { first, storage, started, release, holdHandOff } = steeringCopies();
    const chat = await first.createChat("anna");
    const answering = readAll(await first.sendMessage("anna", chat.id, user("u1", "сделай сайт"), { page: { turnRequestId: "turn-1" } }));
    await started;
    await first.steer("anna", chat.id, user("p1", "синим"), { page: { turnRequestId: "turn-p1" } });
    const handOff = holdHandOff();
    release();
    await answering;
    await handOff.reached;
    expect(await first.stop("anna", chat.id, { turnRequestId: "turn-p1" })).toBe(true);
    handOff.open();
    await nextTurn(first, chat.id);
    await vi.waitFor(async () => expect(await statuses(storage, chat.id)).toEqual(["complete", "stopped"]));
  });
});
