import type { ToolUIPart } from "ai";
import { describe, expect, it, vi } from "vitest";
import { imagesClient } from "../../src/react/index";

const input = { prompt: "Маяк на рассвете", count: 3, aspectRatio: "16:9" };

function call(fields: Record<string, unknown>) {
  const openImage = vi.fn();
  const part = { type: "tool-generate_images", toolCallId: "g1", ...fields } as unknown as ToolUIPart;
  return { openImage, view: imagesClient.describe({ part, api: "/api/chat", chatId: "c 1", openImage }) };
}

describe("imagesClient (T046)", () => {
  it("имя инструмента — generate_images", () => {
    expect(imagesClient.toolName).toBe("generate_images");
  });

  it("вход ещё идёт или вызов выполняется — заглушки на count нужной пропорции", () => {
    expect(call({ state: "input-available", input }).view).toEqual({
      ordered: 3,
      aspectRatio: "16:9",
      items: [1, 2, 3].map((n) => ({ state: "loading", key: `g1:${n}` })),
      stopped: false,
    });
    // Пока вход недописан: count и пропорция по умолчанию.
    expect(call({ state: "input-streaming", input: { prompt: "Ма" } }).view).toMatchObject({ ordered: 1, aspectRatio: "1:1", items: [{ state: "loading" }] });
    expect(call({ state: "input-streaming", input: undefined }).view).toMatchObject({ ordered: 1, items: [{ state: "loading" }] });
  });

  it("готово: картинки по номеру с адресом вложения, alt — prompt; упавшие с причиной; клик открывает окно по id", () => {
    const output = {
      создано: 2,
      заказано: 3,
      картинки: [
        { номер: 3, id: "img-3", ширина: 1088, высота: 608 },
        { номер: 1, id: "img-1", ширина: 1088, высота: 608 },
      ],
      ошибки: [{ номер: 2, причина: "contentModeration: Blocked" }],
    };
    const { view, openImage } = call({ state: "output-available", input, output });
    expect(view).toEqual({
      ordered: 3,
      aspectRatio: "16:9",
      items: [
        { state: "ready", key: "img-1", src: "/api/chat/c%201/attachments/img-1", alt: "Маяк на рассвете", width: 1088, height: 608, onOpen: expect.any(Function) },
        { state: "failed", key: "g1:2", reason: "contentModeration: Blocked" },
        { state: "ready", key: "img-3", src: "/api/chat/c%201/attachments/img-3", alt: "Маяк на рассвете", width: 1088, height: 608, onOpen: expect.any(Function) },
      ],
      stopped: false,
    });
    const trigger = {} as HTMLElement;
    (view!.items[2] as { onOpen: (trigger: HTMLElement) => void }).onOpen(trigger);
    expect(openImage).toHaveBeenCalledWith("img-3", trigger);
  });

  it("«Стоп» в итоге: готовые остаются, недоделанных нет, пометка «остановлено»", () => {
    const output = { создано: 1, заказано: 3, картинки: [{ номер: 1, id: "img-1", ширина: 1088, высота: 608 }], остановлено: true };
    expect(call({ state: "output-available", input, output }).view).toMatchObject({ ordered: 3, items: [{ state: "ready", key: "img-1" }], stopped: true });
  });

  it("отказ (лимит) — все заказанные помечены упавшими с причиной", () => {
    expect(call({ state: "output-available", input, output: { отказ: "лимит расходов исчерпан" } }).view).toEqual({
      ordered: 3,
      aspectRatio: "16:9",
      items: [1, 2, 3].map((n) => ({ state: "failed", key: `g1:${n}`, reason: "лимит расходов исчерпан" })),
      stopped: false,
    });
  });

  it("вызов закрыт ошибкой («Стоп» во время хода) — «остановлено», без картинок", () => {
    expect(call({ state: "output-error", input, errorText: "Выполнение прервано" }).view).toEqual({ ordered: 3, aspectRatio: "16:9", items: [], stopped: true });
  });

  it("отклонённый вызов и непонятный итог — нет вида: остаётся строка инструмента", () => {
    expect(call({ state: "output-denied", input }).view).toBeUndefined();
    expect(call({ state: "output-available", input, output: "текст" }).view).toBeUndefined();
    expect(call({ state: "output-available", input, output: { картинки: "нет" } }).view).toBeUndefined();
  });

  it("неверный вход приводится к допустимому: count в 1..8, неизвестная пропорция — 1:1", () => {
    expect(call({ state: "input-available", input: { prompt: "x", count: 40, aspectRatio: "4:3" } }).view).toMatchObject({ ordered: 8, aspectRatio: "1:1" });
    expect(call({ state: "input-available", input: { prompt: "x", count: 0 } }).view).toMatchObject({ ordered: 1 });
  });
});
