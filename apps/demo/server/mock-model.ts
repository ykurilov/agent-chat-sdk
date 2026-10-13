import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { APICallError, simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { fakeSearchResult, researchTaskPrefix, researchTaskTopic } from "./demo-background";
import { demoPageUrl, demoSearchQuery } from "./demo-web-services";

/*
 * Модель-заглушка для e2e (DEMO_MODEL=mock): рассуждает, затем пишет ответ по кусочкам.
 * Вопрос про время в Токио и Москве — два вызова `current_time`, про справочную службу —
 * вызов падающего `broken_lookup`, «очисти заметки» — вызов опасного `clear_notes`, который ждёт подтверждения, «огромный» — ответ на 50 000 символов с таблицами и кодом,
 * «бесконечный» — ответ на 240 абзацев (около четырёх минут) для проверок долгой потери связи,
 * «подумай подольше» — начало рассуждения, 70 секунд тишины и короткий ответ, «поищи в интернете» —
 * поиск, чтение найденной страницы и ответ со ссылкой на источник, «скриншот» — снимок страницы,
 * «кто отвечает» — пара провайдер/модель и настройки рассуждений из запроса, «подробно» — ответ на 4 000 знаков
 * за секунду (для сжатия истории), «какой код» — поиск по старой переписке и ответ по найденному.
 * «по-разному» — каждый повтор того же вопроса получает свой ответ («Вариант ответа N»), «как меня зовут» — имя из
 * последней фразы «меня зовут …» в переданной истории (по нему видно, какая ветка ушла модели).
 * «Создай задачу <название>» — вызов `create_task` (демо-страница с панелью), затем ответ «Создал задачу «<название>»».
 * «Создай три задачи <метка>» — три вызова `create_task` («<метка> 1», «<метка> 2», «<метка> 3») по одному на шаг; в первый раз
 * провайдер обрывает ход перед третьим вызовом, продолжение того же хода («Повторить») создаёт третью и отвечает.
 * «Оборвись посреди ответа» — начало ответа, затем ошибка перегрузки провайдера кусочком потока посреди текста; запрос
 * автопродолжения (пометка о сбое последним сообщением человека) дописывает ответ с места обрыва.
 * «Открой задачу <номер>» — вызов браузерного `open_task`, затем «Открыл задачу <номер>»; «зависни» — вызов `freeze_page`,
 * на который страница не отвечает (проверка срока), затем «Страница не ответила вовремя».
 * «Где я» — место на экране из запроса («Вы сейчас здесь: …»); места нет — «Не вижу, где вы сейчас».
 * Память (`DEMO_MEMORY=1`): «запомни, что …» — вызов `manage_memory` с записью, «что ты помнишь» — ответ записями из блока
 * `<agent_memory>` в конце сообщения человека: шапка и по блоку на запись (нет записей — «В памяти ничего нет»). Блоки не мешают
 * разбору вопроса: из текста вопроса они вырезаются.
 * «Покажи чужую картинку» — ответ с картинкой по чужому адресу (`externalImageUrl`): скин должен показать её ссылкой, а не грузить.
 * Если у сообщения есть вложения: «Вижу картинку» на каждую картинку, «Прочитал файл» с началом текста, «не вижу» — если
 * картинку не показали.
 * Проверка дублей памяти (запрос без потока со словами «Текущие записи:»): записи, что целиком вошли в самую длинную,
 * предлагаются к слиянию в неё; таких нет — пустой список.
 * Расход токенов пропорционален запросу и ответу (знаков на токен — четыре), поэтому малый порог сжатия срабатывает
 * по-настоящему. На задание сжатия (запрос без потока) отвечает сводкой из шести разделов без деталей переписки.
 * Виджеты (`agent.widgets`): «спроси тариф» — `ask_choice`, затем «Выбран тариф «…»», «выбери несколько» — `ask_multi_choice`, «оцени» —
 * `ask_rating`, «заполни форму» — `ask_form`, «выбери время» — свой `pick_slot`, «подскажи» — ответ с `suggest_replies`,
 * «спроси дважды» — два вопроса в одном шаге (второй сервер отклоняет). Ответом на любой ждущий виджет, закрытый сообщением,
 * модель отвечает «Ответили сообщением».
 * Схемы (`agent.diagrams`): «нарисуй схему» — ответ с блоком ```mermaid (блок печатается кусками), «нарисуй широкую схему» — схема
 * шире экрана телефона, «нарисуй сломанную схему» — блок, который не разбирается.
 * Живые демонстрации (`agent.liveDemos`): «покажи демонстрацию» — блок ```html-demo с ползунком и кнопкой, которые меняют текст
 * (блок печатается кусками), «покажи большую демонстрацию» — блок больше 30 КБ. «Запусти демонстрации:» и код через строки
 * `-----` — каждый кусок своим блоком (проверка защиты: код приходит из теста).
 * Картинки (`generate_images`): «нарисуй картинку» — один заказ, «нарисуй три картинки» — три, одна из них отклоняется поддельным
 * Runware, «нарисуй восемь картинок» — восемь, ответ держится до «Стопа» (mock-runware.ts; «метка <слово>» в вопросе называет заказ для запроса `/pending/<слово>`); после результата — «Создано N из M».
 * Видео (`find_videos`, `show_video`): «покажи урок про <тема>» — поиск по теме и показ первого найденного, «… с примеров» — с начала
 * главы «Примеры», «покажи несуществующее видео» — показ id не из каталога (сервер отказывает).
 * Помощники и фон (`agent.helpers`, пакет фона): «Поручи исследователю <тема>» — вызов `helper_researcher` с заданием «Изучи тему: <тема>»
 * (само задание помощник узнаёт по этому началу и своему `search_sources`: ищет, затем докладывает), затем ответ «Исследователь закончил…».
 * «Запусти отчёт <тема>» — вызов фонового `report`, затем «Запустил отчёт … он делается в фоне». Служебное сообщение «Фоновая задача "…" закончилась: …»
 * (его присылает пакет фона) — реакция «Фоновая задача закончилась. Итог: …».
 * Поправка на лету (фича 034): «долгая проверка» — вызов `slow_check` на пять секунд, затем «Проверка закончена». Сообщение, начатое
 * словом «поправка» (поправки подряд приходят одним сообщением), — ответ «Учёл поправку: <текст>».
 * Итог хода: «… на зачёт» — ответ «Работа принята: зачёт.», по нему хук демо `afterTurn` даёт событие `lesson_passed`.
 * В модуль не входит.
 */

/** Чужой адрес картинки: по нему уходили бы данные, если бы скин грузил картинку сам. */
export const externalImageUrl = "https://images.example.test/cat.png?d=private-note";

const shortAnswer = `Привет! Вот короткий пример с таблицей и кодом.

| Город | Время |
|---|---|
| Москва | 12:00 |
| Токио | 18:00 |

\`\`\`ts
const sum = (a: number, b: number) => a + b;
\`\`\`

Спрашивайте ещё.`;

const longAnswer = Array.from(
  { length: 60 },
  (_, index) => `Абзац ${index + 1}: длинный ответ растёт постепенно и не спешит заканчиваться.`,
).join("\n\n");

/** Ответ на ~4 000 знаков, отдаётся крупными кусками: наполняет контекст, не задерживая тесты. */
const detailedAnswer = Array.from(
  { length: 50 },
  (_, index) => `Пункт ${index + 1}: подробный ответ занимает место в контексте, чтобы сжатие сработало.`,
).join("\n\n");

/** Сводка, какой её пишет заглушка: шесть разделов, конкретных деталей переписки в ней нет (их ищет поиск). */
const compactionSummary = `## Цель
Проверить, как демо сжимает длинную переписку.

## Решения
Ответы даёт заглушка, настоящая модель не подключена.

## Факты
В переписке были длинные ответы.

## Файлы и результаты
Файлов и результатов нет.

## Незакрытые задачи
Нет.

## Где остановились
Человек ждёт следующего вопроса.`;

/** Идёт около четырёх минут: дольше самой долгой серии попыток переподключения (75 с). */
const endlessAnswer = Array.from(
  { length: 240 },
  (_, index) => `Абзац ${index + 1}: очень долгий ответ растёт постепенно и не спешит заканчиваться.`,
).join("\n\n");

/** Ответ на 50 000 символов: разделы с заголовком, текстом, таблицей и кодом (Edge Cases «очень длинный ответ»). */
export const HUGE_ANSWER_LENGTH = 50_000;
const hugeAnswer = (() => {
  const sections: string[] = [];
  for (let section = 1; sections.join("\n\n").length < HUGE_ANSWER_LENGTH; section++) {
    sections.push(`## Раздел ${section}

Огромный ответ растёт без подвисания ленты: в каждом разделе есть текст, таблица и код.

| Показатель | Значение | Комментарий |
|---|---|---|
| Строк | ${section * 10} | растёт с номером раздела |
| Символов | ${section * 500} | примерно |
| Таблиц | ${section} | по одной на раздел |

\`\`\`ts
export function section${section}(values: number[]): number {
  return values.reduce((sum, value) => sum + value * ${section}, 0);
}
\`\`\``);
  }
  return sections.join("\n\n");
})();

/** Кусками по ~250 символов: огромный ответ дописывается за секунды, а не за минуты. */
function largeChunks(text: string): string[] {
  return text.match(/[\s\S]{1,250}/g) ?? [];
}

/** Когда модель отдала первый кусок текста ответа, по тексту вопроса: для замера задержки (SC-001). */
const firstTextAtByQuestion = new Map<string, number>();

export function firstTextAt(question: string): number | null {
  return firstTextAtByQuestion.get(question) ?? null;
}

type PromptMessage = { role?: string; content?: unknown };

const memoryBlockPattern = /<agent_memory>[\s\S]*?<\/agent_memory>/g;
const placeBlockPattern = /<screen_place>\n[^\n]*\n([\s\S]*?)\n<\/screen_place>/;
const todayPattern = /Сегодня: [а-яё]+, \d{1,2} [а-яё]+ \d{4} г\./;

/** Текст сообщения без блоков памяти, даты и места: по нему модель понимает вопрос. */
function withoutAppBlocks(text: string): string {
  return text.replace(memoryBlockPattern, "").replace(todayPattern, "").replace(placeBlockPattern, "");
}

/** Где человек на экране, как оно пришло в запросе (`<screen_place>` в сообщении человека); `null` — места нет. */
function placeInRequest(prompt: unknown): string | null {
  return placeBlockPattern.exec(lastUserText(prompt))?.[1] ?? null;
}

function lastUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  const last = [...(prompt as PromptMessage[])].reverse().find((message) => message.role === "user");
  const content = Array.isArray(last?.content) ? (last.content as Array<{ type: string; text?: string }>) : [];
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}

