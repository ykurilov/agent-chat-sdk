import { describe, expect, it } from "vitest";
import { createDictationField } from "../src/dictation-field";

describe("запись диктовки в поле", () => {
  it("в пустое поле: слова без ведущего пробела, промежуточные заменяются", () => {
    const field = createDictationField("");

    expect(field.write({ finalText: "", interimText: "При" })).toBe("При");
    expect(field.write({ finalText: "Привет", interimText: " ми" })).toBe("Привет ми");
    expect(field.write({ finalText: "Привет мир", interimText: "" })).toBe("Привет мир");
  });

  it("после набранного текста — через пробел, набранное не теряется", () => {
    const field = createDictationField("Слушай,");

    expect(field.write({ finalText: "Привет", interimText: "" })).toBe("Слушай, Привет");
    expect(field.write({ finalText: "Привет", interimText: " мир" })).toBe("Слушай, Привет мир");
  });

  it("набранный текст уже кончается пробелом или переводом строки — второй не добавляется", () => {
    expect(createDictationField("Слушай, ").write({ finalText: "Привет", interimText: "" })).toBe("Слушай, Привет");
    expect(createDictationField("Строка\n").write({ finalText: "Привет", interimText: "" })).toBe("Строка\nПривет");
  });

  it("пока ничего не сказано, поле не меняется (пробел не дописывается)", () => {
    expect(createDictationField("Слушай,").write({ finalText: "", interimText: "" })).toBe("Слушай,");
    expect(createDictationField("").write({ finalText: "", interimText: "" })).toBe("");
  });

  it("ручная правка: остаётся, продиктованное раньше не дублируется, новое дописывается в конец", () => {
    const field = createDictationField("");
    const written = field.write({ finalText: "Привет", interimText: "" });
    expect(written).toBe("Привет");

    field.observe("Привет,");
    expect(field.write({ finalText: "Привет мир", interimText: "" })).toBe("Привет, мир");
  });

  it("свою же запись за правку не считает", () => {
    const field = createDictationField("");
    const written = field.write({ finalText: "Привет", interimText: "" })!;

    field.observe(written);

    expect(field.write({ finalText: "Привет мир", interimText: "" })).toBe("Привет мир");
  });

  it("правка, стёршая всё поле: дальше диктовка пишет в чистое поле", () => {
    const field = createDictationField("");
    field.write({ finalText: "Привет мир", interimText: "" });

    field.observe("");

    expect(field.write({ finalText: "Привет мир пока", interimText: "" })).toBe("пока");
  });

  it("поле очищено отправкой, диктовка идёт дальше: новая речь начинает новое сообщение", () => {
    const field = createDictationField("");
    field.write({ finalText: "Раз два", interimText: "" });

    field.observe("");

    expect(field.write({ finalText: "Раз два три", interimText: " четыре" })).toBe("три четыре");
  });

  it("правка посреди ещё не закреплённого слова: текст не ломается, закреплённое не дублируется", () => {
    const field = createDictationField("");
    expect(field.write({ finalText: "Привет", interimText: " ми" })).toBe("Привет ми");

    field.observe("Привет ми!");

    const next = field.write({ finalText: "Привет мир", interimText: "" });
    expect(next).toBe("Привет ми! мир");
    expect(next).not.toContain("! р");
  });

  it("правка в начале ещё не закреплённой фразы: дальше дописывается только закреплённое после `finalText`", () => {
    const field = createDictationField("");
    field.write({ finalText: "Раз", interimText: " два три" });

    field.observe("Раз два три.");

    expect(field.write({ finalText: "Раз два три", interimText: "" })).toBe("Раз два три. два три");
  });

  describe("замена надиктованного куска исправленным текстом", () => {
    const dictated = (startValue: string, speech = "ну э-э привет") => {
      const field = createDictationField(startValue);
      const written = field.write({ finalText: speech, interimText: "" })!;
      return { field, written };
    };

    it("в пустом поле заменяется весь надиктованный текст", () => {
      const { field } = dictated("");
      field.freeze();

      expect(field.applyPolished("Привет.")).toBe("Привет.");
    });

    it("набранное до диктовки остаётся, заменяется только надиктованный кусок", () => {
      const { field, written } = dictated("Слушай,");
      field.freeze();
      field.observe(written);

      expect(field.applyPolished("Привет.")).toBe("Слушай, Привет.");
    });

    it("дописали руками после диктовки — хвост сохраняется", () => {
      const { field, written } = dictated("Слушай,");
      field.freeze();

      field.observe(`${written} и всё`);

      expect(field.applyPolished("Привет.")).toBe("Слушай, Привет. и всё");
    });

    it("пока поле заморожено, write ничего не пишет: дописанное руками не стирается, чистка встаёт на место", () => {
      const { field, written } = dictated("Слушай,");
      field.freeze();
      field.observe(`${written} и всё`);

      expect(field.write({ finalText: "ну э-э привет", interimText: "" })).toBeNull();

      expect(field.applyPolished("Привет.")).toBe("Слушай, Привет. и всё");
    });

    it("поправили внутри надиктованного или до него — чистка не применяется", () => {
      const { field, written } = dictated("Слушай,");
      field.freeze();

      field.observe(written.replace("э-э", "эээ"));

      expect(field.applyPolished("Привет.")).toBeNull();
    });

    it("поправили до диктовки во время чистки — не применяется", () => {
      const { field } = dictated("Слушай,");
      field.freeze();

      field.observe("Слушайте, ну э-э привет");

      expect(field.applyPolished("Привет.")).toBeNull();
    });

    it("поле стёрли — не применяется, ничего не возвращается в пустое поле", () => {
      const { field } = dictated("");
      field.freeze();

      field.observe("");

      expect(field.applyPolished("Привет.")).toBeNull();
    });

    it("правка руками во время самой диктовки (до «стоп») — надиктованный кусок не восстановить, чистка не применяется", () => {
      const field = createDictationField("");
      const written = field.write({ finalText: "ну э-э привет", interimText: "" })!;
      field.observe(`${written}!`);
      field.write({ finalText: "ну э-э привет мир", interimText: "" });
      field.freeze();

      expect(field.applyPolished("Привет, мир.")).toBeNull();
    });

    it("ничего не надиктовано — применять нечего", () => {
      const field = createDictationField("Слушай,");
      field.write({ finalText: "", interimText: "" });
      field.freeze();

      expect(field.applyPolished("Привет.")).toBeNull();
    });

    it("после замены поле считается нашей записью: та же строка не воспринимается как правка", () => {
      const { field } = dictated("");
      field.freeze();
      const replaced = field.applyPolished("Привет.")!;

      field.observe(replaced);

      expect(field.applyPolished("Привет!")).toBe("Привет!");
    });
  });
});
