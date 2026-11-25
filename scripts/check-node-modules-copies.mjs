#!/usr/bin/env node
// Файлы, которые читает TypeScript, в node_modules должны быть своими копиями, а не жёсткими ссылками.
// TypeScript 7.0 узнаёт настоящий путь файла через fcntl(F_GETPATH). У жёсткой ссылки macOS отдаёт путь той из её
// копий, которую кто-то открывал последним, — и при параллельной проверке типов `drizzle-orm/better-sqlite3`
// изредка читается как `drizzle-orm/node-postgres` (у их index.d.ts одинаковый текст, pnpm делает их одним файлом).
// Отсюда плавающие ошибки «SQLite-таблица не PgTable» в случайном пакете.
// pnpm-workspace.yaml велит копировать (packageImportMethod: clone-or-copy), но пакеты, поставленные раньше, pnpm
// не переносит сам: их чинит `pnpm install --force`. Эта проверка ловит такие node_modules до проверки типов.
import { lstatSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const READ_BY_TYPESCRIPT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"]);

/** Файлы, которые читает TypeScript, — жёсткие ссылки (больше одного имени на диске) в node_modules/.pnpm. */
export function findLinkedTypeFiles(root, limit = Infinity) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && READ_BY_TYPESCRIPT.has(extname(entry.name)) && lstatSync(path).nlink > 1) {
        found.push(relative(root, path));
      }
    }
  };
  walk(join(root, "node_modules", ".pnpm"));
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const linked = findLinkedTypeFiles(root, 3);
  if (linked.length > 0) {
    console.error(
      [
        "✋ В node_modules файлы пакетов — жёсткие ссылки, а не копии. TypeScript на macOS тогда изредка читает",
        "   чужой файл вместо нужного, и проверка типов падает в случайном пакете. Например:",
        ...linked.map((path) => `   ${path}`),
        "   Починка (один раз, пакеты перенесутся копиями): pnpm install --force --frozen-lockfile",
      ].join("\n"),
    );
    process.exit(1);
  }
}
