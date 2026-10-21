import { describe, expect, it } from "vitest";
import { stepIconOf } from "../../src/work-view/step-icons";

const call = (toolName: string) => ({ toolName, state: "done" as const });

describe("stepIconOf: значок шага", () => {
  it("значок приложения рядом с фразой главнее угадывания; функция фраз тоже может его дать", () => {
    expect(stepIconOf(call("deploy"), { phrases: { deploy: { running: "Выкладываю", done: "Выложил", icon: "run" } } })).toBe("run");
    expect(stepIconOf(call("deploy"), { phrases: { deploy: () => ({ icon: "check" }) } })).toBe("check");
  });

  it("встроенные инструменты SDK, MCP и помощники", () => {
    expect(stepIconOf(call("use_skill"))).toBe("skill");
    expect(stepIconOf(call("web_search"))).toBe("web");
    expect(stepIconOf(call("page_screenshot"))).toBe("snapshot");
    expect(stepIconOf(call("manage_memory"))).toBe("memory");
    expect(stepIconOf(call("generate_images"))).toBe("image");
    expect(stepIconOf(call("github__create_issue"))).toBe("mcp");
    expect(stepIconOf(call("helper_analyst"))).toBe("helper");
  });

  it("по словам имени: правка, чтение, поиск, проверка, снимок, запуск; иначе общий", () => {
    expect(stepIconOf(call("edit_file"))).toBe("edit");
    expect(stepIconOf(call("writeFile"))).toBe("edit");
    expect(stepIconOf(call("read_file"))).toBe("read");
    expect(stepIconOf(call("grep_code"))).toBe("search");
    expect(stepIconOf(call("run_tests"))).toBe("check");
    expect(stepIconOf(call("take_screenshot"))).toBe("snapshot");
    expect(stepIconOf(call("bash"))).toBe("run");
    expect(stepIconOf(call("pick_slot_for_me"))).toBe("tool");
  });

  it("ошибка функции фраз — значок угадывается, чат не ломается", () => {
    const phrases = {
      read_file: () => {
        throw new Error("сломалась");
      },
    };
    expect(stepIconOf(call("read_file"), { phrases })).toBe("read");
  });
});
