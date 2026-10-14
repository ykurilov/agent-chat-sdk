import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FLOWS_MIGRATIONS_TABLE, FLOWS_MIGRATION_LOCK_KEY } from "../src/store/migration-settings";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const text = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = read("packages/flows/package.json");

describe("каркас пакета @ykurilov/agent-chat-flows", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-flows");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "drizzle", "agent-flow.schema.json"]));
  });

  it("входы «.», «./format», «./react», «./sqlite», «./postgres» и JSON Schema, исходники на месте", () => {
    expect(Object.keys(manifest.exports)).toEqual([".", "./format", "./react", "./sqlite", "./postgres", "./agent-flow.schema.json"]);
    for (const name of ["index", "format", "react", "sqlite", "postgres"]) {
      expect(existsSync(join(root, `packages/flows/src/${name}.ts`)), name).toBe(true);
    }
    expect(manifest.exports["./agent-flow.schema.json"]).toBe("./agent-flow.schema.json");
  });

  it("база, React и экран чата — необязательные peer", () => {
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@ykurilov/agent-chat-react", "better-sqlite3", "pg", "react"]);
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
      expect(manifest.dependencies[name], `${name} не в dependencies`).toBeUndefined();
    }
  });

  it("свой журнал миграций и свой ключ блокировки, не пересекаются с соседями", () => {
    expect(FLOWS_MIGRATIONS_TABLE).toBe("__flows_migrations");
    expect(FLOWS_MIGRATION_LOCK_KEY).toBe(7_311_900_447);
    for (const path of [
      "packages/storage-postgres/src/migrate.ts",
      "packages/sandbox/src/journal/postgres-journal.ts",
      "packages/background/src/store/migration-settings.ts",
      "packages/messengers/src/store/migration-settings.ts",
      "packages/images/src/image-queue/migration-settings.ts",
    ]) {
      expect(text(path), path).not.toContain("7_311_900_447");
    }
  });

  it("миграции создают только таблицы flow_*", () => {
    const sqlite = text("packages/flows/drizzle/sqlite/0000_init.sql");
    const postgres = text("packages/flows/drizzle/postgres/0000_init.sql");
    const tables = ["flow_chats", "flow_client_cards", "flow_first_messages", "flow_versions"];
    expect(sqlite.match(/CREATE TABLE `([a-z_]+)`/g)).toEqual(tables.map((table) => `CREATE TABLE \`${table}\``));
    expect(postgres.match(/CREATE TABLE "agent_chat"\."([a-z_]+)"/g)).toEqual(tables.map((table) => `CREATE TABLE "agent_chat"."${table}"`));
  });
});
