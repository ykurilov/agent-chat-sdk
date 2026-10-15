import type { AgentChatMessage } from "../../../src/conversation/types";

type Part = AgentChatMessage["parts"][number];

const text = (value: string): Part => ({ type: "text", text: value, state: "done" });
const step: Part = { type: "step-start" };
const call = (name: string, id = "call-1"): Part =>
  ({ type: `tool-${name}`, toolCallId: id, state: "output-available", input: {}, output: "ок" }) as unknown as Part;

/**
 * Корпус обычных ответов, похожих на служебное: код, объяснения шаблонов чатов, промпты, логи, английский текст. Ни
 * обрезка каши, ни вырезка поддельных служебных блоков их не трогают. Примеры ревьюера и свои.
 */
export const ORDINARY_ANSWERS: Record<string, Part[]> = {
  "ChatML прозой без кода": [step, text("Формат ChatML выглядит так: <|im_start|>user Привет<|im_end|> и ответ идёт после метки.")],
  "ChatML с отступом в 4 пробела": [
    step,
    text("Пример запроса:\n\n    <|im_start|>user\n    Привет<|im_end|>\n    <|im_start|>assistant\n\nЭто и есть формат."),
  ],
  "</think> прозой и вызов следом": [step, text("Метка </think> закрывает рассуждение. Сейчас найду в документации."), step, call("search"), step, text("Нашёл.")],
  "<|im_end|> прозой и вызов": [step, text("Токен <|im_end|> — конец хода. Проверю."), call("search"), step, text("Да.")],
  "</think> прозой и вызов в том же шаге": [step, text("Готово.</think>Он доволен. Вызвать save."), call("save")],
  "DeepSeek: </think> в начале второго шага и вызов": [
    step, text("Сейчас посмотрю."), call("search", "c1"), step, text("</think>Нашёл результат."), call("search", "c2"), step, text("Готово."),
  ],
  "DeepSeek: </think> в начале каждого шага": [
    step, text("</think>Сейчас посмотрю."), call("search", "c1"), step, text("</think>Нашёл."), step, text("</think>Итог."),
  ],
  "user story списком": [step, text("Примеры.\nuser story: как пользователь я хочу войти.\nuser\nassistant")],
  "одинокая строка user и склейка": [step, text("Вот поля таблицы.\nuser\nid, имя.Далее Мы")],
  "C# вне кода и строка user": [step, text("Вызывается Console.WriteLine в методе.\n\nuser\n\nчто-то")],
  "C# и <think> прозой": [step, text("Тег <think> в выводе. Вызов Console.WriteLine тут.")],
  "таблица markdown": [step, text("| role | text |\n|---|---|\n| user | привет |\n| assistant | здравствуйте |")],
  "лог чата в кавычках": [step, text("Пример:\n«user\nпривет»\n«assistant\nздравствуй»")],
  "английский текст": [step, text("The user asked a question.\nUser\nIs this right? The assistant replied.Yes")],
  "строка user в конце": [step, text("Готово.\nuser")],
  "роли за обоих, слитно с репликой": [step, text("Результат.\nuserам нужно знать.\nassistantу тоже.")],
  "ограждение из 4 бэктиков с вложенным": [step, text("Пример:\n````markdown\n```js\nx\n```\nuser\nпривет.Далее Мы\n````\nГотово.")],
  "html-тег think в пояснении и склейки": [step, text("Тег <think>…</think> используют модели. См.Рис один. Файл.Next")],
  "двойные бэктики": [step, text("Пиши ``</think>`` в конце и <|im_end|> тоже. ok.Next")],
  "пример кода, где строки начинаются с user, и вызов": [
    step,
    text("Вот так.\n\n```\nuserName = 'Аня'\nuser\nassistantОтвет.Дальше\n</think>\n```\n\nПроверю.\n\n`</think>` — служебная метка."),
    call("run_code"),
  ],
  "диалог «user:» и «assistant:» и вызов": [
    step,
    text("Вот пример диалога:\n\nuser: Привет! Как дела?\nassistant: Отлично.Спасибо!\nuser: А погода?\nassistant: Солнечно."),
    call("save_dialog"),
  ],
  "диалог ролями отдельными строками": [step, text("Сценарий:\n\nuser\nПривет!\n\nassistant\nЗдравствуйте.Чем помочь?\n\nuser\nНичем.")],
  "диалог ролями после законченной фразы": [step, text("Конечно. Вот сценарий.\n\nuser\nПривет!\n\nassistant\nЗдравствуйте.Чем помочь?\n\nuser\nНичем.")],
  "цитата с репликой и </think>": [step, text("Модель написала так:\n\n> Ответ готов.\n> userНу а дальше?</think>\n\nЭто и есть срыв.")],
  "username, Users и склейка": [step, text("Готово.\nusername задаётся в настройках.\nUsers видят его.Дальше метка."), call("save")],
  "</think> в самом начале и строка userНу": [step, text("</think>Ответ готов.\n\nuserНу а дальше?")],
  "одна строка userНу": [step, text("Вот вопрос?\n\nuserНу ладно, ответ такой.")],
  "промпт для модели": [
    step,
    text(
      "Системный промпт:\n\nТы помощник. Отвечай коротко.\nНе пиши за пользователя.\n\nШаблон Llama: <|start_header_id|>user<|end_header_id|> текст <|eot_id|>.",
    ),
  ],
  "лог чата с временем": [step, text("Лог:\n12:01 user: привет\n12:02 assistant: здравствуйте.Чем помочь?\n12:03 user: ничем")],
  "английский ответ с ролями в коде": [
    step,
    text('Use the messages array:\n\n```json\n[{"role": "user", "content": "Hi"}]\n```\n\nThen call the API.Done'),
    call("http"),
  ],
  "JSON с ролями без ограждения": [step, text('Тело запроса: {"role":"user","content":"Привет"}. Отправляю.'), call("http")],
  "рассказ про метки DeepSeek": [step, text("У DeepSeek метки <｜User｜> и <｜Assistant｜> отделяют реплики. Проверю версию."), call("search")],
  // Повторное ревью: шаблоны без ограждения, одинокая роль и вызов, пара </think> прозой.
  "ChatML без ограждения": [step, text("Формат такой.\n<|im_start|>user\nПривет<|im_end|>\n<|im_start|>assistant\nЗдравствуйте<|im_end|>\nЭто ChatML.")],
  "DeepSeek метками строкой": [step, text("Формат DeepSeek.\n<｜User｜>вопрос<｜Assistant｜>ответ<｜end▁of▁sentence｜>\nТак выглядит запрос.")],
  "Llama 3 без ограждения": [step, text("Шаблон Llama 3.\n<|start_header_id|>user<|end_header_id|>\nПривет<|eot_id|>\nТак.")],
  "Llama 3 два заголовка": [
    step,
    text("Шаблон Llama 3.\n<|start_header_id|>user<|end_header_id|>\nПривет<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\nТак."),
  ],
  "ChatML без ограждения и вызов": [step, text("Формат такой.\n<|im_start|>user\nПривет<|im_end|>\n<|im_start|>assistant\nОтвет."), call("search")],
  "одна строка user без ничего": [step, text("Пример запроса к API.\nuser\nПривет, как дела?\nТак задают вопрос.")],
  "одна строка user и вызов в том же шаге": [step, text("Пример запроса.\nuser\nПривет.\nСейчас проверю."), call("search")],
  "одна строка user, склейка и вызов": [step, text("Пример запроса.\nuser\nПривет.Далее Мы проверим."), call("search")],
  "диалог строками и вызов": [step, text("Вот диалог.\nuser\nПривет!\nassistant\nЗдравствуйте."), call("search")],
  "пара </think> после ответа и вызов": [step, text("Готово.</think>Он доволен.</think>Вызвать save."), call("save")],
  "два </think> прозой и вызов": [step, text("Тег </think> закрывает, а второй </think> лишний. Сейчас проверю."), call("search")],
  "два </think> прозой и склейка": [step, text("Тег </think> закрывает, а второй </think> лишний. Файл.Далее ок. Мы.Это")],
  "английский текст с ролями строками": [step, text("Here is how a chat works.\nThe user sends a message. The assistant replies.\nuser\nassistant\nIs that clear?")],
  "английские роли строками и вызов": [step, text("The roles are:\nuser\nthe human.\nassistant\nthe model."), call("search")],
  "код в ограждении и user строкой": [step, text("Вот код:\n```python\nmessages = [\n{'role': 'user'},\n]\n```\nuser\nэто имя переменной.\nГотово.")],
  "список user story": [step, text("Истории:\n- user story 1\n- user story 2\nuser stories описывают нужды.")],
  "роли в таблице без рамки": [step, text("| Роль | Что |\n|---|---|\nuser | человек\nassistant | модель\n")],
  "реплика в ёлочках": [step, text("Он сказал:\n«\nuser\nПривет\n»\nИ ушёл.")],
  "userам строчной": [step, text("Ответ готов.\nuserам\nнужна справка.")],
  "DeepSeek: пара </think> во втором шаге": [step, text("Сейчас.</think>Смотрю."), call("search"), step, text("Нашёл.</think>Ещё раз.</think>ok.")],
};
