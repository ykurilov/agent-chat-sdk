import { tool } from "ai";
import type { ToolSet } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { trackToolErrors } from "../../../src/agent-run/tool-errors";

const options = { toolCallId: "call-1", messages: [] };

function failingTool(error: unknown): ToolSet {
  const execute = async () => {
    throw error;
  };
  return { lookup: tool({ description: "Справка.", inputSchema: z.object({}), execute: execute as () => unknown }) } as ToolSet;
}

async function thrownBy(error: unknown): Promise<unknown> {
  const { tools } = trackToolErrors(failingTool(error), { secrets: ["provider-key-123456"] });
  const execute = tools.lookup!.execute as (input: unknown, options: unknown) => unknown;
  return Promise.resolve(execute({}, options)).then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
}

describe("trackToolErrors: секреты в ошибке инструмента", () => {
  it("чистятся сообщение, стек и причина (`cause`), даже если в сообщении секрета нет", async () => {
    const error = new Error("запрос не прошёл", { cause: new Error("connect postgres://app:S3cret@db/x") });
    error.stack = "Error: запрос не прошёл\n    at call (key provider-key-123456)";
    const thrown = (await thrownBy(error)) as Error;
    expect(thrown.message).toBe("запрос не прошёл");
    expect(thrown.stack).not.toContain("provider-key-123456");
    expect((thrown.cause as Error).message).toBe("connect postgres://app:[скрыто]@db/x");
  });

  it("причина-строка тоже чистится", async () => {
    const thrown = (await thrownBy(new Error("сбой", { cause: "password=hunter2" }))) as Error;
    expect(thrown.cause).toBe("password=[скрыто]");
  });
});
