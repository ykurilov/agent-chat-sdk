/** Текст без закрывающей скобки, которая закрыла весь JSON раньше времени. */
export interface PrematureCloserRepair {
  text: string;
}

/**
 * Убирает лишнюю `}` или `]` посреди объекта: `{"a": {"b": 1}}, "c": 2}` → `{"a": {"b": 1}, "c": 2}`.
 * Скобка закрыла самый внешний объект, а текст после неё продолжается: парсер видит конец JSON и мусор следом.
 * Убирается ровно одна скобка — та, что закрыла всё раньше времени; чинится, только если после неё текст
 * продолжается запятой. Проверку разбором делает вызывающий.
 */
export function dropPrematureCloser(json: string): PrematureCloserRepair | undefined {
  const open: string[] = [];
  let inString = false;
  for (let index = 0; index < json.length; index++) {
    const char = json[index]!;
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") open.push(char);
    else if (char === "}" || char === "]") {
      if (open.at(-1) !== (char === "}" ? "{" : "[")) return undefined;
      open.pop();
      if (open.length === 0) {
        const rest = json.slice(index + 1);
        if (!/^\s*,/.test(rest) || index === 0) return undefined;
        return { text: json.slice(0, index) + rest };
      }
    }
  }
  return undefined;
}