/** Тексты записей из блоков памяти в последнем сообщении человека (запись — строка JSON в своём блоке); `null` — блоков нет. */
function memoryNotesInBlock(prompt: unknown): string[] | null {
  const blocks = lastUserText(prompt).match(memoryBlockPattern);
  if (!blocks) return null;
  const lines = blocks.flatMap((block) => block.split("\n").filter((candidate) => candidate.startsWith("{")));
  return lines.map((line) => (JSON.parse(line) as { content: string }).content);
}

interface OptimizerNote {
  id: string;
  categories: string[];
  content: string;
}

/** Записи из задания оптимизатора памяти; `null` — это не оно. */
function optimizerNotes(prompt: unknown): OptimizerNote[] | null {
  const match = /Текущие записи:\n(\[[\s\S]*\])/.exec(lastUserText(prompt));
  return match ? (JSON.parse(match[1]!) as OptimizerNote[]) : null;
}

/** Предложение слияний: самая длинная запись и те, что в неё целиком входят. */
function mergeProposal(notes: OptimizerNote[]): { groups: { sourceIds: string[]; categories: string[]; content: string }[] } {
  const longest = notes.reduce((best, note) => (note.content.length > best.content.length ? note : best));
  const inside = notes.filter((note) => longest.content.toLowerCase().includes(note.content.toLowerCase()));
  return { groups: inside.length < 2 ? [] : [{ sourceIds: inside.slice(0, 4).map((note) => note.id), categories: longest.categories, content: longest.content }] };
}

