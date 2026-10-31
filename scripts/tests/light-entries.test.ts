import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, it } from "vitest";

it.each([
  ["skins/oduvanchik/src/text.tsx", 80_000],
  ["packages/flows/src/labels/index.ts", 15_000],
] as const)("light entry %s stays isolated from chat/editor controls", async (entry, gzipBudget) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, minify: true, platform: "browser", format: "esm", jsx: "automatic", write: false, metafile: true, external: ["react", "react/jsx-runtime", "react-dom"], conditions: ["@ykurilov/agent-chat-source"] });
  const inputs = Object.keys(result.metafile!.inputs).join("\n");
  expect(inputs).not.toMatch(/@xyflow|@tandem|@phosphor|packages\/react|@ai-sdk|node_modules\/ai\//);
  expect(gzipSync(result.outputFiles![0]!.contents).byteLength).toBeLessThan(gzipBudget);
  if (entry.includes("flows")) expect(inputs).not.toMatch(/node_modules\/react|drizzle|node_modules\/zod/);
});
