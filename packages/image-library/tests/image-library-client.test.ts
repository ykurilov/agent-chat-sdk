import type { DynamicToolUIPart } from "ai";
import { describe, expect, it, vi } from "vitest";
import { createImageLibraryClient, imageLibraryClient } from "../src/react/index";

const part = (fields: Partial<DynamicToolUIPart> & { state: DynamicToolUIPart["state"] }) =>
  ({ type: "tool-show_image", toolCallId: "call-1", input: { id: "cell" }, ...fields }) as never;

const describeShown = (картинка: unknown, client = imageLibraryClient, openImage = vi.fn()) =>
  client.describe({ part: part({ state: "output-available", output: { картинка } }), api: "/api/chat", chatId: "c1", openImage });

const shown = { id: "cell", название: "Строение клетки", подпись: "Схема клетки: ядро и мембрана", адрес: "/library/cell.png", ширина: 1200, высота: 800 };

describe("imageLibraryClient: вызов show_image → картинка по ширине ответа с подписью", () => {
  it("имя инструмента", () => {
    expect(imageLibraryClient.toolName).toBe("show_image");
  });

  it("готовая картинка: своя пропорция, по ширине ответа, alt и видимая подпись-название, открытие в окне", () => {
    const openImage = vi.fn();
    const view = describeShown(shown, imageLibraryClient, openImage);
    expect(view).toMatchObject({
      ordered: 1,
      aspectRatio: "3:2",
      wide: true,
      stopped: false,
      items: [{ state: "ready", key: "call-1", src: "/library/cell.png", alt: "Схема клетки: ядро и мембрана", caption: "Строение клетки", width: 1200, height: 800 }],
    });
    const trigger = {} as HTMLElement;
    const item = view!.items[0]!;
    if (item.state === "ready") item.onOpen(trigger);
    expect(openImage).toHaveBeenCalledWith("call-1", trigger);
  });

  it.each([
    [1200, 800, "3:2"],
    [800, 800, "1:1"],
    [1920, 1080, "16:9"],
    [1080, 1920, "9:16"],
    [600, 900, "2:3"],
    [1024, 768, "3:2"],
    [768, 1024, "2:3"],
    [3000, 1000, "16:9"],
    [1000, 1100, "1:1"],
  ])("%i×%i — пропорция %s из общей таблицы: скин версии 25 рисует её плиткой без квадратной обрезки", (ширина, высота, aspectRatio) => {
    expect(describeShown({ ...shown, ширина, высота })?.aspectRatio).toBe(aspectRatio);
  });

  it("вызов идёт — пустой вид без надписи «создаю»: библиотека ничего не рисует", () => {
    for (const state of ["input-streaming", "input-available"] as const) {
      expect(imageLibraryClient.describe({ part: part({ state }), api: "/api/chat", chatId: "c1", openImage: vi.fn() })).toEqual({
        ordered: 1,
        aspectRatio: "3:2",
        wide: true,
        items: [],
        stopped: false,
      });
    }
  });

  it("отказ, ошибка, «Стоп» — undefined: строка инструмента", () => {
    const describe = (fields: Record<string, unknown>) => imageLibraryClient.describe({ part: part(fields as never), api: "/api/chat", chatId: "c1", openImage: vi.fn() });
    expect(describe({ state: "output-available", output: { отказ: "нет в каталоге" } })).toBeUndefined();
    expect(describe({ state: "output-error", errorText: "сбой" })).toBeUndefined();
    expect(describe({ state: "output-denied" })).toBeUndefined();
    expect(describe({ state: "output-available", output: "строка" })).toBeUndefined();
  });

  it("подделка в базе: чужой адрес, без подписи, кривые размеры — undefined", () => {
    expect(describeShown({ ...shown, адрес: "https://evil.example/x.png" })).toBeUndefined();
    expect(describeShown({ ...shown, адрес: "javascript:alert(1)" })).toBeUndefined();
    expect(describeShown({ ...shown, адрес: "//evil.example/x.png" })).toBeUndefined();
    expect(describeShown({ ...shown, подпись: "" })).toBeUndefined();
    expect(describeShown({ ...shown, название: 5 })).toBeUndefined();
    expect(describeShown({ ...shown, ширина: -1 })).toBeUndefined();
    expect(describeShown({ ...shown, высота: "800" })).toBeUndefined();
  });

  it("разрешённые домены — через createImageLibraryClient, как на сервере", () => {
    const cdn = { ...shown, адрес: "https://cdn.school.example/cell.png" };
    expect(describeShown(cdn)).toBeUndefined();
    const client = createImageLibraryClient({ allowedHosts: ["cdn.school.example"] });
    expect(client.toolName).toBe("show_image");
    expect(describeShown(cdn, client)?.items[0]).toMatchObject({ state: "ready", src: "https://cdn.school.example/cell.png" });
  });
});
