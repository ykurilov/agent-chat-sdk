import { jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundTool } from "../src/index";
import { calling, createGate, noticesIn, openCopy, rolesOf, saying, scriptedModel, sharedStorage } from "./support/chat-server";
import type { ChatServerCopy, StreamPart } from "./support/chat-server";

/** T069: две копии службы чата на одной базе задач — ни двойного выполнения, ни двойной доставки. Настоящие часы. */
const CHATS = 4;
const LEASE_MS = 3_000;

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** Работа на обе копии: держится до `release`, отмена обрывает её; счёт законченных запусков по номеру отчёта. */
function createWork() {
  const started: number[] = [];
  const completed: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const definition = backgroundTool({
    description: "Считает отчёт",
    inputSchema: jsonSchema<{ n: number }>({ type: "object", properties: { n: { type: "number" } }, required: ["n"] }),
    title: (input) => `Отчёт ${input.n}`,
    rerunAfterRestart: true,
    async run(input, { signal }) {
      started.push(input.n);
      await Promise.race([gate, new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))]);
      completed.push(input.n);
      return `отчёт ${input.n} готов`;
    },
  });
  return { definition, started, completed, release };
}

/** Модель копии: на «#отчёт N» вызывает инструмент, на остальное отвечает текстом. */
function reportingModel() {
  return new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const last = prompt.at(-1);
      const text = last?.role === "user" ? last.content.map((part) => (part.type === "text" ? part.text : "")).join("") : "";
      const n = /#отчёт (\d+)/.exec(text)?.[1];
      const parts: StreamPart[] = n === undefined ? saying("ок") : calling({ id: `c${n}`, name: "build_report", input: { n: Number(n) } });
      return { stream: new ReadableStream<StreamPart>({ start: (controller) => (parts.forEach((part) => controller.enqueue(part)), controller.close()) }) };
    },
  });
}

async function twoCopies(work: ReturnType<typeof createWork>) {
  const shared = sharedStorage();
  cleanups.push(shared.close);
  const copies: ChatServerCopy[] = [];
  for (let index = 0; index < 2; index += 1) {
    const copy = await openCopy({ storage: shared.storage, store: shared.openStore(), model: reportingModel(), tools: { build_report: work.definition }, leaseMs: LEASE_MS, maxRunningPerUser: CHATS });
    cleanups.push(() => copy.service.flush());
    copies.push(copy);
  }
  return copies;
}

/** Чат `n` начат на копии `n % 2`: в нём задача «Отчёт n». */
async function startReports(copies: ChatServerCopy[], work: ReturnType<typeof createWork>): Promise<string[]> {
  const chats: string[] = [];
  for (let n = 0; n < CHATS; n += 1) {
    const copy = copies[n % 2]!;
    const chatId = (await copy.service.createChat("anna")).id;
    await copy.ask(chatId, `u${n}`, `#отчёт ${n}`);
    chats.push(chatId);
  }
  await vi.waitFor(() => expect(work.started).toHaveLength(CHATS));
  return chats;
}

/** В каждом чате ровно одно служебное сообщение со своим итогом и один ход агента после него; каждый отчёт досчитан один раз. */
async function expectEachOnce(reader: ChatServerCopy, chats: string[], work: ReturnType<typeof createWork>) {
  await vi.waitFor(
    async () => {
      for (const chatId of chats) expect(rolesOf(await reader.history(chatId))).toEqual(["user", "assistant", "notice", "assistant"]);
    },
    { timeout: 10_000, interval: 50 },
  );
  for (const [n, chatId] of chats.entries()) {
    expect(noticesIn(await reader.history(chatId))).toEqual([[expect.objectContaining({ kind: "task_done", title: `Отчёт ${n}`, result: `отчёт ${n} готов` })]]);
  }
  expect([...work.completed].sort()).toEqual([...Array(CHATS).keys()]);
}

describe("T069: две копии службы на одной базе", { timeout: 20_000 }, () => {
  it("обе работают: каждая ведёт и доставляет свои задачи по одному разу", async () => {
    const work = createWork();
    const copies = await twoCopies(work);
    const chats = await startReports(copies, work);
    work.release();
    await expectEachOnce(copies[0]!, chats, work);
    expect(work.started.sort()).toEqual([...Array(CHATS).keys()]);
    for (const copy of copies) expect(copy.errors).toEqual([]);
  });

  it("одна копия остановилась посреди работы — другая доделывает её задачи, итог и доставка по одному разу", async () => {
    const work = createWork();
    const copies = await twoCopies(work);
    const chats = await startReports(copies, work);
    await copies[0]!.service.flush();
    work.release();
    await expectEachOnce(copies[1]!, chats, work);
    // Обрывались только запуски остановленной копии: их задачи начаты второй раз, досчитаны один.
    expect(work.started.filter((n) => n % 2 === 0)).toHaveLength(CHATS);
    expect(copies[1]!.errors).toEqual([]);
  });
});

describe("итог готов, пока в чате идёт ход на другой копии", { timeout: 20_000 }, () => {
  it("доставка ждёт конца чужого хода и приходит после него: ветка одна, ходы не наложились", async () => {
    const work = createWork();
    const shared = sharedStorage();
    cleanups.push(shared.close);
    const gate = createGate();
    const open = async (model: MockLanguageModelV4) => {
      const copy = await openCopy({ storage: shared.storage, store: shared.openStore(), model, tools: { build_report: work.definition }, leaseMs: LEASE_MS });
      cleanups.push(() => copy.service.flush());
      return copy;
    };
    const a = await open(scriptedModel({ stream: [calling({ id: "c1", name: "build_report", input: { n: 1 } })] }));
    const b = await open(scriptedModel({ stream: [gate.after(saying("подумал"))] }));
    const chatId = (await a.service.createChat("anna")).id;
    await a.ask(chatId, "u1", "#отчёт 1");
    await vi.waitFor(() => expect(work.started).toEqual([1]));
    // Человек пишет через копию B; её ход ждёт ворот. Тем временем отчёт на копии A готов.
    const turn = await b.askAndKeep(chatId, "u2", "ещё вопрос");
    work.release();
    await vi.waitFor(() => expect(work.completed).toEqual([1]));
    // Несколько обходов доставки копии A: чат занят чужим ходом, ничего не дописано.
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS));
    expect(rolesOf(await a.history(chatId))).toEqual(["user", "assistant", "user", "assistant"]);
    gate.open();
    await turn.done;
    await vi.waitFor(async () => expect(rolesOf(await a.history(chatId))).toEqual(["user", "assistant", "user", "assistant", "notice", "assistant"]), {
      timeout: 10_000,
      interval: 50,
    });
    const history = await a.history(chatId);
    expect(history[3]!.parts).toContainEqual(expect.objectContaining({ type: "text", text: "подумал" }));
    for (const copy of [a, b]) expect(copy.errors).toEqual([]);
  });
});
