#!/usr/bin/env node
// Вшивает миграции drizzle пакетов в код: папка `drizzle` (или `drizzle/postgres`, `drizzle/sqlite`) пакета превращается
// в `src/drizzle-migrations[-<база>].generated.ts` с теми же полями, что читает `readMigrationFiles` drizzle (те же хеши).
// Зачем: файлы пакета на диске бандлер Next.js принимает за импорт, а `output: "standalone"` их не копирует; код едет всегда.
// Запуск: `node scripts/embed-migrations.mjs` после `drizzle-kit generate` (это делает `pnpm db:generate` пакета);
// `--check` — только сверить, ничего не писать (часть `pnpm test`).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const checkOnly = process.argv.includes("--check");

/** Папки миграций пакета и имя файла с их кодом. */
function migrationFolders(packageFolder) {
  const drizzle = join(packageFolder, "drizzle");
  if (existsSync(join(drizzle, "meta/_journal.json"))) return [{ folder: drizzle, target: "drizzle-migrations.generated.ts" }];
  return ["postgres", "sqlite"]
    .filter((database) => existsSync(join(drizzle, database, "meta/_journal.json")))
    .map((database) => ({ folder: join(drizzle, database), target: `drizzle-migrations-${database}.generated.ts` }));
}

// Миграции читает сам drizzle: хеши обязаны совпасть с записанными в журналах баз приложений.
const drizzleMigrator = createRequire(join(root, "packages/storage-sqlite/package.json")).resolve("drizzle-orm/migrator");
const drizzleModule = await import(pathToFileURL(drizzleMigrator).href);
const readMigrationFiles = drizzleModule.readMigrationFiles ?? drizzleModule.default.readMigrationFiles;

function readMigrations(folder) {
  const { entries } = JSON.parse(readFileSync(join(folder, "meta/_journal.json"), "utf8"));
  return readMigrationFiles({ migrationsFolder: folder }).map((migration, index) => ({ tag: entries[index].tag, ...migration }));
}

function moduleCode(folder, migrations) {
  const items = migrations.map(
    ({ tag, sql, bps, folderMillis, hash }) =>
      `  // ${tag}\n  { folderMillis: ${folderMillis}, hash: ${JSON.stringify(hash)}, bps: ${bps}, sql: [\n${sql.map((part) => `    ${JSON.stringify(part)},`).join("\n")}\n  ] },`,
  );
  return [
    `// Создано scripts/embed-migrations.mjs из ${relative(root, folder)}; не править руками: \`pnpm db:generate\` пакета пересоздаёт файл.`,
    `import type { EmbeddedMigration } from "@ykurilov/agent-chat-core";`,
    ``,
    `export const migrations: readonly EmbeddedMigration[] = [`,
    ...items,
    `];`,
    ``,
  ].join("\n");
}

const stale = [];
for (const name of readdirSync(join(root, "packages"))) {
  const packageFolder = join(root, "packages", name);
  for (const { folder, target } of migrationFolders(packageFolder)) {
    const file = join(packageFolder, "src", target);
    const code = moduleCode(folder, readMigrations(folder));
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (current === code) continue;
    if (checkOnly) stale.push(relative(root, file));
    else {
      writeFileSync(file, code);
      console.log(`записан ${relative(root, file)}`);
    }
  }
}

if (stale.length > 0) {
  console.error(`embed-migrations: код миграций отстал от папки drizzle — запустите node scripts/embed-migrations.mjs:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}
if (checkOnly) console.log("embed-migrations: вшитые миграции совпадают с папками drizzle");
