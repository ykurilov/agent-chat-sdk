import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DiagramColors, DiagramsClient } from "../src/index";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const manifest = read("packages/diagrams/package.json");

describe("каркас пакета @ykurilov/agent-chat-diagrams", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-diagrams");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
  });

  it("точка входа одна и без масок, исходник на месте", () => {
    expect(Object.keys(manifest.exports)).toEqual(["."]);
    expect(manifest.exports["."]).toEqual({
      "@ykurilov/agent-chat-source": "./src/index.ts",
      types: "./dist/types/index.d.ts",
      import: "./dist/index.js",
    });
    expect(existsSync(join(root, "packages/diagrams/src/index.ts"))).toBe(true);
  });

  it("mermaid 12 — зависимость только этого пакета; ядру он не нужен", () => {
    expect(manifest.dependencies.mermaid).toMatch(/^\^?12\./);
    expect(read("packages/core/package.json").dependencies.mermaid).toBeUndefined();
    expect(read("packages/react/package.json").dependencies?.mermaid).toBeUndefined();
  });

  it("версия пакета ведётся вместе с остальными (changesets, группа fixed)", () => {
    const fixed: string[][] = read(".changeset/config.json").fixed;
    expect(fixed.flat()).toContain("@ykurilov/agent-chat-diagrams");
  });

  it("типы договора: клиент рисует схему по цветам и отвечает svg или error", () => {
    expectTypeOf<DiagramsClient["render"]>().toEqualTypeOf<
      (source: string, colors: DiagramColors) => Promise<{ svg: string } | { error: string }>
    >();
    expectTypeOf<DiagramColors>().toEqualTypeOf<{ background: string; text: string; line: string; node: string; accent: string; dark: boolean }>();
    expect(true).toBe(true);
  });
});
