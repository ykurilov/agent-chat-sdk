#!/usr/bin/env node
// Проверки правил репозитория:
// 1. Слой поведения и скин: в `skins/tandem/src`,
//    `packages/react/src` (кроме словаря `labels.tsx`) и экранах пакетов нет кириллицы в коде — ни в строках, ни в
//    тексте JSX; все надписи берутся из словаря. Комментарии на русском разрешены.
// 2. `packages/react/src` и экран сценариев (`packages/flows/src/react`) не импортируют дизайн-систему `@tandem/ui` и файлы стилей.
// 3. Цвета: в скине и демо нет `var(--background)` (в Тандеме фон — `--canvas`).
// 4. Встраивание: у каждого пакета `exports` без масок; демо-стенд и скин импортируют пакеты
//    модуля только по адресам из их `exports` и не лезут относительными путями в чужие папки.
// 5. Необязательные пакеты: ядро, сервер и слой поведения не знают пакетов памяти,
//    фоновых задач, мессенджеров и сценариев. Пакет памяти зависит только от ядра (`@ykurilov/agent-chat-core`),
//    но не от сервера и не от экрана.
// 6. Журнал пакета (`CHANGELOG.md`) уходит в npm-архив без папки `docs/`: относительных ссылок
//    на них в журнале быть не должно, только полные (на GitHub).
// 7. Вход `./format` пакета сценариев (формат, движок, проверка) идёт и в браузер: из чужого он берёт только `zod`,
//    без базы, сервера, ядра и `node:`.
// 8. В пакетах, скинах и приложениях нет локальных путей машины автора (папка картинок чата в /tmp, внешний диск, домашняя папка):
//    снимки и временные файлы — в `screenshotFolder()` из `apps/demo/e2e/support/screen.ts`.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sourceExtensions = /\.(ts|tsx|js|jsx|mjs)$/;
const cyrillic = /[А-Яа-яЁё]/;
const importSpecifier = /(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

const labelFolders = [
  "skins/tandem/src",
  "packages/react/src",
  "packages/sandbox/src/react",
  "packages/messengers/src/react",
  "packages/flows/src/react",
  "packages/skills/src/react",
  "packages/mcp/src/react",
];
const labelsDictionaries = [
  "packages/react/src/labels.tsx",
  "packages/sandbox/src/react/sandbox-labels.ts",
  "packages/messengers/src/react/messengers-labels.ts",
  "packages/skills/src/react/skills-labels.ts",
  "packages/mcp/src/react/mcp-labels.ts",
];
const behaviourFolder = "packages/react/src";
const behaviourFolders = [behaviourFolder, "packages/flows/src/react", "packages/skills/src/react"];
const consumers = [
  { folder: "apps/demo", sources: ["src", "server", "e2e", "vite.config.ts", "playwright.config.ts"] },
  { folder: "apps/next-example", sources: ["app", "lib", "scripts", "next.config.ts"] },
  { folder: "skins/tandem", sources: ["src"] },
];

const problems = [];

/**
 * Файлы кода по указанному пути (файл или папка), пути от корня репозитория. Нет пути — нарушение:
 * после переименования папки проверки иначе тихо выключились бы.
 */
function sourceFiles(path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    problems.push(`${path}: проверяемого пути нет (переименовали? поправьте списки в scripts/check-rules.mjs)`);
    return [];
  }
  if (sourceExtensions.test(absolute)) return [path];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && sourceExtensions.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

/**
 * Заменяет комментарии пробелами той же длины, сохраняя переводы строк, чтобы номера строк
 * остались прежними. Строки и шаблоны проходят как есть: `//` внутри строки — не комментарий.
 */
function withoutComments(source) {
  let result = "";
  let index = 0;
  /** Глубина `${…}` внутри шаблонных строк: на ней `}` возвращает в шаблон. */
  const templateDepths = [];
  let braceDepth = 0;
  const blank = (text) => text.replace(/[^\n]/g, " ");

  const readQuoted = (quote) => {
    let end = index + 1;
    while (end < source.length && source[end] !== quote && source[end] !== "\n") end += source[end] === "\\" ? 2 : 1;
    result += source.slice(index, end + 1);
    index = end + 1;
  };

  const readTemplate = () => {
    // index стоит сразу после открывающей «`» или закрывающей «}» подстановки.
    let end = index;
    while (end < source.length && source[end] !== "`" && !(source[end] === "$" && source[end + 1] === "{")) {
      end += source[end] === "\\" ? 2 : 1;
    }
    if (source[end] === "`") {
      result += source.slice(index, end + 1);
      index = end + 1;
    } else {
      result += source.slice(index, end + 2);
      index = end + 2;
      templateDepths.push(braceDepth);
      braceDepth += 1;
    }
  };

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      result += blank(source.slice(index, stop));
      index = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      result += blank(source.slice(index, stop));
      index = stop;
    } else if (char === '"' || char === "'") {
      readQuoted(char);
    } else if (char === "`") {
      result += char;
      index += 1;
      readTemplate();
    } else if (char === "{") {
      braceDepth += 1;
      result += char;
      index += 1;
    } else if (char === "}") {
      braceDepth -= 1;
      result += char;
      index += 1;
      if (templateDepths.at(-1) === braceDepth) {
        templateDepths.pop();
        readTemplate();
      }
    } else {
      result += char;
      index += 1;
    }
  }
  return result;
}

