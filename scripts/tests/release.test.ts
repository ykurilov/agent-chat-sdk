import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptsFolder = join(__dirname, "..");

/**
 * Настоящий `release.mjs` в чужой папке: рядом лежат подставные `git`, `pnpm` и `npm`, которые только пишут в журнал,
 * что их позвали. Так проверяются ветки выпуска, а опубликовать и запушить по-настоящему тест не может.
 */
let project: string;
let home: string;
let bin: string;
let logFile: string;

const fakeCommand = (name: string, body: string) => {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\necho "${name} $*" >> "$FAKE_LOG"\n${body}\n`);
  chmodSync(path, 0o755);
};

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "release-"));
  home = mkdtempSync(join(tmpdir(), "release-home-"));
  bin = join(project, "bin");
  logFile = join(project, "calls.log");
  mkdirSync(bin);
  mkdirSync(join(project, "scripts"));
  mkdirSync(join(project, ".changeset"));
  mkdirSync(join(project, "packages/core"), { recursive: true });
  for (const file of ["release.mjs", "release-in-actions.mjs", "verified-stamp.mjs"]) copyFileSync(join(scriptsFolder, file), join(project, "scripts", file));
  writeFileSync(join(project, ".changeset/README.md"), "# записи\n");
  writeFileSync(join(project, "packages/core/package.json"), JSON.stringify({ name: "@ykurilov/agent-chat-core", version: "1.2.3" }));
  writeFileSync(logFile, "");
  // Подставная проверка открытой выгрузки: пишет в журнал, при FAKE_EXPORT_FAIL падает.
  writeFileSync(
    join(project, "scripts/export-public.mjs"),
    `import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_LOG, "export-public " + process.argv.slice(2).join(" ") + "\\n");
if (process.env.FAKE_EXPORT_FAIL) { console.error("запретный список: 2 мест"); process.exit(1); }
`,
  );
  fakeCommand(
    "git",
    `case "$1" in
  rev-parse) echo "\${FAKE_BRANCH:-main}" ;;
  status) printf "%s" "\${FAKE_DIRTY:-}" ;;
  tag) if [ "$2" = "--list" ]; then printf "%s" "\${FAKE_EXISTING_TAG:-}"; fi ;;
esac
exit 0`,
  );
  fakeCommand("pnpm", "exit 0");
  // dist-tags.latest — проверка «npm показывает новую версию»: показывает после FAKE_LATEST_AFTER опросов, при FAKE_NEVER_LATEST никогда.
  fakeCommand(
    "npm",
    `case "$*" in *dist-tags.latest*)
  n=$(( $(cat "$FAKE_LOG.latest" 2>/dev/null || echo 0) + 1 )); echo $n > "$FAKE_LOG.latest"
  [ -z "\${FAKE_NEVER_LATEST:-}" ] && [ "$n" -gt "\${FAKE_LATEST_AFTER:-0}" ] && echo 1.2.3 && exit 0
  exit 1 ;;
