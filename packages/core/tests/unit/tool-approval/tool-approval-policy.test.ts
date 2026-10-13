import { tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ALWAYS_OFFERED_REASON } from "../../../src/tool-approval/approval-parts";
import { prepareToolApproval } from "../../../src/tool-approval/tool-approval-policy";

const input = z.object({ path: z.string() });
const call = (toolName: string, args: unknown) => ({ toolCall: { toolName, input: args, toolCallId: "c1" }, messages: [] }) as never;

describe("prepareToolApproval", () => {
  it("без needsApproval ни у одного инструмента правило не нужно", () => {
    const tools = { read: tool({ description: "d", inputSchema: input, execute: async () => "ok" }) };
    const prepared = prepareToolApproval(tools, new Set());
    expect(prepared.toolApproval).toBeUndefined();
    expect(prepared.tools).toBe(tools);
  });

  it("needsApproval: true просит подтверждение, другие инструменты — нет", async () => {
    const tools = {
      remove: tool({ description: "d", inputSchema: input, needsApproval: true, execute: async () => "ok" }),
      read: tool({ description: "d", inputSchema: input, execute: async () => "ok" }),
    };
    const decide = prepareToolApproval(tools, new Set()).toolApproval!;
    expect(await decide(call("remove", { path: "a" }))).toEqual({ type: "user-approval", reason: ALWAYS_OFFERED_REASON });
    expect(await decide(call("read", { path: "a" }))).toBeUndefined();
  });

  it("функция needsApproval не предлагает «Всегда» и метку «Всегда в этом чате» не учитывает", async () => {
    const tools = { remove: tool({ description: "d", inputSchema: input, needsApproval: () => true, execute: async () => "ok" }) };
    const decide = prepareToolApproval(tools, new Set(["remove"])).toolApproval!;
    expect(await decide(call("remove", { path: "a" }))).toBe("user-approval");
  });

  it("функция needsApproval решает по входным данным вызова", async () => {
    const tools = {
      remove: tool({
        description: "d",
        inputSchema: input,
        needsApproval: (args) => args.path.startsWith("/etc"),
        execute: async () => "ok",
      }),
    };
    const decide = prepareToolApproval(tools, new Set()).toolApproval!;
    expect(await decide(call("remove", { path: "/etc/passwd" }))).toBe("user-approval");
    expect(await decide(call("remove", { path: "/tmp/x" }))).toBeUndefined();
  });

  it("«всегда в этом чате» снимает вопрос по имени инструмента", async () => {
    const tools = { remove: tool({ description: "d", inputSchema: input, needsApproval: true, execute: async () => "ok" }) };
    const decide = prepareToolApproval(tools, new Set(["remove"])).toolApproval!;
    expect(await decide(call("remove", { path: "a" }))).toBe("not-applicable");
  });

  it("инструменты для SDK идут без needsApproval: решает только наше правило, порядок и состав те же", () => {
    const tools = {
      b: tool({ description: "d", inputSchema: input, needsApproval: true, execute: async () => "ok" }),
      a: tool({ description: "d", inputSchema: input, execute: async () => "ok" }),
    };
    const prepared = prepareToolApproval(tools, new Set());
    expect(Object.keys(prepared.tools!)).toEqual(["b", "a"]);
    expect((prepared.tools!.b as { needsApproval?: unknown }).needsApproval).toBeUndefined();
    expect((tools.b as { needsApproval?: unknown }).needsApproval).toBe(true);
  });
});