function userTexts(prompt: unknown): string[] {
  if (!Array.isArray(prompt)) return [];
  return (prompt as PromptMessage[])
    .filter((message) => message.role === "user")
    .map((message) =>
      Array.isArray(message.content)
        ? withoutAppBlocks(
            (message.content as Array<{ type: string; text?: string }>).map((part) => (part.type === "text" ? (part.text ?? "") : "")).join(""),
          )
        : "",
    );
}

/** Сколько раз уже отвечали на этот вопрос: повтор («переделать ответ») получает другой ответ. */
const answersByQuestion = new Map<string, number>();

/** Части последнего сообщения человека: файлы (картинки) и текст с блоками `<attachment>`. */
function attachmentAnswer(prompt: unknown): string | null {
  if (!Array.isArray(prompt)) return null;
  const last = [...(prompt as PromptMessage[])].reverse().find((message) => message.role === "user");
  const parts = Array.isArray(last?.content) ? (last.content as Array<{ type: string; text?: string; mediaType?: string }>) : [];
  const images = parts.filter((part) => part.type === "file" && part.mediaType?.startsWith("image/"));
  const text = parts.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
  const lines = [
    ...images.map((image) => `Вижу картинку (${image.mediaType}).`),
    ...[...text.matchAll(/Картинка «([^»]*)» не показана/g)].map((match) => `Картинку «${match[1]}» не вижу.`),
    ...[...text.matchAll(/<attachment name="([^"]*)"[^>]*>\n([\s\S]*?)\n<\/attachment>/g)].map(
      (match) => `Прочитал файл «${match[1]}»: ${match[2]!.slice(0, 80)}`,
    ),
  ];
  return lines.length > 0 ? lines.join("\n\n") : null;
}

/** Сколько результатов инструментов модель уже получила в этом ходе. */
function toolResultsThisTurn(prompt: unknown): number {
  if (!Array.isArray(prompt)) return 0;
  const messages = prompt as PromptMessage[];
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  return messages.slice(lastUser + 1).filter((message) => message.role === "tool").length;
}

/** Режет текст на куски по словам, чтобы ответ рос как у настоящей модели. */
function words(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

const CHARACTERS_PER_TOKEN = 4;
const tokensOf = (characters: number) => Math.ceil(characters / CHARACTERS_PER_TOKEN);

/** Расход шага: вход — по размеру запроса, выход — по написанному (рассуждения отдельно). */
function measuredUsage(promptCharacters: number, outputCharacters: number, reasoningCharacters: number) {
  const input = tokensOf(promptCharacters);
  const output = tokensOf(outputCharacters);
  const reasoning = Math.min(output, tokensOf(reasoningCharacters));
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: output, text: output - reasoning, reasoning },
  };
}

const usage = measuredUsage(0, 0, 0);

function reasoningParts(text: string): LanguageModelV4StreamPart[] {
  return [
    { type: "reasoning-start", id: "reasoning-0" },
    ...words(text).map((delta): LanguageModelV4StreamPart => ({ type: "reasoning-delta", id: "reasoning-0", delta })),
    { type: "reasoning-end", id: "reasoning-0" },
  ];
}

function answerStep(reasoning: string, answer: string, split: (text: string) => string[] = words): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    ...reasoningParts(reasoning),
    { type: "text-start", id: "text-0" },
    ...split(answer).map((delta): LanguageModelV4StreamPart => ({ type: "text-delta", id: "text-0", delta })),
    { type: "text-end", id: "text-0" },
    { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
  ];
}

interface ToolCallPlan {
  toolName: string;
  input: object;
  callId: string;
}

/** Несколько вызовов в одном шаге: модель просит сразу два вопроса. */
function toolCallsStep(reasoning: string, calls: ToolCallPlan[]): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    ...reasoningParts(reasoning),
    ...calls.flatMap(({ toolName, input, callId }): LanguageModelV4StreamPart[] => [
      // Вход вызова приходит по кусочкам, как у настоящих провайдеров: строка успевает побыть «выполняется».
      { type: "tool-input-start", id: callId, toolName },
      ...(JSON.stringify(input).match(/.{1,4}/g) ?? []).map(
        (delta): LanguageModelV4StreamPart => ({ type: "tool-input-delta", id: callId, delta }),
      ),
      { type: "tool-input-end", id: callId },
      { type: "tool-call", toolCallId: callId, toolName, input: JSON.stringify(input) },
    ]),
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage },
  ];
}

function toolCallStep(reasoning: string, toolName: string, input: object, callId: string): LanguageModelV4StreamPart[] {
  return toolCallsStep(reasoning, [{ toolName, input, callId }]);
}

/** Текст результатов инструментов этого хода. */
function toolResultsText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  const messages = prompt as PromptMessage[];
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  return JSON.stringify(messages.slice(lastUser + 1).filter((message) => message.role === "tool"));
}

