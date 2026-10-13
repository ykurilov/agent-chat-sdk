import { APICallError, readUIMessageStream } from "ai";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";
import {
  AUTO_CONTINUE_NOTE,
  autoContinueNoteMessage,
  autoContinuePauseMs,
  closingChunksForHangingCalls,
  createOpenPartsTracker,
  createSeamJoiner,
  hasAnswerContent,
  messageForAutoContinue,
  needsLineBreak,
  partsLeftOutOfAutoContinue,
  UNSENT_TOOL_CALL_REASON,
} from "../../../src/agent-run/auto-continue";
import { HANGING_TOOL_CALL_REASON } from "../../../src/tool-approval/approval-parts";
import type { AgentChatMessage } from "../../../src/conversation/types";

type Part = AgentChatMessage["parts"][number];
const part = (value: Record<string, unknown>): Part => value as never;
const answer = (parts: Part[]): AgentChatMessage => ({ id: "a1", role: "assistant", parts });

/** Сообщение, которое соберут клиент и сохранение из кусков. */
async function assembled(chunks: UIMessageChunk[]): Promise<Part[]> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  let last: AgentChatMessage | undefined;
  for await (const message of readUIMessageStream<AgentChatMessage>({ stream, onError: (error) => { throw error; } })) last = message;
  return last?.parts ?? [];
}

describe("AUTO_CONTINUE_NOTE (FR-039)", () => {
  it("текст пометки дословно по spec", () => {
    expect(AUTO_CONTINUE_NOTE).toBe(
      "Ответ прервался из-за сбоя связи с моделью. Продолжи с того места, где оборвался текст выше: не повторяй уже написанное и не вызывай заново инструменты, у которых есть результат",
    );
  });
});

describe("messageForAutoContinue: что из оборванного ответа идёт в запрос продолжения (FR-039)", () => {
  const finishedCall = part({ type: "tool-lookup", toolCallId: "c1", state: "output-available", input: { q: "a" }, output: "найдено" });

  it("законченные вызовы и недописанный текст идут как есть", () => {
    const parts = [
      part({ type: "step-start" }),
      finishedCall,
      part({ type: "step-start" }),
      part({ type: "text", text: "Нашёл, теперь пиш", state: "streaming" }),
    ];
    expect(messageForAutoContinue(answer(parts))).toEqual(answer(parts));
  });

  it("недописанное рассуждение в конце выброшено: у него нет подписи провайдера", () => {
    const parts = [
      part({ type: "step-start" }),
      finishedCall,
      part({ type: "step-start" }),
      part({ type: "reasoning", text: "думаю, как отв", state: "streaming" }),
    ];
    expect(messageForAutoContinue(answer(parts)).parts).toEqual(parts.slice(0, 3));
  });

  it("законченное рассуждение остаётся", () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "reasoning", text: "думаю", state: "done", providerMetadata: { mock: { signature: "s" } } }),
      part({ type: "text", text: "Нача", state: "streaming" }),
    ];
    expect(messageForAutoContinue(answer(parts)).parts).toEqual(parts);
  });

  it("недописанные аргументы вызова (input-streaming) выброшены", () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "text", text: "Ищу", state: "done" }),
      part({ type: "tool-lookup", toolCallId: "c2", state: "input-streaming", input: { q: "ча" } }),
    ];
    expect(messageForAutoContinue(answer(parts)).parts).toEqual(parts.slice(0, 2));
  });

  it("сообщение на входе не меняется", () => {
    const parts = [part({ type: "reasoning", text: "ду", state: "streaming" })];
    const message = answer(parts);
    messageForAutoContinue(message);
    expect(message.parts).toHaveLength(1);
  });

  it("partsLeftOutOfAutoContinue — номера выброшенных частей", () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "tool-lookup", toolCallId: "c2", state: "input-streaming", input: {} }),
      part({ type: "reasoning", text: "ду", state: "streaming" }),
    ];
    expect(partsLeftOutOfAutoContinue(parts)).toEqual([1, 2]);
  });
});

