import type { DynamicToolUIPart } from "ai";
import { describe, expect, it } from "vitest";
import { videosClient } from "../src/react/index";

const part = (fields: Partial<DynamicToolUIPart> & { state: DynamicToolUIPart["state"] }) =>
  ({ type: "tool-show_video", toolCallId: "call-1", input: { id: "x" }, ...fields }) as never;

const ready = (видео: Record<string, unknown>) => videosClient.describe(part({ state: "output-available", output: { видео } }));

describe("videosClient: вызов show_video → вид карточки (FR-010, FR-011)", () => {
  it("имя инструмента", () => {
    expect(videosClient.toolName).toBe("show_video");
  });

  it("вызов идёт — loading", () => {
    expect(videosClient.describe(part({ state: "input-streaming" }))).toEqual({ state: "loading" });
    expect(videosClient.describe(part({ state: "input-available" }))).toEqual({ state: "loading" });
  });

  it("YouTube: адрес плеера с nocookie и стартом, страница, длительность и «с 3:20»", () => {
    expect(
      ready({ id: "a", название: "Нейросети", площадка: "youtube", код: "aircAruvnKk", длительность: 1120, обложка: "/p.jpg", начало: 200 }),
    ).toEqual({
      state: "ready",
      video: {
        id: "call-1",
        title: "Нейросети",
        provider: "youtube",
        embedUrl: "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0&start=200",
        pageUrl: "https://www.youtube.com/watch?v=aircAruvnKk&t=200s",
        poster: "/p.jpg",
        duration: "18:40",
        start: "3:20",
      },
    });
  });

  it("Kinescope без начала и обложки", () => {
    expect(ready({ id: "b", название: "Вебинар", площадка: "kinescope", код: "gPhDX2pPFyCG77vboYnRCZ" })).toEqual({
      state: "ready",
      video: {
        id: "call-1",
        title: "Вебинар",
        provider: "kinescope",
        embedUrl: "https://kinescope.io/embed/gPhDX2pPFyCG77vboYnRCZ?autoplay=1&playsinline=1",
        pageUrl: "https://kinescope.io/gPhDX2pPFyCG77vboYnRCZ",
      },
    });
  });

  it("отказ, ошибка, «Стоп» — undefined: строка инструмента", () => {
    expect(videosClient.describe(part({ state: "output-available", output: { отказ: "нет в каталоге" } }))).toBeUndefined();
    expect(videosClient.describe(part({ state: "output-error", errorText: "сбой" }))).toBeUndefined();
    expect(videosClient.describe(part({ state: "output-denied" } as never))).toBeUndefined();
  });

  it("подделанный результат в базе — undefined: чужой адрес в iframe не попадёт", () => {
    expect(ready({ название: "x", площадка: "youtube", код: 'aircAruvnKk"><script>' })).toBeUndefined();
    expect(ready({ название: "x", площадка: "vimeo", код: "123456" })).toBeUndefined();
    expect(ready({ название: "x", площадка: "kinescope", код: "../../evil" })).toBeUndefined();
    expect(ready({ площадка: "youtube", код: "aircAruvnKk" })).toBeUndefined();
    expect(videosClient.describe(part({ state: "output-available", output: "строка" }))).toBeUndefined();
  });

  it.each(["//evil.com/x.png", "/\\evil.com/x.png", "/\t/evil.com/x.png", "/\\t/evil.com/x.png", "/%2f/evil.com/x.png", "/%5C/evil.com/x.png"])(
    "обложка, которую браузер уведёт на чужой хост, отброшена: %j",
    (обложка) => {
      const view = ready({ название: "x", площадка: "youtube", код: "aircAruvnKk", обложка });
      expect(view && "video" in view && view.video.poster).toBeFalsy();
    },
  );

  it("негодные необязательные поля отбрасываются: обложка не https и не «/…», начало не целое", () => {
    const view = ready({ название: "x", площадка: "youtube", код: "aircAruvnKk", обложка: "javascript:alert(1)", начало: -5, длительность: "много" });
    expect(view).toEqual({
      state: "ready",
      video: {
        id: "call-1",
        title: "x",
        provider: "youtube",
        embedUrl: "https://www.youtube-nocookie.com/embed/aircAruvnKk?autoplay=1&playsinline=1&rel=0",
        pageUrl: "https://www.youtube.com/watch?v=aircAruvnKk",
      },
    });
  });
});