/** Что просят запомнить: текст после «запомни», без слова «что» и точки в конце. */
function noteToRemember(question: string): string {
  const text = question.replace(/^[\s\S]*?запомни[\s,:]*(что\s+)?/i, "").replace(/[.!\s]+$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Ходы «создай три задачи», уже оборванные перед третьим вызовом: по id первого вызова хода. */
const cutThreeTaskTurns = new Set<string>();

/** Id первого вызова инструмента в этом ходе; вызовов ещё не было — `null`. */
function firstToolCallId(prompt: unknown): string | null {
  if (!Array.isArray(prompt)) return null;
  const messages = prompt as PromptMessage[];
  const lastUser = messages.map((message) => message.role).lastIndexOf("user");
  for (const message of messages.slice(lastUser + 1)) {
    const call = Array.isArray(message.content)
      ? (message.content as Array<{ type: string; toolCallId?: string }>).find((part) => part.type === "tool-call")
      : undefined;
    if (call?.toolCallId) return call.toolCallId;
  }
  return null;
}

/** Обрыв ответа провайдером: ошибка без повторов, ход заканчивается с «Повторить». */
function providerCut(): APICallError {
  return new APICallError({ message: "Simulated cut", url: "https://demo.invalid/simulated-cut", requestBodyValues: {}, statusCode: 400, isRetryable: false });
}

/** Пометка автопродолжения последним сообщением человека: ответ оборвался посреди текста, модель дописывает его. */
const autoContinueNotePattern = /^Ответ прервался из-за сбоя связи с моделью/;

/** Перегрузка провайдера посреди ответа: временный сбой, ядро продолжает ответ само. */
function providerOverloaded(): APICallError {
  return new APICallError({ message: "Simulated overload", url: "https://demo.invalid/simulated-overload", requestBodyValues: {}, statusCode: 503, isRetryable: true });
}

/** «Оборвись посреди ответа»: начало ответа и ошибка кусочком потока вместо конца; продолжение дописывает. */
function cutMidAnswerStep(continuing: boolean): LanguageModelV4StreamPart[] {
  if (continuing) return answerStep("Продолжаю с места обрыва.", "а конец дописан после обрыва.");
  const started = answerStep("Пишу ответ.", "Начало ответа пишется по кусочкам, ");
  return [...started.slice(0, -2), { type: "error", error: providerOverloaded() }];
}

/** «Создай три задачи <метка>»: по вызову на шаг; перед третьим вызовом ход в первый раз обрывается. */
function threeTasksStep(label: string, toolResults: number, firstCallId: string | null): LanguageModelV4StreamPart[] {
  if (toolResults === 2 && firstCallId && !cutThreeTaskTurns.has(firstCallId)) {
    cutThreeTaskTurns.add(firstCallId);
    throw providerCut();
  }
  if (toolResults < 3) {
    return toolCallStep(`Создаю задачу ${toolResults + 1} из трёх.`, "create_task", { title: `${label} ${toolResults + 1}` }, `call-three-${crypto.randomUUID()}`);
  }
  return answerStep("Все три созданы.", `Создал три задачи «${label}».`);
}

/** Результаты инструментов хода без экранирования: ответ виджета читается как `"выбрано":"Про"`. */
const plainResults = (toolsText: string) => toolsText.replaceAll("\\", "");

const widgetCallId = () => `call-widget-${crypto.randomUUID()}`;

/**
 * Сценарии виджетов: вопрос человеку, после ответа — короткая фраза с этим ответом. Ответ сообщением вместо виджета
 * модель видит в результате вызова. `null` — вопрос не про виджеты.
 */
function widgetStep(question: string, toolResults: number, toolsText: string, toolNames: ReadonlySet<string>): LanguageModelV4StreamPart[] | null {
  const text = question.trim();
  const results = plainResults(toolsText);
  const byMessage = results.includes('"ответ":"сообщением"');
  /** Ответ человека виджету: первая группа шаблона из результата вызова. */
  const answered = (reasoning: string, pattern: RegExp, line: (answer: string) => string) =>
    byMessage ? answerStep("Человек ответил своими словами.", "Ответили сообщением.") : answerStep(reasoning, line(pattern.exec(results)?.[1] ?? "—"));
  if (/^спроси дважды/i.test(text) && toolNames.has("ask_choice")) {
    if (toolResults === 0) {
      return toolCallsStep("Задам сразу два вопроса.", [
        { toolName: "ask_choice", input: { question: "Какой тариф выберете?", options: ["Базовый", "Про"] }, callId: widgetCallId() },
        { toolName: "ask_choice", input: { question: "Когда оплачивать?", options: ["Сразу", "Позже"] }, callId: widgetCallId() },
      ]);
    }
    return answered("Получил ответ на первый вопрос.", /"выбрано":"([^"]+)"/, (answer) => `Спросил один вопрос, выбран тариф «${answer}».`);
  }
  if (/^спроси тариф/i.test(text) && toolNames.has("ask_choice")) {
    if (toolResults === 0) return toolCallStep("Спрошу, какой тариф нужен.", "ask_choice", { question: "Какой тариф выберете?", options: ["Базовый", "Про", "Команда"] }, widgetCallId());
    return answered("Человек выбрал тариф.", /"выбрано":"([^"]+)"/, (answer) => `Выбран тариф «${answer}».`);
  }
  if (/^выбери несколько/i.test(text) && toolNames.has("ask_multi_choice")) {
    if (toolResults === 0) {
      return toolCallStep("Спрошу, что включить.", "ask_multi_choice", { question: "Что включить в пакет?", options: ["Почта", "Чат", "Отчёты", "Звонки"], min: 1, max: 3 }, widgetCallId());
    }
    return answered("Человек выбрал части пакета.", /"выбрано":\["([^\]]+)"\]/, (answer) => `В пакете: ${answer.replaceAll('","', ", ")}.`);
  }
  if (/^оцени/i.test(text) && toolNames.has("ask_rating")) {
    if (toolResults === 0) return toolCallStep("Попрошу оценку.", "ask_rating", { question: "Как вам ответ?", scale: "stars" }, widgetCallId());
    return answered("Человек поставил оценку.", /"оценка":(\d+)/, (answer) => `Оценка ${answer} из 5.`);
  }
  if (/^заполни форму/i.test(text) && toolNames.has("ask_form")) {
    if (toolResults === 0) {
      return toolCallStep(
        "Нужны контакты.",
        "ask_form",
        {
          title: "Контакты",
          fields: [
            { name: "name", label: "Имя", kind: "text", required: true },
            { name: "email", label: "Почта", kind: "text", required: true },
            { name: "seats", label: "Сколько мест", kind: "number", min: 1, max: 50 },
          ],
        },
        widgetCallId(),
      );
    }
    return answered("Форма заполнена.", /"name":"([^"]+)"/, (name) => `Получил контакты: ${name}.`);
  }
  if (/^выбери время/i.test(text) && toolNames.has("pick_slot")) {
    if (toolResults === 0) return toolCallStep("Предложу время.", "pick_slot", { slots: ["10:00", "12:30", "16:00"] }, widgetCallId());
    return answered("Человек выбрал время.", /"slot":"([^"]+)"/, (slot) => `Записал на ${slot}.`);
  }
  if (/^подскажи/i.test(text) && toolNames.has("suggest_replies")) {
    if (toolResults === 0) return toolCallStep("Приготовлю подсказки.", "suggest_replies", { replies: ["Что там с временем в Токио?", "Спасибо, хватит"] }, widgetCallId());
    return answerStep("Подсказки показаны.", "Что рассказать дальше?");
  }
  return null;
}

