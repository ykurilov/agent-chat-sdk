/*
 * Portions adapted from pi-mono (https://github.com/badlogic/pi-mono), Copyright (c) 2025 Mario Zechner, MIT License.
 * `repairJson` — из packages/ai/src/utils/json-parse.ts. Полный текст лицензии — THIRD_PARTY_NOTICES.md.
 * Отличие: `\u` без четырёх шестнадцатеричных цифр (путь `C:\users`) считается неверной `\` и удваивается.
 */

// `\u` здесь нет: верная `\uXXXX` разбирается отдельно, ниже.
const VALID_JSON_ESCAPES = new Set(['"', "\\", "/", "b", "f", "n", "r", "t"]);

function isControlCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f;
}

function escapeControlCharacter(char: string): string {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
  }
}

/**
 * Чинит кривые строки JSON, которые иногда присылают модели:
 * - сырые управляющие знаки внутри строки (перевод строки, табуляция) получают запись через `\`;
 * - `\` перед знаком, который так не пишется (`\d`), удваивается.
 */
export function repairJson(json: string): string {
  let repaired = "";
  let inString = false;

  for (let index = 0; index < json.length; index++) {
    const char = json[index]!;

    if (!inString) {
      repaired += char;
      if (char === '"') inString = true;
      continue;
    }

    if (char === '"') {
      repaired += char;
      inString = false;
      continue;
    }

    if (char === "\\") {
      const nextChar = json[index + 1];
      if (nextChar === undefined) {
        repaired += "\\\\";
        continue;
      }

      if (nextChar === "u") {
        const unicodeDigits = json.slice(index + 2, index + 6);
        if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
          repaired += `\\u${unicodeDigits}`;
          index += 5;
          continue;
        }
      }

      if (VALID_JSON_ESCAPES.has(nextChar)) {
        repaired += `\\${nextChar}`;
        index += 1;
        continue;
      }

      repaired += "\\\\";
      continue;
    }

    repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
  }

  return repaired;
}
