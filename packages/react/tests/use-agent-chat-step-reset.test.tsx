// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as core from "../../core/src/agent-run/step-reset";
import { STEP_RESET_PART_TYPE, withoutResetSteps } from "../src";
import { renderChatHook } from "./support/chat-dom";
import { fakeChatServer } from "./support/fake-chat-server";

afterEach(cleanup);

const textOf = (parts: ReadonlyArray<{ type: string; text?: string }>) => parts.map((part) => (part.type === "text" ? part.text : "")).join("");

describe("шаг ответа начат заново у другого провайдера (data-step-reset)", () => {
  it("показанный текст шага пропадает из ленты, новый шаг виден; отметки сброса в частях нет", async () => {
    const server = fakeChatServer({ history: [{ id: "u0", role: "user", parts: [{ type: "text", text: "Было" }] }] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Вопрос"));
    act(() => result.current.submit());
    await waitFor(() => expect(server.streams[0]).toBeDefined());
    const stream = server.streams[0]!;

    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Стёртое начало" });
    await waitFor(() => expect(textOf(result.current.messages.at(-1)!.parts)).toBe("Стёртое начало"));

    stream.push({ type: "text-end", id: "t" });
    stream.push({ type: "data-step-reset", data: { providerId: "backup" } });
    await waitFor(() => expect(textOf(result.current.messages.at(-1)!.parts)).toBe(""));

    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t2" });
    stream.push({ type: "text-delta", id: "t2", delta: "Ответ запасного" });
    stream.finish("t2");
    await waitFor(() => expect(textOf(result.current.messages.at(-1)!.parts)).toBe("Ответ запасного"));
    expect(result.current.messages.at(-1)!.parts.map((part) => part.type)).toEqual(["step-start", "text"]);
  });

  it("«Повторить» и «Ответить заново» смотрят на ответ без стёртого: стёрт весь текст, запасной не написал ничего — ответ пустой", async () => {
    const server = fakeChatServer({ history: [{ id: "u0", role: "user", parts: [{ type: "text", text: "Было" }] }] });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.setValue("Вопрос"));
    act(() => result.current.submit());
    await waitFor(() => expect(server.streams[0]).toBeDefined());
    const stream = server.streams[0]!;

    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Стёртое" });
    stream.push({ type: "text-end", id: "t" });
    stream.push({ type: "data-step-reset", data: { providerId: "backup" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "finish-step" });
    stream.push({ type: "message-metadata", messageMetadata: { status: "complete" } });
    stream.push({ type: "finish" });
    stream.end();

    await waitFor(() => expect(result.current.messages.at(-1)!.metadata?.status).toBe("complete"));
    await waitFor(() => expect(result.current.canRetry).toBe(true));
    expect(result.current.canRegenerate).toBe(false);
  });

  it("вторая вкладка подключилась к идущему ответу: поток идёт с начала, со стёртым шагом и сбросом — в ленте только ответ запасного", async () => {
    const question = { id: "u1", role: "user" as const, parts: [{ type: "text", text: "Вопрос" }] };
    const server = fakeChatServer({ history: [question], running: true, resumable: true });
    const { result } = renderChatHook(server);
    await waitFor(() => expect(server.resumed).toHaveLength(1));
    const stream = server.resumed[0]!;

    stream.push({ type: "start", messageId: "a1" });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t" });
    stream.push({ type: "text-delta", id: "t", delta: "Стёртое" });
    stream.push({ type: "text-end", id: "t" });
    stream.push({ type: "data-step-reset", data: { providerId: "backup" } });
    stream.push({ type: "start-step" });
    stream.push({ type: "text-start", id: "t2" });
    stream.push({ type: "text-delta", id: "t2", delta: "Ответ запасного" });
    await waitFor(() => expect(textOf(result.current.messages.at(-1)!.parts)).toBe("Ответ запасного"));
    expect(result.current.busy).toBe(true);

    stream.finish("t2");
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(textOf(result.current.messages.at(-1)!.parts)).toBe("Ответ запасного");
  });

  // React не зависит от ядра: у него своя копия. Одни случаи для обеих — копии не расходятся.
  const cases: Array<{ name: string; parts: Array<{ type: string; text?: string }>; kept: Array<{ type: string; text?: string }> }> = [
    { name: "без сброса", parts: [{ type: "text", text: "а" }], kept: [{ type: "text", text: "а" }] },
    {
      name: "сброс убирает всё от последней step-start",
      parts: [{ type: "step-start" }, { type: "text", text: "а" }, { type: "step-start" }, { type: "text", text: "б" }, { type: STEP_RESET_PART_TYPE }, { type: "step-start" }],
      kept: [{ type: "step-start" }, { type: "text", text: "а" }, { type: "step-start" }],
    },
    {
      name: "два сброса подряд",
      parts: [{ type: "step-start" }, { type: "text", text: "а" }, { type: STEP_RESET_PART_TYPE }, { type: "step-start" }, { type: "text", text: "б" }, { type: STEP_RESET_PART_TYPE }, { type: "step-start" }, { type: "text", text: "в" }],
      kept: [{ type: "step-start" }, { type: "text", text: "в" }],
    },
    { name: "сброс без step-start — убирает только себя", parts: [{ type: "text", text: "а" }, { type: STEP_RESET_PART_TYPE }], kept: [{ type: "text", text: "а" }] },
  ];
  for (const { name, parts, kept } of cases) {
    it(`withoutResetSteps у React и у ядра — одно и то же: ${name}`, () => {
      expect(withoutResetSteps(parts)).toEqual(kept);
      expect(core.withoutResetSteps(parts)).toEqual(kept);
      expect(core.STEP_RESET_PART_TYPE).toBe(STEP_RESET_PART_TYPE);
    });
  }

  it("без сброса — тот же массив", () => {
    const plain = [{ type: "text", text: "а" }];
    expect(withoutResetSteps(plain)).toBe(plain);
  });
});
