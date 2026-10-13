import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/*
 * SC-006: начальная загрузка экрана чата не растёт от схем, mermaid грузится только на странице со схемой.
 * Проверяется настоящей сборкой Vite (тем же Vite и теми же условиями, что у демо) по её манифесту: что входит в
 * начальную загрузку (точка входа и всё, что она тянет статическим импортом), а что — отдельные куски по `import()`.
 */

const root = fileURLToPath(new URL("../../..", import.meta.url));
const demo = join(root, "apps/demo");
const workDir = mkdtempSync(join(demo, ".sc006-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

/** Нужная часть Vite демо: пакет схем от Vite не зависит, поэтому он берётся из демо по пути. */
interface Vite {
  build(config: Record<string, unknown>): Promise<unknown>;
  defaultClientConditions: readonly string[];
}
const loadVite = (): Promise<Vite> => import(pathToFileURL(join(demo, "node_modules/vite/dist/node/index.js")).href);

interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
}
type Manifest = Record<string, ManifestChunk>;

/**
 * Код mermaid узнаётся по содержимому, а не по манифесту: статически импортированный mermaid вклеился бы в кусок точки
 * входа и в манифесте отдельно не значился бы. Метки — строки самого mermaid, которых нет в коде пакета схем.
 */
const MERMAID_CODE = /mermaidAPI|No diagram type detected/;

/** Ключи манифеста, которые грузятся сразу с точкой входа: сама точка и её статические импорты. */
function initialLoad(manifest: Manifest, entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const next of manifest[key]?.imports ?? []) visit(next);
  };
  visit(entry);
  return seen;
}

/** Ключи, до которых можно дойти из точки входа хоть как-то, в том числе через `import()`. */
function reachable(manifest: Manifest, entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const next of [...(manifest[key]?.imports ?? []), ...(manifest[key]?.dynamicImports ?? [])]) visit(next);
  };
  visit(entry);
  return seen;
}

interface Built {
  manifest: Manifest;
  entry: string;
  outDir: string;
}

/** Код JS-файлов сборки по ключам манифеста. */
const codeOf = ({ manifest, outDir }: Built, keys: Iterable<string>) =>
  [...keys]
    .map((key) => manifest[key]?.file)
    .filter((file): file is string => file?.endsWith(".js") === true)
    .map((file) => readFileSync(join(outDir, file), "utf8"));

async function build(name: string, options: { input: string; configFile?: string }): Promise<Built> {
  const vite = await loadVite();
  const outDir = join(workDir, `out-${name}`);
  await vite.build({
    root: demo,
    configFile: options.configFile ?? false,
    logLevel: "error",
    resolve: {
      conditions: [...vite.defaultClientConditions, "@ykurilov/agent-chat-source"],
      // Демо пока не ставит пакет схем (его подключает этап 7): берём исходник пакета напрямую.
      alias: { "@ykurilov/agent-chat-diagrams": join(root, "packages/diagrams/src/index.ts") },
    },
    build: { outDir, emptyOutDir: true, manifest: true, minify: false, rollupOptions: { input: options.input } },
  });
  const manifest = JSON.parse(readFileSync(join(outDir, ".vite/manifest.json"), "utf8")) as Manifest;
  const entry = Object.keys(manifest).find((key) => manifest[key]!.isEntry);
  if (!entry) throw new Error("в сборке нет точки входа");
  return { manifest, entry, outDir };
}

/** Точка входа экрана чата: `AgentChat` со скином Тандем, со схемами или без. */
function chatEntry(name: string, withDiagrams: boolean): string {
  const file = join(workDir, `${name}.ts`);
  writeFileSync(
    file,
    [
      'import { createElement } from "react";',
      'import { createRoot } from "react-dom/client";',
      'import { AgentChat } from "@ykurilov/agent-chat-react";',
      'import { tandemSkin } from "@ykurilov/agent-chat-skin-tandem";',
      withDiagrams ? 'import { diagramsClient } from "@ykurilov/agent-chat-diagrams";' : "",
      `createRoot(document.getElementById("root")!).render(createElement(AgentChat, { api: "/api/chat", chatId: "c1", skin: tandemSkin${withDiagrams ? ", diagrams: diagramsClient" : ""} }));`,
    ].join("\n"),
  );
  return file;
}

describe("SC-006: mermaid — отдельный кусок, только по первой схеме", () => {
  it("демо: начальная загрузка без mermaid", async () => {
    const built = await build("demo", { input: join(demo, "index.html"), configFile: join(demo, "vite.config.ts") });
    expect(codeOf(built, initialLoad(built.manifest, built.entry)).filter((code) => MERMAID_CODE.test(code))).toEqual([]);
  }, 300_000);

  it("экран чата без diagrams: кода mermaid нет в сборке вовсе, ни одного ленивого куска", async () => {
    const built = await build("plain", { input: chatEntry("plain", false) });
    // Слово «mermaid» в сборке есть законно: это разбор блоков ```mermaid в тексте ответа, а не сама библиотека.
    expect(codeOf(built, Object.keys(built.manifest)).filter((code) => MERMAID_CODE.test(code))).toEqual([]);
    expect(Object.values(built.manifest).filter((chunk) => /mermaid/i.test(chunk.file))).toEqual([]);
  }, 300_000);

  it("экран чата с diagrams: mermaid — отдельный кусок вне начальной загрузки, доступный только через import()", async () => {
    const built = await build("diagrams", { input: chatEntry("diagrams", true) });
    const initial = initialLoad(built.manifest, built.entry);
    expect(codeOf(built, initial).filter((code) => MERMAID_CODE.test(code))).toEqual([]);
    const lazy = [...reachable(built.manifest, built.entry)].filter((key) => !initial.has(key));
    expect(codeOf(built, lazy).some((code) => MERMAID_CODE.test(code))).toBe(true);
  }, 300_000);
});
