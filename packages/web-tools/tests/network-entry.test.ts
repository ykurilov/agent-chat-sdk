import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]!);

/** Пакеты, которые подтягивает файл со всеми своими относительными импортами. */
function packagesReachedFrom(entry: string): string[] {
  const reached = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of importsOf(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) {
        reached.add(specifier);
        continue;
      }
      const base = resolve(dirname(file), specifier);
      const target = [`${base}.ts`, join(base, "index.ts")].find((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
      if (target) visit(target);
    }
  };
  visit(entry);
  return [...reached].sort();
}

describe("вход ./network", () => {
  it("только сеть: без инструментов, служб поиска, ядра и ai — пакет undici грузится лишь при первом запросе", () => {
    expect(packagesReachedFrom(join(packageRoot, "src/network.ts"))).toEqual(["node:dns", "node:dns/promises", "node:net", "undici"]);
    const pinned = readFileSync(join(packageRoot, "src/pinned-fetch.ts"), "utf8");
    expect(pinned).not.toMatch(/^import \{[^}]*\} from "undici"/m);
  });

  it("объявлен в exports пакета рядом с главным входом", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { exports: Record<string, unknown>; dependencies: Record<string, string> };
    expect(manifest.exports["./network"]).toEqual({
      "@ykurilov/agent-chat-source": "./src/network.ts",
      types: "./dist/types/network.d.ts",
      import: "./dist/network.js",
    });
    expect(manifest.dependencies.undici).toBeDefined();
  });
});
