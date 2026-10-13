import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));

/** Все исходники папки: .ts и .tsx. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const importsOf = (text: string) => [...text.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]!);

/** Пакеты, которые подтягивает файл со всеми своими относительными импортами. */
function packagesReachedFrom(entry: string): Set<string> {
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
      const target = [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find((path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      });
      if (target) visit(target);
    }
  };
  visit(entry);
  return reached;
}

const basePackages = ["packages/core", "packages/server", "packages/react", "packages/attachments", "skins/tandem"];

describe("картинки — необязательный пакет (FR-034, T048)", () => {
  it.each(basePackages)("%s не зависит от пакета картинок и не импортирует его", (dir) => {
    const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const field of ["dependencies", "peerDependencies", "devDependencies", "optionalDependencies"]) {
      expect(Object.keys(manifest[field] ?? {})).not.toContain("@ykurilov/agent-chat-images");
    }
    for (const file of sources(join(root, dir, "src"))) {
      expect(importsOf(readFileSync(file, "utf8")).filter((specifier) => specifier.startsWith("@ykurilov/agent-chat-images")), file).toEqual([]);
    }
  });

  it.each(["packages/core", "packages/server"])("%s не знает инструмента generate_images: у модели его нет без пакета", (dir) => {
    for (const file of sources(join(root, dir, "src"))) expect(readFileSync(file, "utf8"), file).not.toContain("generate_images");
  });

  it("вход ./react не тянет серверную часть: ни ai, ни zod, ни ядра — только пакет экрана", () => {
    expect([...packagesReachedFrom(join(root, "packages/images/src/react/index.ts"))]).toEqual(["@ykurilov/agent-chat-react"]);
  });
});
