#!/usr/bin/env node
// Один выпуск SDK: `pnpm release`.
// С Мака команда сама не выпускает, а запускает этот же скрипт на GitHub Actions (release-in-actions.mjs) и ждёт итога.
// Сам выпуск по шагам ниже идёт на машине GitHub Actions (GITHUB_ACTIONS=true) или на Маке с флагом `--local` — запасной путь.
//   проверка открытой выгрузки → проверки (юнит-тесты, типы, сборка) → changeset version → коммит → проверка архивов npm →
//   публикация → теги на коммит выпуска → слияние со свежим origin/main → атомарный push main и тегов → открытая выгрузка.
// Теги и открытая выгрузка — ровно тот код, что ушёл в npm: чужие коммиты, пришедшие в main за время выпуска, в них не
// попадают, а вливаются в main отдельным слиянием.
// Проверки пропускаются, если `pnpm verify` уже прогнал их на этом же коде (отметка в node_modules/.cache);
// `--full` проверяет заново принудительно.
// `--dry-run` показывает, что выпуск сделал бы, и останавливается до changeset version: ничего не меняет и не запускает.
// Нет записей в .changeset — выпускать нечего, скрипт объясняет и останавливается.
// Если прошлый выпуск подготовлен, но не опубликован или не отправлен на GitHub (сбой сети, нет токена), повторный
// запуск доводит его до конца, не создавая новую версию, — и только с самого коммита выпуска: иначе недостающие пакеты
// той же версии ушли бы в npm с другим кодом.
// Ключ npm: переменная NPM_TOKEN или файл ~/.config/agent-chat-sdk/npm-token. Другой путь — NPM_TOKEN_FILE в окружении
// или в ~/.config/agent-chat-sdk/release.env (строка NPM_TOKEN_FILE=…; файл вне репозитория, настройка своей машины).
// На GitHub Actions — секрет репозитория NPM_TOKEN, а без него доверенная публикация npm (OIDC, RELEASING.md).
// Ключ попадает в публикацию только через временный .npmrc со ссылкой ${NPM_TOKEN} и нигде не печатается. Ключ npm,
// право доверенной публикации (OIDC) и ключ git для push проверки, сборка и тесты не видят: им окружение без них.
// npm показывает новую версию не сразу (бывает, через 10+ минут), поэтому тег и push — только когда
// у каждого публичного пакета latest стал новой версией.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { checkStamp } from "./verified-stamp.mjs";

if (!process.argv.includes("--local") && process.env.GITHUB_ACTIONS !== "true") {
  const { releaseInActions } = await import("./release-in-actions.mjs");
  process.exit(releaseInActions(process.argv.slice(2)));
}

/** Доступы, которые нужны только публикации и push: остальным командам выпуска окружение без них. */
const PUBLISH_ENV_NAMES = ["NPM_TOKEN", "NODE_AUTH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"];
const publishEnv = Object.fromEntries(PUBLISH_ENV_NAMES.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
/** Ключ для push в закрытое хранилище на GitHub Actions: только командам git, которые ходят на GitHub. */
const gitPushToken = process.env.RELEASE_GITHUB_TOKEN ?? "";
for (const name of [...PUBLISH_ENV_NAMES, "RELEASE_GITHUB_TOKEN"]) delete process.env[name];

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
      stop(`За ${Math.round(timeoutMs / 60_000)} мин npm так и не показал ${version} как latest у: ${waiting.join(", ")}. Пакеты отправлены в npm, а тег и push не сделаны; проверьте https://www.npmjs.com/package/${waiting[0]} и запустите pnpm release снова.`);
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
  if (publishEnv.NPM_TOKEN) return publishEnv.NPM_TOKEN;
  if (existsSync(tokenFile)) return readFileSync(tokenFile, "utf8").trim() || null;
  return null;
}
const npmToken = readNpmToken();
// npm не выдаёт токен через `npm config get` (он защищён), поэтому ищем строку в пользовательском .npmrc.
const userNpmrc = join(process.env.HOME ?? "", ".npmrc");
// На GitHub Actions с id-token: write npm публикует и без ключа — доверенной публикацией (OIDC).
const hasTrustedPublishing = Boolean(publishEnv.ACTIONS_ID_TOKEN_REQUEST_URL);
const hasToken =
  Boolean(npmToken) ||
  hasTrustedPublishing ||
  Boolean(publishEnv.NODE_AUTH_TOKEN) ||
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
// Без gitleaks настоящий выпуск не идёт: ключи в выгрузке и в архивах npm иначе не проверить.
step("Проверка открытой выгрузки: запретный список и ключи на HEAD");
run("node", ["scripts/export-public.mjs", "HEAD", "--check-only", ...(dryRun ? ["--allow-missing-gitleaks"] : [])]);

