/** Больше лишних скобок в одном вызове — уже не опечатка, а что-то другое: такое не чиним. */
const MAX_STRAY_CLOSERS = 2;

/** Текст без лишних закрывающих скобок и сколько их было: внутри JSON и после его конца. */
export interface StrayClosersRepair {
  text: string;
  inside: number;
  end: number;
}

/**
 * Убирает закрывающие `}` и `]`, которые не закрывают ничего открытого: `{"a": [{"b": 1}}]}`, `{"a": 1}}`.
 * Такую скобку парсер JSON не примет нигде, данных в ней нет — убрать её значит не гадать о содержимом.
 * Не чинит (`undefined`), если лишних скобок нет или больше двух, если после конца JSON идёт не скобка и не пробел,
 * если чего-то не хватает (недостающая скобка, незакрытая строка). Проверку разбором делает вызывающий.
 */
export function dropStrayClosers(json: string): StrayClosersRepair | undefined {
  const open: string[] = [];
  let text = "";
  let inside = 0;
  let end = 0;
  let inString = false;
  let started = false;

  for (let index = 0; index < json.length; index++) {
    const char = json[index]!;

    if (inString) {
      text += char;
      if (char === "\\") {
        text += json[index + 1] ?? "";
        index += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    const finished = started && open.length === 0;
    if (char === "}" || char === "]") {
      if (open.at(-1) === (char === "}" ? "{" : "[")) {
        open.pop();
        text += char;
      } else if (finished) {
        end += 1;
      } else if (open.length > 0) {
        inside += 1;
      } else {
        return undefined;
      }
      continue;
    }

    if (finished && !/\s/.test(char)) return undefined;
    if (char === "{" || char === "[") {
      open.push(char);
      started = true;
    } else if (char === '"') {
      inString = true;
    }
    text += char;
  }

  const dropped = inside + end;
  if (dropped === 0 || dropped > MAX_STRAY_CLOSERS || inString || open.length > 0) return undefined;
  return { text, inside, end };
}