describe("createOpenPartsTracker: закрывающие куски для незакрытых текста и рассуждения (FR-040)", () => {
  it("text-end и reasoning-end по id незакрытых частей; закрытые не повторяются", () => {
    const tracker = createOpenPartsTracker();
    const chunks: UIMessageChunk[] = [
      { type: "reasoning-start", id: "r0" },
      { type: "reasoning-delta", id: "r0", delta: "думаю" },
      { type: "reasoning-end", id: "r0" },
      { type: "text-start", id: "t0" },
      { type: "text-delta", id: "t0", delta: "Готово" },
      { type: "text-end", id: "t0" },
      { type: "reasoning-start", id: "r1" },
      { type: "text-start", id: "t1" },
    ];
    for (const chunk of chunks) tracker.observe(chunk);

    expect(tracker.closingChunks()).toEqual([
      { type: "reasoning-end", id: "r1" },
      { type: "text-end", id: "t1" },
    ]);
    // Закрытое закрыто: второй раз кусков нет.
    expect(tracker.closingChunks()).toEqual([]);
  });

  it("закрывающие куски и куски продолжения собираются в ответ без повтора начала, все части закрыты", async () => {
    const tracker = createOpenPartsTracker();
    const broken: UIMessageChunk[] = [
      { type: "start", messageId: "a1" },
      { type: "start-step" },
      { type: "reasoning-start", id: "r0" },
      { type: "reasoning-delta", id: "r0", delta: "думаю" },
      { type: "text-start", id: "t0" },
      { type: "text-delta", id: "t0", delta: "Начало отв" },
    ];
    for (const chunk of broken) tracker.observe(chunk);
    // Продолжение — новые части, у провайдера те же id частей.
    const continuation: UIMessageChunk[] = [
      { type: "start-step" },
      { type: "text-start", id: "t0" },
      { type: "text-delta", id: "t0", delta: "ета и конец." },
      { type: "text-end", id: "t0" },
      { type: "finish-step" },
      { type: "finish" },
    ];

    const parts = await assembled([...broken, ...tracker.closingChunks(), ...continuation]);

    expect(parts.map(({ type, ...rest }) => ({ type, ..."text" in rest && { text: rest.text, state: rest.state } }))).toEqual([
      { type: "step-start" },
      { type: "reasoning", text: "думаю", state: "done" },
      { type: "text", text: "Начало отв", state: "done" },
      { type: "step-start" },
      { type: "text", text: "ета и конец.", state: "done" },
    ]);
  });
});

describe("autoContinuePauseMs: пауза перед продолжением (FR-038)", () => {
  it("2 с перед первым, 5 с перед вторым, плюс разброс до 25%", () => {
    expect(autoContinuePauseMs({ index: 0, error: new Error("сбой"), random: () => 0 })).toBe(2_000);
    expect(autoContinuePauseMs({ index: 0, error: new Error("сбой"), random: () => 0.5 })).toBe(2_250);
    expect(autoContinuePauseMs({ index: 1, error: new Error("сбой"), random: () => 0.99 })).toBe(Math.round(5_000 * (1 + 0.99 * 0.25)));
  });

  const busy = (headers: Record<string, string>) =>
    new APICallError({ message: "ответ 503", url: "https://provider.test", requestBodyValues: {}, statusCode: 503, responseHeaders: headers });

  it("retry-after длиннее расписания удлиняет паузу, но не больше 10 с", () => {
    expect(autoContinuePauseMs({ index: 0, error: busy({ "retry-after": "3" }), random: () => 0.9 })).toBe(3_000);
    expect(autoContinuePauseMs({ index: 1, error: busy({ "retry-after": "30" }), random: () => 0 })).toBe(10_000);
  });

  it("retry-after короче расписания паузу не сокращает: провайдер перегружен, сразу не стучимся", () => {
    expect(autoContinuePauseMs({ index: 0, error: busy({ "retry-after-ms": "1" }), random: () => 0 })).toBe(2_000);
    expect(autoContinuePauseMs({ index: 0, error: busy({ "retry-after": "0" }), random: () => 0 })).toBe(2_000);
    expect(autoContinuePauseMs({ index: 0, error: busy({ "retry-after-ms": "1500" }), random: () => 0.9 })).toBe(2_450);
    expect(autoContinuePauseMs({ index: 1, error: busy({ "retry-after-ms": "1" }), random: () => 0 })).toBe(5_000);
  });
});

