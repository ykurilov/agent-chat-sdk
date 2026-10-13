import type { WidgetDescription } from "./widget-types";

// Модуль без зависимостей: его импортирует и страница (имя виджета для `widgets={{ … }}`).
const WIDGET_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const RESERVED_PREFIXES = ["ask_", "suggest_"];

/**
 * Свой виджет приложения: одно описание для сервера (`agent.widgets.custom`) и страницы. Проверяет имя:
 * `^[a-z][a-z0-9_]{0,63}$`, без префиксов `ask_` и `suggest_` — они у базовых виджетов. Негодное имя — исключение.
 */
export function defineWidget<Input, Answer>(description: WidgetDescription<Input, Answer>): WidgetDescription<Input, Answer> {
  const { name } = description;
  if (!WIDGET_NAME.test(name)) {
    throw new Error(`Имя виджета «${name}» не подходит: латинские строчные буквы, цифры и _, начинается с буквы, до 64 знаков`);
  }
  const prefix = RESERVED_PREFIXES.find((reserved) => name.startsWith(reserved));
  if (prefix) throw new Error(`Имя виджета «${name}» не подходит: префикс ${prefix} занят базовыми виджетами`);
  return description;
}