const fence = "```";
const mermaidAnswer = (intro: string, source: string) => `${intro}\n\n${fence}mermaid\n${source}\n${fence}\n\nГотово.`;

/** Схема короткая, ширины ленты хватает. */
const orderDiagram = ["graph TD", "  A[Заказ] --> B{Оплата}", "  B -->|Да| C[Склад]", "  B -->|Нет| D[Отмена]", "  C --> E[Доставка]"].join("\n");
/** Цепочка из десяти узлов в строку: шире экрана телефона. */
const wideDiagram = ["graph LR", ...Array.from({ length: 9 }, (_, index) => `  S${index}[Этап номер ${index + 1}] --> S${index + 1}[Этап номер ${index + 2}]`)].join("\n");
const brokenDiagram = ["graph TD", "  A --> --> B[", "  C ---"].join("\n");

const demoAnswer = (intro: string, source: string) => `${intro}\n\n${fence}html-demo\n${source}\n${fence}\n\nГотово.`;

/** Ползунок и кнопка меняют текст; цвета — переменные темы, которые даёт рамка. */
const sliderDemo = [
  "<style>",
  "  body { margin: 0; padding: 16px; font: 15px system-ui; background: var(--surface); color: var(--text); }",
  "  button { background: var(--accent); color: var(--on-accent); border: 0; border-radius: 8px; padding: 8px 14px; }",
  "  input { width: 100%; accent-color: var(--accent); }",
  "  #value { font-size: 28px; margin: 8px 0; }",
  "</style>",
  '<label for="speed">Скорость</label>',
  '<input id="speed" type="range" min="0" max="100" value="40">',
  '<p id="value">Скорость: 40</p>',
  '<button id="reset" type="button">Сбросить</button>',
  "<script>",
  '  const speed = document.getElementById("speed");',
  '  const value = document.getElementById("value");',
  '  const show = () => { value.textContent = "Скорость: " + speed.value; };',
  '  speed.addEventListener("input", show);',
  '  document.getElementById("reset").addEventListener("click", () => { speed.value = 0; show(); });',
  "</script>",
].join("\n");
/** Больше предела в 30 КБ: показывается кодом. */
const hugeDemo = `<p>Большая</p>\n<!-- ${"x".repeat(31 * 1024)} -->`;

/**
 * Сценарии схем и картинок. Метка в описании картинки (`#fail`, `#slow`) на каждый заказ своя: поддельный Runware (mock-runware.ts)
 * считает по ней запросы, а тесты идут параллельно. `null` — вопрос не про схемы и картинки.
 */
function mediaStep(question: string, toolResults: number, toolsText: string, toolNames: ReadonlySet<string>): LanguageModelV4StreamPart[] | null {
  const text = question.trim();
  if (/^нарисуй широкую схему/i.test(text)) return answerStep("Нарисую широкую схему.", mermaidAnswer("Вот длинная цепочка:", wideDiagram));
  if (/^нарисуй сломанную схему/i.test(text)) return answerStep("Нарисую схему с ошибкой.", mermaidAnswer("Вот схема:", brokenDiagram));
  if (/^нарисуй схему/i.test(text)) return answerStep("Нарисую схему заказа.", mermaidAnswer("Вот схема заказа:", orderDiagram));
  const ownDemos = /^запусти демонстрации:\n([\s\S]+)$/i.exec(text);
  if (ownDemos) {
    const blocks = ownDemos[1]!.split(/\n-----\n/).map((source) => `${fence}html-demo\n${source}\n${fence}`);
    return answerStep("Запущу демонстрации.", `Демонстрации:\n\n${blocks.join("\n\n")}\n\nГотово.`);
  }
  if (/^покажи большую демонстрацию/i.test(text)) return answerStep("Покажу большую демонстрацию.", demoAnswer("Вот она:", hugeDemo));
  if (/^покажи демонстрацию/i.test(text)) return answerStep("Покажу ползунок.", demoAnswer("Подвигайте ползунок:", sliderDemo));
  if (!toolNames.has("generate_images")) return null;
  const order = /^нарисуй картинку/i.test(text)
    ? { prompt: "Рыжий кот на подоконнике", count: 1 }
    : /^нарисуй три картинки/i.test(text)
      ? { prompt: "Три рыжих кота #fail:%label%:3", count: 3 }
      : /^нарисуй восемь картинок/i.test(text)
        ? { prompt: "Восемь рыжих котов #slow:%label%", count: 8 }
        : null;
  if (!order) return null;
  if (toolResults === 0) {
    const label = /метка\s+([\w-]+)/i.exec(text)?.[1] ?? crypto.randomUUID();
    const input = { prompt: order.prompt.replace("%label%", label), count: order.count, aspectRatio: "1:1" };
    return toolCallStep("Закажу картинки.", "generate_images", input, widgetCallId());
  }
  const [, made, ordered] = /"создано":(\d+),"заказано":(\d+)/.exec(plainResults(toolsText)) ?? [];
  return answerStep("Смотрю, что получилось.", made ? `Создано ${made} из ${ordered}.` : "Картинки не создались.");
}

