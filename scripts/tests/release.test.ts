import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  for (const file of ["release.mjs", "verified-stamp.mjs"]) copyFileSync(join(scriptsFolder, file), join(project, "scripts", file));
  writeFileSync(join(project, ".changeset/README.md"), "# записи\n");
  writeFileSync(join(project, "packages/core/package.json"), JSON.stringify({ name: "@ykurilov/agent-chat-core", version: "1.2.3" }));
  writeFileSync(logFile, "");
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
  fakeCommand("npm", `[ -n "$FAKE_PUBLISHED" ] && echo "$FAKE_PUBLISHED" && exit 0\nexit 1`);
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const addChangeset = () => writeFileSync(join(project, ".changeset/fix.md"), '---\n"@ykurilov/agent-chat-core": patch\n---\n\nПравка.\n');
const addToken = () => writeFileSync(join(home, ".npmrc"), "//registry.npmjs.org/:_authToken=abc123\n");

function release(args: string[] = [], env: Record<string, string> = {}) {
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
    expect(result.output).toContain("Нет токена для registry.npmjs.org");
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
    expect(result.output).toContain("выпускать нечего (версия 1.2.3 уже в npm)");
    expect(result.calls.some((call) => call.includes("publish") || call.startsWith("git push"))).toBe(false);
  });

  it("подготовлен, но не опубликован: собирает, публикует, ставит тег и пушит, новую версию не создаёт", () => {
    addToken();
    const result = release();
    expect(result.status).toBe(0);
    expect(result.output).toContain("подготовлена раньше, но не опубликована");
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
    const order = ["pnpm test", "pnpm typecheck", "pnpm build", "pnpm exec changeset version", "git commit", "pnpm exec changeset publish", "git tag -a", "git push"];
    const positions = order.map((prefix) => result.calls.findIndex((call) => call.startsWith(prefix)));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(result.calls.find((call) => call.startsWith("git commit"))).toContain("chore(release): v1.2.3");
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

  it("сбой публикации: тег и push не выполняются", () => {
    addToken();
    fakeCommand("pnpm", `[ "$2" = "changeset" ] && [ "$3" = "publish" ] && exit 1\nexit 0`);
    const result = release();
    expect(result.status).toBe(1);
    expect(result.calls.some((call) => call.startsWith("git tag -a") || call.startsWith("git push"))).toBe(false);
  });
});
