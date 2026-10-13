import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const manifest = read("packages/sandbox/package.json");

const entry = (source: string, built: string) => ({
  "@ykurilov/agent-chat-source": `./src/${source}.ts`,
  types: `./dist/types/${built}.d.ts`,
  import: `./dist/${built}.js`,
});

describe("каркас пакета @ykurilov/agent-chat-sandbox", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT, без побочных действий при импорте", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-sandbox");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.engines).toEqual({ node: ">=22" });
  });

  it("входы «.», «./react», «./sqlite», «./postgres», исходники на месте", () => {
    expect(manifest.exports).toEqual({
      ".": entry("index", "index"),
      "./react": entry("react", "react"),
      "./sqlite": entry("sqlite", "sqlite"),
      "./postgres": entry("postgres", "postgres"),
    });
    for (const name of ["index", "react", "sqlite", "postgres"]) {
      expect(existsSync(join(root, `packages/sandbox/src/${name}.ts`)), name).toBe(true);
    }
  });

  it("миграции журнала уходят в архив пакета", () => {
    expect(manifest.files).toContain("drizzle");
  });

  it("база и экран — необязательные peer: серверу с SQLite не нужен pg, серверу без экрана — React", () => {
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@ykurilov/agent-chat-react", "better-sqlite3", "pg", "react"]);
    for (const name of Object.keys(manifest.peerDependencies)) {
      expect(manifest.peerDependenciesMeta[name], name).toEqual({ optional: true });
      expect(manifest.dependencies[name], `${name} не в dependencies`).toBeUndefined();
      expect(manifest.devDependencies[name], `${name} есть для тестов`).toBeDefined();
    }
    expect(manifest.peerDependencies["@ykurilov/agent-chat-react"]).toBe("workspace:^");
  });

  it("журнал на Drizzle: drizzle-orm в работе, drizzle-kit только для миграций", () => {
    expect(manifest.dependencies["drizzle-orm"]).toBe(read("packages/storage-sqlite/package.json").dependencies["drizzle-orm"]);
    expect(manifest.devDependencies["drizzle-kit"]).toBe(read("packages/storage-sqlite/package.json").devDependencies["drizzle-kit"]);
    expect(manifest.dependencies["drizzle-kit"]).toBeUndefined();
  });
});