const codeOf = (file) => withoutComments(readFileSync(join(root, file), "utf8"));
const lineOf = (code, index) => code.slice(0, index).split("\n").length;

for (const file of labelFolders.flatMap(sourceFiles)) {
  if (labelsDictionaries.includes(file)) continue;
  codeOf(file).split("\n").forEach((line, lineIndex) => {
    if (cyrillic.test(line)) problems.push(`${file}:${lineIndex + 1}: надпись в коде, а не в словаре: ${line.trim()}`);
  });
}

// Цвета: в Тандеме фон страницы — `--canvas`; переменной `--background` там нет, и фон выходит прозрачным.
for (const file of [...sourceFiles("skins/tandem/src"), ...sourceFiles("apps/demo/src")]) {
  codeOf(file).split("\n").forEach((line, lineIndex) => {
    if (line.includes("var(--background)")) problems.push(`${file}:${lineIndex + 1}: «--background» нет в Тандеме, фон страницы — «--canvas»`);
  });
}

for (const file of behaviourFolders.flatMap(sourceFiles)) {
  const code = codeOf(file);
  for (const match of code.matchAll(importSpecifier)) {
    const specifier = match[1];
    if (specifier === "@tandem/ui" || specifier.startsWith("@tandem/ui/")) {
      problems.push(`${file}:${lineOf(code, match.index)}: слой поведения импортирует дизайн-систему «${specifier}»`);
    } else if (/\.(css|scss|sass|less)(\?.*)?$/.test(specifier)) {
      problems.push(`${file}:${lineOf(code, match.index)}: слой поведения импортирует стили «${specifier}»`);
    }
  }
}

/** Публичные адреса пакетов модуля: `@ykurilov/agent-chat-react`, `@ykurilov/agent-chat-server/hono`… */
const publicSpecifiers = new Set();
const packageFolders = [...readdirSync(join(root, "packages")).map((name) => `packages/${name}`), "skins/tandem"].filter(
  (folder) => existsSync(join(root, folder, "package.json")),
);

