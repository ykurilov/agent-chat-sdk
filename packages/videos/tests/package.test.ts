import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { VideoAddress, VideoEntry } from "../src/index";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const manifest = read("packages/videos/package.json");

describe("каркас пакета @ykurilov/agent-chat-videos", () => {
  it("имя, версия вместе с ядром, открытый npm, лицензия MIT", () => {
    expect(manifest.name).toBe("@ykurilov/agent-chat-videos");
    expect(manifest.version).toBe(read("packages/core/package.json").version);
    expect(manifest.publishConfig).toEqual({ registry: "https://registry.npmjs.org", access: "public" });
    expect(manifest.license).toBe("MIT");
  });

  it("входы «.» и «./react» без масок, исходники на месте", () => {
    expect(manifest.exports).toEqual({
      ".": { "@ykurilov/agent-chat-source": "./src/index.ts", types: "./dist/types/index.d.ts", import: "./dist/index.js" },
      "./react": {
        "@ykurilov/agent-chat-source": "./src/react/index.ts",
        types: "./dist/types/react/index.d.ts",
        import: "./dist/react/index.js",
      },
    });
    expect(existsSync(join(root, "packages/videos/src/index.ts"))).toBe(true);
    expect(existsSync(join(root, "packages/videos/src/react/index.ts"))).toBe(true);
  });

  it("react и пакет экрана — необязательные peer", () => {
    expect(Object.keys(manifest.peerDependencies).sort()).toEqual(["@ykurilov/agent-chat-react", "react"]);
    expect(manifest.peerDependenciesMeta.react).toEqual({ optional: true });
    expect(manifest.peerDependenciesMeta["@ykurilov/agent-chat-react"]).toEqual({ optional: true });
  });

  it("версия пакета ведётся вместе с остальными (changesets, группа fixed)", () => {
    expect((read(".changeset/config.json").fixed as string[][]).flat()).toContain("@ykurilov/agent-chat-videos");
  });

  it("типы договора: запись каталога и адрес видео", () => {
    expectTypeOf<VideoAddress["provider"]>().toEqualTypeOf<"youtube" | "kinescope">();
    expectTypeOf<VideoEntry["chapters"]>().toEqualTypeOf<Array<{ title: string; startSeconds: number }> | undefined>();
    expect(true).toBe(true);
  });
});