describe("autoContinueNoteMessage: пометка с хвостом оборванного текста", () => {
  const noteOf = (parts: Part[]) => autoContinueNoteMessage(parts).content as string;

  it("ответ оборвался на тексте — пометка, затем последние знаки строкой JSON: перенос строки виден как \\n", () => {
    const note = noteOf([part({ type: "step-start" }), part({ type: "text", text: "Список:\n1 — 1", state: "streaming" })]);
    expect(autoContinueNoteMessage([]).role).toBe("user");
    expect(note.startsWith(AUTO_CONTINUE_NOTE)).toBe(true);
    expect(note).toContain(JSON.stringify("Список:\n1 — 1"));
    expect(note).toContain("\\n");
    expect(note).toMatch(/следующего знака/);
  });

  it("в хвосте — только последние 80 знаков длинного текста", () => {
    const text = `${"а".repeat(200)}${"б".repeat(80)}`;
    const note = noteOf([part({ type: "text", text, state: "streaming" })]);
    expect(note).toContain(JSON.stringify("б".repeat(80)));
    expect(note).not.toContain("аб");
  });

  it("ответ оборвался не на тексте (после вызова) — пометка без хвоста", () => {
    const parts = [part({ type: "text", text: "Ищу", state: "done" }), part({ type: "tool-lookup", toolCallId: "c1", state: "output-available", input: {}, output: "ок" })];
    expect(noteOf(parts)).toBe(AUTO_CONTINUE_NOTE);
  });
});

describe("hasAnswerContent: есть ли в ответе что продолжать", () => {
  it("только начала шагов — нечего; текст или вызов — есть", () => {
    expect(hasAnswerContent([])).toBe(false);
    expect(hasAnswerContent([part({ type: "step-start" })])).toBe(false);
    expect(hasAnswerContent([part({ type: "step-start" }), part({ type: "text", text: "А", state: "done" })])).toBe(true);
    expect(hasAnswerContent([part({ type: "tool-lookup", toolCallId: "c1", state: "output-available", input: {}, output: "ок" })])).toBe(true);
  });

  it("одни рассуждения и пустой текст — нечего: модель такой ответ не видит (FR-055)", () => {
    expect(hasAnswerContent([part({ type: "step-start" }), part({ type: "reasoning", text: "думаю", state: "done" })])).toBe(false);
    expect(hasAnswerContent([part({ type: "text", text: " \n", state: "done" })])).toBe(false);
  });
});

describe("closingChunksForHangingCalls: недописанные вызовы закрываются ошибкой", () => {
  it("input-streaming — tool-input-error с пустым входом, input-available — tool-output-error; законченные не трогаются", () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "tool-lookup", toolCallId: "c0", state: "output-available", input: {}, output: "ок" }),
      part({ type: "step-start" }),
      part({ type: "tool-lookup", toolCallId: "c1", state: "input-available", input: { q: "a" } }),
      part({ type: "dynamic-tool", toolName: "remote", toolCallId: "c2", state: "input-streaming", input: undefined }),
      part({ type: "tool-lookup", toolCallId: "c3", state: "input-streaming", input: { q: "б" } }),
    ];
    expect(closingChunksForHangingCalls(parts)).toEqual([
      { type: "tool-output-error", toolCallId: "c1", errorText: HANGING_TOOL_CALL_REASON },
      { type: "tool-input-error", toolCallId: "c2", toolName: "remote", input: {}, errorText: UNSENT_TOOL_CALL_REASON, dynamic: true },
      { type: "tool-input-error", toolCallId: "c3", toolName: "lookup", input: {}, errorText: UNSENT_TOOL_CALL_REASON },
    ]);
  });

  it("вызов с промежуточным выводом закрывается тем же текстом, что и при сборке запроса: с выводом (FR-053)", () => {
    const parts = [
      part({ type: "step-start" }),
      part({ type: "tool-mail", toolCallId: "c1", state: "output-available", input: {}, output: "отправлено 3 из 5", preliminary: true }),
    ];
    expect(closingChunksForHangingCalls(parts)).toEqual([
      { type: "tool-output-error", toolCallId: "c1", errorText: `${HANGING_TOOL_CALL_REASON}\nПоследний промежуточный вывод: отправлено 3 из 5` },
    ]);
  });

  it("собранный ответ: вызовы в output-error, у недописанного вход пустой и без обрывка JSON", async () => {
    const broken: UIMessageChunk[] = [
      { type: "start", messageId: "a1" },
      { type: "start-step" },
      { type: "tool-input-start", toolCallId: "c1", toolName: "lookup" },
      { type: "tool-input-delta", toolCallId: "c1", inputTextDelta: '{"q":"a"}' },
      { type: "tool-input-available", toolCallId: "c1", toolName: "lookup", input: { q: "a" } },
      { type: "tool-input-start", toolCallId: "c2", toolName: "lookup" },
      { type: "tool-input-delta", toolCallId: "c2", inputTextDelta: '{"q":"ча' },
    ];
    const before = await assembled(broken);
    const parts = await assembled([...broken, ...closingChunksForHangingCalls(before)]);
    expect(parts.slice(1)).toEqual([
      expect.objectContaining({ toolCallId: "c1", state: "output-error", input: { q: "a" }, errorText: HANGING_TOOL_CALL_REASON }),
      expect.objectContaining({ toolCallId: "c2", state: "output-error", input: {}, errorText: UNSENT_TOOL_CALL_REASON }),
    ]);
    expect((parts[2] as { rawInput?: unknown }).rawInput).toBeUndefined();
  });
});

