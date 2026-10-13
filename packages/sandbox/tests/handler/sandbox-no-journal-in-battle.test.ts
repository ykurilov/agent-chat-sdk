import { describe, expect, it } from "vitest";
import { createMemorySandboxJournal } from "../../src/index";
import type { SandboxJournal } from "../../src/index";
import { setupSandbox } from "./support/sandbox-setup";

/** T045: боевой ход журнала не касается; журнал пишет только ход, идущий через песочницу. */

function countingJournal() {
  const inner = createMemorySandboxJournal({ env: {} });
  const calls = { model: 0, tool: 0 };
  const journal: SandboxJournal = {
    ...inner,
    enqueueModelCall: (event) => {
      calls.model += 1;
      inner.enqueueModelCall(event);
    },
    enqueueToolCall: (event) => {
      calls.tool += 1;
      inner.enqueueToolCall(event);
    },
    flush: () => inner.flush(),
  };
  return { journal, calls };
}

describe("боевой ход без песочницы (T045)", () => {
  it("не зовёт журнал, а ход через песочницу зовёт", async () => {
    const { journal, calls } = countingJournal();
    const setup = setupSandbox({ sandbox: { journal }, steps: [{ toolCall: { id: "c1", name: "none", input: {} } }, { text: "ок" }] });

    const created = await setup.callBattle("POST", "", { body: {} });
    const { id } = (await created.json()) as { id: string };
    const turn = await setup.callBattle("POST", `/${id}/messages`, {
      body: { message: { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: "привет" }] } },
    });
    expect(turn.status).toBe(200);
    await turn.text();
    await setup.battle.handler.flush();
    expect(calls).toEqual({ model: 0, tool: 0 });

    await setup.send(await setup.createChat());
    expect(calls.model).toBeGreaterThan(0);
  });
});
