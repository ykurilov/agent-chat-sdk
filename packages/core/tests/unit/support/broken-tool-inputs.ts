// Обезличенные вызовы DeepSeek 4.1 Flash из прогона приложения с лид-магнитами 2026-10-11.

/** `remember`: лишняя `}` после конца JSON («Unexpected non-whitespace character after JSON»). */
export const extraCloserAtEnd =
  '{"fields": [{"fieldId": "f-1", "value": "@user_name"}, {"fieldId": "f-2", "value": "Имя"}], "facts": ["Короткий факт"]}}';

/** `edit_lead_magnet`: лишняя `}` после элемента массива («Expected ',' or ']' after array element»). */
export const extraCloserInside =
  '{"changes": [{"op": "set", "field": "instruction", "value": "Первая строка.\\n\\nВторая — с тире."}}, ' +
  '{"op": "set", "field": "firstMessage", "value": "Привет!"}, {"op": "set", "field": "endCondition", "value": "Человек согласился."}]}';
