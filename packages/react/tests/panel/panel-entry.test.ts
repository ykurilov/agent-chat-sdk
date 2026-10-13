import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const dist = join(packageRoot, "dist");

/** Файлы, до которых доходит вход через статические импорты: сам файл и всё, что он подтягивает. */
function importClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      queue.push(join(file, "..", match[1]!));
    }
  }
  return seen;
}

describe("вход ./panel", () => {
  it("описан в exports пакета рядом с основным входом", () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(manifest.exports["./panel"]).toEqual({
      "@ykurilov/agent-chat-source": "./src/agent-panel/index.ts",
      types: "./dist/types/agent-panel/index.d.ts",
      import: "./dist/panel.js",
    });
  });

  it("сборка даёт dist/panel.js, а основной вход не тянет код панели", () => {
    rmSync(dist, { recursive: true, force: true });
    execFileSync("pnpm", ["build"], { cwd: packageRoot, stdio: "pipe" });
    expect(existsSync(join(dist, "panel.js"))).toBe(true);
    expect(existsSync(join(dist, "types", "agent-panel", "index.d.ts"))).toBe(true);
    // Основной вход со всем, что он подтягивает, не доходит до входа панели.
    expect(importClosure(join(dist, "index.js")).has(join(dist, "panel.js"))).toBe(false);
    // Словарь и контекст подписей — один общий кусок у обоих входов: `ChatLabelsProvider` приложения доходит до чата в панели.
    const withLabels = readdirSync(dist)
      .filter((file) => file.endsWith(".js") && /agentPanelToolUnavailable:/.test(readFileSync(join(dist, file), "utf8")))
      .map((file) => join(dist, file));
    expect(withLabels).toHaveLength(1);
    expect(importClosure(join(dist, "index.js")).has(withLabels[0]!)).toBe(true);
    expect(importClosure(join(dist, "panel.js")).has(withLabels[0]!)).toBe(true);
  }, 120_000);
});
