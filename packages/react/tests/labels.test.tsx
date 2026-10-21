// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatLabelsProvider, russianLabels, useChatLabels, voiceErrorText } from "../src/labels";
import { stubSkin } from "./support/stub-skin";

function SendAndStop() {
  const labels = useChatLabels();
  return (
    <p>
      {labels.send} | {labels.stop} | {labels.reasoningDone(3)}
    </p>
  );
}

afterEach(cleanup);

describe("словарь надписей", () => {
  it("без провайдера отдаёт russianLabels", () => {
    render(<SendAndStop />);
    expect(screen.getByText("Отправить | Остановить | Думал 3 сек")).toBeTruthy();
  });

  it("ChatLabelsProvider с заменой send меняет только эту надпись", () => {
    render(
      <ChatLabelsProvider labels={{ ...russianLabels, send: "Послать" }}>
        <SendAndStop />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Послать | Остановить | Думал 3 сек")).toBeTruthy();
  });

  it("свой словарь без необязательной externalImageLink: useChatLabels отдаёт русскую по умолчанию", () => {
    const { externalImageLink: _omitted, ...withoutField } = russianLabels;
    function ImageLink() {
      return <p>{useChatLabels().externalImageLink}</p>;
    }
    render(
      <ChatLabelsProvider labels={withoutField}>
        <ImageLink />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("картинка")).toBeTruthy();
  });

  it("русские надписи по умолчанию: все литералы на месте", () => {
    const { reasoningDone, thinkingElapsed, toolRunning, toolDone, toolError, approvalRequested, branchPosition, spendingWarning, spendingExhausted, spendingMessagesLeft, spendingMessagesExhausted, chatListRowMenu, chatListDeleteBody, voiceDialog, memoryCount, memoryShownHint, memoryEditNote, memoryDeleteNote, memoryGroupLabel, memoryDeleteBody, memoryClearBody, memoryMergeDate, memoryMergeRevertFor, widgets, diagram, demo, images, videos, viewer, voice, helpers, tasks, notices, messengerStatus, workView, voiceErrors, ...texts } = russianLabels;
    const { interruptedMark, ...dialogTexts } = voiceDialog;
    expect(demo.loading).toBe("Готовлю демонстрацию…");
    const info = { scope: "user" as const, period: "month" as const, share: 0.8, resetsAt: new Date("2026-11-01T00:00:00Z") };
    expect({
      ...texts,
      reasoningDone: reasoningDone(3),
      thinkingElapsed: thinkingElapsed(65),
      toolRunning: toolRunning("поиск"),
      toolDone: toolDone("поиск"),
      toolError: toolError("поиск"),
      approvalRequested: approvalRequested("удалить заметки"),
      branchPosition: branchPosition(2, 3),
      spendingWarning: spendingWarning(info),
      spendingExhausted: spendingExhausted(info),
      spendingMessagesLeft: spendingMessagesLeft(3, { ...info, unit: "messages" }),
      spendingMessagesExhausted: spendingMessagesExhausted({ ...info, unit: "messages" }),
      chatListRowMenu: chatListRowMenu("Отпуск"),
      chatListDeleteBody: chatListDeleteBody("Отпуск"),
      voiceDialog: { ...dialogTexts, interruptedMark: interruptedMark("Длинный") },
      voiceErrors: { ...voiceErrors, time_limit: voiceErrorText(voiceErrors, "time_limit", { maxSessionSeconds: 300 }) },
      memoryCount: memoryCount(12, 200),
      memoryShownHint: memoryShownHint(40, 57),
      memoryEditNote: memoryEditNote("Любит чай"),
      memoryDeleteNote: memoryDeleteNote("Любит чай"),
      memoryGroupLabel: memoryGroupLabel("Работа", 3),
      memoryDeleteBody: memoryDeleteBody("Любит чай"),
      memoryClearBody: memoryClearBody(12),
      memoryMergeDate: memoryMergeDate(new Date(2026, 8, 30, 12, 5)),
      memoryMergeRevertFor: memoryMergeRevertFor("30 сентября в 12:05"),
    }).toEqual({
      locale: "ru",
      voiceDialog: {
        start: "Голосовой режим",
        exit: "Выйти",
        voiceMenu: "Голос",
        states: {
          off: "Голосовой режим выключен",
          connecting: "Подключаемся…",
          listening: "Слушаю",
          thinking: "Думаю",
          speaking: "Говорю",
          interrupted: "Вы перебили",
          error: "Что-то пошло не так",
        },
        errors: {
          microphone_denied: "Нет доступа к микрофону. Разрешите его в настройках браузера",
          microphone_missing: "Микрофон недоступен: нужны микрофон, https и свежий браузер",
          network: "Нет связи, голосовой режим остановлен",
          service_unavailable: "Голосовой сервис недоступен",
          recognition_lost: "Распознавание речи оборвалось",
          speech_unavailable: "Озвучка недоступна: ответы приходят текстом",
          limit: "Лимит расходов исчерпан",
          rate_limited: "Слишком много включений подряд, попробуйте через минуту",
          idle: "Режим выключен: долго не было слышно речи",
          backgrounded: "Режим выключен: страница ушла в фон",
        },
        interruptedMark: "Вы перебили: озвучено до «Длинный»",
      },
      spendingWarning: "Использовано 80% лимита на месяц",
      spendingExhausted: "Лимит на месяц исчерпан, обновится 1 ноября",
      spendingMessagesLeft: "Осталось 3 сообщения",
      spendingMessagesExhausted: "Лимит сообщений исчерпан, обновится 1 ноября",
      composerPlaceholder: "Напишите сообщение",
      composerLabel: "Сообщение",
      branchPosition: "Вариант 2 из 3",
      previousBranch: "Предыдущий вариант",
      nextBranch: "Следующий вариант",
      regenerate: "Переделать ответ",
      editMessage: "Изменить сообщение",
      saveEdit: "Отправить",
      cancelEdit: "Отмена",
      editMessageLimit: "Лимит сообщений исчерпан. Текст сохранён в поле",
      editErrors: {
        busy: "Ответ ещё идёт. Дождитесь его конца и отправьте снова",
        offline: "Нет связи с сервером. Текст сохранён в поле",
        rejected: "Сервер не принял правку. Текст сохранён в поле",
        spendingLimit: "Лимит расходов исчерпан. Текст сохранён в поле",
        signedOut: "Вход истёк. Войдите снова. Текст сохранён в поле",
        tooManyTurns: "Уже идут ответы в других чатах. Текст сохранён в поле",
        forbiddenOrigin: "Сервер чата не принимает сообщения с этой страницы. Текст сохранён в поле",
      },
      send: "Отправить",
      stop: "Остановить",
      copyAnswer: "Скопировать ответ",
      copied: "Скопировано",
      copyCode: "Скопировать код",
      reasoningRunning: "Думает…",
      reasoningDone: "Думал 3 сек",
      thinkingElapsed: "1 мин 5 с",
      thinkingPhrases: [
        "Думаю…",
        "Прикидываю…",
        "Раскладываю по полочкам…",
        "Сверяю детали…",
        "Собираю мысли…",
        "Взвешиваю варианты…",
        "Ищу лучший ход…",
        "Проверяю себя…",
        "Складываю картину…",
        "Обдумываю…",
      ],
      toolRunning: "поиск: выполняется",
      toolDone: "поиск: готово",
      toolError: "поиск: ошибка",
      approvalRequested: "Агент хочет: удалить заметки",
      approvalWaiting: "Ждёт вашего решения",
      approvalAllow: "Разрешить",
      approvalDeny: "Отклонить",
      approvalAlways: "Всегда в этом чате",
      approvalFailed: "Ответ не дошёл до сервера, попробуйте ещё раз",
      approvalSpendingLimit: "Лимит расходов исчерпан, ответить сейчас нельзя",
      approvalBusy: "Чат занят другим ходом, попробуйте ещё раз",
      approvalTooManyTurns: "Уже идут ответы в других чатах, попробуйте чуть позже",
      approvalAllowedMark: "Разрешено",
      approvalAlwaysMark: "Разрешено в этом чате",
      approvalDeniedMark: "Отклонено",
      approvalAnnouncement: "Агент ждёт вашего решения",
      screenshotAlt: "Снимок страницы",
      screenshotUnavailable: "Снимок не загрузился.",
      answerStopped: "Остановлено",
      answerInterrupted: "Ответ прерван",
      answerEmpty: "Модель не дала ответа",
      externalImageLink: "картинка",
      answerCutByLength: "Ответ оборван по длине",
      answerEdited: "Изменено человеком",
      answerUndelivered: "Не доставлено",
      toolOutputEdited: "Результат изменён",
      editAnswer: "Изменить ответ",
      steeringPending: "Агент учтёт на следующем шаге",
      retry: "Повторить",
      reconnecting: "Переподключаемся…",
      connectionLost: "Нет связи с сервером",
      chatNotFound: "Чат не найден",
      errors: {
        overloaded: "Модель перегружена, попробуйте ещё раз",
        rate_limited: "Слишком много запросов, попробуйте через минуту",
        insufficient_funds: "На счёте провайдера закончились деньги",
        invalid_key: "Ключ провайдера не подходит",
        context_overflow: "Переписка не помещается в модель. Начните новый чат или выберите модель с большим окном",
        other: "Что-то пошло не так, попробуйте ещё раз",
        signed_out: "Вход истёк. Войдите снова",
        too_many_turns: "Уже идут ответы в других чатах. Дождитесь, пока один закончится, и отправьте снова",
        forbidden_origin: "Сервер чата не принимает сообщения с этой страницы. Сообщите администратору сайта",
      },
      reasoningLevels: {
        off: "Выкл",
        on: "Вкл",
        minimal: "Минимальный",
        low: "Низкий",
        medium: "Средний",
        high: "Высокий",
        max: "Максимум",
      },
      historyCompacted: "История сжата",
      historyCompactedHint: "Вместо сообщений выше модель видит эту сводку. Сами сообщения никуда не делись.",
      modelChoiceFailed: "Не удалось сменить модель",
      modelMenuFailed: "Список моделей не загрузился",
      voiceStart: "Диктовать",
      voiceStop: "Остановить диктовку",
      voiceConnecting: "Подключаемся к микрофону…",
      voicePolishing: "Приводим текст в порядок…",
      voiceErrors: {
        permission_denied: "Нет доступа к микрофону. Разрешите его в настройках браузера",
        no_microphone: "Микрофон не найден",
        unsupported: "Этот браузер не умеет записывать звук",
        network: "Нет связи, диктовка прервана",
        service_unavailable: "Сервис распознавания речи недоступен",
        other: "Не удалось начать диктовку",
        rate_limited: "Слишком много диктовок подряд, попробуйте через минуту",
        time_limit: "Запись остановлена: предел 5 минут",
        limit: "Лимит расходов исчерпан, диктовка недоступна",
        forbidden: "Нет доступа к диктовке",
        too_long: "Запись слишком длинная",
      },
      chatListHeading: "Чаты",
      chatListNewChat: "Новый чат",
      chatListUntitled: "Новый чат",
      chatListOrigin: { telegram: "Telegram", vk: "ВКонтакте", max: "MAX" },
      chatListClosed: "Закрыт",
      chatListLoading: "Загружаем чаты…",
      chatListLoadFailed: "Список чатов не загрузился",
      chatListCreateFailed: "Не удалось создать чат",
      chatListRenameFailed: "Не удалось переименовать чат",
      chatListDeleteFailed: "Не удалось удалить чат",
      chatListRowMenu: "Действия с чатом «Отпуск»",
      chatListRename: "Переименовать",
      chatListRenameField: "Название чата",
      chatListDelete: "Удалить",
      chatListDeleteTitle: "Удалить чат?",
      chatListDeleteBody: "Чат «Отпуск» и вся его переписка будут удалены насовсем.",
      chatListDeleteConfirm: "Удалить",
      chatListDeleteCancel: "Отмена",
      memoryHeading: "Память",
      memoryCount: "Записей: 12 из 200",
      memoryShownHint: "Показано агенту: 40 из 57. Остальное он находит поиском.",
      memoryAdd: "Добавить",
      memoryClearAll: "Стереть всю память",
      memoryLoading: "Загружаем память…",
      memoryEmpty: "Память пуста. Агент запоминает важное по ходу разговора, а вы можете добавить запись сами.",
      memoryUnavailable: "Память в этом приложении не включена",
      memoryLoadFailed: "Память не загрузилась",
      memoryEdit: "Изменить",
      memoryDelete: "Удалить",
      memoryEditNote: "Изменить запись «Любит чай»",
      memoryDeleteNote: "Удалить запись «Любит чай»",
      memoryGroupLabel: "Работа, записей: 3",
      memoryNewNoteTitle: "Новая запись",
      memoryEditNoteTitle: "Изменить запись",
      memoryPathField: "Раздел",
      memoryPathHint: "До трёх уровней через «/», например: О себе / Работа",
      memoryContentField: "Запись",
      memorySave: "Сохранить",
      memoryCancel: "Отмена",
      memoryFieldErrors: {
        pathRequired: "Укажите раздел",
        pathTooMany: "Не больше трёх уровней раздела",
        pathTooLong: "Название раздела не длиннее 60 знаков",
        contentRequired: "Напишите текст записи",
        contentTooLong: "Запись не длиннее 500 знаков",
      },
      memoryErrors: {
        not_found: "Такой записи уже нет. Список обновлён",
        stale_version: "Запись изменилась в другом месте. Список обновлён: проверьте и повторите",
        limit_reached: "Память заполнена. Удалите ненужные записи и повторите",
        duplicate: "Такая запись уже есть",
        invalid: "Сервер не принял запись. Проверьте разделы и текст",
        conflict: "Вернуть как было уже нельзя: записи с тех пор менялись. Список обновлён",
        unavailable: "Память в этом приложении не включена",
        other: "Не удалось выполнить действие, попробуйте ещё раз",
      },
      memoryDeleteTitle: "Удалить запись?",
      memoryDeleteBody: "Запись «Любит чай» будет удалена насовсем.",
      memoryClearTitle: "Стереть всю память?",
      memoryClearBody: "Все записи (12) будут удалены насовсем. Агент забудет всё, что знал о вас.",
      memoryConfirmDelete: "Удалить",
      memoryConfirmClear: "Стереть всё",
      memoryConfirmCancel: "Отмена",
      memoryMergesHeading: "Объединено",
      memoryMergeDate: "30 сентября в 12:05",
      memoryMergeBefore: "Было",
      memoryMergeAfter: "Стало",
      memoryMergeRevert: "Вернуть как было",
      memoryMergeRevertFor: "Вернуть как было (30 сентября в 12:05)",
      memoryMergeNotRevertible: "Вернуть нельзя: записи с тех пор менялись",
      memoryRevertErrors: {
        limit_reached: "Вернуть как было нельзя: в памяти не хватит места. Удалите ненужные записи и повторите",
        duplicate: "Вернуть как было нельзя: одну из записей вы уже добавили заново. Удалите повтор и повторите",
      },
      agentPanelLauncher: "Агент",
      agentPanelOpen: "Открыть агента",
      agentPanelClose: "Закрыть панель агента",
      agentPanelLabel: "Панель агента",
      agentPanelChats: "Чаты",
      agentPanelBackToChat: "К чату",
      agentPanelBusy: "Агент отвечает",
      agentPanelToolUnavailable: "Инструмент недоступен на этой странице",
    });
  });

  it("простой вид работы агента: русские надписи по умолчанию", () => {
    const { live, stepFailed, stepUnfinished, stepRepeated, stepsDone, helperRunning, helperDone, thought, moreSteps, ...texts } = russianLabels.workView;
    expect({
      ...texts,
      live: live("Рисую календарь"),
      stepFailed: stepFailed("Пишу файл"),
      stepUnfinished: stepUnfinished("Пишу файл"),
      stepRepeated: stepRepeated("Поискал в интернете", 5),
      stepsDone: [1, 3, 6, 11, 21].map(stepsDone),
      helperRunning: helperRunning("researcher"),
      helperDone: helperDone("researcher"),
      thought: [thought(4_000), thought(null)],
      moreSteps: moreSteps(3),
    }).toEqual({
      stepRunning: "Работаю",
      stepDone: "Сделал шаг",
      stepFailedUnknown: "Шаг не получился",
      stepUnfinishedUnknown: "Шаг не закончен",
      thinking: "Думаю",
      live: "Рисую календарь…",
      stepFailed: "Пишу файл — не вышло",
      stepUnfinished: "Пишу файл — не закончил",
      stepRepeated: "Поискал в интернете ×5",
      stepsDone: ["Сделан 1 шаг", "Сделано 3 шага", "Сделано 6 шагов", "Сделано 11 шагов", "Сделан 21 шаг"],
      helperRunning: "Помощник «researcher» работает",
      helperDone: "Помощник «researcher» закончил",
      thought: ["Думал 4 сек", "Подумал"],
      moreSteps: "+3",
    });
  });

  it("подмена connectionLost через ChatLabelsProvider видна в ConnectionNotice", () => {
    const { ConnectionNotice } = stubSkin;
    render(
      <ChatLabelsProvider labels={{ ...russianLabels, connectionLost: "Связь пропала", reconnecting: "Ищем сеть…" }}>
        <ConnectionNotice state="offline" onRetry={() => {}} />
        <ConnectionNotice state="reconnecting" />
      </ChatLabelsProvider>,
    );
    expect(screen.getByText("Связь пропала")).toBeTruthy();
    expect(screen.getByText("Ищем сеть…")).toBeTruthy();
    expect(screen.queryByText("Нет связи с сервером")).toBeNull();
  });
});