/** Сценарии видео: поиск по теме, затем показ найденного id, при «с примеров» — с секунды главы «Примеры». `null` — вопрос не про видео. */
function videoStep(question: string, toolResults: number, toolsText: string, toolNames: ReadonlySet<string>): LanguageModelV4StreamPart[] | null {
  if (!toolNames.has("show_video")) return null;
  const text = question.trim();
  const results = plainResults(toolsText);
  const shown = () => answerStep("Смотрю, показалось ли.", /"отказ"/.test(results) ? "Такого видео в каталоге нет." : "Вот урок — нажмите, чтобы посмотреть.");
  if (/^покажи несуществующее видео/i.test(text)) {
    return toolResults === 0 ? toolCallStep("Покажу видео по памяти.", "show_video", { id: "lost-video" }, widgetCallId()) : shown();
  }
  const topic = /^покажи урок про (.+?)(?: с примеров)?[.!]?$/i.exec(text)?.[1];
  if (!topic) return null;
  if (toolResults === 0) return toolCallStep("Поищу урок в каталоге.", "find_videos", { query: topic }, widgetCallId());
  if (toolResults > 1) return shown();
  const id = /"id":"([^"]+)"/.exec(results)?.[1];
  if (!id) return answerStep("Ничего не нашлось.", "Такого урока в каталоге нет.");
  const examples = / с примеров/i.test(text) ? /"название":"Примеры"[^}]*"секунда":(\d+)/.exec(results)?.[1] : undefined;
  return toolCallStep("Покажу урок.", "show_video", { id, ...(examples && { startSeconds: Number(examples) }) }, widgetCallId());
}

/** Шаги хода по вопросу и числу уже полученных результатов инструментов. */
/** Помощники и фон: поручение, запуск отчёта, итог задачи; не по теме — `undefined`. */
function workStep(question: string, toolResults: number, toolsText: string, toolNames: ReadonlySet<string>): LanguageModelV4StreamPart[] | undefined {
  // Итог задачи приходит служебным сообщением, в нём может быть любое слово: разбираем его первым.
  const finished = /Фоновая задача "[^"]+" закончилась: (.*)$/s.exec(question);
  if (finished) return answerStep("Задача закончилась, сообщу итог.", `Фоновая задача закончилась. Итог: ${finished[1]!.trim()}`);
  if (/Фоновая задача "[^"]+" (?:отменена|не удалась|прервана|не уложилась)/.test(question)) return answerStep("Задача не дошла до конца.", "Фоновая задача не дошла до конца.");
  const researched = researchTaskTopic(question);
  if (researched && toolNames.has("search_sources")) {
    if (toolResults === 0) return toolCallStep("Поищу источники по теме.", "search_sources", { query: researched }, "call-sources");
    return answerStep("Собираю доклад.", `Нашёл по теме «${researched}»: ${fakeSearchResult(researched).split(": ")[1]}`);
  }
  const topicToResearch = /(?:^|\s)поручи исследователю\s+(.+?)[.!]?$/i.exec(question.trim())?.[1];
  if (topicToResearch && toolNames.has("helper_researcher")) {
    if (toolResults === 0) return toolCallStep("Поручу тему исследователю.", "helper_researcher", { task: `${researchTaskPrefix}${topicToResearch}` }, "call-researcher");
    return answerStep("Смотрю доклад.", /"error"/.test(toolsText) ? "Исследователь не справился." : `Исследователь закончил: источники по теме «${topicToResearch}» найдены.`);
  }
  const reportTopic = /(?:^|\s)запусти отчёт\s+(.+?)[.!]?$/i.exec(question.trim())?.[1];
  if (reportTopic && toolNames.has("report")) {
    if (toolResults === 0) return toolCallStep("Отчёт долгий, запущу в фоне.", "report", { topic: reportTopic }, "call-report");
    return answerStep("Задача пошла.", /too_many_tasks/.test(toolsText) ? "Фоновых задач уже много." : `Запустил отчёт «${reportTopic}», он делается в фоне. Можно спрашивать о другом.`);
  }
  return undefined;
}

