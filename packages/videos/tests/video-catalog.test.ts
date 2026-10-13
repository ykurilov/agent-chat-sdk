import { describe, expect, it } from "vitest";
import { checkVideoCatalog, checkVideoEntry, searchVideos } from "../src/video-catalog";
import type { VideoEntry } from "../src/index";

const entry = (fields: Partial<VideoEntry> & { id: string }): VideoEntry => ({
  title: `Видео ${fields.id}`,
  url: "https://www.youtube.com/watch?v=aircAruvnKk",
  ...fields,
});

describe("проверка записи каталога (FR-003)", () => {
  it("годная запись — без замечаний", () => {
    expect(
      checkVideoEntry(
        entry({
          id: "a",
          durationSeconds: 600,
          poster: "https://cdn.example/a.jpg",
          chapters: [{ title: "Начало", startSeconds: 0 }, { title: "Примеры", startSeconds: 200 }],
        }),
      ),
    ).toBeUndefined();
    expect(checkVideoEntry(entry({ id: "b", poster: "/posters/b.jpg" }))).toBeUndefined();
  });

  it.each([
    ["пустой id", entry({ id: "" }), /id/],
    ["пустое название", entry({ id: "a", title: "  " }), /название/],
    ["ссылка не YouTube и не Kinescope", entry({ id: "a", url: "https://vimeo.com/1" }), /ссылк/],
    ["обложка не https", entry({ id: "a", poster: "http://cdn.example/a.jpg" }), /обложк/],
    ["обложка с чужого хоста без схемы", entry({ id: "a", poster: "//evil.example/a.jpg" }), /обложк/],
    ["обложка «/\\evil» — браузер читает как //evil", entry({ id: "a", poster: "/\\evil.com/x.png" }), /обложк/],
    ["обложка «/<таб>/evil» — таб выбрасывается, выходит //evil", entry({ id: "a", poster: "/\t/evil.com/x.png" }), /обложк/],
    ["обложка «/\\t/evil»", entry({ id: "a", poster: "/\\t/evil.com/x.png" }), /обложк/],
    ["обложка «/%2f/evil» — закодированная косая", entry({ id: "a", poster: "/%2f/evil.com/x.png" }), /обложк/],
    ["обложка https с пробелом", entry({ id: "a", poster: "https://cdn.example/a b.jpg" }), /обложк/],
    ["длительность не целая", entry({ id: "a", durationSeconds: 10.5 }), /длительн/],
    ["длительность ноль", entry({ id: "a", durationSeconds: 0 }), /длительн/],
    ["глава за концом видео", entry({ id: "a", durationSeconds: 100, chapters: [{ title: "Конец", startSeconds: 100 }] }), /глав/],
    ["глава без названия", entry({ id: "a", chapters: [{ title: "", startSeconds: 0 }] }), /глав/],
    ["глава с отрицательным началом", entry({ id: "a", chapters: [{ title: "x", startSeconds: -1 }] }), /глав/],
  ])("%s — замечание", (_name, video, reason) => {
    expect(checkVideoEntry(video)).toMatch(reason);
  });

  it("каталог-массив: повтор id и негодная запись — исключение с id", () => {
    expect(() => checkVideoCatalog([entry({ id: "урок-1" }), entry({ id: "урок-1" })])).toThrow(/урок-1/);
    expect(() => checkVideoCatalog([entry({ id: "урок-2", url: "https://vimeo.com/1" })])).toThrow(/урок-2/);
    expect(() => checkVideoCatalog([entry({ id: "a" }), entry({ id: "b" })])).not.toThrow();
  });
});

describe("встроенный поиск (FR-006)", () => {
  const catalog: VideoEntry[] = [
    entry({ id: "neural", title: "Что такое нейросеть", description: "Нейроны, слои и веса простыми словами." }),
    entry({ id: "prompts", title: "Как писать промпты", chapters: [{ title: "Примеры промптов", startSeconds: 200 }] }),
    entry({ id: "gradient", title: "Градиентный спуск", description: "Как нейросеть учится: ошибка и шаг." }),
    entry({ id: "ёлка", title: "Ёлочные игрушки своими руками" }),
    entry({ id: "examples", title: "Разбор задач", chapters: [{ title: "Промпты для учёбы", startSeconds: 0 }] }),
  ];
  const ids = (query: string) => searchVideos(catalog, query).map((video) => video.id);

  it("находит по другой форме слова и без регистра", () => {
    expect(ids("ПРОМПТОВ")).toEqual(["prompts", "examples"]);
    expect(ids("нейросети")[0]).toBe("neural");
  });

  it("название весит больше главы и описания", () => {
    expect(ids("нейросеть")).toEqual(["neural", "gradient"]);
    expect(ids("промпты")).toEqual(["prompts", "examples"]);
  });

  it("«ё» и «е» одно и то же", () => {
    expect(ids("елочные")).toEqual(["ёлка"]);
  });

  it("служебные слова не считаются, если есть другие", () => {
    expect(ids("покажи урок про градиентный спуск")).toEqual(["gradient"]);
    expect(ids("видео как")).not.toEqual([]);
  });

  it("ничего не подошло — пустой список", () => {
    expect(ids("квантовая криптография")).toEqual([]);
  });

  it("не больше восьми, при равенстве — порядок каталога", () => {
    const many = Array.from({ length: 12 }, (_, index) => entry({ id: `v${index}`, title: `Урок номер ${index} про python` }));
    expect(searchVideos(many, "python").map((video) => video.id)).toEqual(["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7"]);
  });
});

describe("встроенный поиск снаружи пакета", () => {
  it("корень пакета отдаёт тот же поиск, что у массива: приложение зовёт его из source.search", async () => {
    const root = await import("../src/index");
    expect(root.searchVideos).toBe(searchVideos);
  });
});
