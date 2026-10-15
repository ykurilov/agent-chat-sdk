import { describe, expect, it } from "vitest";
import { checkImageCatalog, checkImageEntry, isImageAddress, searchImages } from "../src/index";
import type { ImageEntry } from "../src/index";

const cell: ImageEntry = {
  id: "cell",
  title: "Строение клетки",
  alt: "Схема клетки: ядро, мембрана, митохондрии",
  url: "/library/cell.png",
  width: 1200,
  height: 800,
  description: "Рисунок для урока биологии: из чего состоит живая клетка.",
  concepts: ["клетка", "органоиды"],
  tags: ["биология"],
};
const atom: ImageEntry = { id: "atom", title: "Модель атома", alt: "Ядро и электроны на орбитах", url: "https://cdn.school.example/atom.webp", width: 640, height: 640 };

describe("адрес картинки: свой сайт или разрешённые домены", () => {
  it.each(["/library/cell.png", "/a/b/c.webp?v=2"])("путь от корня своего сайта годится: %s", (url) => {
    expect(isImageAddress(url, [])).toBe(true);
  });

  it("https на разрешённом домене годится, на чужом — нет", () => {
    expect(isImageAddress("https://cdn.school.example/atom.webp", ["cdn.school.example"])).toBe(true);
    expect(isImageAddress("https://CDN.school.example/atom.webp", ["cdn.school.example"])).toBe(true);
    expect(isImageAddress("https://cdn.school.example/atom.webp", [])).toBe(false);
    expect(isImageAddress("https://evil.example/atom.webp", ["cdn.school.example"])).toBe(false);
    expect(isImageAddress("https://cdn.school.example.evil.example/a.png", ["cdn.school.example"])).toBe(false);
  });

  it.each([
    "http://cdn.school.example/atom.webp",
    "//evil.example/x.png",
    "/\\evil.example/x.png",
    "/\t/evil.example/x.png",
    "/%2f/evil.example/x.png",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "library/cell.png",
    "https://user:pass@cdn.school.example/x.png",
    "",
  ])("негодный адрес отклонён: %j", (url) => {
    expect(isImageAddress(url, ["cdn.school.example"])).toBe(false);
  });
});

describe("проверка записи каталога", () => {
  it("годная запись — без замечаний", () => {
    expect(checkImageEntry(cell, [])).toBeUndefined();
    expect(checkImageEntry(atom, ["cdn.school.example"])).toBeUndefined();
  });

  it.each([
    ["id пустой", { id: "" }, /id/],
    ["id длиннее 200", { id: "x".repeat(201) }, /id/],
    ["без названия", { title: " " }, /названи/],
    ["без alt", { alt: "" }, /alt/],
    ["alt не строка", { alt: 5 }, /alt/],
    ["чужой адрес", { url: "https://evil.example/x.png" }, /адрес/],
    ["ширина не целая", { width: 10.5 }, /ширин/],
    ["высоты нет", { height: undefined }, /высот/],
    ["описание не строка", { description: 1 }, /описани/],
    ["понятия не список строк", { concepts: ["ок", 1] }, /понят/],
    ["теги не список", { tags: "биология" }, /тег/],
  ])("%s — замечание", (_name, patch, reason) => {
    expect(checkImageEntry({ ...cell, ...patch } as ImageEntry, [])).toMatch(reason);
  });

  it("каталог-массив: негодная запись и повтор id — исключение с id записи", () => {
    expect(() => checkImageCatalog([cell, { ...atom, alt: "" }], ["cdn.school.example"])).toThrow(/atom/);
    expect(() => checkImageCatalog([cell, cell], [])).toThrow(/cell.*повторяется/);
    expect(() => checkImageCatalog([cell, atom], ["cdn.school.example"])).not.toThrow();
  });
});

describe("встроенный поиск", () => {
  const catalog = [atom, cell, { ...cell, id: "plant", title: "Растительная клетка", concepts: ["фотосинтез"], description: "", tags: [] }];

  it("по названию, описанию, понятиям и тегам, без регистра и с падежами", () => {
    expect(searchImages(catalog, "КЛЕТКИ").map((image) => image.id)).toEqual(["cell", "plant"]);
    expect(searchImages(catalog, "органоиды").map((image) => image.id)).toEqual(["cell"]);
    expect(searchImages(catalog, "биология").map((image) => image.id)).toEqual(["cell"]);
    expect(searchImages(catalog, "фотосинтеза").map((image) => image.id)).toEqual(["plant"]);
    expect(searchImages(catalog, "живая").map((image) => image.id)).toEqual(["cell"]);
  });

  it("служебные слова не мешают: «картинка про атом» находит атом", () => {
    expect(searchImages(catalog, "картинка про атом").map((image) => image.id)).toEqual(["atom"]);
  });

  it("ничего не нашлось — пустой список; не больше восьми", () => {
    expect(searchImages(catalog, "квантовая физика")).toEqual([]);
    const many = Array.from({ length: 12 }, (_, index) => ({ ...atom, id: `a${index}` }));
    expect(searchImages(many, "атом")).toHaveLength(8);
  });
});
