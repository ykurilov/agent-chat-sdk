import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../../../", import.meta.url);

interface Manifest {
  name: string;
  private?: boolean;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

function readManifest(folder: string): Manifest {
  return JSON.parse(readFileSync(new URL(`${folder}/package.json`, root), "utf8")) as Manifest;
}

const published = ["packages", "skins"].flatMap((group) =>
  readdirSync(new URL(`${group}/`, root)).map((name) => readManifest(`${group}/${name}`)).filter((manifest) => !manifest.private),
);

describe("публикуемые пакеты", () => {
  it("найдены все двадцать пять пакетов", () => {
    expect(published).toHaveLength(25);
    expect(published.map(({ name }) => name)).toContain("@ykurilov/agent-chat-skin-oduvanchik");
  });

  it.each(published.map((manifest) => [manifest.name, manifest] as const))("%s требует Node 22 и новее: встроенный WebSocket есть только там", (_name, manifest) => {
    expect(manifest.engines?.node).toBe(">=22");
  });
});

describe.each([["packages/attachments"], ["packages/images"], ["packages/videos"], ["packages/image-library"], ["packages/sandbox"], ["packages/messengers"], ["packages/flows"]])("пакет с входом для экрана: %s", (folder) => {
  const manifest = readManifest(folder);

  it("React и экран чата — необязательные: серверу без экрана они не нужны", () => {
    for (const name of ["react", "@ykurilov/agent-chat-react"]) {
      expect(manifest.dependencies?.[name], `${name} не в dependencies`).toBeUndefined();
      expect(manifest.peerDependencies?.[name], `${name} в peerDependencies`).toBeDefined();
      expect(manifest.peerDependenciesMeta?.[name]?.optional, `${name} необязательный`).toBe(true);
    }
  });

  it("peer на экран чата — `workspace:^`: при публикации станет диапазоном ^версия, а не точной версией", () => {
    expect(manifest.peerDependencies?.["@ykurilov/agent-chat-react"]).toBe("workspace:^");
  });
});
