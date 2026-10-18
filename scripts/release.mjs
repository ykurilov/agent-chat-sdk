#!/usr/bin/env node
// Один выпуск SDK: `pnpm release`.
// С Мака команда сама не выпускает, а запускает этот же скрипт на GitHub Actions (release-in-actions.mjs) и ждёт итога.
// Сам выпуск по шагам ниже идёт на машине GitHub Actions (GITHUB_ACTIONS=true) или на Маке с флагом `--local` — запасной путь.
//   проверка открытой выгрузки → проверки (юнит-тесты, типы, сборка) → changeset version → коммит → публикация → тег → push.
// Проверки пропускаются, если `pnpm verify` уже прогнал их на этом же коде (отметка в node_modules/.cache);
// `--full` проверяет заново принудительно.
// `--dry-run` показывает, что выпуск сделал бы, и останавливается до changeset version: ничего не меняет и не запускает.
// Нет записей в .changeset — выпускать нечего, скрипт объясняет и останавливается.
// Если прошлый выпуск подготовлен, но не опубликован (сбой сети, нет токена), повторный запуск
// доводит его до конца, не создавая новую версию.
// Ключ npm: переменная NPM_TOKEN или файл ~/.config/agent-chat-sdk/npm-token. Другой путь — NPM_TOKEN_FILE в окружении
// или в ~/.config/agent-chat-sdk/release.env (строка NPM_TOKEN_FILE=…; файл вне репозитория, настройка своей машины).
// На GitHub Actions — секрет репозитория NPM_TOKEN, а без него доверенная публикация npm (OIDC, RELEASING.md).
// Ключ попадает в публикацию только через временный .npmrc со ссылкой ${NPM_TOKEN} и нигде не печатается.
// npm показывает новую версию не сразу (бывает, через 10+ минут), поэтому тег и push — только когда
// у каждого публичного пакета latest стал новой версией.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { checkStamp } from "./verified-stamp.mjs";

if (!process.argv.includes("--local") && process.env.GITHUB_ACTIONS !== "true") {
  const { releaseInActions } = await import("./release-in-actions.mjs");
  process.exit(releaseInActions(process.argv.slice(2)));
}

const full = process.argv.includes("--full");
const dryRun = process.argv.includes("--dry-run");

const root = fileURLToPath(new URL("..", import.meta.url));
const registry = "https://registry.npmjs.org";
const coAuthor = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>";

function stop(message) {
  console.error(`\n✋ ${message}\n`);
  process.exit(1);
}

