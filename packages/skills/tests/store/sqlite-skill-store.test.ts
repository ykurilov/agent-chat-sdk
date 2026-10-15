import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteChatStorage } from "../../../storage-sqlite/src/sqlite-storage";
import { sqliteSkillStore } from "../../src/sqlite";
import { at, describeSkillStoreContract, newSkill } from "./skill-store-contract";

const folders: string[] = [];
function freshFile(): string {
  const folder = mkdtempSync(join(tmpdir(), "skills-"));
  folders.push(folder);
  return join(folder, "skills.sqlite");
}
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function tables(filePath: string): string[] {
  const database = new Database(filePath, { readonly: true });
  try {
    return (database.prepare("select name from sqlite_master where type = 'table' order by name").all() as Array<{ name: string }>).map((row) => row.name);
  } finally {
    database.close();
  }
}

describe("навыки в SQLite", () => {
  describeSkillStoreContract(async () => {
    const file = freshFile();
    const first = sqliteSkillStore(file);
    const second = sqliteSkillStore(file);
    return { first, second, close: async () => {} };
  });

  it("общий файл с чатами: свои таблицы и свой журнал миграций, повторное открытие ничего не ломает", async () => {
    const file = freshFile();
    const chats = createSqliteChatStorage({ filePath: file });
    await sqliteSkillStore(file).create(newSkill(), at(1));
    const again = sqliteSkillStore(file);
    expect((await again.get("game-dev"))?.version).toBe(1);
    expect(tables(file)).toEqual(expect.arrayContaining(["__skills_migrations", "skills", "skill_versions", "skill_loads"]));
    chats.close();
  });
});
