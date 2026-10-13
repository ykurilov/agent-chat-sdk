// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatLabelsProvider, russianLabels, useChatLabels } from "../src/labels";
import type { ChatLabels } from "../src/labels";

afterEach(cleanup);

function Probe({ read }: { read: (labels: ReturnType<typeof useChatLabels>) => string }) {
  return <p>{read(useChatLabels())}</p>;
}

describe("надписи версии 13: виджеты, схемы, картинки, окно просмотра", () => {
  it("русские надписи по умолчанию", () => {
    const { ratingStars } = russianLabels.widgets;
    const { counter } = russianLabels.viewer;
    expect({
      widgets: {
        ...russianLabels.widgets,
        ratingStars: ratingStars(3, 5),
        choiceRange: [russianLabels.widgets.choiceRange(1, 3), russianLabels.widgets.choiceRange(2, 2)],
        formOutOfRange: [
          russianLabels.widgets.formOutOfRange("1", "9"),
          russianLabels.widgets.formOutOfRange("1", undefined),
          russianLabels.widgets.formOutOfRange(undefined, "9"),
        ],
        formTooLong: russianLabels.widgets.formTooLong(2000),
      },
      diagram: russianLabels.diagram,
      images: russianLabels.images,
      viewer: { ...russianLabels.viewer, counter: counter(3, 12) },
      voice: {
        ...russianLabels.voice,
        widgetChoices: russianLabels.voice.widgetChoices("Куда?", ["Море", "Горы"]),
        widgetOnScreen: russianLabels.voice.widgetOnScreen(),
      },
    }).toEqual({
      widgets: {
        answeredByMessage: "Ответ дан сообщением",
        submit: "Готово",
        choose: "Выберите вариант или ответьте своими словами",
        ratingStars: "Оценка 3 из 5",
        answerFailed: "Ответ не отправился, попробуйте ещё раз",
        notCurrentBranch: "Вопрос из другой ветки: ответить на него можно только там",
        fallback: "Ответьте сообщением",
        formRequired: "Обязательное поле",
        asked: "Агент задал вопрос",
        answerSent: "Ответ отправлен",
        formSubmit: "Отправить",
        choiceRange: ["Выберите от 1 до 3", "Выберите 2"],
        formOutOfRange: ["Допустимо от 1 до 9", "Допустимо от 1", "Допустимо до 9"],
        formNotNumber: "Введите число",
        formNotDate: "Введите дату",
        formTooLong: "Не длиннее 2000 знаков",
        alreadyAnswered: "На этот вопрос уже ответили",
        answerRejected: "Такой ответ не подходит, ответьте сообщением",
        answerCheckTimeout: "Не удалось проверить ответ, попробуйте ещё раз",
      },
      diagram: {
        loading: "Схема рисуется…",
        failed: "Схему не удалось нарисовать, показан её текст",
        open: "Открыть схему",
      },
      images: {
        loading: "Картинка создаётся…",
        failed: "Картинка не создалась",
        stopped: "Создание остановлено",
        open: "Открыть картинку",
      },
      viewer: {
        close: "Закрыть",
        next: "Следующая",
        previous: "Предыдущая",
        fit: "Вписать в экран",
        counter: "3 из 12",
      },
      voice: {
        diagramOnScreen: "схема на экране",
        videoOnScreen: "видео на экране",
        widgetChoices: "Куда? Варианты: Море, Горы.",
        widgetOnScreen: "Ответьте на экране или голосом.",
      },
    });
  });

  it("без провайдера useChatLabels отдаёт новые надписи", () => {
    render(<Probe read={(labels) => `${labels.widgets.submit}|${labels.viewer.counter(1, 2)}|${labels.voice.diagramOnScreen}`} />);
    expect(screen.getByText("Готово|1 из 2|схема на экране")).toBeTruthy();
  });

  it("свои подписи приложения перекрывают новые ключи, остальные новые остаются русскими", () => {
    const labels: ChatLabels = {
      ...russianLabels,
      widgets: { submit: "Отправить ответ" },
      viewer: { close: "Закрыть окно", counter: (n, total) => `${n}/${total}` },
      voice: { diagramOnScreen: "диаграмма на экране" },
    };
    render(
      <ChatLabelsProvider labels={labels}>
        <Probe
          read={(l) => [l.widgets.submit, l.widgets.fallback, l.viewer.close, l.viewer.counter(2, 9), l.viewer.fit, l.voice.diagramOnScreen, l.diagram.open].join("|")}
        />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Отправить ответ|Ответьте сообщением|Закрыть окно|2/9|Вписать в экран|диаграмма на экране|Открыть схему")).toBeTruthy();
  });

  it("полный словарь приложения, написанный до версии 13 (без новых ключей), работает и берёт русские новые надписи", () => {
    const { widgets: _w, diagram: _d, images: _i, viewer: _v, voice: _vo, ...beforeV13 } = russianLabels;
    const old: ChatLabels = { ...beforeV13, send: "Послать" };
    render(
      <ChatLabelsProvider labels={old}>
        <Probe read={(l) => `${l.send}|${l.widgets.answeredByMessage}|${l.images.open}`} />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Послать|Ответ дан сообщением|Открыть картинку")).toBeTruthy();
  });
});
