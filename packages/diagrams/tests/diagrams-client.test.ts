// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramColors } from "../src/index";

/** Подменённый mermaid: считает загрузки модуля, запоминает настройки и рисует по исходнику. */
const fake = vi.hoisted(() => ({
  loaded: 0,
  configs: [] as Array<Record<string, any>>,
  render: null as unknown as (...args: any[]) => Promise<{ svg: string }>,
}));

vi.mock("mermaid", () => {
  fake.loaded += 1;
  return {
    default: {
      initialize: (config: Record<string, any>) => fake.configs.push(config),
      render: (...args: unknown[]) => fake.render(...args),
    },
  };
});

const light: DiagramColors = { background: "#ffffff", text: "#111111", line: "#555555", node: "#f2f2f2", accent: "#3366ff", dark: false };
const dark: DiagramColors = { background: "#101010", text: "#eeeeee", line: "#aaaaaa", node: "#222222", accent: "#6688ff", dark: true };

async function freshClient() {
  vi.resetModules();
  fake.loaded = 0;
  fake.configs = [];
  return (await import("../src/diagrams-client")).createDiagramsClient();
}

beforeEach(() => {
  fake.render = vi.fn(async (_id: string, source: string) => {
    if (source.includes("ошибка")) throw new Error("Parse error on line 2");
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>${source.length}</text></svg>` };
  });
});

describe("diagramsClient: ленивый mermaid, строгий режим, кэш (FR-024, FR-026, FR-028)", () => {
  it("mermaid загружается только при первом render и один раз", async () => {
    const client = await freshClient();
    expect(fake.loaded).toBe(0);
    await client.render("graph TD\nA-->B", light);
    await client.render("graph TD\nA-->C", light);
    expect(fake.loaded).toBe(1);
  });

  it("настройки: strict, без HTML в подписях, тема base в цветах скина, без вывода ошибок на страницу", async () => {
    const client = await freshClient();
    await client.render("graph TD\nA-->B", dark);
    const config = fake.configs.at(-1)!;
    expect(config).toMatchObject({ startOnLoad: false, securityLevel: "strict", htmlLabels: false, theme: "base", suppressErrorRendering: true });
    expect(config.flowchart?.htmlLabels).toBe(false);
    expect(config.themeVariables).toMatchObject({
      darkMode: true,
      background: dark.background,
      primaryColor: dark.node,
      primaryTextColor: dark.text,
      lineColor: dark.line,
    });
    expect(JSON.stringify(config.themeVariables)).toContain(dark.accent);
  });

  it("готовый рисунок очищен", async () => {
    const client = await freshClient();
    const result = await client.render("graph TD\nA-->B", light);
    expect(result).toHaveProperty("svg");
    expect((result as { svg: string }).svg).not.toContain("script");
    expect((result as { svg: string }).svg).toContain("<text>");
  });

  it("ошибка разбора — { error }, не исключение", async () => {
    const client = await freshClient();
    expect(await client.render("graph TD\nошибка", light)).toEqual({ error: expect.stringContaining("Parse error") });
  });

  it("больше 20 000 знаков или больше 200 узлов — { error } без рисования и без загрузки mermaid", async () => {
    const client = await freshClient();
    const long = `graph TD\n${"A-->B\n".repeat(3400)}`;
    expect(long.length).toBeGreaterThan(20_000);
    expect(await client.render(long, light)).toHaveProperty("error");
    const crowded = `graph TD\n${Array.from({ length: 201 }, (_, n) => `N${n}`).join("\n")}`;
    expect(await client.render(crowded, light)).toHaveProperty("error");
    const chain = `graph TD\n${Array.from({ length: 202 }, (_, n) => `N${n}`).join("-->")}`;
    expect(await client.render(chain, light)).toHaveProperty("error");
    expect(fake.render).not.toHaveBeenCalled();
    expect(fake.loaded).toBe(0);
    const fits = `graph TD\n${Array.from({ length: 150 }, (_, n) => `N${n}`).join("\n")}`;
    expect(await client.render(fits, light)).toHaveProperty("svg");
  });

  it("кэш по source + colors: та же пара не рисуется заново, смена темы — перерисовка", async () => {
    const client = await freshClient();
    const first = await client.render("graph TD\nA-->B", light);
    expect(await client.render("graph TD\nA-->B", light)).toBe(first);
    expect(fake.render).toHaveBeenCalledTimes(1);
    await client.render("graph TD\nA-->B", dark);
    expect(fake.render).toHaveBeenCalledTimes(2);
    expect(fake.configs.at(-1)!.themeVariables.darkMode).toBe(true);
  });

  it("одновременные рисунки в разных темах не смешивают настройки: каждый рисуется под своими", async () => {
    const client = await freshClient();
    const seen: boolean[] = [];
    fake.render = vi.fn(async () => {
      seen.push(fake.configs.at(-1)!.themeVariables.darkMode);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(fake.configs.at(-1)!.themeVariables.darkMode);
      return { svg: "<svg></svg>" };
    });
    await Promise.all([client.render("graph TD\nA", light), client.render("graph TD\nB", dark)]);
    expect(seen).toEqual([false, false, true, true]);
  });

  it("diagramsClient из точки входа — готовый рисовальщик", async () => {
    vi.resetModules();
    const { diagramsClient } = await import("../src/index");
    expect(typeof diagramsClient.render).toBe("function");
  });
});
