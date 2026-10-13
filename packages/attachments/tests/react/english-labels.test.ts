import { describe, expect, it } from "vitest";
import { englishAttachmentsLabels, russianAttachmentsLabels } from "../../src/react/labels";

const shape = (value: unknown): unknown =>
  typeof value === "function" ? "fn" : typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)])) : "text";

describe("englishAttachmentsLabels", () => {
  it("те же ключи, что у русского словаря", () => {
    expect(shape(englishAttachmentsLabels)).toEqual(shape(russianAttachmentsLabels));
  });

  it("ни одной русской буквы, размер по-английски", () => {
    const texts = [
      JSON.stringify(englishAttachmentsLabels),
      englishAttachmentsLabels.tooManyFiles(5),
      englishAttachmentsLabels.fileTooLarge("notes.txt", 20 * 1024 * 1024),
      englishAttachmentsLabels.fileTooLarge("notes.txt", 512 * 1024),
      englishAttachmentsLabels.fileProblem("notes.txt", englishAttachmentsLabels.errors.empty),
    ];
    expect(texts.join("\n")).not.toMatch(/[А-Яа-яЁё]/);
    expect(englishAttachmentsLabels.fileTooLarge("notes.txt", 20 * 1024 * 1024)).toBe("File “notes.txt” is larger than 20 MB, so we can’t take it.");
  });
});
