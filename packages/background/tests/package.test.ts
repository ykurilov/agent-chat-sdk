import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BACKGROUND_MIGRATIONS_TABLE, BACKGROUND_MIGRATION_LOCK_KEY } from "../src/store/migration-settings";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const text = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = read("packages/background/package.json");

describe("каркас пакета @ykurilov/agent-chat-background", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-background");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.files).toContain("drizzle");
  });

  it("входы «.», «./sqlite», «./postgres», «./labels», исходники на месте", () => {
    expect(Object.keys(manifest.exports)).toEqual([".", "./sqlite", "./postgres", "./labels"]);
    for (const name of ["index", "sqlite", "postgres", "types", "labels"]) {
      expect(existsSync(join(root, `packages/background/src/${name}.ts`)), name).toBe(true);
    }
  });

  it("база — необязательный peer", () => {
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
      expect(manifest.dependencies[name], `${name} не в dependencies`).toBeUndefined();
    }
  });

  it("свой журнал миграций и свой ключ блокировки, не пересекаются с песочницей и памятью", () => {
    expect(BACKGROUND_MIGRATIONS_TABLE).toBe("__background_migrations");
    expect(BACKGROUND_MIGRATION_LOCK_KEY).toBe(7_311_900_444);
    expect(text("packages/sandbox/src/journal/postgres-journal.ts")).not.toContain("7_311_900_444");
    expect(text("packages/storage-postgres/src/migrate.ts")).not.toContain("7_311_900_444");
  });

  it("миграции создают только background_tasks", () => {
    const sqlite = text("packages/background/drizzle/sqlite/0000_init.sql");
    const postgres = text("packages/background/drizzle/postgres/0000_init.sql");
    expect(sqlite.match(/CREATE TABLE `([a-z_]+)`/g)).toEqual(["CREATE TABLE `background_tasks`"]);
    expect(postgres).toContain('CREATE TABLE "agent_chat"."background_tasks"');
  });
});
