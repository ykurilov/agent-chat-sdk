import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../load-secrets.mjs", import.meta.url));
const FAKE_KEY = "fake-runware-key-9f3a1c";

/** Папка-«дом» и копия скрипта рядом с чужим `.env.local`: настоящий файл ключей репозитория тест не трогает. */
let sandbox: string;
let home: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "load-secrets-"));
  home = join(sandbox, "home");
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  mkdirSync(join(home, ".claude", "secrets"), { recursive: true });
  copyFileSync(script, join(sandbox, "scripts", "load-secrets.mjs"));
});
afterEach(() => rmSync(sandbox, { recursive: true, force: true }));

function run(extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [join(sandbox, "scripts", "load-secrets.mjs")], {
    env: { PATH: process.env.PATH ?? "", HOME: home, ...extraEnv },
    encoding: "utf8",
  });
  const envLocal = join(sandbox, ".env.local");
  let written: Record<string, string> = {};
  try {
    written = parseEnv(readFileSync(envLocal, "utf8")) as Record<string, string>;
  } catch {
    // файл не создан
  }
  return { ...result, written, output: `${result.stdout}\n${result.stderr}` };
}

describe("scripts/load-secrets.mjs: RUNWARE_API_KEY", () => {
  it("берёт ключ из ~/.claude/secrets/runware.env (формат `export ИМЯ=значение`) и пишет в .env.local", () => {
    writeFileSync(join(home, ".claude", "secrets", "runware.env"), `export RUNWARE_API_KEY=${FAKE_KEY}\n`);
    const result = run();
    expect(result.written.RUNWARE_API_KEY).toBe(FAKE_KEY);
    expect(result.stdout).toContain("RUNWARE_API_KEY ←");
  });

  it("значение ключа не попадает ни в вывод, ни в сообщения об ошибках", () => {
    writeFileSync(join(home, ".claude", "secrets", "runware.env"), `export RUNWARE_API_KEY=${FAKE_KEY}\n`);
    expect(run().output).not.toContain(FAKE_KEY);
  });

  it("RUNWARE_API_KEY_FILE переопределяет путь; файл без кавычек и без export тоже читается", () => {
    const custom = join(sandbox, "custom-runware.env");
    writeFileSync(custom, `RUNWARE_API_KEY="${FAKE_KEY}"\n`);
    const result = run({ RUNWARE_API_KEY_FILE: custom });
    expect(result.written.RUNWARE_API_KEY).toBe(FAKE_KEY);
    expect(result.stdout).toContain(custom);
  });

  it("нет файла — ключ не пишется, ошибка называет файл и переменную переопределения", () => {
    const result = run();
    expect(result.written.RUNWARE_API_KEY).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RUNWARE_API_KEY: нет файла");
    expect(result.stderr).toContain("RUNWARE_API_KEY_FILE");
  });

  it("в файле нет нужной переменной — ошибка «файл пустой», значения других переменных не выводятся", () => {
    writeFileSync(join(home, ".claude", "secrets", "runware.env"), "OTHER_KEY=do-not-print-me\n");
    const result = run();
    expect(result.written.RUNWARE_API_KEY).toBeUndefined();
    expect(result.stderr).toContain("RUNWARE_API_KEY: файл");
    expect(result.output).not.toContain("do-not-print-me");
  });

  it("остальные ключи в .env.local сохраняются", () => {
    writeFileSync(join(sandbox, ".env.local"), 'DEEPSEEK_API_KEY="keep-me"\n');
    writeFileSync(join(home, ".claude", "secrets", "runware.env"), `export RUNWARE_API_KEY=${FAKE_KEY}\n`);
    const result = run();
    expect(result.written.DEEPSEEK_API_KEY).toBe("keep-me");
    expect(result.written.RUNWARE_API_KEY).toBe(FAKE_KEY);
  });
});

describe("scripts/load-secrets.mjs: KIE_API_KEY", () => {
  const FAKE_KIE_KEY = "fake-kie-key-7b2e04";

  it("берёт ключ из ~/.claude/secrets/kie.env, значение не выводит", () => {
    writeFileSync(join(home, ".claude", "secrets", "kie.env"), `KIE_API_KEY=${FAKE_KIE_KEY}\n`);
    const result = run();
    expect(result.written.KIE_API_KEY).toBe(FAKE_KIE_KEY);
    expect(result.stdout).toContain("KIE_API_KEY ←");
    expect(result.output).not.toContain(FAKE_KIE_KEY);
  });

  it("KIE_API_KEY_FILE переопределяет путь; нет файла — ошибка называет переменную переопределения", () => {
    const missing = run();
    expect(missing.written.KIE_API_KEY).toBeUndefined();
    expect(missing.stderr).toContain("KIE_API_KEY: нет файла");
    expect(missing.stderr).toContain("KIE_API_KEY_FILE");
    const custom = join(sandbox, "custom-kie.env");
    writeFileSync(custom, `export KIE_API_KEY="${FAKE_KIE_KEY}"\n`);
    expect(run({ KIE_API_KEY_FILE: custom }).written.KIE_API_KEY).toBe(FAKE_KIE_KEY);
  });
});