const releaseSubject = (number) => `chore(release): v${number}`;
const headSubject = () => run("git", ["log", "-1", "--format=%s", "HEAD"], { quiet: true });
/** Тег выпуска уже на GitHub: выпуск прошлой попытки дошёл до конца. */
const tagOnGitHub = (name) => tryGit(["ls-remote", "--tags", "origin", `refs/tags/${name}`]).output.includes(`refs/tags/${name}`);

let version;
let published = false;
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
  // Версия уже в npm у части пакетов, а коммита выпуска здесь нет (прошлая попытка упала до push): новая сборка ушла бы
  // в npm под той же версией с другим кодом.
  const already = publicPackages().filter((name) => npmView(`${name}@${version}`, "version") === version);
  if (already.length > 0) {
    tryGit(["reset", "--hard", "--quiet", "HEAD"]);
    tryGit(["clean", "-fdq"]);
    stop(
      `Версия ${version} уже в npm у ${already.join(", ")}, а коммита выпуска ${releaseSubject(version)} в этой ветке нет — он остался там, где шла прошлая попытка.\n` +
        `   Доведите выпуск с того коммита (pnpm release --local на нём) или выпустите следующую версию. Правки changeset version отменены.`,
    );
  }
  run("git", ["add", "-A"]);
  run("git", ["commit", "-m", releaseSubject(version), "-m", coAuthor]);
} else {
  version = readVersion();
  published = isPublished(version);
  if (published && tagOnGitHub(`v${version}`)) {
    stop(
      `Нет записей об изменениях в .changeset, выпускать нечего (версия ${version} уже в npm у всех пакетов).\n` +
        "   Создайте запись: pnpm changeset (шаблоны и правила — RELEASING.md), закоммитьте её и запустите pnpm release снова.",
    );
  }
  if (headSubject() !== releaseSubject(version)) {
    stopUnlessDryRun(
      `Версия ${version} ${published ? "в npm, но не отправлена на GitHub" : "опубликована не у всех пакетов"}, а HEAD — не коммит выпуска ${releaseSubject(version)}.\n` +
        "   Доводить выпуск можно только с него: иначе пакеты и тег этой версии разойдутся с кодом. Перейдите на этот коммит и запустите снова.",
    );
  }
  console.log(published ? `Версия ${version} уже в npm, но не отправлена на GitHub. Довожу выпуск до конца.` : `Версия ${version} подготовлена раньше, но опубликована не у всех пакетов. Довожу выпуск до конца.`);
  if (dryRun) {
    console.log("\nСухой прогон закончен: сборка, публикация, тег и push — не выполнялись.");
    process.exit(0);
  }
}
/** Коммит, чей код уходит в npm: на него встают теги, его же берёт открытая выгрузка. */
const releaseCommit = run("git", ["rev-parse", "HEAD"], { quiet: true });

if (!published) {
  // Отметка verify подтверждает исходники, а не наличие/свежесть dist на этой машине.
  // После изменения версии и при повторе выпуска архивы всегда собираются заново.
  step("Сборка актуальных пакетов перед публикацией");
  run("pnpm", ["build"]);
  step("Проверка архивов npm: запретный список и ключи в том, что уйдёт в npm");
  run("node", ["scripts/check-npm-packages.mjs"]);

  step(`Публикация версии ${version} в npm`);
  publishWithToken();
}
step(`Проверяю, что npm показывает ${version} у всех пакетов`);
waitUntilVisible(version);

/** Публикация. Ключ из NPM_TOKEN или файла — через временный .npmrc, который удаляется сразу после. */
function publishWithToken() {
  const failure = "часть пакетов могла уже уйти в npm. Исправьте причину и запустите pnpm release снова: он опубликует недостающие";
  if (!npmToken) {
    run("pnpm", ["exec", "changeset", "publish"], { env: publishEnv, failure });
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "release-npmrc-"));
  const userconfig = join(dir, ".npmrc");
  // stop() выходит через process.exit, мимо finally: убираем папку и на выходе.
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  process.on("exit", cleanup);
  try {
    writeFileSync(userconfig, "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n", { mode: 0o600 });
    run("pnpm", ["exec", "changeset", "publish"], { env: { ...publishEnv, NPM_TOKEN: npmToken, NPM_CONFIG_USERCONFIG: userconfig }, failure });
  } finally {
    cleanup();
  }
}

/** Git без остановки: код выхода и вывод, решение — за вызывающим. */
function tryGit(args) {
  const result = spawnSync("git", [...githubAuth(args), ...args], { cwd: root, encoding: "utf8" });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}
