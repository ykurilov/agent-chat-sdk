import { describe, expect, expectTypeOf, it } from "vitest";
import * as flows from "../../src/index";
import type { AgentFlowHandle } from "../../src/index";

// 0.53: то, что приложению понадобилось при переносе на сценарии, — в публичном входе пакета.

describe("публичный вход 0.53", () => {
  it("`tick()` — в типе сценария: один обход таймеров для тестов и ручного запуска", () => {
    expectTypeOf<AgentFlowHandle["tick"]>().toEqualTypeOf<() => Promise<void>>();
  });

  it("`factId` — id факта карточки по тексту: регистр и пробелы не важны", () => {
    const { factId } = flows as Record<string, unknown> as { factId?: (text: string) => string };
    expect(typeof factId).toBe("function");
    expect(factId!("Курс  по Акварели ")).toBe(factId!("курс по акварели"));
    expect(factId!("курс по акварели")).toMatch(/^f[0-9a-f]{8}$/);
  });
});
