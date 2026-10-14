#!/usr/bin/env node
// Собирает пакет, из папки которого запущен: `pnpm build` в packages/core и так далее.
// Точки входа берутся из `exports` пакета: у каждой есть условие с исходником (`@ykurilov/agent-chat-source`)
// и адрес собранного файла (`import`). Входы-строки (готовый файл, например JSON Schema) не собираются. На выходе в `dist`:
//   1. JS (esbuild через tsup); зависимости пакета остаются внешними;
//   2. типы `.d.ts` в `dist/types` (tsc), с расширениями `.js` в относительных импортах:
//      без них типы не находятся у приложений с настройкой `moduleResolution: node16`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "tsup";

const packageRoot = process.cwd();
const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const dist = join(packageRoot, "dist");

const entry = Object.fromEntries(
  Object.values(manifest.exports)
    .filter((condition) => typeof condition === "object" && condition.import)
    .map((condition) => [
      condition.import.replace(/^\.\/dist\//, "").replace(/\.js$/, ""),
      condition["@ykurilov/agent-chat-source"],
    ]),
);

rmSync(dist, { recursive: true, force: true });

// Пакет, который включает перенесённый чужой код, кладёт в архив и лицензию: копия из корня репозитория (в git не хранится).
if (manifest.files?.includes("THIRD_PARTY_NOTICES.md")) {
  copyFileSync(resolve(packageRoot, "../../THIRD_PARTY_NOTICES.md"), join(packageRoot, "THIRD_PARTY_NOTICES.md"));
}

await build({
  entry,
  format: "esm",
  target: "es2023",
  sourcemap: true,
  outDir: "dist",
  config: false,
  silent: true,
});

const declarations = spawnSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], { cwd: packageRoot, stdio: "inherit" });
if (declarations.status !== 0) process.exit(declarations.status ?? 1);
addJsExtensionsToDeclarations(join(dist, "types"));

function addJsExtensionsToDeclarations(folder) {
  const relativeSpecifier = /(from\s+|import\s*\(\s*|import\s+)(["'])(\.{1,2}\/[^"']*)\2/g;
  const files = readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".d.ts"))
    .map((item) => join(item.parentPath, item.name));
  for (const file of files) {
    const code = readFileSync(file, "utf8");
    const fixed = code.replace(relativeSpecifier, (whole, lead, quote, specifier) => {
      const target = resolve(dirname(file), specifier);
      if (existsSync(`${target}.d.ts`)) return `${lead}${quote}${specifier}.js${quote}`;
      if (existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, "index.d.ts"))) {
        return `${lead}${quote}${specifier}/index.js${quote}`;
      }
      return whole;
    });
    if (fixed !== code) writeFileSync(file, fixed);
  }
}
