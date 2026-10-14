import { describe, expect, it } from "vitest";
import { linksIn, unknownLinksIn, withoutLinks } from "../src/links-in-text";

describe("ссылки в тексте ответа", () => {
  it("находит http(s)://, www., домен с путём и t.me/…; знаки в конце — не часть ссылки; почта и @имя — не ссылки", () => {
    expect(
      linksIn("Запись: https://yoga-anna.ru/probnoe. Ещё www.anna.ru, t.me/anna_bot и bit.ly/x1? Почта anna@mail.ru, @anna_coach, сайт anna.ru"),
    ).toEqual(["https://yoga-anna.ru/probnoe", "www.anna.ru", "t.me/anna_bot", "bit.ly/x1"]);
  });

  it("ссылка из знакомых текстов законна; то же без https:// или с ним — тоже; выдуманная или изменённая — нет", () => {
    const known = ["Ссылка на запись: https://yoga-anna.ru/probnoe", "Канал t.me/anna_yoga"];
    expect(unknownLinksIn("Вот запись: https://yoga-anna.ru/probnoe", known)).toEqual([]);
    expect(unknownLinksIn("Вот запись: yoga-anna.ru/probnoe и https://t.me/anna_yoga", known)).toEqual([]);
    expect(unknownLinksIn("Вот: https://yoga-anna.ru/probnoe-2 и https://yoga-anna.ru/zapis", known)).toEqual([
      "https://yoga-anna.ru/probnoe-2",
      "https://yoga-anna.ru/zapis",
    ]);
  });

  it("домен без учёта регистра и косая черта в конце не делают ссылку чужой", () => {
    expect(unknownLinksIn("Вот: https://A.ru/x/", ["a.ru/x"])).toEqual([]);
  });

  it("голый адрес из знакомых текстов делает законной ссылку на него", () => {
    expect(unknownLinksIn("Откройте https://sveta-nails.example.com", ["Мой сайт sveta-nails.example.com"])).toEqual([]);
  });

  it("вырезание убирает подводку «: » перед ссылкой и лишние пробелы перед знаками", () => {
    expect(withoutLinks("Вот: https://fake.ru/a. Жду!", ["https://fake.ru/a"])).toBe("Вот. Жду!");
    expect(withoutLinks("Запись тут: www.fake.ru, жду", ["www.fake.ru"])).toBe("Запись тут, жду");
  });
});

describe("короткий адрес приложения", () => {
  const instruction = "Приложение открывается по ссылке вида адрес.apps.example.com. Сервис: https://studio.example.com/";

  it("человек прислал адрес без схемы — ссылка с https:// на него законна", () => {
    expect(unknownLinksIn("Откройте https://sveta-nails.apps.example.com и проверьте", [instruction, "Вот: sveta-nails.apps.example.com"])).toEqual([]);
  });

  it("домен-шаблон из знакомых текстов: голое имя из слов человека законно; другое имя или чужой домен — нет", () => {
    const known = [instruction, "Опубликовала, адрес sveta-nails"];
    expect(unknownLinksIn("Ваша ссылка: https://sveta-nails.apps.example.com/", known)).toEqual([]);
    expect(unknownLinksIn("Ваша ссылка: https://sveta.apps.example.com/", known)).toEqual(["https://sveta.apps.example.com/"]);
    expect(unknownLinksIn("Ваша ссылка: https://sveta-nails.studio.example.com/", known)).toEqual(["https://sveta-nails.studio.example.com/"]);
  });

  it("домен приложений можно задать настройкой — шаблон в инструкции не нужен", () => {
    const known = ["Опубликовала, адрес sveta-nails"];
    expect(unknownLinksIn("Ваша ссылка: https://sveta-nails.apps.example.com/", known)).toEqual(["https://sveta-nails.apps.example.com/"]);
    expect(unknownLinksIn("Ваша ссылка: https://sveta-nails.apps.example.com/", known, ["apps.example.com"])).toEqual([]);
    expect(unknownLinksIn("Ваша ссылка: https://sveta.apps.example.com/", known, ["apps.example.com"])).toEqual(["https://sveta.apps.example.com/"]);
  });

  it("имя с точкой после него — уже другой адрес, а не короткое имя", () => {
    expect(unknownLinksIn("Ссылка: https://sveta-nails.ru.apps.example.com/", ["адрес sveta-nails.ru"], ["apps.example.com"])).toEqual([
      "https://sveta-nails.ru.apps.example.com/",
    ]);
  });
});
