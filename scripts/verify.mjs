#!/usr/bin/env node
// Проверки перед сдачей: `pnpm verify` = юнит-тесты и правила → типы → сборка.
// Всё зелёное — ставит отметку «код проверен» (см. verified-stamp.mjs), и `pnpm release` не повторяет эти проверки.
// Код менялся во время проверки — отметки нет: проверенное и текущее уже не одно и то же.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { codeFingerprint, writeStamp } from "./verified-stamp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

const checks = [
  ["Юнит-тесты и проверки правил", "test"],
  ["Проверка типов", "typecheck"],
  ["Сборка пакетов", "build"],
];

const before = codeFingerprint(root);
for (const [title, script] of checks) {
  console.log(`\n▶ ${title}`);
  if (spawnSync("pnpm", [script], { cwd: root, stdio: "inherit" }).status !== 0) {
    console.error(`\n✋ pnpm ${script} не прошёл. Отметки «код проверен» нет.\n`);
    process.exit(1);
  }
}

if (codeFingerprint(root) !== before) {
  console.error("\n✋ Файлы менялись во время проверки. Отметки «код проверен» нет, запустите pnpm verify снова.\n");
  process.exit(1);
}
writeStamp(root, before);
console.log("\n✅ Код проверен, отметка поставлена: pnpm release повтор пропустит.");
