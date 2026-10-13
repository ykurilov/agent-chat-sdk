import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AspectRatio, ImageCatalog, ImageModelProfile, ImageProviderDescription } from "../src/index";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const manifest = read("packages/images/package.json");

describe("каркас пакета @ykurilov/agent-chat-images", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-images");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
  });

  it("входы «.», «./react», «./sqlite» и «./postgres» без масок, исходники на месте", () => {
    expect(manifest.exports).toEqual({
      ".": {
        "@ykurilov/agent-chat-source": "./src/index.ts",
        types: "./dist/types/index.d.ts",
        import: "./dist/index.js",
      },
      "./react": {
        "@ykurilov/agent-chat-source": "./src/react/index.ts",
        types: "./dist/types/react/index.d.ts",
        import: "./dist/react/index.js",
      },
      "./sqlite": {
        "@ykurilov/agent-chat-source": "./src/sqlite.ts",
        types: "./dist/types/sqlite.d.ts",
        import: "./dist/sqlite.js",
      },
      "./postgres": {
        "@ykurilov/agent-chat-source": "./src/postgres.ts",
        types: "./dist/types/postgres.d.ts",
        import: "./dist/postgres.js",
      },
    });
    expect(existsSync(join(root, "packages/images/src/index.ts"))).toBe(true);
    expect(existsSync(join(root, "packages/images/src/react/index.ts"))).toBe(true);
  });

  it("зависит от ядра и вложений; react, пакет экрана и драйверы баз задач — необязательные peer", () => {
    expect(manifest.dependencies["@ykurilov/agent-chat-core"]).toBe("workspace:*");
    expect(manifest.dependencies["@ykurilov/agent-chat-attachments"]).toBe("workspace:*");
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@ykurilov/agent-chat-react", "better-sqlite3", "pg", "react"]);
    for (const name of ["react", "better-sqlite3", "pg"]) expect(manifest.peerDependenciesMeta[name]).toEqual({ optional: true });
    expect(manifest.peerDependenciesMeta["@ykurilov/agent-chat-react"]).toEqual({ optional: true });
  });

  it("версия пакета ведётся вместе с остальными (changesets, группа fixed)", () => {
    const fixed: string[][] = read(".changeset/config.json").fixed;
    expect(fixed.flat()).toContain("@ykurilov/agent-chat-images");
  });

  it("типы договора: пропорции, профиль модели, провайдер, каталог", () => {
    expectTypeOf<AspectRatio>().toEqualTypeOf<"1:1" | "3:2" | "2:3" | "16:9" | "9:16">();
    expectTypeOf<ImageModelProfile["aspectRatios"]>().toEqualTypeOf<Record<AspectRatio, { width: number; height: number }>>();
    expectTypeOf<ImageModelProfile["providerModelIds"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<ImageModelProfile["pricePerImageUsd"]>().toEqualTypeOf<number>();
    expectTypeOf<ImageProviderDescription["apiKeyEnv"]>().toEqualTypeOf<string>();
    expectTypeOf<ImageCatalog>().toHaveProperty("providers");
    expectTypeOf<ImageCatalog>().toHaveProperty("models");
    expect(true).toBe(true);
  });
});
