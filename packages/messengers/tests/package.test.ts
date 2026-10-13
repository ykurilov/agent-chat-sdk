import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MESSENGERS_MIGRATIONS_TABLE, MESSENGERS_MIGRATION_LOCK_KEY } from "../src/store/migration-settings";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const text = (path: string) => readFileSync(join(root, path), "utf8");
const manifest = read("packages/messengers/package.json");

const tables = [
  "messenger_links",
  "messenger_link_codes",
  "messenger_conversations",
  "messenger_member_hits",
  "messenger_updates",
  "messenger_buttons",
  "messenger_leases",
];

describe("каркас пакета @ykurilov/agent-chat-messengers", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-messengers");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.files).toContain("drizzle");
  });

  it("входы по мессенджерам, базам и экрану, исходники на месте", () => {
    expect(Object.keys(manifest.exports)).toEqual([".", "./telegram", "./vk", "./max", "./sqlite", "./postgres", "./react"]);
    for (const name of ["index", "telegram", "vk", "max", "sqlite", "postgres", "react", "messenger-adapter", "types"]) {
      expect(existsSync(join(root, `packages/messengers/src/${name}.ts`)), name).toBe(true);
    }
  });

  it("база и экран — необязательные peer", () => {
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
      expect(manifest.dependencies[name], `${name} не в dependencies`).toBeUndefined();
    }
  });

  it("свой журнал миграций и свой ключ блокировки", () => {
    expect(MESSENGERS_MIGRATIONS_TABLE).toBe("__messengers_migrations");
    expect(MESSENGERS_MIGRATION_LOCK_KEY).toBe(7_311_900_445);
  });

  it("миграции создают все таблицы мессенджеров", () => {
    const sqlite = text("packages/messengers/drizzle/sqlite/0000_init.sql");
    const postgres = text("packages/messengers/drizzle/postgres/0000_init.sql");
    for (const table of tables) {
      expect(sqlite, table).toContain(`CREATE TABLE \`${table}\``);
      expect(postgres, table).toContain(`CREATE TABLE "agent_chat"."${table}"`);
    }
  });
});
