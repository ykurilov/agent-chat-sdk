import { describe, expect, it } from "vitest";
import { foreignWordsIn } from "../src/found-foreign-words";

describe("чужие слова в русском ответе", () => {
  const found = (text: string, known: string[] = []) => foreignWordsIn(text, known, "cyrillic");

  it("иероглифы, японское и корейское письмо, другие алфавиты ловятся всегда, даже если были в знакомых текстах", () => {
    expect(found("Это часть 歷史 вашей семьи.")).toEqual(["歷史"]);
    expect(found("Спасибо, ありがとう и 감사합니다!", ["ありがとう 감사합니다"])).toEqual(["ありがとう", "감사합니다"]);
    expect(found("Это شكرا и Ελλάδα.")).toEqual(["شكرا", "Ελλάδα"]);
  });

  it("латинское слово, которого нет в знакомых текстах, — чужое", () => {
    expect(found("Actually, это важно. Она teaches детей.", ["Ты консультант Ирины."])).toEqual(["Actually", "teaches"]);
  });

  it("слова из знакомых текстов законны: у преподавателя английского свои термины", () => {
    const known = ["Разбираем Present Perfect и разговорный английский.", "Я путаю I have been и I was"];
    expect(found("Present perfect — это когда «I have been» про опыт до сих пор, а «I was» — про прошлое.", known)).toEqual([]);
  });

  it("ссылки, почта и @имена не трогает", () => {
    expect(found("Пишите на anna.coach@mail.ru, в t.me/anna_coach или @anna_coach. Сайт: https://anna-coach.com/start и www.example.org.")).toEqual([]);
  });

  it("любой домен с путём не трогает: youtu.be, bit.ly", () => {
    expect(found("Ролик: youtu.be/abc123, анкета: bit.ly/form-1, сайт anna.studio.")).toEqual([]);
  });

  it("названия из знакомых текстов узнаёт без учёта регистра", () => {
    const known = ["Созвон в Zoom. Курс «Money Mindset».", "Ролик: Как начать в YouTube", "До встречи в Telegram!"];
    expect(found("Встреча в zoom, курс Money mindset, ролик про YOUTUBE, потом в Telegram.", known)).toEqual([]);
  });

  it("одиночные латинские буквы и римские цифры не считаются словами", () => {
    expect(found("План B на XXI век, пункт a.")).toEqual([]);
  });

  it("сокращения из заглавных и слова с большой буквой внутри — названия", () => {
    expect(found("Пришлю PDF, заведём в CRM, напишу в WhatsApp или на iPhone.")).toEqual([]);
  });

  it("распространённые сервисы и название с большой буквы посреди фразы — не чужие; то же слово в начале фразы — чужое", () => {
    expect(found("Telegram удобнее. Созвон в zoom или в Calendly, запись в Instagram.")).toEqual([]);
    expect(found("Встреча в Calendly. Thanks за ответ!")).toEqual(["Thanks"]);
  });

  it("латинская буква внутри русского слова — слово чужое целиком, даже если слово из знакомых текстов", () => {
    expect(found("Пpивет, это вaжно.")).toEqual(["Пpивет", "вaжно"]);
    expect(found("Пpивет!", ["Пpивет"])).toEqual(["Пpивет"]);
  });

  it("имена из настройки законны, как и знакомые тексты", () => {
    expect(foreignWordsIn("Запишем в Notion и в airtable.", [], "cyrillic", ["airtable"])).toEqual([]);
    expect(foreignWordsIn("Запишем в airtable.", [], "cyrillic")).toEqual(["airtable"]);
  });

  it("обычный русский ответ чист", () => {
    expect(found("Понимаю, это непросто. Что сейчас мешает больше всего?")).toEqual([]);
  });
});

describe("чужие слова в ответе латиницей (английский ответ)", () => {
  const found = (text: string, known: string[] = [], names: string[] = []) => foreignWordsIn(text, known, "latin", names);

  it("английский ответ чист: латиница тут своя", () => {
    expect(found("Actually, this is important. Thanks for asking!")).toEqual([]);
  });

  it("кириллица в английском ответе — чужая; иероглифы — чужие всегда", () => {
    expect(found("Sure, привет and 歷史 here.")).toEqual(["привет", "歷史"]);
  });

  it("кириллическое слово из знакомых текстов или из имён законно", () => {
    expect(found("Thanks, Иван!", ["Ваш менеджер: Иван"])).toEqual([]);
    expect(found("Thanks, Иван!", [], ["Иван"])).toEqual([]);
  });

  it("кириллица и латиница в одном слове — чужое слово", () => {
    expect(found("Hello, thаnks!")).toEqual(["thаnks"]);
  });

  it("ссылки не трогает", () => {
    expect(found("Write to anna@mail.ru or see https://anna.ru/старт.")).toEqual([]);
  });
});
