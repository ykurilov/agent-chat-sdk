import { describe, expect, it } from "vitest";
import type { StoredMessage } from "@ykurilov/agent-chat-core";
import { searchableText } from "../src/message-text";
import { assistantMessage, userMessage } from "./support";

const partsOf = (parts: unknown[]) => assistantMessage("a1", "u1", parts as StoredMessage["parts"], 1);

describe("текст сообщения для поиска", () => {
  it("берёт текст ответа", () => {
    expect(searchableText(partsOf([{ type: "text", text: "Первое" }, { type: "text", text: "Второе" }]))).toBe("Первое\nВторое");
  });

  it("берёт вызов инструмента: имя, что просили, что вернулось", () => {
    const text = searchableText(
      partsOf([
        {
          type: "tool-web_search",
          toolCallId: "t1",
          state: "output-available",
          input: { query: "курс евро" },
          output: "Курс евро — 101 рубль",
        },
      ]),
    );
    expect(text).toContain("web_search");
    expect(text).toContain("курс евро");
    expect(text).toContain("101 рубль");
  });

  it("берёт текст ошибки инструмента", () => {
    const text = searchableText(
      partsOf([{ type: "tool-read_page", toolCallId: "t1", state: "output-error", input: { url: "https://a.b" }, errorText: "страница закрыта" }]),
    );
    expect(text).toContain("страница закрыта");
  });

  it("рассуждения и картинки не читаются", () => {
    const text = searchableText(
      partsOf([
        { type: "reasoning", text: "тайные мысли", state: "done" },
        { type: "file", mediaType: "image/png", url: "data:image/png;base64,AAAA", filename: "схема.png" },
        { type: "text", text: "готово" },
      ]),
    );
    expect(text).toBe("готово");
  });

  it("теги голоса в ответе голосового хода не попадают в поиск и выдержки: их человек не видел", () => {
    const text = searchableText(partsOf([{ type: "text", text: "[laughs] Ну вот [sighs] курс евро — 101 рубль [1]." }]), { voiceAnswer: true });
    expect(text).toBe("Ну вот курс евро — 101 рубль [1].");
  });

  it("в ответе текстового хода скобки остаются: «[docs]» там обычное слово", () => {
    const text = searchableText(partsOf([{ type: "text", text: "Смотри [docs] и [laughs] тут." }]));
    expect(text).toBe("Смотри [docs] и [laughs] тут.");
  });

  it("слова человека не правятся, а вызовы инструментов с именем в скобках остаются как были", () => {
    const user = userMessage("u1", "напиши [laughs] как есть", 1);
    expect(searchableText(user, { voiceAnswer: true })).toBe("напиши [laughs] как есть");
    const tool = searchableText(partsOf([{ type: "tool-search", toolCallId: "t1", state: "output-available", input: { q: "x" }, output: "ответ" }]));
    expect(tool).toContain("[search]");
  });
});
