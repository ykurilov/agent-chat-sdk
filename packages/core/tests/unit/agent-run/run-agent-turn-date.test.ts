import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FROZEN_CONTEXT_PART_TYPE } from "../../../src/frozen-context/context-blocks";
import { resolveTimeZone, todayBlock } from "../../../src/agent-run/today";
import { finishPart, reasoningAndTextParts, streamOf, streamStart } from "../support/mock-model";
import { runTurn } from "../support/turn-fixtures";

const friday = () => new Date(2026, 9, 2, 12, 0);

function userParts(model: MockLanguageModelV4, call = 0): string[] {
  const last = [...model.doStreamCalls[call]!.prompt].reverse().find((message) => message.role === "user")!;
  return typeof last.content === "string" ? [last.content] : last.content.map((part) => (part.type === "text" ? part.text : `[${part.type}]`));
}

const answering = () => new MockLanguageModelV4({ doStream: async () => ({ stream: streamOf(reasoningAndTextParts(["ок"])) }) });

describe("сегодняшняя дата в хвосте запроса (FR-056)", () => {
  it("день недели, число, месяц и год словами", () => {
    expect(todayBlock(friday())).toBe("Сегодня: пятница, 2 октября 2026 г.");
  });

  it("часовой пояс человека: 19:00 по UTC — уже 03:00 следующего дня у человека в +8, дата его", () => {
    const evening = new Date(Date.UTC(2026, 9, 2, 19, 0));
    expect(todayBlock(evening, "UTC")).toBe("Сегодня: пятница, 2 октября 2026 г.");
    expect(todayBlock(evening, "Asia/Shanghai")).toBe("Сегодня: суббота, 3 октября 2026 г.");
  });

  it("пояс в ходе: дата в хвосте — по поясу хода", async () => {
    const model = answering();
    await runTurn(model, { now: () => new Date(Date.UTC(2026, 9, 2, 19, 0)), timeZone: "Asia/Shanghai" });
    expect(userParts(model)).toEqual(["Привет", "Сегодня: суббота, 3 октября 2026 г."]);
  });

  it("resolveTimeZone: настоящий IANA-пояс — он и есть; остальное — нет пояса", () => {
    for (const zone of ["Europe/Moscow", "UTC", "Asia/Shanghai", "America/Argentina/Buenos_Aires", "Etc/GMT-8"]) {
      expect(resolveTimeZone(zone)).toBe(zone);
    }
    for (const bad of ["Mars/Olympus", "+08:00", "", " Europe/Moscow", "Europe/Moscow\n", "a".repeat(200), 42, null, undefined, {}]) {
      expect(resolveTimeZone(bad)).toBeUndefined();
    }
  });

  it("дата — частью в конце последнего сообщения человека: после памяти, перед местом на экране", async () => {
    const model = answering();
    await runTurn(model, {
      ownerId: "anna",
      now: friday,
      memory: { snapshot: async () => "<memory>любит чай</memory>" },
      place: { description: "Календарь" },
    });

    const parts = userParts(model);
    expect(parts.slice(0, 3)).toEqual(["Привет", "<memory>любит чай</memory>", "Сегодня: пятница, 2 октября 2026 г."]);
    expect(parts[3]).toContain("<screen_place>");
    // В начало запроса дата не идёт: инструкция та же.
    expect(JSON.stringify(model.doStreamCalls[0]!.prompt[0])).not.toContain("Сегодня");
  });

  it("дата берётся один раз за ход: полночь посреди хода не меняет запрос", async () => {
    let calls = 0;
    const midnight = () => (calls++ === 0 ? new Date(2026, 9, 2, 23, 59, 59) : new Date(2026, 9, 3, 0, 0, 1));
    const call: LanguageModelV4StreamPart[] = [
      streamStart,
      { type: "tool-call", toolCallId: "c1", toolName: "lookup", input: "{}" },
      finishPart("tool-calls"),
    ];
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({ stream: streamOf(step++ === 0 ? call : reasoningAndTextParts(["ок"])) }),
    });
    const lookup = tool({ description: "Поиск", inputSchema: z.object({}), execute: async () => "нашёл" });

    await runTurn(model, { now: midnight, tools: { lookup } });

    expect(userParts(model, 0)).toEqual(["Привет", "Сегодня: пятница, 2 октября 2026 г."]);
    expect(userParts(model, 1)).toEqual(userParts(model, 0));
  });

  it("дата застывает в части ответа: вопрос человека не меняется, клиенту она не уходит", async () => {
    const { storage, chunks } = await runTurn(answering(), { now: friday });
    const [question, answer] = await storage.listMessages("chat-1");
    expect(JSON.stringify(question)).not.toContain("Сегодня");
    expect(answer!.parts[0]).toEqual({
      type: FROZEN_CONTEXT_PART_TYPE,
      data: { blocks: [{ key: "today", text: "Сегодня: пятница, 2 октября 2026 г." }], sent: "all", base: null },
    });
    expect(JSON.stringify(chunks)).not.toContain("Сегодня");
  });
});
