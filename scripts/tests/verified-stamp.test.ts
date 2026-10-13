import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error — скрипт на .mjs, у него нет типов
import { checkStamp, codeFingerprint, writeStamp } from "../verified-stamp.mjs";

/** Маленький git-репозиторий вместо настоящего: тест не трогает файлы проекта. */
let repo: string;

const git = (...args: string[]) => {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
};
const put = (path: string, content: string) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
};
const commitAll = (message: string) => {
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", message);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "verified-stamp-"));
  git("init", "-q");
  put(".gitignore", "node_modules\ndist\n");
  put("package.json", '{"name":"x"}');
  put("packages/core/src/index.ts", "export const a = 1;\n");
  put("CHANGES.md", "# Что нового\n");
  put(".changeset/config.json", "{}");
  commitAll("first");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("отпечаток кода", () => {
  it("не меняется, если ничего не трогали", () => {
    expect(codeFingerprint(repo)).toBe(codeFingerprint(repo));
  });

  it("меняется от правки кода", () => {
    const before = codeFingerprint(repo);
    put("packages/core/src/index.ts", "export const a = 2;\n");
    expect(codeFingerprint(repo)).not.toBe(before);
  });

  it("учитывает незакоммиченную правку: коммит той же правки отпечаток не меняет", () => {
    put("packages/core/src/index.ts", "export const a = 2;\n");
    const uncommitted = codeFingerprint(repo);
    commitAll("same edit");
    expect(codeFingerprint(repo)).toBe(uncommitted);
  });

  it("учитывает новый файл, которого git ещё не видел, и удаление файла", () => {
    const before = codeFingerprint(repo);
    put("packages/core/src/extra.ts", "export const b = 1;\n");
    const withNew = codeFingerprint(repo);
    expect(withNew).not.toBe(before);
    unlinkSync(join(repo, "packages/core/src/index.ts"));
    expect(codeFingerprint(repo)).not.toBe(withNew);
  });

  it("не меняется от CHANGES.md и записей .changeset/*.md", () => {
    const before = codeFingerprint(repo);
    put("CHANGES.md", "# Что нового\n\n- 0.19.0: новое\n");
    put(".changeset/brave-lions-sing.md", "---\n'@x/y': patch\n---\nТекст\n");
    expect(codeFingerprint(repo)).toBe(before);
  });

  it("меняется от конфигов, включая .changeset/config.json, и от файла-замка", () => {
    const before = codeFingerprint(repo);
    put(".changeset/config.json", '{"fixed":[]}');
    const afterConfig = codeFingerprint(repo);
    expect(afterConfig).not.toBe(before);
    put("pnpm-lock.yaml", "lockfileVersion: 9\n");
    expect(codeFingerprint(repo)).not.toBe(afterConfig);
  });

  it("не меняется от того, что git игнорирует (dist, node_modules)", () => {
    const before = codeFingerprint(repo);
    put("dist/out.js", "built");
    put("node_modules/.cache/anything.json", "{}");
    expect(codeFingerprint(repo)).toBe(before);
  });
});

describe("отметка «код проверен»", () => {
  it("без отметки код не считается проверенным", () => {
    expect(checkStamp(repo).verified).toBe(false);
  });

  it("совпавший отпечаток — проверено, и в отметке есть время", () => {
    writeStamp(repo, codeFingerprint(repo));
    const verdict = checkStamp(repo);
    expect(verdict.verified).toBe(true);
    expect(Number.isNaN(Date.parse(verdict.verifiedAt))).toBe(false);
  });

  it("правка кода после отметки — не проверено", () => {
    writeStamp(repo, codeFingerprint(repo));
    put("packages/core/src/index.ts", "export const a = 3;\n");
    expect(checkStamp(repo).verified).toBe(false);
  });

  it("правка CHANGES.md после отметки отметку не ломает", () => {
    writeStamp(repo, codeFingerprint(repo));
    put("CHANGES.md", "# Что нового\n\n- свежая строка\n");
    expect(checkStamp(repo).verified).toBe(true);
  });

  it("повреждённая отметка — не проверено", () => {
    writeStamp(repo, codeFingerprint(repo));
    put("node_modules/.cache/agent-chat-verified.json", "{не json");
    expect(checkStamp(repo).verified).toBe(false);
    put("node_modules/.cache/agent-chat-verified.json", '{"fingerprint":1}');
    expect(checkStamp(repo).verified).toBe(false);
  });
});
