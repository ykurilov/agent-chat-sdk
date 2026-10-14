/** Больше недостающих скобок в одном вызове — уже не забывчивость, а обрыв: такое не чиним. */
const MAX_MISSING_CLOSERS = 3;

const CLOSER = { "{": "}", "[": "]" } as const;
type Opener = keyof typeof CLOSER;

/** Что последним встретилось вне строки: по этому видно, закончено ли значение. */
type Last = "none" | "open" | "comma" | "colon" | "key" | "string" | "bare" | "close";

/** Текст с дописанными закрывающими скобками и сколько их дописано. */
export interface MissingClosersRepair {
  text: string;
  added: number;
}

/**
 * Дописывает забытые закрывающие `]` и `}` в правильном порядке: `{"a": ["x", "y"}` → `{"a": ["x", "y"]}`,
 * `{"a": [{"b": 1}` → `{"a": [{"b": 1}]}`.
 * Чинит, только если скобка пропущена после законченного значения (объекта, массива, строки-значения):
 * там, где следующая закрывающая не подходит к открытой, или в самом конце текста.
 * Не чинит (`undefined`), если текст обрезан посреди строки, ключа, числа или слова `true`/`null`,
 * после запятой, двоеточия или открывающей скобки, если дописать надо больше трёх скобок
 * или закрывающая скобка вообще ничего не закрывает (лишняя — это дело `dropStrayClosers`).
 * Проверку разбором делает вызывающий.
 */
export function addMissingClosers(json: string): MissingClosersRepair | undefined {
  const open: Opener[] = [];
  let text = "";
  let added = 0;
  let last: Last = "none";
  let inString = false;
  let stringIsKey = false;

  for (let index = 0; index < json.length; index++) {
    const char = json[index]!;

    if (inString) {
      text += char;
      if (char === "\\") {
        if (index + 1 >= json.length) return undefined;
        text += json[index + 1];
        index += 1;
      } else if (char === '"') {
        inString = false;
        last = stringIsKey ? "key" : "string";
      }
      continue;
    }

    if (/\s/.test(char)) {
      text += char;
      continue;
    }

    if (char === "}" || char === "]") {
      const depth = open.lastIndexOf(char === "}" ? "{" : "[");
      if (depth === -1) return undefined;
      const missing = open.length - 1 - depth;
      if (missing > 0) {
        if (last !== "string" && last !== "bare" && last !== "close") return undefined;
        for (let skipped = 0; skipped < missing; skipped++) text += CLOSER[open.pop()!];
        added += missing;
      }
      open.pop();
      last = "close";
    } else if (char === "{" || char === "[") {
      open.push(char);
      last = "open";
    } else if (char === '"') {
      inString = true;
      stringIsKey = open.at(-1) === "{" && (last === "open" || last === "comma");
    } else if (char === ",") {
      last = "comma";
    } else if (char === ":") {
      last = "colon";
    } else {
      last = "bare";
    }
    text += char;
  }

  if (inString || (last !== "string" && last !== "close")) return undefined;
  added += open.length;
  while (open.length > 0) text += CLOSER[open.pop()!];
  return added > 0 && added <= MAX_MISSING_CLOSERS ? { text, added } : undefined;
}