esac
[ -n "$FAKE_PUBLISHED" ] && echo "$FAKE_PUBLISHED" && exit 0
exit 1`,
  );
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const addChangeset = () => writeFileSync(join(project, ".changeset/fix.md"), '---\n"@ykurilov/agent-chat-core": patch\n---\n\nПравка.\n');
const addToken = () => writeFileSync(join(home, ".npmrc"), "//registry.npmjs.org/:_authToken=abc123\n");

/** Выпуск на этой машине (`--local`): так же он идёт и на GitHub Actions. */
const release = (args: string[] = [], env: Record<string, string> = {}) => runRelease(["--local", ...args], env);

function runRelease(args: string[], env: Record<string, string>) {
  const result = spawnSync("node", [join(project, "scripts/release.mjs"), ...args], {
    cwd: project,
    encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, FAKE_LOG: logFile, ...env },
  });
  const calls = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

describe("release.mjs: ветки выпуска", () => {
  it("не из ветки main: стоп, ничего не запущено", () => {
    addToken();
    const result = release([], { FAKE_BRANCH: "feature" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("только из ветки main");
    expect(result.calls.some((call) => call.startsWith("pnpm") || call.startsWith("npm"))).toBe(false);
  });

  it("незакоммиченные изменения: стоп", () => {
    addToken();
    const result = release([], { FAKE_DIRTY: " M file.ts" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("незакоммиченные изменения");
  });

  it("нет токена npm: стоп до проверок и публикации", () => {
    addChangeset();
    const result = release();
    expect(result.status).toBe(1);
    expect(result.output).toContain("Нет ключа npm");
    expect(result.calls.some((call) => call.startsWith("pnpm"))).toBe(false);
  });

  it("токен из переменной окружения тоже годится", () => {
    const result = release(["--dry-run"], { NODE_AUTH_TOKEN: "abc" });
    expect(result.output).not.toContain("Нет токена");
  });

  it("сухой прогон без токена не останавливается, а сообщает", () => {
    addChangeset();
    const result = release(["--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("в настоящем выпуске здесь был бы стоп");
    expect(result.calls.some((call) => call.includes("changeset") || call.startsWith("git push"))).toBe(false);
  });

  it("нет записей, а версия уже в npm: выпускать нечего", () => {
    addToken();
    const result = release([], { FAKE_PUBLISHED: "1.2.3" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("выпускать нечего (версия 1.2.3 уже в npm у всех пакетов)");
    expect(result.calls.some((call) => call.includes("publish") || call.startsWith("git push"))).toBe(false);
  });

  it("подготовлен, но не опубликован: собирает, публикует, ставит тег и пушит, новую версию не создаёт", () => {
    addToken();
    const result = release();
    expect(result.status).toBe(0);
    expect(result.output).toContain("подготовлена раньше, но опубликована не у всех пакетов");
    expect(result.calls).toEqual(
      expect.arrayContaining(["pnpm build", "pnpm exec changeset publish", "git tag -a v1.2.3 -m Agent Chat SDK 1.2.3", "git push origin main --tags"]),
    );
    expect(result.calls.some((call) => call.includes("changeset version"))).toBe(false);
    expect(result.calls.indexOf("pnpm exec changeset publish")).toBeLessThan(result.calls.indexOf("git push origin main --tags"));
  });

  it("подготовлен, но не опубликован, сухой прогон: ничего не публикуется", () => {
    addToken();
    const result = release(["--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.includes("publish") || call.includes("build") || call.startsWith("git push"))).toBe(false);
  });

  it("тег уже стоит после прошлой попытки: второй раз не создаётся, push идёт", () => {
    addToken();
    const result = release([], { FAKE_EXISTING_TAG: "v1.2.3" });
    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.startsWith("git tag -a"))).toBe(false);
    expect(result.calls).toContain("git push origin main --tags");
  });

  it("новая запись: проверки, версия, коммит, публикация, тег, push — в этом порядке", () => {
    addToken();
    addChangeset();
    const result = release(["--full"]);
    expect(result.status).toBe(0);
    const order = ["export-public HEAD --check-only", "pnpm test", "pnpm typecheck", "pnpm build", "pnpm exec changeset version", "git commit", "pnpm exec changeset publish", "git tag -a", "git push"];
    const positions = order.map((prefix) => result.calls.findIndex((call) => call.startsWith(prefix)));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(result.calls.find((call) => call.startsWith("git commit"))).toContain("chore(release): v1.2.3");
  });

  it("открытая выгрузка не проходит запретный список: стоп до проверок, новой версии и публикации", () => {
    addToken();
    addChangeset();
    const result = release(["--full"], { FAKE_EXPORT_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("запретный список");
    expect(result.calls).toContain("export-public HEAD --check-only");
    expect(result.calls.some((call) => call.startsWith("pnpm") || call.startsWith("git commit") || call.startsWith("git push"))).toBe(false);
  });

  it("сбой проверок: выпуск остановлен до новой версии и публикации", () => {
    addToken();
    addChangeset();
    fakeCommand("pnpm", `[ "$1" = "test" ] && exit 1\nexit 0`);
    const result = release(["--full"]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("ничего не опубликовано");
    expect(result.calls.some((call) => call.includes("changeset version") || call.includes("publish"))).toBe(false);
  });

  it("ключ из ~/.config/agent-chat-sdk/npm-token: публикация через временный .npmrc, ключ нигде не напечатан, файл удалён", () => {
    mkdirSync(join(home, ".config/agent-chat-sdk"), { recursive: true });
    writeFileSync(join(home, ".config/agent-chat-sdk/npm-token"), "secret-value-42\n");
    const seen = join(project, "seen.txt");
    fakeCommand(
      "pnpm",
      `if [ "$3" = "publish" ]; then echo "$NPM_CONFIG_USERCONFIG" > "${seen}"; cat "$NPM_CONFIG_USERCONFIG" >> "${seen}"; [ "$NPM_TOKEN" = "secret-value-42" ] && echo "token-ok" >> "${seen}"; fi\nexit 0`,
    );
    const result = release();
    expect(result.status).toBe(0);
    const [userconfig, ...rest] = readFileSync(seen, "utf8").trim().split("\n");
    expect(rest).toEqual(["//registry.npmjs.org/:_authToken=${NPM_TOKEN}", "token-ok"]);
    expect(existsSync(userconfig)).toBe(false);
    expect(result.output).not.toContain("secret-value-42");
    expect(result.calls.join("\n")).not.toContain("secret-value-42");
  });

  it("путь к ключу из ~/.config/agent-chat-sdk/release.env: ключ найден, не напечатан", () => {
    mkdirSync(join(home, ".config/agent-chat-sdk"), { recursive: true });
    mkdirSync(join(home, "keys"));
    writeFileSync(join(home, "keys/npm.txt"), "secret-from-env-file\n");
    writeFileSync(join(home, ".config/agent-chat-sdk/release.env"), "NPM_TOKEN_FILE=~/keys/npm.txt\n");
    const seen = join(project, "seen.txt");
    fakeCommand("pnpm", `if [ "$3" = "publish" ]; then [ "$NPM_TOKEN" = "secret-from-env-file" ] && echo "token-ok" > "${seen}"; fi\nexit 0`);
    const result = release();
    expect(result.status).toBe(0);
    expect(readFileSync(seen, "utf8").trim()).toBe("token-ok");
    expect(result.output).not.toContain("secret-from-env-file");
  });

  it("ключ в переменной NPM_TOKEN: стопа «нет токена» нет", () => {
    const result = release([], { NPM_TOKEN: "env-secret" });
    expect(result.status).toBe(0);
    expect(result.output).not.toContain("env-secret");
  });

  it("сбой публикации: тег и push не выполняются", () => {
    addToken();
    fakeCommand("pnpm", `[ "$2" = "changeset" ] && [ "$3" = "publish" ] && exit 1\nexit 0`);
    const result = release();
    expect(result.status).toBe(1);
    expect(result.output).toContain("часть пакетов могла уже уйти в npm");
    expect(result.calls.some((call) => call.startsWith("git tag -a") || call.startsWith("git push"))).toBe(false);
  });

  it("npm показывает новую версию не сразу: ждёт, потом тег и push", () => {
    addToken();
    const result = release([], { FAKE_LATEST_AFTER: "2", RELEASE_VISIBILITY_INTERVAL_MS: "10" });
    expect(result.status).toBe(0);
    expect(result.output).toContain("npm ещё не показывает 1.2.3");
    const latestChecks = result.calls.filter((call) => call.includes("dist-tags.latest"));
    expect(latestChecks).toHaveLength(3);
    expect(latestChecks[0]).toContain("--registry https://registry.npmjs.org --@ykurilov:registry=https://registry.npmjs.org");
    expect(result.calls.indexOf(latestChecks[2])).toBeLessThan(result.calls.indexOf("git push origin main --tags"));
  });

  it("npm так и не показал новую версию: стоп, тег и push не выполняются", () => {
    addToken();
    const result = release([], { FAKE_NEVER_LATEST: "1", RELEASE_VISIBILITY_TIMEOUT_MS: "50", RELEASE_VISIBILITY_INTERVAL_MS: "10" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("так и не показал 1.2.3 как latest у: @ykurilov/agent-chat-core");
    expect(result.calls.some((call) => call.startsWith("git tag -a") || call.startsWith("git push"))).toBe(false);
  });

  it("опубликована не у всех пакетов: выпуск доводится", () => {
    addToken();
    mkdirSync(join(project, "packages/mcp"));
    writeFileSync(join(project, "packages/mcp/package.json"), JSON.stringify({ name: "@ykurilov/agent-chat-mcp", version: "1.2.3" }));
    fakeCommand("npm", `case "$*" in *agent-chat-mcp@*) exit 1 ;; esac\necho 1.2.3`);
    const result = release();
    expect(result.status).toBe(0);
    expect(result.output).toContain("опубликована не у всех пакетов");
    expect(result.calls).toContain("pnpm exec changeset publish");
  });
});

describe("release.mjs с Мака: выпуск запускается на GitHub Actions", () => {
  beforeEach(() => {
    // HEAD и origin/main — один коммит, пока не задан FAKE_UNPUSHED; ветки на GitHub — из FAKE_REMOTE_BRANCHES.
    fakeCommand(
      "git",
      `case "$1 $2" in
  "rev-parse --abbrev-ref") echo "\${FAKE_BRANCH:-main}" ;;
  "rev-parse HEAD") if [ -n "\${FAKE_UNPUSHED:-}" ]; then echo local; else echo same; fi ;;
  "rev-parse --verify") case " \${FAKE_REMOTE_BRANCHES:-main} " in *" \${4#origin/} "*) echo same ;; *) exit 1 ;; esac ;;
  "status --porcelain") printf "%s" "\${FAKE_DIRTY:-}" ;;
  "log -1") echo "abc123 последний коммит" ;;
