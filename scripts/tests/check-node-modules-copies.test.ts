import { spawnSync } from "node:child_process";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findLinkedTypeFiles } from "../check-node-modules-copies.mjs";

const script = join(__dirname, "../check-node-modules-copies.mjs");
let repo: string;
let drizzle: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "nm-copies-"));
  drizzle = join(repo, "node_modules/.pnpm/drizzle-orm@1/node_modules/drizzle-orm");
  mkdirSync(join(drizzle, "better-sqlite3"), { recursive: true });
  mkdirSync(join(drizzle, "node-postgres"), { recursive: true });
  writeFileSync(join(drizzle, "better-sqlite3/index.d.ts"), 'export * from "./driver.js";\n');
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const check = () => spawnSync("node", [script], { cwd: repo, encoding: "utf8" });

describe("check-node-modules-copies: файлы типов в node_modules — свои копии, не жёсткие ссылки", () => {
  it("жёсткая ссылка на файл типов — найдена, проверка останавливает с командой починки", () => {
    linkSync(join(drizzle, "better-sqlite3/index.d.ts"), join(drizzle, "node-postgres/index.d.ts"));

    expect(findLinkedTypeFiles(repo).length).toBe(2);
    const result = check();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pnpm install --force");
  });

  it("копии с одинаковым текстом — проверка проходит", () => {
    copyFileSync(join(drizzle, "better-sqlite3/index.d.ts"), join(drizzle, "node-postgres/index.d.ts"));

    expect(findLinkedTypeFiles(repo)).toEqual([]);
    expect(check().status).toBe(0);
  });

  it("жёсткая ссылка на файл, который TypeScript не читает, — не мешает", () => {
    writeFileSync(join(drizzle, "LICENSE"), "MIT");
    linkSync(join(drizzle, "LICENSE"), join(drizzle, "node-postgres/LICENSE"));

    expect(findLinkedTypeFiles(repo)).toEqual([]);
  });

  it("нет node_modules — проверять нечего", () => {
    rmSync(join(repo, "node_modules"), { recursive: true });

    expect(check().status).toBe(0);
  });
});
