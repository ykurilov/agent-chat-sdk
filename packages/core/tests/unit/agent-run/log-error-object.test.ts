import { expect, it, vi } from "vitest";
import { mockModel, readAll, streamOf, streamStart } from "../support/mock-model";
import { savedAnswer, startTurn, storageWithQuestion } from "../support/turn-fixtures";
import { notifyTurnFinished } from "../../../src/agent-run/turn-finished";

it("ошибка провайдера доходит в журнал тем же объектом со stack и cause", async () => {
  const failure = new Error("provider failed", { cause: new Error("upstream failure") });
  const logError = vi.fn();
  const storage = await storageWithQuestion();
  const model = mockModel(() => streamOf([streamStart, { type: "error", error: failure }]));
  await readAll(startTurn(storage, model, { logError }));
  expect(logError.mock.calls.some((call) => call[1] === failure)).toBe(true);
  expect((await savedAnswer(storage))?.status).toBe("error");
});

it.each([false, true])("ошибка onTurnFinished передаётся без потери объекта, async=%s", async (asyncHook) => {
  const failure = new Error("hook failed", { cause: new Error("original") });
  const logError = vi.fn();
  notifyTurnFinished(
    () => { if (asyncHook) return Promise.reject(failure); throw failure; },
    { userId: "u", chatId: "c", messageId: "m", status: "complete", modelId: "model", providerId: "provider" },
    logError,
  );
  await Promise.resolve();
  expect(logError).toHaveBeenCalledWith(expect.stringContaining("onTurnFinished"), failure);
  expect(logError.mock.calls[0]?.[1]).toBe(failure);
});

it("без пользовательского колбэка console.error сохраняет прежнюю строку без сырого исключения", async () => {
  const failure = new Error("provider failed");
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const storage = await storageWithQuestion();
    await readAll(startTurn(storage, mockModel(() => streamOf([streamStart, { type: "error", error: failure }]))));
    expect(logged).toHaveBeenCalled();
    expect(logged.mock.calls.every((args) => args.length === 1 && typeof args[0] === "string")).toBe(true);
  } finally {
    logged.mockRestore();
  }
});