const isAncestor = (older, newer) => tryGit(["merge-base", "--is-ancestor", older, newer]).ok;

/** Ключ GitHub Actions — только командам, которые ходят на GitHub, и только через настройку на одну команду. */
function githubAuth(args) {
  if (!gitPushToken || !["fetch", "push", "ls-remote"].includes(args[0])) return [];
  const basic = Buffer.from(`x-access-token:${gitPushToken}`).toString("base64");
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`];
}

// Пока шёл выпуск, в main могли запушить. Теги встают на коммит выпуска — ровно тот код, что ушёл в npm; свежий
// origin/main вливается в main слиянием поверх него. main и теги уходят одним атомарным push (или всё, или ничего).
// Пакеты к этому шагу уже в npm.
step("Теги на коммит выпуска, слияние со свежим main и push");
const tag = `v${version}`;
const tagMessage = (name) => (name === tag ? `Agent Chat SDK ${version}` : name);
// Теги пакетов ставит changeset publish на коммит выпуска; тег SDK — свой.
const releaseTags = [...new Set([...run("git", ["tag", "--points-at", releaseCommit], { quiet: true }).split("\n").filter(Boolean), tag])];
const notPushed = (reason, todo) =>
  stop(
    `${reason}\n   Пакеты ${version} уже в npm, а на GitHub не хватает коммита выпуска chore(release): v${version} и тегов: ${releaseTags.join(", ")}.\n` +
      `   Сделайте: ${todo}`,
  );
const manualFix =
  `поставьте теги на коммит выпуска ${releaseCommit.slice(0, 12)} (именно его код в npm), влейте свежий origin/main в main поверх него, ` +
  `решив конфликт, и отправьте: git push --atomic origin main ${releaseTags.map((name) => `refs/tags/${name}`).join(" ")}`;

const fetched = tryGit(["fetch", "origin", "main"]);
if (!fetched.ok) notPushed(`Не получил свежий main с GitHub:\n${fetched.output}`, `проверьте доступ к GitHub; затем ${manualFix}`);
// Есть ли свой коммит, которого нет на GitHub (при доводке прошлого выпуска его может не быть).
const hasOwnCommit = !isAncestor("HEAD", "origin/main");
if (hasOwnCommit && !isAncestor("origin/main", "HEAD")) {
  console.log("main на GitHub ушёл вперёд — вливаю его слиянием; теги остаются на коммите выпуска.");
  const merged = tryGit(["merge", "--no-edit", "-m", `Merge origin/main into ${releaseSubject(version)}`, "origin/main"]);
  if (!merged.ok) {
    tryGit(["merge", "--abort"]);
    notPushed(`Свежие правки в main задели файлы выпуска (package.json, CHANGELOG.md, файл-замок) — слияние не прошло:\n${merged.output}`, manualFix);
  }
}
for (const name of releaseTags) run("git", ["tag", "-f", "-a", name, "-m", tagMessage(name), releaseCommit], { quiet: true, failure: `пакеты ${version} уже в npm, теги не поставлены` });
const pushed = tryGit(["push", "--atomic", "origin", ...(hasOwnCommit ? ["HEAD:refs/heads/main"] : []), ...releaseTags.map((name) => `refs/tags/${name}`)]);
if (!pushed.ok) notPushed(`GitHub не принял push (атомарный: не ушло ничего):\n${pushed.output}`, `запустите pnpm release снова — опубликованное в npm он пропустит; или вручную: ${manualFix}`);

// На GitHub Actions выгрузку делают следующие шаги прогона: ключ открытого хранилища появляется только для push.
if (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`\n✅ Agent Chat SDK ${version}: npm, main и теги готовы. Открытую выгрузку ${tag} делают следующие шаги прогона.`);
  process.exit(0);
}
step(`Выгрузка ${tag} в открытое хранилище (проверки очищенного дерева и push)`);
const exported = spawnSync("node", ["scripts/export-public.mjs", tag, "--push"], { cwd: root, stdio: "inherit" });
if (exported.status !== 0) {
  const message = `Пакеты ${version} уже в npm, main и теги отправлены в закрытое хранилище. Открытое хранилище (включая CHANGES.md) не обновлено. Отката нет. Повторите только выгрузку: node scripts/export-public.mjs ${tag} --push`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
  stop(message);
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `SDK ${version}: npm, main и теги, открытое хранилище (включая CHANGES.md) обновлены.\n`);

console.log(`\n✅ Agent Chat SDK ${version} выпущен. Тег ${tag} отправлен. Журнал: packages/*/CHANGELOG.md`);
