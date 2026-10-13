#!/usr/bin/env node
// Один выпуск SDK: `pnpm release`.
//   проверки (юнит-тесты, типы, сборка) → changeset version → коммит → публикация → тег → push.
// Проверки пропускаются, если `pnpm verify` уже прогнал их на этом же коде (отметка в node_modules/.cache);
// `--full` проверяет заново принудительно.
// `--dry-run` показывает, что выпуск сделал бы, и останавливается до changeset version: ничего не меняет и не запускает.
// Нет записей в .changeset — выпускать нечего, скрипт объясняет и останавливается.
// Если прошлый выпуск подготовлен, но не опубликован (сбой сети, нет токена), повторный запуск
// доводит его до конца, не создавая новую версию.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStamp } from "./verified-stamp.mjs";

const full = process.argv.includes("--full");
const dryRun = process.argv.includes("--dry-run");

const root = fileURLToPath(new URL("..", import.meta.url));
const registry = "https://registry.npmjs.org";
const coAuthor = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";

function stop(message) {
  console.error(`\n✋ ${message}\n`);
  process.exit(1);
}

function run(command, args, { quiet = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: quiet ? "pipe" : "inherit", encoding: "utf8" });
  if (result.status !== 0) {
    if (quiet) console.error(result.stdout, result.stderr);
    stop(`Команда не прошла: ${command} ${args.join(" ")}. Выпуск остановлен, ничего не опубликовано.`);
  }
  return result.stdout?.trim() ?? "";
}

/** Сухой прогон: нарушение окружения не останавливает, а попадает в отчёт. */
function stopUnlessDryRun(message) {
  if (!dryRun) stop(message);
  console.log(`⚠ (сухой прогон, в настоящем выпуске здесь был бы стоп) ${message}`);
}

function step(title) {
  console.log(`\n▶ ${title}`);
}

const pendingChangesets = () =>
  readdirSync(join(root, ".changeset")).filter((name) => name.endsWith(".md") && name !== "README.md");

const readVersion = () => JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8")).version;

/** Есть ли эта версия ядра в npm. Ядро едет вместе с остальными, поэтому по нему судим о выпуске. */
function isPublished(version) {
  const result = spawnSync("npm", ["view", `@ykurilov/agent-chat-core@${version}`, "version", "--registry", registry], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim() === version;
}

step("Проверяю окружение");
if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true }) !== "main") stopUnlessDryRun("Выпускать можно только из ветки main.");
if (run("git", ["status", "--porcelain"], { quiet: true }) !== "") {
  stopUnlessDryRun("В рабочей папке есть незакоммиченные изменения. Закоммитьте их (вместе с записью в .changeset) и запустите снова.");
}
// npm не выдаёт токен через `npm config get` (он защищён), поэтому ищем строку в пользовательском .npmrc.
const userNpmrc = join(process.env.HOME ?? "", ".npmrc");
const hasToken =
  Boolean(process.env.NODE_AUTH_TOKEN) ||
  (existsSync(userNpmrc) && /^\/\/registry\.npmjs\.org\/:_authToken=\S+/m.test(readFileSync(userNpmrc, "utf8")));
if (!hasToken) {
  stopUnlessDryRun("Нет токена для registry.npmjs.org в ~/.npmrc (Granular Access Token с правом записи в пакеты @ykurilov). Без него публикация не пройдёт.");
}

/** Тесты, типы и сборка перед выпуском — если `pnpm verify` не проверил этот же код. */
function runChecks() {
  const verdict = full ? { verified: false, reason: "задан --full" } : checkStamp(root);
  if (verdict.verified) {
    console.log(`Код уже проверен (pnpm verify, ${new Date(verdict.verifiedAt).toLocaleString("ru-RU")}), повтор пропущен.`);
    return;
  }
  console.log(`Проверяю заново: ${verdict.reason}.`);
  if (dryRun) {
    console.log("Сухой прогон: запустил бы pnpm test, pnpm typecheck, pnpm build.");
    return;
  }
  step("Юнит-тесты и проверки правил");
  run("pnpm", ["test"]);
  step("Проверка типов");
  run("pnpm", ["typecheck"]);
  step("Сборка пакетов");
  run("pnpm", ["build"]);
}

let version;
if (pendingChangesets().length > 0) {
  step("Проверки перед выпуском");
  runChecks();
  if (dryRun) {
    console.log("\nСухой прогон закончен: дальше changeset version, коммит, публикация, тег и push — не выполнялись.");
    process.exit(0);
  }

  step("Новая версия и журнал изменений");
  run("pnpm", ["exec", "changeset", "version"]);
  run("pnpm", ["install", "--lockfile-only"], { quiet: true });
  version = readVersion();
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", `chore(release): v${version}`, "-m", coAuthor]);
} else {
  version = readVersion();
  if (isPublished(version)) {
    stop(
      `Нет записей об изменениях в .changeset, выпускать нечего (версия ${version} уже в npm).\n` +
        "   Создайте запись: pnpm changeset (шаблоны и правила — RELEASING.md), закоммитьте её и запустите pnpm release снова.",
    );
  }
  console.log(`Версия ${version} подготовлена раньше, но не опубликована. Довожу выпуск до конца.`);
  if (dryRun) {
    console.log("\nСухой прогон закончен: сборка, публикация, тег и push — не выполнялись.");
    process.exit(0);
  }
  step("Сборка пакетов");
  run("pnpm", ["build"]);
}

step(`Публикация версии ${version} в npm`);
run("pnpm", ["exec", "changeset", "publish"]);

step("Тег и push");
const tag = `v${version}`;
if (run("git", ["tag", "--list", tag], { quiet: true }) === "") run("git", ["tag", "-a", tag, "-m", `Agent Chat SDK ${version}`]);
run("git", ["push", "origin", "main", "--tags"]);

console.log(`\n✅ Agent Chat SDK ${version} выпущен. Тег ${tag} отправлен. Журнал: packages/*/CHANGELOG.md`);
