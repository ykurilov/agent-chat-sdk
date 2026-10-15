import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILLS_MIGRATION_LOCK_KEY, SKILLS_MIGRATIONS_TABLE } from "../src/store/migration-settings";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const manifest = read("packages/skills/package.json");

describe("каркас пакета @ykurilov/agent-chat-skills", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT, миграции в пакете", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-skills");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.files).toContain("drizzle");
  });

  it("входы «.», «./sqlite», «./postgres», «./labels», «./react»", () => {
    expect(Object.keys(manifest.exports)).toEqual([".", "./sqlite", "./postgres", "./labels", "./react"]);
  });

  it("база и React — необязательные peer", () => {
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
      expect(manifest.dependencies[name], `${name} не в dependencies`).toBeUndefined();
    }
  });

  it("свой журнал миграций и свой ключ блокировки — ни у кого другого его нет", () => {
    expect(SKILLS_MIGRATIONS_TABLE).toBe("__skills_migrations");
    const others = [
      "packages/background/src/store/migration-settings.ts",
      "packages/flows/src/store/migration-settings.ts",
      "packages/images/src/image-queue/migration-settings.ts",
      "packages/messengers/src/store/migration-settings.ts",
      "packages/sandbox/src/journal/postgres-journal.ts",
      "packages/storage-postgres/src/migrate.ts",
    ];
    const key = SKILLS_MIGRATION_LOCK_KEY.toLocaleString("en").replaceAll(",", "_");
    for (const path of others) expect(readFileSync(join(root, path), "utf8"), path).not.toContain(key);
  });

  it("миграции SQLite и PostgreSQL сгенерированы", () => {
    for (const dialect of ["sqlite", "postgres"]) {
      const folder = join(root, "packages/skills/drizzle", dialect);
      expect(existsSync(join(folder, "meta/_journal.json")), dialect).toBe(true);
      expect(readdirSync(folder).filter((file) => file.endsWith(".sql")).length, dialect).toBeGreaterThan(0);
    }
  });
});