function nextStep(
  question: string,
  toolResults: number,
  toolsText: string,
  history: string[],
  memoryNotes: string[] | null,
  toolNames: ReadonlySet<string>,
  firstCallId: string | null,
): LanguageModelV4StreamPart[] {
  // Голосовой режим: пометка приложения говорит, что человек смеялся, и заглушка отвечает на смех.
  if (/были слышны его звуки:[^.]*смех/i.test(question)) return answerStep("Человек засмеялся.", "Ха, рад, что смешно!");
  if (/^поправка/i.test(question.trim())) return answerStep("Человек поправил задачу на ходу.", `Учёл поправку: ${question.trim().replace(/\s*\n+\s*/g, " ")}`);
  if (/долг\S* проверк/i.test(question) && toolNames.has("slow_check")) {
    if (toolResults === 0) return toolCallStep("Запущу долгую проверку.", "slow_check", { subject: "кнопка" }, `call-slow-${crypto.randomUUID()}`);
    return answerStep("Проверка закончилась.", "Проверка закончена.");
  }
  const work = workStep(question, toolResults, toolsText, toolNames);
  if (work) return work;
  const widget = widgetStep(question, toolResults, toolsText, toolNames);
  if (widget) return widget;
  const media = mediaStep(question, toolResults, toolsText, toolNames);
  if (media) return media;
  const video = videoStep(question, toolResults, toolsText, toolNames);
  if (video) return video;
  if (toolNames.has("manage_memory") && /запомни/i.test(question)) {
    const note = noteToRemember(question);
    if (toolResults === 0) {
      return toolCallStep("Человек просит запомнить, запишу в память.", "manage_memory", { action: "create", notes: [{ categories: ["О себе"], content: note }] }, "call-remember");
    }
    return answerStep("Смотрю, записалось ли.", /"error"/.test(toolsText) ? "Не получилось запомнить." : `Запомнил: ${note}.`);
  }
  if (toolNames.has("manage_memory") && /что ты помнишь/i.test(question)) {
    return answerStep("Смотрю в память.", memoryNotes?.length ? `В памяти: ${memoryNotes.join("; ")}.` : "В памяти ничего нет.");
  }
  const threeTasksLabel = /(?:^|\s)создай три задачи\s+(.+)$/i.exec(question.trim())?.[1]?.replace(/[.!]+$/, "");
  if (threeTasksLabel && toolNames.has("create_task")) return threeTasksStep(threeTasksLabel, toolResults, firstCallId);
  // Узкое совпадение: в служебных пометках голосового режима таких слов нет.
  const newTaskTitle = /(?:^|\s)создай задачу(?:[\s:,]+(.*))?$/i.exec(question.trim());
  if (newTaskTitle && toolNames.has("create_task")) {
    const title = newTaskTitle[1]?.trim().replace(/[.!]+$/, "") || "Новая задача";
    if (toolResults === 0) return toolCallStep("Человек просит новую задачу, создам.", "create_task", { title }, "call-task");
    return answerStep("Смотрю, создалась ли.", /"error"/.test(toolsText) ? "Не получилось создать задачу." : `Создал задачу «${title}».`);
  }
  // Браузерные инструменты страницы с панелью: номер вызова свой на каждый ход — вкладка помнит исполненные вызовы.
  const openedTaskId = /(?:^|\s)открой задачу\s+(\d+)[.!]?$/i.exec(question.trim())?.[1];
  if (openedTaskId && toolNames.has("open_task")) {
    if (toolResults === 0) return toolCallStep("Открою задачу на экране.", "open_task", { taskId: openedTaskId }, `call-open-task-${crypto.randomUUID()}`);
    return answerStep("Смотрю, открылась ли.", /"error/.test(toolsText) ? "Не получилось открыть задачу." : `Открыл задачу ${openedTaskId}.`);
  }
  if (/^зависни[.!]?$/i.test(question.trim()) && toolNames.has("freeze_page")) {
    if (toolResults === 0) return toolCallStep("Человек просит проверить срок.", "freeze_page", {}, `call-freeze-${crypto.randomUUID()}`);
    return answerStep("Страница молчит.", /"error/.test(toolsText) ? "Страница не ответила вовремя." : "Страница ответила.");
  }
  if (/по-разному/i.test(question)) {
    const attempt = (answersByQuestion.get(question) ?? 0) + 1;
    answersByQuestion.set(question, attempt);
    return answerStep("Придумываю новый вариант.", `Вариант ответа ${attempt}.`);
  }
  if (/как меня зовут/i.test(question)) {
    const name = history.map((text) => /меня зовут (\p{L}+)/iu.exec(text)?.[1]).findLast(Boolean);
    return answerStep("Смотрю, что мне говорили.", name ? `Вас зовут ${name}.` : "Вы не говорили, как вас зовут.");
  }
  if (/токио/i.test(question)) {
    if (toolResults === 0) return toolCallStep("Нужно текущее время в Токио.", "current_time", { timeZone: "Asia/Tokyo" }, "call-tokyo");
    if (toolResults === 1) return toolCallStep("Теперь время в Москве.", "current_time", { timeZone: "Europe/Moscow" }, "call-moscow");
    return answerStep("Сравниваю два времени.", "Разница между Токио и Москвой — 6 часов.");
  }
  if (/очисти заметки/i.test(question)) {
    if (toolResults === 0) return toolCallStep("Заметки нужно очистить, это опасное действие.", "clear_notes", { folder: "старое" }, "call-clear");
    // Отказ доходит до модели причиной в результате вызова.
    if (/отклонил/.test(toolsText)) return answerStep("Человек отказал.", "Хорошо, заметки не трогаю.");
    return answerStep("Готово.", "Заметки очищены.");
  }
  if (/справочн/i.test(question)) {
    if (toolResults === 0) return toolCallStep("Спрошу справочную службу.", "broken_lookup", { query: "курс" }, "call-lookup");
    return answerStep("Служба ответила ошибкой.", "Справочная служба сейчас недоступна, попробуйте позже.");
  }
  if (/в интернете/i.test(question)) {
    if (toolResults === 0) return toolCallStep("Поищу в интернете.", "web_search", { query: demoSearchQuery }, "call-search");
    if (toolResults === 1) return toolCallStep("Прочитаю найденную страницу.", "read_page", { url: demoPageUrl }, "call-page");
    return answerStep("Собираю ответ по источнику.", `Текущий выпуск — Node.js 26. Источник: [Node.js — Releases](${demoPageUrl}).`);
  }
  if (/скриншот/i.test(question)) {
    if (toolResults === 0) return toolCallStep("Сделаю снимок страницы.", "page_screenshot", { url: demoPageUrl }, "call-shot");
    return answerStep("Смотрю на снимок.", "Снимок страницы получен.");
  }
  if (/какой код/i.test(question)) {
    if (toolResults === 0) {
      return toolCallStep("Деталь нужна точная, поищу её в старой переписке.", "search_earlier_conversation", { query: "код от сейфа" }, "call-history");
    }
    const code = /код от сейфа\D{0,3}(\d+)/i.exec(toolsText)?.[1];
    return answerStep("Смотрю, что нашлось.", code ? `Код от сейфа — ${code}.` : "В переписке такого кода не нашлось.");
  }
  // Итог хода (фича 029, US2): ответ со словом «зачёт» — хук демо `afterTurn` добавляет событие `lesson_passed`.
  if (/на зачёт/i.test(question)) return answerStep("Проверяю работу.", "Работа принята: зачёт.");
  if (/покажи чужую картинку/i.test(question)) return answerStep("Вставлю картинку со страницы.", `Вот она: ![кот](${externalImageUrl})`);
  if (/подробн/i.test(question)) return answerStep("Пишу подробный ответ.", detailedAnswer, largeChunks);
  if (/бесконечн/i.test(question)) return answerStep("Пишу очень долгий ответ.", endlessAnswer);
  if (/огромн/i.test(question)) return answerStep("Пишу очень длинный ответ.", hugeAnswer, largeChunks);
  return answerStep(
    "Разбираю вопрос и прикидываю, как ответить понятнее.",
    /длинн/i.test(question) ? longAnswer : shortAnswer,
  );
}

/** Сколько модель молчит перед ответом на вопрос «не торопись»: дольше порога заполнителя голосового режима (1,5 с). */
export const SLOW_START_MS = 4000;

/** Пауза «долгого раздумья» после первого куска: дольше минуты, но меньше срока молчания между кусками (120 с, FR-046 фичи 022). */
export const LONG_THINKING_PAUSE_MS = 70_000;

/** Первый кусок рассуждения, долгая пауза, затем короткий ответ (SC-006). */
function longThinkingStream(): ReadableStream<LanguageModelV4StreamPart> {
  const parts = answerStep("Думаю очень тщательно.", "Вот и ответ после долгого раздумья.");
  const firstReasoningDelta = parts.findIndex((part) => part.type === "reasoning-delta");
  const beforePause = parts.slice(0, firstReasoningDelta + 1);
  const afterPause = parts.slice(firstReasoningDelta + 1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      timer = setTimeout(() => {
        for (const part of beforePause) controller.enqueue(part);
        timer = setTimeout(() => {
          for (const part of afterPause) controller.enqueue(part);
          controller.close();
        }, LONG_THINKING_PAUSE_MS);
      }, 300);
    },
    cancel() {
      clearTimeout(timer);
    },
  });
}