esac
exit 0`,
    );
    fakeCommand(
      "gh",
      `case "$1 $2" in
  "workflow run") echo "https://github.com/owner/repo/actions/runs/42" ;;
  "run watch") [ "\${FAKE_CONCLUSION:-success}" = success ] ;;
  "run view") case "$*" in
      *".url"*) echo "https://github.com/owner/repo/actions/runs/42" ;;
      *".conclusion"*) echo "\${FAKE_CONCLUSION:-success}" ;;
      *--log-failed*) echo "шаг pnpm release упал" ;;
    esac ;;
esac
exit 0`,
    );
  });

  it("выпуск: запускает release.yml на main без сухого режима, ждёт и печатает ссылку на прогон", () => {
    const result = runRelease([], {});
    expect(result.status).toBe(0);
    expect(result.calls).toContain("gh workflow run release.yml --ref main -f dry_run=false");
    expect(result.calls).toContain("gh run watch 42 --compact --exit-status --interval 30");
    expect(result.output).toContain("Выпуск прошёл. Прогон: https://github.com/owner/repo/actions/runs/42");
    expect(result.calls.some((call) => call.startsWith("pnpm") || call.startsWith("npm"))).toBe(false);
  });

  it("сухой прогон: на текущей ветке, если она есть на GitHub", () => {
    const result = runRelease(["--dry-run"], { FAKE_BRANCH: "094-github-ci", FAKE_REMOTE_BRANCHES: "main 094-github-ci" });
    expect(result.status).toBe(0);
    expect(result.calls).toContain("gh workflow run release.yml --ref 094-github-ci -f dry_run=true");
  });

  it("сухой прогон с ветки, которой нет на GitHub: на main", () => {
    const result = runRelease(["--dry-run"], { FAKE_BRANCH: "local-only" });
    expect(result.calls).toContain("gh workflow run release.yml --ref main -f dry_run=true");
  });

  it("локальный main не запушен: стоп до запуска", () => {
    const result = runRelease([], { FAKE_UNPUSHED: "1" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("git push");
    expect(result.calls.some((call) => call.startsWith("gh"))).toBe(false);
  });

  it("незакоммиченные изменения в main: стоп до запуска", () => {
    const result = runRelease([], { FAKE_DIRTY: " M packages/core/src/index.ts" });
    expect(result.status).toBe(1);
    expect(result.calls.some((call) => call.startsWith("gh"))).toBe(false);
  });

  it("прогон упал: код 1, конец журнала и ссылка", () => {
    const result = runRelease([], { FAKE_CONCLUSION: "failure" });
    expect(result.status).toBe(1);
    expect(result.output).toContain("шаг pnpm release упал");
    expect(result.output).toContain("Выпуск не прошёл (failure). Прогон: https://github.com/owner/repo/actions/runs/42");
  });

  it("на GitHub Actions выпуск идёт на месте, без запуска нового прогона", () => {
    addToken();
    const result = runRelease([], { GITHUB_ACTIONS: "true" });
    expect(result.status).toBe(0);
    expect(result.calls.some((call) => call.startsWith("gh"))).toBe(false);
    expect(result.calls).toContain("git push origin main --tags");
  });

  it("на GitHub Actions без ключа, но с OIDC: стопа «нет ключа» нет, публикация доверенной публикацией", () => {
    const result = runRelease([], { GITHUB_ACTIONS: "true", ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/token" });
    expect(result.status).toBe(0);
    expect(result.output).not.toContain("Нет ключа npm");
    expect(result.calls).toContain("pnpm exec changeset publish");
  });
});
