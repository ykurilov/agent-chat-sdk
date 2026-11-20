import { describe, expect, it } from "vitest";
import { textFitsInRow } from "../src/composer-row";

/* Поле в одну строку, только пока тексту остаётся 55 % строки (но 320 px хватает всегда) и не меньше 160 px (подсказка целиком). */
describe("хватает ли тексту места в одной строке с кнопками", () => {
  it("телефон 390 px, только «+» и «Отправить» — одна строка", () => expect(textFitsInRow(316, 92)).toBe(true));
  it("телефон 390 px, пять кнопок — тексту 86 px, не помещается", () => expect(textFitsInRow(316, 230)).toBe(false));
  it("порог — 55 % строки", () => {
    expect(textFitsInRow(500, 225)).toBe(true);
    expect(textFitsInRow(500, 226)).toBe(false);
  });
  it("на широкой строке 320 px тексту хватает, даже если это меньше 55 %", () => {
    expect(textFitsInRow(700, 380)).toBe(true);
    expect(textFitsInRow(700, 381)).toBe(false);
  });
  it("на узкой строке — не меньше 160 px тексту", () => {
    expect(textFitsInRow(250, 90)).toBe(true);
    expect(textFitsInRow(250, 91)).toBe(false);
  });
  it("ширина не измерена (поле скрыто) — одна строка, без скачков", () => expect(textFitsInRow(0, 0)).toBe(true));
});