for (const folder of packageFolders) {
  const manifest = JSON.parse(readFileSync(join(root, folder, "package.json"), "utf8"));
  if (!manifest.exports || typeof manifest.exports !== "object") {
    problems.push(`${folder}/package.json: нет поля exports — открыт любой файл пакета`);
    continue;
  }
  for (const subpath of Object.keys(manifest.exports)) {
    if (subpath.includes("*")) problems.push(`${folder}/package.json: маска «${subpath}» в exports открывает глубокие импорты`);
    publicSpecifiers.add(subpath === "." ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//, "")}`);
  }
}

for (const consumer of consumers) {
  const consumerRoot = join(root, consumer.folder);
  for (const file of consumer.sources.flatMap((source) => sourceFiles(join(consumer.folder, source)))) {
    const code = codeOf(file);
    for (const match of code.matchAll(importSpecifier)) {
      const specifier = match[1];
      const where = `${file}:${lineOf(code, match.index)}`;
      if (specifier.startsWith("@ykurilov/agent-chat") && !publicSpecifiers.has(specifier)) {
        problems.push(`${where}: «${specifier}» — не публичная точка модуля`);
      }
      if (specifier.startsWith(".") && relative(consumerRoot, resolve(dirname(join(root, file)), specifier)).startsWith("..")) {
        problems.push(`${where}: «${specifier}» — импорт в обход пакетов, мимо их exports`);
      }
    }
  }
}

const optionalPackages = [
  { name: "@ykurilov/agent-chat-memory", title: "пакет памяти" },
  { name: "@ykurilov/agent-chat-background", title: "пакет фоновых задач" },
  { name: "@ykurilov/agent-chat-messengers", title: "пакет мессенджеров" },
  { name: "@ykurilov/agent-chat-flows", title: "пакет сценариев" },
  { name: "@ykurilov/agent-chat-reply-check", title: "пакет проверок ответа" },
  { name: "@ykurilov/agent-chat-skills", title: "пакет навыков" },
  { name: "@ykurilov/agent-chat-mcp", title: "пакет серверов MCP" },
];
// Пакеты, которые зависят только от ядра.
const coreOnlyPackages = [
  { folder: "packages/memory/src", title: "пакет памяти" },
  { folder: "packages/reply-check/src", title: "пакет проверок ответа" },
  { folder: "packages/skills/src", title: "пакет навыков" },
];
for (const file of ["packages/core/src", "packages/server/src", "packages/react/src"].flatMap(sourceFiles)) {
  const code = codeOf(file);
  for (const match of code.matchAll(importSpecifier)) {
    for (const optional of optionalPackages) {
      if (match[1] === optional.name || match[1].startsWith(`${optional.name}/`)) {
        problems.push(`${file}:${lineOf(code, match.index)}: «${match[1]}» — ядро, сервер и слой поведения не импортируют ${optional.title}`);
      }
    }
  }
}
for (const own of coreOnlyPackages) {
  for (const file of sourceFiles(own.folder)) {
    const code = codeOf(file);
    for (const match of code.matchAll(importSpecifier)) {
      const specifier = match[1];
      if (specifier.startsWith("@ykurilov/agent-chat") && specifier !== "@ykurilov/agent-chat-core" && !specifier.startsWith("@ykurilov/agent-chat-core/")) {
        problems.push(`${file}:${lineOf(code, match.index)}: «${specifier}» — ${own.title} зависит только от ядра`);
      }
    }
  }
}

const browserFlowParts = ["format", "engine", "check", "not-yet"].map((part) => `packages/flows/src/${part}`);
const isBrowserFlowPart = (path) => browserFlowParts.some((part) => path === part || path === `${part}.ts` || path.startsWith(`${part}/`));
const browserFlowFiles = ["format", "engine", "check", "format.ts", "not-yet.ts"].map((part) => `packages/flows/src/${part}`);
for (const file of browserFlowFiles.flatMap(sourceFiles)) {
  const code = codeOf(file);
  for (const match of code.matchAll(importSpecifier)) {
    const specifier = match[1];
    const where = `${file}:${lineOf(code, match.index)}`;
    if (specifier.startsWith(".")) {
      const target = relative(root, resolve(dirname(join(root, file)), specifier));
      if (!isBrowserFlowPart(target)) problems.push(`${where}: «${specifier}» — вход ./format сценариев не тянет серверные части пакета`);
    } else if (specifier !== "zod" && !specifier.startsWith("zod/")) {
      problems.push(`${where}: «${specifier}» — вход ./format сценариев идёт в браузер и берёт из чужого только zod`);
    }
  }
}

for (const folder of packageFolders) {
  const changelog = join(root, folder, "CHANGELOG.md");
  if (!existsSync(changelog)) continue;
  readFileSync(changelog, "utf8")
    .split("\n")
    .forEach((line, lineIndex) => {
      if (/\]\(\.{1,2}\//.test(line)) problems.push(`${folder}/CHANGELOG.md:${lineIndex + 1}: относительная ссылка не работает у читателя из node_modules, дайте полную (GitHub)`);
    });
}

// Локальные пути машины автора (папка картинок для чата, внешний диск, домашняя папка) в коде и текстах пакетов.
// Публичная выгрузка их не пропустит, но ловит только при выпуске — здесь ловится на каждом push.
// Образцы собраны из частей: иначе сама проверка попала бы под запретный список открытой выгрузки.
const localPath = new RegExp(["/tmp/" + "pa" + "seo" + "-images", "/Vol" + "umes/", "/Us" + "ers/(?!somebody\\b)", "/home/" + "ykur" + "ilov"].map((part) => part.replaceAll("/", "\\/")).join("|"));
const binaryFile = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|mp3|mp4|wav|webm|sqlite|db|zip|gz)$/i;
const generatedFolders = new Set(["node_modules", "dist", ".next", ".turbo", "coverage", "test-results", "playwright-report"]);
/** Файлы под git; копия без `.git` (прогон на другой машине) — обход папок без зависимостей и сборок. */
function repositoryFiles(folders) {
  try {
    return execFileSync("git", ["ls-files", "--", ...folders], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n");
  } catch {
    const walk = (folder) =>
      readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory()) return generatedFolders.has(entry.name) ? [] : walk(`${folder}/${entry.name}`);
        return entry.isFile() ? [`${folder}/${entry.name}`] : [];
      });
    return folders.flatMap(walk);
  }
}
const trackedFiles = repositoryFiles(["packages", "skins", "apps"]).filter(
  (file) => file && !binaryFile.test(file) && existsSync(join(root, file)),
);
for (const file of trackedFiles) {
  readFileSync(join(root, file), "utf8").split("\n").forEach((line, lineIndex) => {
    if (localPath.test(line)) {
      problems.push(`${file}:${lineIndex + 1}: локальный путь «${line.match(localPath)[0]}» — снимки и временные файлы кладите в screenshotFolder() из apps/demo/e2e/support/screen.ts`);
    }
  });
}

const found = [...new Set(problems)];
if (found.length > 0) {
  console.error(`check-rules: найдено нарушений — ${found.length}`);
  for (const problem of found) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(
  `check-rules: надписи только в словаре, слой поведения без дизайн-системы и стилей, модуль подключается только через публичные точки (${[...publicSpecifiers].sort().join(", ")})`,
);