describe("needsLineBreak: потерянный перенос строки на шве продолжения", () => {
  it.each([
    ["1 — 1", "2 — 4\n3 — 9"],
    ["Список:\n9. Девять", "10. Десять"],
    ["| a | b |\n| 1 | 2 |", "| 3 | 4 |"],
    ["  3) три", "4) четыре"],
  ])("строка списка или таблицы закончена, продолжение — новый элемент без переноса: %j + %j — нужен", (before, after) => {
    expect(needsLineBreak(before, after)).toBe(true);
  });

  it.each([
    ["1 — 1", "\n2 — 4"],
    ["1 — 1\n", "2 — 4"],
    ["1 — 1 ", "2 — 4"],
    ["Начало отв", "ета и конец."],
    ["1 — 1", "4 — 16"],
    ["1 — 1", "2. Два"],
    ["Шаг 1 — готов", "2 — дальше"],
    ["| a | b", "| c |"],
    ["1 — 1", "2"],
  ])("иначе не трогать: %j + %j", (before, after) => {
    expect(needsLineBreak(before, after)).toBe(false);
  });
});

describe("createSeamJoiner: начало продолжения придерживается, пока не ясно, нужен ли перенос", () => {
  const delta = (text: string, id = "t1"): UIMessageChunk => ({ type: "text-delta", id, delta: text });

  it("начало нового пункта без переноса — перенос подставлен в первый кусок, дальше куски как есть", () => {
    const seam = createSeamJoiner();
    seam.watch("1 — 1");
    expect(seam.pass({ type: "start-step" })).toEqual([{ type: "start-step" }]);
    expect(seam.pass({ type: "text-start", id: "t1" })).toEqual([{ type: "text-start", id: "t1" }]);
    expect(seam.pass(delta("2"))).toEqual([]);
    expect(seam.pass(delta(" — 4\n3"))).toEqual([delta("\n2 — 4\n3")]);
    expect(seam.pass(delta(" — 9"))).toEqual([delta(" — 9")]);
  });

  it("обычный текст — без изменений; конец части отпускает придержанное", () => {
    const seam = createSeamJoiner();
    seam.watch("Начало отв");
    seam.pass({ type: "text-start", id: "t1" });
    expect(seam.pass(delta("ета"))).toEqual([]);
    expect(seam.pass({ type: "text-end", id: "t1" })).toEqual([delta("ета"), { type: "text-end", id: "t1" }]);
    expect(seam.pass(delta("ещё", "t2"))).toEqual([delta("ещё", "t2")]);
  });

  it("рассуждение перед текстом проходит; вызов инструмента раньше текста — шов не проверяется", () => {
    const seam = createSeamJoiner();
    seam.watch("1 — 1");
    expect(seam.pass({ type: "reasoning-start", id: "r1" })).toEqual([{ type: "reasoning-start", id: "r1" }]);
    expect(seam.pass({ type: "tool-input-start", toolCallId: "c1", toolName: "lookup" })).toHaveLength(1);
    seam.pass({ type: "text-start", id: "t1" });
    expect(seam.pass(delta("2 — 4"))).toEqual([delta("2 — 4")]);
  });

  it("flush отдаёт придержанное: ход кончился посреди начала", () => {
    const seam = createSeamJoiner();
    seam.watch("1 — 1");
    seam.pass({ type: "text-start", id: "t1" });
    seam.pass(delta("2"));
    expect(seam.flush()).toEqual([delta("2")]);
    expect(seam.flush()).toEqual([]);
  });
});