function run(command, args, { quiet = false, env, failure = "ничего не опубликовано" } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: quiet ? "pipe" : "inherit",
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (result.status !== 0) {
    if (quiet) console.error(result.stdout, result.stderr);
    stop(`Команда не прошла: ${command} ${args.join(" ")}. Выпуск остановлен, ${failure}.`);
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

/** Имена публичных пакетов из packages/ и skins/ — всё, что уходит в npm. */
function publicPackages() {
  return ["packages", "skins"].flatMap((group) => {
    const base = join(root, group);
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .map((name) => join(base, name, "package.json"))
      .filter((manifest) => existsSync(manifest))
      .map((manifest) => JSON.parse(readFileSync(manifest, "utf8")))
      .filter((manifest) => !manifest.private)
      .map((manifest) => manifest.name);
  });
}

/** Ответ общего npm мимо кэша; строка вида `@ykurilov:registry=` в .npmrc его не перебьёт. */
function npmView(spec, field) {
  const result = spawnSync("npm", ["view", spec, field, "--registry", registry, `--@ykurilov:registry=${registry}`, "--prefer-online"], {
    cwd: root,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

/** Опубликована ли эта версия у всех публичных пакетов. Если хоть одного нет — выпуск надо доводить. */
const isPublished = (version) => publicPackages().every((name) => npmView(`${name}@${version}`, "version") === version);

/** Ждёт, пока у каждого пакета latest станет новой версией; не дождался — стоп до тега и push. */
function waitUntilVisible(version) {
  const timeoutMs = Number(process.env.RELEASE_VISIBILITY_TIMEOUT_MS ?? 20 * 60_000);
  const intervalMs = Number(process.env.RELEASE_VISIBILITY_INTERVAL_MS ?? 15_000);
  const deadline = Date.now() + timeoutMs;
  let waiting = publicPackages();
  for (;;) {
    waiting = waiting.filter((name) => npmView(name, "dist-tags.latest") !== version);
    if (waiting.length === 0) return;
    if (Date.now() >= deadline) {
      stop(`За ${Math.round(timeoutMs / 60_000)} мин npm так и не показал ${version} как latest у: ${waiting.join(", ")}. Тег и push не сделаны; проверьте https://www.npmjs.com/package/${waiting[0]} и запустите pnpm release снова.`);
    }
    console.log(`npm ещё не показывает ${version} у ${waiting.length} пакетов, жду…`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, intervalMs);
  }
}

step("Проверяю окружение");
if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { quiet: true }) !== "main") stopUnlessDryRun("Выпускать можно только из ветки main.");
if (run("git", ["status", "--porcelain"], { quiet: true }) !== "") {
  stopUnlessDryRun("В рабочей папке есть незакоммиченные изменения. Закоммитьте их (вместе с записью в .changeset) и запустите снова.");
}
const sdkConfigDir = join(process.env.HOME ?? "", ".config/agent-chat-sdk");
/** Настройки выпуска своей машины: ~/.config/agent-chat-sdk/release.env, если он есть. */
function machineReleaseEnv() {
  const file = join(sdkConfigDir, "release.env");
  return existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
}
const expandHome = (path) => path.replace(/^~(?=\/)/, process.env.HOME ?? "");
const tokenFile = expandHome(process.env.NPM_TOKEN_FILE ?? machineReleaseEnv().NPM_TOKEN_FILE ?? join(sdkConfigDir, "npm-token"));
/** Ключ npm из NPM_TOKEN или из файла секретов; null — нет ни того ни другого. */
function readNpmToken() {
  if (process.env.NPM_TOKEN) return process.env.NPM_TOKEN;
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim() || null;
  return null;
}
const npmToken = readNpmToken();
// npm не выдаёт токен через `npm config get` (он защищён), поэтому ищем строку в пользовательском .npmrc.
const userNpmrc = join(process.env.HOME ?? "", ".npmrc");
// На GitHub Actions с id-token: write npm публикует и без ключа — доверенной публикацией (OIDC).
const hasTrustedPublishing = Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
const hasToken =
  Boolean(npmToken) ||
  hasTrustedPublishing ||
  Boolean(process.env.NODE_AUTH_TOKEN) ||
  (existsSync(userNpmrc) && /^\/\/registry\.npmjs\.org\/:_authToken=\S+/m.test(readFileSync(userNpmrc, "utf8")));
if (!hasToken) {
  stopUnlessDryRun(`Нет ключа npm: ни NPM_TOKEN, ни ${tokenFile}, ни строки //registry.npmjs.org/:_authToken в ~/.npmrc (нужен Granular Access Token с правом записи в пакеты @ykurilov). Без него публикация не пройдёт.`);
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

// Открытая выгрузка (scripts/export-public.mjs) после выпуска падает на запретном и ключах — ловим это до него.
step("Проверка открытой выгрузки: запретный список и ключи на HEAD");
run("node", ["scripts/export-public.mjs", "HEAD", "--check-only"]);

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
      `Нет записей об изменениях в .changeset, выпускать нечего (версия ${version} уже в npm у всех пакетов).\n` +
        "   Создайте запись: pnpm changeset (шаблоны и правила — RELEASING.md), закоммитьте её и запустите pnpm release снова.",
    );
  }
  console.log(`Версия ${version} подготовлена раньше, но опубликована не у всех пакетов. Довожу выпуск до конца.`);
  if (dryRun) {
    console.log("\nСухой прогон закончен: сборка, публикация, тег и push — не выполнялись.");
    process.exit(0);
  }
  step("Сборка пакетов");
  run("pnpm", ["build"]);
}

step(`Публикация версии ${version} в npm`);
publishWithToken();
step(`Проверяю, что npm показывает ${version} у всех пакетов`);
waitUntilVisible(version);

/** Публикация. Ключ из NPM_TOKEN или файла — через временный .npmrc, который удаляется сразу после. */
function publishWithToken() {
  const failure = "часть пакетов могла уже уйти в npm. Исправьте причину и запустите pnpm release снова: он опубликует недостающие";
  if (!npmToken) {
    run("pnpm", ["exec", "changeset", "publish"], { failure });
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "release-npmrc-"));
  const userconfig = join(dir, ".npmrc");
  // stop() выходит через process.exit, мимо finally: убираем папку и на выходе.
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  process.on("exit", cleanup);
  try {
    writeFileSync(userconfig, "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n", { mode: 0o600 });
    run("pnpm", ["exec", "changeset", "publish"], { env: { NPM_TOKEN: npmToken, NPM_CONFIG_USERCONFIG: userconfig }, failure });
  } finally {
    cleanup();
  }
}

step("Тег и push");
const tag = `v${version}`;
if (run("git", ["tag", "--list", tag], { quiet: true }) === "") run("git", ["tag", "-a", tag, "-m", `Agent Chat SDK ${version}`]);
run("git", ["push", "origin", "main", "--tags"]);

console.log(`\n✅ Agent Chat SDK ${version} выпущен. Тег ${tag} отправлен. Журнал: packages/*/CHANGELOG.md`);