/** Ответ на «Кто отвечает?»: пара и настройки рассуждений, как они пришли в запросе, — для проверки выбора в e2e. */
function whoAnswers({ providerId, providerModelId }: DemoMockTarget, reasoning: unknown, providerOptions: unknown): string {
  return `Отвечает ${providerId}: ${providerModelId}. Настройки рассуждений: ${JSON.stringify({ reasoning, providerOptions })}`;
}

export interface DemoMockTarget {
  providerId: string;
  providerModelId: string;
}

/** Помощник идёт обычным запросом без потока: шаг по заданию «Изучи тему: …» собираем из тех же частей, что и ход главного агента. */
function helperTaskStep(prompt: unknown, tools: ReadonlyArray<{ name: string }> | undefined) {
  const toolNames = new Set(tools?.map((tool) => tool.name));
  const step = researchTaskTopic(lastUserText(prompt)) && toolNames.has("search_sources")
    ? workStep(lastUserText(prompt), toolResultsThisTurn(prompt), toolResultsText(prompt), toolNames)
    : undefined;
  if (!step) return undefined;
  const text = step.flatMap((part) => (part.type === "text-delta" ? [part.delta] : [])).join("");
  const calls = step.flatMap((part) => (part.type === "tool-call" ? [part] : []));
  return {
    content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      ...calls.map(({ toolCallId, toolName, input }) => ({ type: "tool-call" as const, toolCallId, toolName, input })),
    ],
    finishReason: calls.length > 0 ? { unified: "tool-calls" as const, raw: "tool_calls" } : { unified: "stop" as const, raw: "stop" },
    usage,
    warnings: [],
  };
}

export function createDemoMockModel(target: DemoMockTarget): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "demo-mock",
    modelId: "demo-mock",
    // Запросов без потока два: проверка дублей памяти и задание сжатия истории.
    doGenerate: async ({ prompt, tools }) => {
      const helperStep = helperTaskStep(prompt, tools);
      if (helperStep) return helperStep;
      const notes = optimizerNotes(prompt);
      const text = notes ? JSON.stringify(mergeProposal(notes)) : compactionSummary;
      const measured = measuredUsage(JSON.stringify(prompt).length, text.length, 0);
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: measured,
        warnings: [],
      };
    },
    doStream: async ({ prompt, reasoning, providerOptions, tools }) => {
      // В запросе автопродолжения последнее сообщение человека — пометка о сбое, вопрос стоит перед ней.
      const continuing = autoContinueNotePattern.test(lastUserText(prompt));
      const question = continuing ? (userTexts(prompt).at(-2) ?? "") : withoutAppBlocks(lastUserText(prompt));
      const withAttachments = attachmentAnswer(prompt);
      const place = placeInRequest(prompt);
      const long = /длинн|бесконечн/i.test(question);
      const stream = /подольше/i.test(question)
        ? longThinkingStream()
        : simulateReadableStream({
            chunks: /оборвись посреди ответа/i.test(question)
              ? cutMidAnswerStep(continuing)
              : withAttachments
              ? answerStep("Смотрю, что приложили.", withAttachments)
              : /где я/i.test(question)
              ? answerStep("Смотрю, где человек.", place ? `Вы сейчас здесь: ${place}.` : "Не вижу, где вы сейчас.")
              : /кто отвечает/i.test(question)
              ? answerStep("Смотрю, кто я.", whoAnswers(target, reasoning, providerOptions))
              : nextStep(question, toolResultsThisTurn(prompt), toolResultsText(prompt), userTexts(prompt), memoryNotesInBlock(prompt), new Set(tools?.map((tool) => tool.name)), firstToolCallId(prompt)),
            // «не торопись»: модель молчит дольше порога заполнителя, потом отвечает.
            initialDelayInMs: /не торопись/i.test(question) ? SLOW_START_MS : 300,
            chunkDelayInMs: long ? 90 : 45,
          });
      firstTextAtByQuestion.delete(question);
      const promptCharacters = JSON.stringify(prompt).length;
      let writtenCharacters = 0;
      let reasoningCharacters = 0;
      return {
        stream: stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform(part, controller) {
              if (part.type === "text-delta" && !firstTextAtByQuestion.has(question)) {
                firstTextAtByQuestion.set(question, Date.now());
              }
              if (part.type === "text-delta") writtenCharacters += part.delta.length;
              if (part.type === "reasoning-delta") {
                writtenCharacters += part.delta.length;
                reasoningCharacters += part.delta.length;
              }
              if (part.type === "tool-call") writtenCharacters += part.input.length;
              // Расход шага — по размеру запроса и написанного, как у настоящей модели.
              controller.enqueue(
                part.type === "finish"
                  ? { ...part, usage: measuredUsage(promptCharacters, writtenCharacters, reasoningCharacters) }
                  : part,
              );
            },
          }),
        ),
      };
    },
  });
}
